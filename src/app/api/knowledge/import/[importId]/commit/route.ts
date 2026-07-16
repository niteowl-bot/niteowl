import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// ── POST /api/knowledge/import/[importId]/commit ───────────────────────
// Applies only review_status='approved' staged items into
// business_knowledge. Pending items are left untouched — "commit in
// waves" is intentional, so a reviewer can approve items in batches over
// multiple sessions. Never publishes anything: new rows land as
// status='draft'; merge/replace keep the target row's current status
// unchanged (a merge into an already-published row stays published — see
// docs/sql/2026-07-16_knowledge_import_extend_business_knowledge.sql).

type DbClient = Awaited<ReturnType<typeof createClient>>;

interface StagedItemRow {
  id: string;
  org_id: string;
  category: string | null;
  title: string;
  content: string | null;
  price: number | null;
  currency: string | null;
  duration_minutes: number | null;
  notes: string | null;
  quote_required: boolean;
  starting_from: boolean;
  duplicate_of: string | null;
  duplicate_action: "merge" | "replace" | "keep_both" | null;
}

async function nextDisplayOrder(
  supabase: DbClient,
  orgId: string,
  category: string,
  counters: Map<string, number>
): Promise<number> {
  const key = `${orgId}:${category}`;
  if (counters.has(key)) {
    const next = counters.get(key)!;
    counters.set(key, next + 1);
    return next;
  }

  const { count } = await supabase
    .from("business_knowledge")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("category", category);

  const next = count ?? 0;
  counters.set(key, next + 1);
  return next;
}

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

  const orgId = importRow.org_id;

  const { data: approvedItems, error: itemsError } = await supabase
    .from("knowledge_staged_items")
    .select(
      "id, org_id, category, title, content, price, currency, duration_minutes, notes, quote_required, starting_from, duplicate_of, duplicate_action"
    )
    .eq("import_id", importId)
    .eq("review_status", "approved");

  if (itemsError) {
    console.error("[knowledge/import/commit] failed to fetch approved items:", itemsError);
    return NextResponse.json({ error: "Failed to load approved items." }, { status: 500 });
  }

  const { count: pendingCount } = await supabase
    .from("knowledge_staged_items")
    .select("id", { count: "exact", head: true })
    .eq("import_id", importId)
    .eq("review_status", "pending");

  if (!approvedItems || approvedItems.length === 0) {
    return NextResponse.json({ inserted: 0, updated: 0, skippedPending: pendingCount ?? 0 });
  }

  let inserted = 0;
  let updated = 0;
  const displayOrderCounters = new Map<string, number>();

  for (const item of approvedItems as StagedItemRow[]) {
    const category = item.category ?? "service";

    try {
      if (item.duplicate_of && (item.duplicate_action === "merge" || item.duplicate_action === "replace")) {
        const { data: existing, error: fetchExistingError } = await supabase
          .from("business_knowledge")
          .select(
            "id, title, content, price, currency, duration_minutes, notes, quote_required, starting_from"
          )
          .eq("id", item.duplicate_of)
          .eq("org_id", orgId)
          .single();

        if (fetchExistingError || !existing) {
          console.error(
            "[knowledge/import/commit] duplicate target missing, skipping:",
            item.duplicate_of
          );
          continue;
        }

        const updatePayload =
          item.duplicate_action === "replace"
            ? {
                title: item.title,
                content: item.content,
                price: item.price,
                currency: item.currency,
                duration_minutes: item.duration_minutes,
                notes: item.notes,
                quote_required: item.quote_required,
                starting_from: item.starting_from,
              }
            : {
                // merge: keep any existing non-empty value, fill gaps only
                title: existing.title || item.title,
                content: existing.content || item.content,
                price: existing.price ?? item.price,
                currency: existing.currency ?? item.currency,
                duration_minutes: existing.duration_minutes ?? item.duration_minutes,
                notes: existing.notes || item.notes,
                quote_required: existing.quote_required || item.quote_required,
                starting_from: existing.starting_from || item.starting_from,
              };

        const { error: updateError } = await supabase
          .from("business_knowledge")
          .update(updatePayload)
          .eq("id", item.duplicate_of)
          .eq("org_id", orgId);

        if (updateError) {
          console.error("[knowledge/import/commit] merge/replace failed:", updateError);
          continue;
        }

        updated++;
      } else {
        // No duplicate, or explicitly "keep_both" — insert as a new draft.
        const displayOrder = await nextDisplayOrder(supabase, orgId, category, displayOrderCounters);

        const { error: insertError } = await supabase.from("business_knowledge").insert({
          org_id: orgId,
          category,
          title: item.title,
          content: item.content,
          display_order: displayOrder,
          status: "draft",
          source: "ai_import",
          import_id: importId,
          price: item.price,
          currency: item.currency,
          duration_minutes: item.duration_minutes,
          notes: item.notes,
          quote_required: item.quote_required,
          starting_from: item.starting_from,
        });

        if (insertError) {
          console.error("[knowledge/import/commit] insert failed:", insertError);
          continue;
        }

        inserted++;
      }

      // The staged item has served its purpose once committed — remove
      // it so a second commit call on this batch can't double-apply it.
      await supabase.from("knowledge_staged_items").delete().eq("id", item.id);
    } catch (err) {
      console.error("[knowledge/import/commit] unexpected error committing item:", item.id, err);
    }
  }

  await supabase.from("knowledge_imports").update({ status: "committed" }).eq("id", importId);

  return NextResponse.json({ inserted, updated, skippedPending: pendingCount ?? 0 });
}
