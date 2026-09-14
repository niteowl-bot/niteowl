import type { Metadata } from "next";
import ProblemPageView from "../ProblemPageView";
import { PROBLEM_PAGES } from "@/lib/site/problemPages";
import { publicUrl } from "@/lib/site/publicRoutes";

// A-2a problem-led page for the canonical condition class below. This
// file holds metadata and the condition key, nothing else: the content
// map (src/lib/site/problemPages.ts) supplies every sentence, and the
// view renders it. No client code, no state, no request API.

const PAGE = PROBLEM_PAGES["booking.friction"];

export const metadata: Metadata = {
  title: PAGE.title,
  description: PAGE.description,
  alternates: { canonical: PAGE.path },
  openGraph: {
    type: "website",
    url: publicUrl(PAGE.path),
    siteName: "NiteOwl HQ",
    title: PAGE.title,
    description: PAGE.description,
  },
  twitter: {
    card: "summary",
    title: PAGE.title,
    description: PAGE.description,
  },
};

export default function BookingBackAndForthPage() {
  return <ProblemPageView condition="booking.friction" />;
}
