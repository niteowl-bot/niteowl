import type { Metadata } from "next";
import IndustryPageView from "@/components/marketing/IndustryPageView";
import { ELECTRICIANS_PAGE } from "@/lib/site/industryPages";
import { publicUrl } from "@/lib/site/publicRoutes";

// ── AI Receptionist for Electricians — industry landing page ─────────────
//
// MARKETING ONLY. The second industry-specific Remy landing page: a
// vertical framing of the ONE unchanged Remy, routing electrical
// businesses into the existing funnel (this page → the unchanged
// nine-question Business Opportunity Scan → Remy). It configures
// nothing, stores nothing and imports nothing that serves a tenant.
// Content lives in src/lib/site/industryPages.ts; the view is shared so
// a later industry is one more constant and one more file like this.

const PAGE = ELECTRICIANS_PAGE;

export const metadata: Metadata = {
  title: PAGE.title,
  description: PAGE.description,
  keywords: [...PAGE.keywords],
  alternates: { canonical: PAGE.path },
  openGraph: {
    type: "website",
    url: publicUrl(PAGE.path),
    siteName: "NiteOwl HQ",
    title: PAGE.title,
    description: PAGE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE.title,
    description: PAGE.description,
  },
};

export default function AiReceptionistForElectriciansPage() {
  return <IndustryPageView page={PAGE} />;
}
