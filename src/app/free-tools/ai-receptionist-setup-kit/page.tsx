import type { Metadata } from "next";
import SetupKitClient from "./SetupKitClient";
import { freeToolApplicationJsonLd } from "@/lib/site/structuredData";
import { publicUrl } from "@/lib/site/publicRoutes";

// ── AI Receptionist Business Setup Kit ─────────────────────────────
//
// A server component whose only job is metadata and mounting the
// wizard. Everything interactive is in SetupKitClient, and everything
// the wizard produces is derived by the pure function in
// @/lib/freetools/setupKit.
//
// NO PERSISTENCE, NO AUTH, NO NETWORK. There is no API route behind this
// page, no database table, no cookie and no stored identifier. The
// answers live in client memory for one page view.
//
// NO REMY, NO PROVIDER. Nothing imports leadCapture, lib/voice,
// availability, calendarSync or integrations, and nothing may. The
// appointment questions here are CONFIGURATION GUIDANCE the visitor
// writes for themselves — they do not reach Google Calendar, Remy's
// booking engine or any availability code.
//
// DISCOVERABILITY (A-1) is metadata only: a canonical URL, OpenGraph
// and a truthful WebApplication JSON-LD. It says what the tool is and
// that it is free; it makes no claim about any business.

const PATH = "/free-tools/ai-receptionist-setup-kit";
const TITLE = "AI Receptionist Business Setup Kit — Free Tool | NiteOwl AI";
const DESCRIPTION =
  "Answer a few questions and get a clear, structured receptionist setup for your business — opening hours, services, common questions, and what to do out of hours. Free, no account needed.";

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
  name: "AI Receptionist Business Setup Kit",
  path: PATH,
  description: DESCRIPTION,
});

export default function SetupKitPage() {
  return (
    <>
      {/* JSON-LD as a string child: React renders script text verbatim, and
          "<" is written as \u003c so the constant can never close the tag. */}
      <script type="application/ld+json">
        {JSON.stringify(structuredData).replace(/</g, "\\u003c")}
      </script>
      <SetupKitClient />
    </>
  );
}
