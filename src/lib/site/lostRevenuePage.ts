// ── Lost Revenue entry page — Organic Acquisition Engine, A-2b ───────
//
// A FRAMING / ENTRY PAGE, AND NOTHING MORE. It explains what the free
// Business Opportunity Scan can and cannot size, and sends the visitor
// into the unchanged nine-question Scan. It calculates nothing,
// diagnoses nobody, and carries no state: the Scan is the sole
// validator, sizing, finding, recommendation and report path, and the
// report already renders the Lost Revenue range — or UNKNOWN with its
// reason — where the answers allow it (docs/ARCHITECTURE.md §88).
//
// THE QUESTIONNAIRE IS NOT SHORTENED. A Lost-Revenue "calculator" that
// asked four questions would be a second question set and a second
// comparability regime (§107.3); the recorded A-2 decision is framing /
// entry only unless a separately approved SCAN_QUESTION_SET_VERSION
// decision says otherwise. So the CTA is the Scan's bare path — no
// query string, fragment, prefill or mode.
//
// THE ASSUMPTIONS ARE RESTATED IN PROSE, NOT IMPORTED. The sizing
// module's E1 assumptions are shown on the report itself; this page
// says the same three things in plain words — missed enquiries assumed
// to convert at about the same rate as answered ones (likely generous),
// the visitor's own typical job value, an estimate rather than a
// measurement — without executing or importing the engine. A test pins
// each idea so the prose cannot drift into a different economic claim.
//
// NO NUMBER ON THE PAGE. Not a benchmark, not an average, not an
// example figure: the only number a visitor sees is the one the Scan
// works out from their own answers, on the report.

import { SCAN_RECOMMENDATIONS } from "@/lib/freetools/scanRecommendations";
import { PROBLEM_PAGES, SCAN_PATH } from "@/lib/site/problemPages";

export const LOST_REVENUE_PATH = "/free-tools/lost-revenue";

export const LOST_REVENUE_TITLE =
  "Lost revenue from missed enquiries — what the free Scan can and can’t size | NiteOwl AI";

export const LOST_REVENUE_DESCRIPTION =
  "How NiteOwl’s free nine-question scan estimates what unanswered enquiries may be worth — as a range worked out from your own answers, never a measurement — and when it says plainly that it cannot.";

/** The one CTA. The Scan's bare path, and nothing else. */
export const LOST_REVENUE_CTA_LABEL = "Start the free Scan";
export const LOST_REVENUE_CTA_HREF = SCAN_PATH;

/** The canonical name of the problem the estimate is attached to. */
export const LOST_REVENUE_PROBLEM_HEADLINE = SCAN_RECOMMENDATIONS["enquiry.unanswered"].headline;
export const LOST_REVENUE_PROBLEM_PAGE_PATH = PROBLEM_PAGES["enquiry.unanswered"].path;

export const LOST_REVENUE_H1 =
  "Lost revenue from missed enquiries — what the free Scan can and can’t size";

export const LOST_REVENUE_LEAD =
  "An enquiry that gets no answer is work that never gets the chance to convert. The free Business Opportunity Scan can estimate what those enquiries may be worth — as a range worked out from your own answers, where you can give enough information — and it says plainly when it cannot.";

export interface LostRevenueSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export const LOST_REVENUE_SECTIONS: readonly LostRevenueSection[] = [
  {
    heading: "How the estimate is built",
    paragraphs: [
      "The scan asks about a typical week: roughly how many enquiries you get, roughly how many go unanswered, and whether you have a way of knowing when one is missed. It also asks, optionally, what a typical job is worth to you and roughly what share of the enquiries you do answer become work.",
      "Where you can give all of that, it works out a range from those answers alone. Missed enquiries are assumed to have converted at about the same rate as the ones you answered — which is likely to be generous, since someone who could not reach you may well have called someone else — and the value used is the typical job value you gave.",
    ],
  },
  {
    heading: "When it will say it can’t",
    paragraphs: [
      "“Not sure” is a fine answer to any of those questions, and it never counts against you — but it does mean the scan will not put a number on this. The same is true if you have no way of knowing when an enquiry was missed, if the counts do not fit together, or if the range would be so wide that it would tell you nothing.",
      "In each of those cases the result is UNKNOWN, stated plainly. That is a real answer, not a failure: the scan will still say whether unanswered enquiries look like something worth changing, and what you could do about them.",
    ],
  },
  {
    heading: "An estimate, not a measurement",
    paragraphs: [
      "Whatever the scan works out is an estimate from what you told it. It is not a measurement of your business, not a comparison with anyone else’s, not a promise of what would come back, and the assumptions behind it are shown alongside the number so you can judge it for yourself.",
    ],
  },
];

export const LOST_REVENUE_PROMISE =
  "Nine short questions, nothing stored, no account, no card. The report is complete either way, and you keep it.";

export const LOST_REVENUE_PROBLEM_LINK_LABEL = "Read about unanswered enquiries first";
export const LOST_REVENUE_HUB_LINK_LABEL = "Want to size missed work? Start from the Lost Revenue page";
