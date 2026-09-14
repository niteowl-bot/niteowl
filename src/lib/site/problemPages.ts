// ── Problem-led discovery pages — Organic Acquisition Engine, A-2a ──
//
// THREE PAGES, THREE CONDITION CLASSES, AND NOTHING ELSE. Each page
// exists because the Business Opportunity Scan can detect that class
// (§87.1's closed enumeration); a page for a class the Scan cannot
// detect would be a diagnosis with no engine behind it, which is the
// "advertisement wearing a diagnostic's clothes" §26 forbids. The map is
// keyed by ScanConditionCode so a fourth page needs a fourth code — a
// Part XI boundary change — and cannot be added by editing prose.
//
// A STATIC MAP, NOT A DIAGNOSIS. Nothing here reads an answer, applies a
// threshold, or decides that a visitor has a problem. The wording that
// names the problem and the advice come from the Scan's own fixed
// recommendation data (SCAN_RECOMMENDATIONS), so the pages and the
// report cannot drift apart; the mechanism prose below explains how the
// problem TENDS to arise in general, in the same tentative register the
// Scan's hypotheses use, and never says it is happening to the reader.
//
// WHY `why_it_matters` IS NOT HERE. That sentence begins "You told us
// that…" — it is report wording, written from the visitor's answers. On
// a page nobody has answered anything, it would be a diagnosis of a
// stranger, so it is excluded and a test pins its absence.
//
// ONE DESTINATION. Every page's call to action is the unchanged Scan
// route — no query string, no fragment, no prefill, no mode. The framing
// is the page; the assessment is the same nine questions.
//
// HONEST ROUTING IS PRESERVED, NOT RESTATED. The follow-up page carries
// the canonical fact that no NiteOwl product is the answer there
// (`recommended_product: null`), because a problem page that quietly
// dropped the one class that routes nowhere would be a funnel by
// omission. The friction page links the Setup Kit exactly as the report
// does (SETUP_KIT_HANDOFF) and names Remy at most once, as attribution
// after the advice, never as a claim.

import { SCAN_CONDITION_ORDER, type ScanConditionCode } from "@/lib/freetools/scanTypes";
import { SCAN_RECOMMENDATIONS, SETUP_KIT_HANDOFF } from "@/lib/freetools/scanRecommendations";
import { publicUrl } from "@/lib/site/publicRoutes";

/** The Scan's canonical entry. A bare path: no query string, no fragment. */
export const SCAN_PATH = "/free-tools/business-opportunity-scan";
export const SCAN_CTA_LABEL = "Run the free Business Opportunity Scan";

export const PROBLEMS_SECTION_TITLE = "Common problems";
export const PROBLEMS_SECTION_NOTE =
  "Plain explanations of three problems small businesses run into with enquiries, and what you can do about each. Read one, then run the scan if you want to see where yours stand.";

/** The sentence every page carries about what the Scan will and will not do. */
export const SCAN_PROMISE =
  "The scan asks nine short questions, stores nothing, needs no account, and says plainly when it cannot tell — “not sure” is always a fine answer.";

export interface ProblemPage {
  readonly condition: ScanConditionCode;
  readonly slug: string;
  readonly path: string;
  /** What someone searching for this page is trying to find out. */
  readonly search_intent: string;
  readonly title: string;
  readonly description: string;
  /** From SCAN_RECOMMENDATIONS — the canonical name of the problem. */
  readonly headline: string;
  /** General mechanisms only. Tentative register; never "you have this". */
  readonly how_it_tends_to_happen: readonly string[];
  /** From SCAN_RECOMMENDATIONS — the owner's own next step. */
  readonly next_step: string;
  /** What the Scan can and cannot say about this class. */
  readonly what_the_scan_can_tell_you: string;
  /**
   * Honest routing, stated as canon states it:
   *   - `none`: no NiteOwl product is the answer (recommended_product: null)
   *   - `setup_kit_then_remy`: the Setup Kit is the canonical first step,
   *     and Remy is named once as attribution after the advice
   *   - `remy_attribution`: Remy is named once as attribution after the advice
   */
  readonly routing:
    | { readonly kind: "none"; readonly wording: string }
    | {
        readonly kind: "setup_kit_then_remy";
        readonly handoff: typeof SETUP_KIT_HANDOFF;
        readonly attribution: string;
      }
    | { readonly kind: "remy_attribution"; readonly attribution: string };
}

const REMY_ATTRIBUTION =
  "NiteOwl builds Remy, an AI receptionist for small businesses, and this is one of the problems it is designed for. The advice above works whether or not you ever use it.";

const page = (
  condition: ScanConditionCode,
  slug: string,
  fields: Omit<ProblemPage, "condition" | "slug" | "path" | "headline" | "next_step">
): ProblemPage => ({
  condition,
  slug,
  path: `/free-tools/problems/${slug}`,
  headline: SCAN_RECOMMENDATIONS[condition].headline,
  next_step: SCAN_RECOMMENDATIONS[condition].next_step,
  ...fields,
});

/** The three pages, in SCAN_CONDITION_ORDER. */
export const PROBLEM_PAGES: Readonly<Record<ScanConditionCode, ProblemPage>> = {
  "enquiry.unanswered": page("enquiry.unanswered", "unanswered-enquiries", {
    search_intent: "Calls and messages to the business go unanswered, and the owner wants to know why it happens and what to do.",
    title: "Unanswered enquiries — when calls and messages get no reply | NiteOwl AI",
    description:
      "Why enquiries to a small business can go unanswered, what tends to be behind it, one practical thing to change, and a free nine-question scan that shows where yours may be going.",
    how_it_tends_to_happen: [
      "Enquiries often arrive when nobody is free to answer them — outside working hours, during a job, or while someone is already on another call. If nothing picks up in that moment, the enquiry may simply end there.",
      "When customers can reach a business through several channels — phone, text, email, a website form, social messages — some of those channels may be watched less closely than others, and an enquiry on a quiet channel can be easy to miss.",
      "A missed enquiry that nobody notices cannot be returned. Without some way of knowing a call or message was missed, the chance to reply may be gone before anyone realises it was there.",
    ],
    what_the_scan_can_tell_you:
      "The scan asks how many enquiries a typical week brings, how many go unanswered, and whether you have a way of knowing when one is missed. Where you can give a typical job value, it estimates what unanswered enquiries may be worth — as a range worked out from your own numbers, never a measurement — and it says so when it cannot.",
    routing: { kind: "remy_attribution", attribution: REMY_ATTRIBUTION },
  }),

  "enquiry.no_followup": page("enquiry.no_followup", "enquiries-that-do-not-book", {
    search_intent: "Customers enquire but do not book, and the owner wants to know what should happen next.",
    title: "Enquiries that don’t book — following up without a system | NiteOwl AI",
    description:
      "What tends to happen to an enquiry that doesn’t turn into a booking, why a simple follow-up habit matters, and a free nine-question scan that shows whether yours are being followed up.",
    how_it_tends_to_happen: [
      "Many enquiries do not book on the first contact. The person may be comparing options, waiting on a decision, or just not ready yet — none of which means they have decided against you.",
      "If nothing is planned to happen next, the enquiry can depend entirely on the customer coming back on their own. Some do; many may quietly not, and the business never learns which.",
      "A follow-up does not need a system to begin with — a short message or call within a day is often enough to find out whether the enquiry is still live. The habit tends to matter more than the tooling.",
    ],
    what_the_scan_can_tell_you:
      "The scan asks what usually happens when an enquiry does not book, and says plainly whether that looks like something to change. It does not put a number on this one — there is no honest way to size it from a questionnaire — so it tells you that rather than inventing an estimate.",
    routing: {
      kind: "none",
      wording:
        "There is nothing to buy for this. A follow-up habit is yours to build, and no NiteOwl product is the honest answer here — the scan will say the same.",
    },
  }),

  "booking.friction": page("booking.friction", "booking-back-and-forth", {
    search_intent: "Agreeing an appointment time takes too many messages, and the owner wants to know how to shorten it.",
    title: "Booking back-and-forth — when agreeing a time takes too many messages | NiteOwl AI",
    description:
      "Why agreeing an appointment can take several messages, the booking rules that tend to shorten it, a free setup kit for writing them down, and a free nine-question scan that shows whether it is happening to you.",
    how_it_tends_to_happen: [
      "When a time is agreed over messages, each reply tends to wait on the other side. A question about days, a question about hours, a question about how long the job takes — every round can be another chance for the customer to drift away.",
      "Replies often wait until someone is free to respond. If that only happens at the end of the day, a conversation that could take minutes can stretch across several days.",
      "Most of the back-and-forth is about information the business already knows: which days and hours it takes work, how long each kind of job needs, how many fit in a day. When those rules are written down and offered up front, the customer can often pick a time in one go.",
    ],
    what_the_scan_can_tell_you:
      "The scan asks how many messages or calls it usually takes to agree a time, and says whether that looks like friction worth removing. It does not put a number on this one — it tells you that plainly rather than inventing an estimate.",
    routing: {
      kind: "setup_kit_then_remy",
      handoff: SETUP_KIT_HANDOFF,
      attribution: REMY_ATTRIBUTION,
    },
  }),
};

/** The pages in the Scan's own presentation order. */
export const PROBLEM_PAGE_LIST: readonly ProblemPage[] = SCAN_CONDITION_ORDER.map(
  (condition) => PROBLEM_PAGES[condition]
);

export function problemPageUrl(condition: ScanConditionCode): string {
  return publicUrl(PROBLEM_PAGES[condition].path);
}
