import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { KNOWLEDGE_CATEGORY_VALUES } from "@/lib/knowledgeImport/constants";

// ── PATCH / DELETE /api/knowledge/import/items/[itemId] ────────────────
// Ownership is verified by fetching the item's own org_id first (same
// two-step lookup PATCH /api/leads uses for a lead id), then re-checking
// organisations.owner_id — RLS also enforces this, this is the same
// defensive extra layer used everywhere else in this codebase.

const EDITABLE_FIELDS = [
  "category",
  "title",
  "content",
  "price",
  "currency",
  "duration_minutes",
  "notes",
  "quote_required",
  "starting_from",
  "duplicate_action",
  "review_status",
] as const;

const VALID_REVIEW_STATUSES = ["pending", "approved", "rejected"];
const VALID_DUPLICATE_ACTIONS = ["merge", "replace", "keep_both"];

async function verifyItemOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemId: string,
  userId: string
) {
  const { data: item, error: itemError } = await supabase
    .from("knowledge_staged_items")
    .select("id, org_id, duplicate_of, duplicate_action")
    .eq("id", itemId)
    .single();

  if (itemError || !item) return { item: null, error: "Staged item not found.", status: 404 };

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", item.org_id)
    .eq("owner_id", userId)
    .single();

  if (orgError || !org) return { item: null, error: "Access denied.", status: 403 };

  return { item, error: null, status: 200 };
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { item, error, status } = await verifyItemOwnership(supabase, itemId, user.id);
  if (!item) {
    return NextResponse.json({ error }, { status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  if (raw.category !== undefined && !KNOWLEDGE_CATEGORY_VALUES.includes(raw.category as string)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }
  if (raw.review_status !== undefined && !VALID_REVIEW_STATUSES.includes(raw.review_status as string)) {
    return NextResponse.json({ error: "Invalid review_status." }, { status: 400 });
  }
  if (
    raw.duplicate_action !== undefined &&
    raw.duplicate_action !== null &&
    !VALID_DUPLICATE_ACTIONS.includes(raw.duplicate_action as string)
  ) {
    return NextResponse.json({ error: "Invalid duplicate_action." }, { status: 400 });
  }
  // Approving a flagged duplicate requires the reviewer to have already
  // chosen how to resolve it — never silently overwrite manual data.
  // Merge/Replace/Keep-both is saved via its own earlier PATCH (clicking
  // the banner button), separate from the Approve click's PATCH — so
  // this must check the value already on the item in the database, not
  // just whether THIS request's body happens to include one. Checking
  // raw.duplicate_action alone made a real, already-saved selection look
  // unset the moment Approve was clicked as its own follow-up request.
  const effectiveDuplicateAction = raw.duplicate_action ?? item.duplicate_action;
  if (
    raw.review_status === "approved" &&
    item.duplicate_of &&
    !effectiveDuplicateAction
  ) {
    return NextResponse.json(
      { error: "This item is a possible duplicate — choose Merge, Replace, or Keep both before approving." },
      { status: 422 }
    );
  }
  const updatePayload: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (raw[field] !== undefined) updatePayload[field] = raw[field];
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("knowledge_staged_items")
    .update(updatePayload)
    .eq("id", itemId)
    .select()
    .single();

  if (updateError || !updated) {
    console.error("[knowledge/import/items/[id]:PATCH] update failed:", updateError);
    return NextResponse.json({ error: "Failed to update item." }, { status: 500 });
  }

  // Missing-currency guard: an item with a price but no currency can't be
  // approved — checked post-update using the merged row, so a PATCH that
  // sets price without also setting currency is caught here rather than
  // needing the client to send both fields every time.
  if (updated.review_status === "approved" && updated.price !== null && !updated.currency) {
    await supabase
      .from("knowledge_staged_items")
      .update({ review_status: "pending" })
      .eq("id", itemId);
    return NextResponse.json(
      { error: "This item has a price but no currency — add a currency before approving." },
      { status: 422 }
    );
  }

  return NextResponse.json({ item: updated });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { item, error, status } = await verifyItemOwnership(supabase, itemId, user.id);
  if (!item) {
    return NextResponse.json({ error }, { status });
  }

  const { error: deleteError } = await supabase
    .from("knowledge_staged_items")
    .delete()
    .eq("id", itemId);

  if (deleteError) {
    console.error("[knowledge/import/items/[id]:DELETE] delete failed:", deleteError);
    return NextResponse.json({ error: "Failed to delete item." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
