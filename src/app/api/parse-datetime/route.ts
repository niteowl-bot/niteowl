import { NextRequest, NextResponse } from "next/server";
import { parseDatetimeToIso } from "@/lib/parseDatetime";

export const runtime = "nodejs";

/**
 * Thin HTTP wrapper around parseDatetimeToIso().
 * Server code (e.g. the chat route) should import parseDatetimeToIso
 * directly instead of calling this endpoint.
 */
export async function POST(req: NextRequest) {
  const { text, timezone } = await req.json();

  const result = await parseDatetimeToIso(text, timezone);

  return NextResponse.json(result);
}

