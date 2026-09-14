import type { Metadata } from "next";
import ScanClient from "./ScanClient";
import { freeToolApplicationJsonLd } from "@/lib/site/structuredData";
import { publicUrl } from "@/lib/site/publicRoutes";

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
//
// DISCOVERABILITY (A-1) is metadata only: a canonical URL, OpenGraph
// and a truthful WebApplication JSON-LD. It says what the tool is and
// that it is free; it makes no claim about any business.

const PATH = "/free-tools/business-opportunity-scan";
const TITLE = "Business Opportunity Scan — Free Tool | NiteOwl AI";
const DESCRIPTION =
  "Answer nine short questions about how enquiries reach your business and what happens to them, and get a clear, honest report on where you may be missing work. Free, nothing stored, no account needed.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    type: "website",
    url: publicUrl(PATH),
    siteName: "NiteOwl HQ",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const structuredData = freeToolApplicationJsonLd({
  name: "Business Opportunity Scan",
  path: PATH,
  description: DESCRIPTION,
});

export default function BusinessOpportunityScanPage() {
  return (
    <>
      {/* JSON-LD as a string child: React renders script text verbatim, and
          "<" is written as \u003c so the constant can never close the tag. */}
      <script type="application/ld+json">
        {JSON.stringify(structuredData).replace(/</g, "\\u003c")}
      </script>
      <ScanClient />
    </>
  );
}
