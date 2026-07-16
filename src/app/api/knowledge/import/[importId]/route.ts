import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// ── GET /api/knowledge/import/[importId] — batch + files + staged items ─
// Used by both the processing-step poller and the review step. Same
// double-layered auth as every other route in this feature.

const STAGED_ITEM_COLUMNS =
  "id, import_id, source_knowledge_id, source_file_id, item_type, category, title, content, price, currency, duration_minutes, notes, quote_required, starting_from, confidence, low_confidence, duplicate_of, duplicate_action, review_status, created_at, updated_at";

export async function GET(
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
    .select("id, org_id, status, error_message, file_count, created_at")
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

  const { data: files, error: filesError } = await supabase
    .from("knowledge_import_files")
    .select("id, original_filename, mime_type, size_bytes, page_count, status, error_message")
    .eq("import_id", importId);

  if (filesError) {
    console.error("[knowledge/import/[id]:GET] files query failed:", filesError);
  }

  const { data: items, error: itemsError } = await supabase
    .from("knowledge_staged_items")
    .select(STAGED_ITEM_COLUMNS)
    .eq("import_id", importId)
    .order("created_at", { ascending: true });

  if (itemsError) {
    console.error("[knowledge/import/[id]:GET] items query failed:", itemsError);
  }

  return NextResponse.json({
    import: importRow,
    files: files ?? [],
    items: items ?? [],
  });
}
