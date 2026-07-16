import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { hasActiveAccess } from "@/lib/billing/access";
import {
  ACCEPTED_MIME_TYPES,
  MAX_FILES_PER_BATCH,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/knowledgeImport/constants";

// ── POST /api/knowledge/import — create a batch and upload its files ──
// Auth/ownership pattern matches src/app/api/leads/route.ts exactly:
// getUser() -> 401 -> explicit organisations.owner_id re-check -> 403 ->
// every subsequent query additionally scoped by org_id. RLS client only
// — every action here is owner-initiated from the dashboard, so there's
// no need for the service-role admin client.

const STORAGE_BUCKET = "knowledge-imports";

interface FileUploadResult {
  id: string;
  filename: string;
  status: "pending" | "rejected";
  error?: string;
}

// Cheap corruption/spoofing sniff — checks the actual byte signature
// against the declared MIME type rather than trusting the browser-supplied
// Content-Type alone, before any storage write or OpenAI spend.
async function sniffMimeMismatch(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const hex = Array.from(head)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const isPng = hex.startsWith("89504e47");
  const isJpeg = hex.startsWith("ffd8ff");
  const isWebp = hex.startsWith("52494646") && hex.slice(16, 24) === "57454250";
  const isPdf = hex.startsWith("255044462d");

  switch (file.type) {
    case "image/png":
      return isPng ? null : "File does not look like a valid PNG.";
    case "image/jpeg":
      return isJpeg ? null : "File does not look like a valid JPEG.";
    case "image/webp":
      return isWebp ? null : "File does not look like a valid WEBP.";
    case "application/pdf":
      return isPdf ? null : "File does not look like a valid PDF.";
    default:
      return "Unsupported file type.";
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!checkRateLimit(`knowledge-import-batch:${user.id}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many import batches. Please try again later." },
      { status: 429 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request body must be multipart/form-data." },
      { status: 400 }
    );
  }

  const orgId = formData.get("org_id");
  if (!orgId || typeof orgId !== "string") {
    return NextResponse.json({ error: "org_id is required." }, { status: 400 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id, subscription_status, trial_ends_at")
    .eq("id", orgId)
    .eq("owner_id", user.id)
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Organisation not found or access denied." },
      { status: 403 }
    );
  }

  if (!hasActiveAccess(org)) {
    return NextResponse.json(
      { error: "Your subscription is inactive. Please check your billing settings." },
      { status: 402 }
    );
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "At least one file is required." }, { status: 400 });
  }

  if (files.length > MAX_FILES_PER_BATCH) {
    return NextResponse.json(
      { error: `A batch can contain at most ${MAX_FILES_PER_BATCH} files.` },
      { status: 400 }
    );
  }

  // Create the batch first so file rows can reference it, even if every
  // file turns out to be invalid — the review UI can then show a clear
  // "all files rejected" batch rather than a bare 400 with no record.
  const { data: importRow, error: importError } = await supabase
    .from("knowledge_imports")
    .insert({ org_id: orgId, created_by: user.id, status: "uploaded", file_count: files.length })
    .select("id")
    .single();

  if (importError || !importRow) {
    console.error("[knowledge/import:POST] failed to create batch:", importError);
    return NextResponse.json({ error: "Failed to create import batch." }, { status: 500 });
  }

  const importId = importRow.id;
  const results: FileUploadResult[] = [];

  for (const file of files) {
    const filename = sanitizeFilename(file.name || "upload");

    if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
      results.push({ id: "", filename, status: "rejected", error: "Unsupported file type." });
      continue;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      results.push({
        id: "",
        filename,
        status: "rejected",
        error: `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit.`,
      });
      continue;
    }

    const mismatch = await sniffMimeMismatch(file);
    if (mismatch) {
      results.push({ id: "", filename, status: "rejected", error: mismatch });
      continue;
    }

    // Insert the file row first to get its id, which becomes part of the
    // storage path — keeps the path unique even for two same-named files
    // in one batch.
    const { data: fileRow, error: fileInsertError } = await supabase
      .from("knowledge_import_files")
      .insert({
        import_id: importId,
        org_id: orgId,
        storage_path: "", // set below once the id is known
        original_filename: filename,
        mime_type: file.type,
        size_bytes: file.size,
        status: "pending",
      })
      .select("id")
      .single();

    if (fileInsertError || !fileRow) {
      console.error("[knowledge/import:POST] failed to record file:", fileInsertError);
      results.push({ id: "", filename, status: "rejected", error: "Failed to record file." });
      continue;
    }

    const storagePath = `${orgId}/${importId}/${fileRow.id}-${filename}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("[knowledge/import:POST] storage upload failed:", uploadError);
      await supabase
        .from("knowledge_import_files")
        .update({ status: "failed", error_message: "Upload failed." })
        .eq("id", fileRow.id);
      results.push({ id: fileRow.id, filename, status: "rejected", error: "Upload failed." });
      continue;
    }

    await supabase
      .from("knowledge_import_files")
      .update({ storage_path: storagePath })
      .eq("id", fileRow.id);

    results.push({ id: fileRow.id, filename, status: "pending" });
  }

  const acceptedCount = results.filter((r) => r.status === "pending").length;

  if (acceptedCount === 0) {
    await supabase
      .from("knowledge_imports")
      .update({ status: "failed", error_message: "All files were rejected." })
      .eq("id", importId);
  }

  return NextResponse.json({ importId, files: results }, { status: 201 });
}
