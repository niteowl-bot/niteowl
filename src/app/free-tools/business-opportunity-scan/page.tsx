import type { Metadata } from "next";
import ScanClient from "./ScanClient";

// ── NiteOwl Business Opportunity Scan ──────────────────────────────
//
// A server component whose only job is metadata and mounting the
// client. Everything interactive is in ScanClient, and everything the
// scan concludes is produced by the shipped pure modules in
// @/lib/freetools/scan* — this surface renders their result and
// decides nothing (docs/ARCHITECTURE.md §84.2, §87.3).
//
// NO PERSISTENCE, NO AUTH, NO NETWORK. There is no API route behind
// this page, no database table, no cookie, no run id, no bearer token
// and no stored identifier. The answers live in client memory for one
// page view, and the full report is delivered there (§26: value before
// any account exists). Persistence, consent and promotion are later,
// separately approved work (§89).
//
// NO REMY, NO PROVIDER. Nothing imports leadCapture, lib/voice,
// availability, calendarSync, integrations, Supabase or a model SDK,
// and nothing may.

export const metadata: Metadata = {
  title: "Business Opportunity Scan — Free Tool | NiteOwl AI",
  description:
    "Answer nine short questions about how enquiries reach your business and what happens to them, and get a clear, honest report on where you may be missing work. Free, nothing stored, no account needed.",
  alternates: { canonical: "/free-tools/business-opportunity-scan" },
};

export default function BusinessOpportunityScanPage() {
  return <ScanClient />;
}
