import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// TEMPORARY, ONE-TIME-USE ops endpoint — deletes only the exact known
// test/demo sales_leads rows created while verifying the
// SALES_NOTIFICATION_EMAIL recipient change (2026-07-08). Matched by
// primary key only. Remove this file immediately after use.
const TOKEN = "b4809c1e76416c783d02a638a44014aaf4b6f4bdc6622a41";

const KNOWN_TEST_LEAD_IDS = [
  "5f1aab5e-1c2f-4a56-9095-88e7074de069", // "Verify Recipient" — stuck, never completed
  "cef1aad6-3e6f-4d99-b942-90e376e7b28f", // "Jordan Blake" — completed, recipient-change verification
];

function authorized(req: NextRequest): boolean {
  return req.headers.get("x-cleanup-token") === TOKEN;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("sales_leads")
    .select("id, name, email, company, status, notification_sent, created_at")
    .in("id", KNOWN_TEST_LEAD_IDS);

  return Response.json({ matches: data });
}

export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sales_leads")
    .delete()
    .in("id", KNOWN_TEST_LEAD_IDS)
    .select("id, email");

  return Response.json({ deleted: data, error: error?.message ?? null });
}
