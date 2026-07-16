import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { KNOWLEDGE_CATEGORY_VALUES } from "@/lib/knowledgeImport/constants";

// ── POST /api/knowledge/import/items — manually add a staged item ─────
// Lets the reviewer add an entry the AI missed, during either an import
// review or a regenerate-FAQs review. Same double-layered auth pattern
// as the rest of this feature.

interface CreateItemPayload {
  org_id: string;
  import_id?: string | null;
  source_knowledge_id?: string | null;
  item_type: "knowledge" | "faq";
  category?: string | null;
  title: string;
  content?: string | null;
  price?: number | null;
  currency?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
  quote_required?: boolean;
  starting_from?: boolean;
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const raw = body as Partial<CreateItemPayload>;

  if (!raw.org_id || typeof raw.org_id !== "string") {
    return NextResponse.json({ error: "org_id is required." }, { status: 400 });
  }
  if (!raw.title || typeof raw.title !== "string" || !raw.title.trim()) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }
  if (raw.item_type !== "knowledge" && raw.item_type !== "faq") {
    return NextResponse.json(
      { error: "item_type must be 'knowledge' or 'faq'." },
      { status: 400 }
    );
  }
  if (
    raw.category &&
    !KNOWLEDGE_CATEGORY_VALUES.includes(raw.category) &&
    raw.item_type === "knowledge"
  ) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", raw.org_id)
    .eq("owner_id", user.id)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const { data: item, error: insertError } = await supabase
    .from("knowledge_staged_items")
    .insert({
      org_id: raw.org_id,
      import_id: raw.import_id ?? null,
      source_knowledge_id: raw.source_knowledge_id ?? null,
      item_type: raw.item_type,
      category: raw.item_type === "faq" ? "faq" : raw.category ?? "service",
      title: raw.title.trim(),
      content: raw.content ?? null,
      price: raw.price ?? null,
      currency: raw.currency ?? null,
      duration_minutes: raw.duration_minutes ?? null,
      notes: raw.notes ?? null,
      quote_required: raw.quote_required ?? false,
      starting_from: raw.starting_from ?? false,
      review_status: "pending",
    })
    .select()
    .single();

  if (insertError || !item) {
    console.error("[knowledge/import/items:POST] insert failed:", insertError);
    return NextResponse.json({ error: "Failed to add item." }, { status: 500 });
  }

  return NextResponse.json({ item }, { status: 201 });
}
