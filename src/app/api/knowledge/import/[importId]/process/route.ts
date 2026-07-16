import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { extractKnowledgeFromImage, type ExtractedKnowledgeItem } from "@/lib/knowledgeImport/extraction";
import { generateFaqSuggestions } from "@/lib/knowledgeImport/faqGeneration";
import { findLikelyDuplicate, findLikelyDuplicateAmong } from "@/lib/knowledgeImport/duplicateDetection";
import { renderPdfToImages } from "@/lib/knowledgeImport/pdfToImages";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/knowledgeImport/constants";

// This is the first route in this codebase that needs an explicit
// maxDuration — it runs multiple synchronous OpenAI vision calls
// (one or more per uploaded file/PDF page) plus a final FAQ-generation
// call, entirely within one request. 300s is Vercel's Pro-plan ceiling
// for a single serverless function; if the project is on the Hobby plan
// (60s ceiling) this will need lowering along with MAX_FILES_PER_BATCH/
// MAX_PDF_PAGES, or moving to a background job — flagged for follow-up
// if real batches start timing out.
export const runtime = "nodejs";
export const maxDuration = 300;

const STORAGE_BUCKET = "knowledge-imports";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ importId: string }> }
) {
  const { importId } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: importRow, error: importError } = await supabase
    .from("knowledge_imports")
    .select("id, org_id, status")
    .eq("id", importId)
    .single();

  if (importError || !importRow) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", importRow.org_id)
    .eq("owner_id", user.id)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  if (importRow.status === "processing") {
    return NextResponse.json({ error: "This batch is already processing." }, { status: 409 });
  }

  if (importRow.status === "ready_for_review" || importRow.status === "committed") {
    return NextResponse.json({ error: "This batch has already been processed." }, { status: 409 });
  }

  const orgId = importRow.org_id;

  await supabase.from("knowledge_imports").update({ status: "processing" }).eq("id", importId);

  const { data: files, error: filesError } = await supabase
    .from("knowledge_import_files")
    .select("id, storage_path, mime_type, original_filename")
    .eq("import_id", importId)
    .eq("status", "pending");

  if (filesError || !files || files.length === 0) {
    await supabase
      .from("knowledge_imports")
      .update({ status: "failed", error_message: "No files available to process." })
      .eq("id", importId);
    return NextResponse.json({ error: "No files available to process." }, { status: 400 });
  }

  let knowledgeItemCount = 0;
  let skippedRedundantCount = 0;
  const allExtractedItems: ExtractedKnowledgeItem[] = [];
  const failedFiles: { id: string; filename: string; error: string }[] = [];

  // Items already staged EARLIER IN THIS SAME BATCH — checked in addition
  // to the existing Knowledge Base (findLikelyDuplicate), so a document
  // that yields both a structured KB entry and an AI-generated FAQ
  // restating the same fact ("Call-out fee" vs "Do you charge a
  // call-out fee?") doesn't stage both as unrelated drafts. See
  // findLikelyDuplicateAmong's own comment for the real case this fixes.
  const stagedInBatch: { id: string; title: string; content: string | null }[] = [];

  for (const file of files) {
    await supabase
      .from("knowledge_import_files")
      .update({ status: "processing" })
      .eq("id", file.id);

    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(file.storage_path);

      if (downloadError || !blob) {
        throw new Error(downloadError?.message ?? "Download returned no data.");
      }

      // Build the list of page images to run extraction on — a direct
      // image is one "page"; a PDF is rendered to one image per page.
      let pageImages: { buffer: Buffer; mimeType: string }[];

      if (file.mime_type === "application/pdf") {
        const pdfBuffer = Buffer.from(await blob.arrayBuffer());
        const rendered = await renderPdfToImages(pdfBuffer);
        if (!rendered) throw new Error("Could not render PDF pages — file may be corrupt or encrypted.");
        pageImages = rendered.map((p) => ({ buffer: p.buffer, mimeType: p.mimeType }));

        await supabase
          .from("knowledge_import_files")
          .update({ page_count: rendered.length })
          .eq("id", file.id);
      } else {
        pageImages = [{ buffer: Buffer.from(await blob.arrayBuffer()), mimeType: file.mime_type }];
      }

      let fileHadAnyItem = false;

      for (const page of pageImages) {
        const dataUrl = `data:${page.mimeType};base64,${page.buffer.toString("base64")}`;
        const result = await extractKnowledgeFromImage(dataUrl);
        if (!result) continue;

        for (const item of result.items) {
          fileHadAnyItem = true;
          allExtractedItems.push(item);

          // Same fact already staged from an earlier page/file in this
          // batch (e.g. a price repeated on two pages of a brochure) —
          // skip the redundant draft rather than staging two near-
          // identical entries with no relationship between them.
          const batchDuplicate = findLikelyDuplicateAmong(item.title, item.content, stagedInBatch);
          if (batchDuplicate) {
            skippedRedundantCount++;
            continue;
          }

          const duplicate = await findLikelyDuplicate(supabase, orgId, item.title, item.content);
          const lowConfidence =
            item.confidence < LOW_CONFIDENCE_THRESHOLD || (item.price !== null && !item.currency);

          const { data: insertedItem, error: insertError } = await supabase
            .from("knowledge_staged_items")
            .insert({
              org_id: orgId,
              import_id: importId,
              source_file_id: file.id,
              item_type: "knowledge",
              category: item.category,
              title: item.title,
              content: item.content,
              price: item.price,
              currency: item.currency ?? result.detectedCurrency,
              duration_minutes: item.duration_minutes,
              notes: item.notes,
              quote_required: item.quote_required,
              starting_from: item.starting_from,
              confidence: item.confidence,
              low_confidence: lowConfidence,
              duplicate_of: duplicate?.knowledgeId ?? null,
            })
            .select("id")
            .single();

          if (!insertError && insertedItem) {
            knowledgeItemCount++;
            stagedInBatch.push({ id: insertedItem.id, title: item.title, content: item.content });
          }
        }
      }

      await supabase
        .from("knowledge_import_files")
        .update({ status: fileHadAnyItem ? "extracted" : "failed" })
        .eq("id", file.id);

      if (!fileHadAnyItem) {
        failedFiles.push({
          id: file.id,
          filename: file.original_filename,
          error: "No information could be extracted from this file.",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown processing error.";
      console.error("[knowledge/import/process] file failed:", file.id, message);
      await supabase
        .from("knowledge_import_files")
        .update({ status: "failed", error_message: message })
        .eq("id", file.id);
      failedFiles.push({ id: file.id, filename: file.original_filename, error: message });
    }
  }

  // ── FAQ generation over the aggregate of everything just extracted ──
  let faqItemCount = 0;
  if (allExtractedItems.length > 0) {
    const summary = allExtractedItems
      .map((item) => {
        const parts = [`- ${item.title}`];
        if (item.content) parts.push(item.content);
        if (item.price !== null) parts.push(`Price: ${item.price}${item.currency ? ` ${item.currency}` : ""}`);
        if (item.duration_minutes !== null) parts.push(`Duration: ${item.duration_minutes} min`);
        if (item.notes) parts.push(`Notes: ${item.notes}`);
        return parts.join(" — ");
      })
      .join("\n");

    const faqs = await generateFaqSuggestions(summary);

    if (faqs) {
      for (const faq of faqs) {
        // A suggested FAQ that just restates a KB entry (or an earlier
        // FAQ) already staged in this same batch is redundant — same
        // reasoning as the KB-item check above. This is the exact case
        // found in testing: a "Call-out fee" KB entry plus a "Do you
        // charge a call-out fee?" FAQ both extracted from one document,
        // left free to drift out of sync once only one got edited.
        const batchDuplicate = findLikelyDuplicateAmong(faq.question, faq.answer, stagedInBatch);
        if (batchDuplicate) {
          skippedRedundantCount++;
          continue;
        }

        const duplicate = await findLikelyDuplicate(supabase, orgId, faq.question, faq.answer);

        const { data: insertedFaq, error: insertError } = await supabase
          .from("knowledge_staged_items")
          .insert({
            org_id: orgId,
            import_id: importId,
            item_type: "faq",
            category: "faq",
            title: faq.question,
            content: faq.answer,
            confidence: faq.confidence,
            low_confidence: faq.confidence < LOW_CONFIDENCE_THRESHOLD,
            duplicate_of: duplicate?.knowledgeId ?? null,
          })
          .select("id")
          .single();

        if (!insertError && insertedFaq) {
          faqItemCount++;
          stagedInBatch.push({ id: insertedFaq.id, title: faq.question, content: faq.answer });
        }
      }
    }
  }

  const finalStatus = knowledgeItemCount + faqItemCount > 0 ? "ready_for_review" : "failed";

  await supabase
    .from("knowledge_imports")
    .update({
      status: finalStatus,
      error_message: finalStatus === "failed" ? "No information could be extracted from any file." : null,
    })
    .eq("id", importId);

  return NextResponse.json({
    importId,
    status: finalStatus,
    itemCounts: { knowledge: knowledgeItemCount, faq: faqItemCount },
    skippedRedundant: skippedRedundantCount,
    failedFiles,
  });
}
