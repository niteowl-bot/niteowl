import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// TEMPORARY, ONE-TIME-USE ops endpoint — deletes only the exact known
// test/demo sales_leads rows created during 2026-07-08 production
// verification (documented in CHECKLIST.md). Matched by primary key
// where known, by exact email otherwise — never by pattern — so a
// genuine customer lead can never be caught. Remove this file
// immediately after use.
const TOKEN = "81045962a73c6026e9007ae11c3911523b011414a0cc16f5";

const KNOWN_TEST_LEAD_IDS = [
  "6dae1e56-7db6-4e40-85e5-a134e226b9e9", // Dean / Qwert Co
  "252ef539-e276-4730-a91a-e0993668f5e2", // Ernie
  "7fe58fbf-6f9a-41ad-b040-2f36a2ed0206", // Lupo / Poiu
];

const KNOWN_TEST_LEAD_EMAILS = [
  "priya@brightsmiles.co.uk",
  "claude-diag-test@example.com",
];

function authorized(req: NextRequest): boolean {
  return req.headers.get("x-cleanup-token") === TOKEN;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const { data: byId } = await admin
    .from("sales_leads")
    .select("id, name, email, company, status, notification_sent, created_at")
    .in("id", KNOWN_TEST_LEAD_IDS);
  const { data: byEmail } = await admin
    .from("sales_leads")
    .select("id, name, email, company, status, notification_sent, created_at")
    .in("email", KNOWN_TEST_LEAD_EMAILS);

  return Response.json({ byId, byEmail });
}

export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const { data: deletedById, error: idErr } = await admin
    .from("sales_leads")
    .delete()
    .in("id", KNOWN_TEST_LEAD_IDS)
    .select("id, email");
  const { data: deletedByEmail, error: emailErr } = await admin
    .from("sales_leads")
    .delete()
    .in("email", KNOWN_TEST_LEAD_EMAILS)
    .select("id, email");

  return Response.json({
    deletedById,
    deletedByEmail,
    idErr: idErr?.message ?? null,
    emailErr: emailErr?.message ?? null,
  });
}
