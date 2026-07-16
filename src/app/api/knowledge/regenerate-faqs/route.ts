import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { generateFaqSuggestions } from "@/lib/knowledgeImport/faqGeneration";
import { findLikelyDuplicate } from "@/lib/knowledgeImport/duplicateDetection";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/knowledgeImport/constants";

// ── POST /api/knowledge/regenerate-faqs ─────────────────────────────
// Generates fresh FAQ suggestions for one existing Knowledge Base entry.
// Never touches existing FAQ rows — only adds new pending
// knowledge_staged_items for the reviewer to approve/reject, same review
// flow as an import batch, just without an import_id.

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!checkRateLimit(`regenerate-faqs:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const raw = body as { orgId?: string; knowledgeId?: string };
  if (!raw.orgId || !raw.knowledgeId) {
    return NextResponse.json({ error: "orgId and knowledgeId are required." }, { status: 400 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", raw.orgId)
    .eq("owner_id", user.id)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const { data: entry, error: entryError } = await supabase
    .from("business_knowledge")
    .select("id, title, content, price, currency, duration_minutes, notes")
    .eq("id", raw.knowledgeId)
    .eq("org_id", raw.orgId)
    .single();

  if (entryError || !entry) {
    return NextResponse.json({ error: "Knowledge entry not found." }, { status: 404 });
  }

  const summaryParts = [`- ${entry.title}`];
  if (entry.content) summaryParts.push(entry.content);
  if (entry.price !== null) summaryParts.push(`Price: ${entry.price}${entry.currency ? ` ${entry.currency}` : ""}`);
  if (entry.duration_minutes !== null) summaryParts.push(`Duration: ${entry.duration_minutes} min`);
  if (entry.notes) summaryParts.push(`Notes: ${entry.notes}`);

  const faqs = await generateFaqSuggestions(summaryParts.join(" — "));

  if (!faqs || faqs.length === 0) {
    return NextResponse.json({ staged: [] });
  }

  const staged = [];
  for (const faq of faqs) {
    const duplicate = await findLikelyDuplicate(supabase, raw.orgId, faq.question, faq.answer);

    const { data: item, error: insertError } = await supabase
      .from("knowledge_staged_items")
      .insert({
        org_id: raw.orgId,
        source_knowledge_id: raw.knowledgeId,
        item_type: "faq",
        category: "faq",
        title: faq.question,
        content: faq.answer,
        confidence: faq.confidence,
        low_confidence: faq.confidence < LOW_CONFIDENCE_THRESHOLD,
        duplicate_of: duplicate?.knowledgeId ?? null,
        review_status: "pending",
      })
      .select()
      .single();

    if (!insertError && item) staged.push(item);
  }

  return NextResponse.json({ staged });
}
