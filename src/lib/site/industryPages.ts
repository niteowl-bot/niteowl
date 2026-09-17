// ── Industry landing pages — marketing / acquisition only ────────────
//
// ONE REMY. An industry page is a vertical MARKETING surface: a
// different landing, emphasis and vocabulary for one kind of business,
// in front of the unchanged product. It configures nothing — no voice
// logic, booking rule, schema, prompt or setting is keyed by industry,
// and nothing here is read by anything that serves a tenant.
//
// THE SMALLEST REUSABLE SHAPE. One typed content object rendered by one
// view (src/components/marketing/IndustryPageView.tsx). A later industry
// is a second constant and a second page.tsx — not a CMS, a dynamic
// segment or a configuration framework. Plumbers and electricians exist today.
//
// EVERY CLAIM IS A SHIPPED BEHAVIOUR. The capability, example and FAQ
// wording below describes what Remy does now — the voice prompt in
// src/lib/voice/assistant.ts, the Knowledge Base, the needs-review
// workflow, availability checks and the owner's per-call summary — and
// is conditional wherever the behaviour is (calendar sync needs a
// connected calendar; a booking is a REQUEST until the business's
// calendar has actually accepted it; Remy flags urgency and never
// promises a response time). Nothing is a guarantee.
//
// NO INVENTED PROOF. No customer, company, testimonial, logo, statistic,
// benchmark, figure or "jobs recovered" appears here, and the shape has
// no field for one. The example call is marked illustrative and names
// nobody.
//
// THE FUNNEL IS THE EXISTING ONE. Industry page → the unchanged
// nine-question Business Opportunity Scan → Remy. Every Scan CTA is the
// Scan's bare path — no query string, fragment or prefill — exactly as
// the problem and Lost Revenue pages link it.

import { PROBLEM_PAGES, SCAN_PATH, SCAN_PROMISE } from "@/lib/site/problemPages";

export interface IndustryFaq {
  readonly q: string;
  readonly a: string;
}

export interface IndustryCapability {
  readonly title: string;
  readonly body: string;
  /** Stated plainly when the behaviour depends on the business's setup. */
  readonly condition?: string;
}

// ── Presentation contract — Slice 1 ─────────────────────────────────
//
// CONTROLLED VARIATION, NOT A PAGE BUILDER. An industry may opt into a
// secondary accent and a hero visual from a closed set; everything is a
// literal union the view maps to STATIC class strings, so Tailwind can
// see every class and no name is ever built at runtime. A page with no
// `presentation` renders exactly as before — the summary card, the
// indigo accent — which is the regression guard for every page that has
// not opted in. Indigo stays the brand and CTA colour on every page; a
// theme only tints the hero's secondary cues (eyebrow pill, visual
// ring and badges, the decorative stroke).

/** Secondary accent for the hero's trade cues. Never the CTA colour. */
export type IndustryTheme = "indigo" | "cyan" | "amber";

/**
 * The hero's right-hand visual.
 *   - `summary_card`: the default — the owner's structured call-summary rows
 *   - `job_ticket`: an incoming-job ticket (requires `hero.job_ticket`)
 *   - `enquiry_panel`: a classified enquiry panel (requires `hero.enquiry_panel`)
 * A variant whose data is absent falls back to the summary card.
 */
export type IndustryHeroVisual = "summary_card" | "job_ticket" | "enquiry_panel";

/**
 * The pain section's layout — Slice 2.
 *   - `cards`: the default — every pain point as an equal card
 *   - `timeline`: a four-stage missed-call story, then the cards as
 *     supporting points (requires `pain_points.timeline`)
 *   - `contrast`: two columns of caller-described enquiries, then the
 *     cards as supporting points (requires `pain_points.contrast`)
 * A variant whose data is absent falls back to `cards`.
 */
export type IndustryPainLayout = "cards" | "timeline" | "contrast";

/**
 * The workflow section's motif — Slice 3.
 *   - `none`: the default — no workflow section is rendered
 *   - `flow_curve`: four nodes on a flowing S-curve (requires `workflow`)
 *   - `flow_circuit`: four nodes on an orthogonal circuit trace (requires `workflow`)
 * The motif is decorative; the numbered nodes carry the sequence.
 */
export type IndustryWorkflowMotif = "none" | "flow_curve" | "flow_circuit";

/**
 * The sections a page may order — Slice 3. A CLOSED set of the sections
 * that already exist; the hero always comes first and the final CTA
 * always last, so neither is listed. `workflow` and `mid_cta` render
 * only when their data and variant are present. A section id that is
 * absent from an order is simply not rendered, and any id the order
 * omits from the shared set is appended in default order so a page can
 * never lose its Scan section or FAQ by accident.
 */
export type IndustrySection =
  | "pain"
  | "workflow"
  | "mid_cta"
  | "capabilities"
  | "example"
  | "scan"
  | "how_it_works"
  | "faq";

/** The order every page renders unless it opts into its own. Exactly the pre-Slice-3 page. */
export const DEFAULT_SECTION_ORDER: readonly IndustrySection[] = [
  "pain",
  "capabilities",
  "example",
  "scan",
  "how_it_works",
  "faq",
];

export interface IndustryPresentation {
  readonly theme: IndustryTheme;
  readonly hero_visual: IndustryHeroVisual;
  /** Optional. Absent means `cards`. */
  readonly pain_layout?: IndustryPainLayout;
  /** Optional. Absent means `none`. */
  readonly workflow?: IndustryWorkflowMotif;
  /** Optional. Absent means DEFAULT_SECTION_ORDER. */
  readonly section_order?: readonly IndustrySection[];
}

/** One node of the workflow — what happens at that step, truthfully. The last node is a REQUEST state, never a completed outcome. */
export interface IndustryWorkflowNode {
  readonly title: string;
  readonly body: string;
}

export interface IndustryWorkflow {
  readonly eyebrow: string;
  readonly heading: string;
  readonly lead: string;
  /** Exactly four, in order. */
  readonly nodes: readonly IndustryWorkflowNode[];
  /** The truthfulness footnote under the nodes — what the endpoint does and does not mean. */
  readonly footnote: string;
}

/** The mid-page Scan CTA — same destination as every other Scan CTA, trade-specific framing. */
export interface IndustryMidCta {
  readonly heading: string;
  readonly body: string;
  readonly label: string;
  readonly href: string;
}

/** One stage of the `timeline` pain story. It describes the business's problem, never a Remy action. */
export interface IndustryPainStage {
  readonly title: string;
  readonly body: string;
}

/** One column of the `contrast` pain story: what one kind of caller tends to ask for, in their words. */
export interface IndustryPainColumn {
  readonly title: string;
  readonly caption: string;
  /** Caller-described enquiries. Rendered as quotations; never a diagnosis. */
  readonly enquiries: readonly string[];
}

/** One labelled row on a hero visual. Values are descriptive or in the caller's words — never a real person. */
export interface IndustryVisualRow {
  readonly label: string;
  readonly value: string;
}

/**
 * The plumbers-style hero visual: one incoming job, as it reaches the
 * owner. `status` is the REQUEST state and must never read as booked,
 * confirmed, dispatched or diagnosed.
 */
export interface IndustryJobTicket {
  readonly title: string;
  /** e.g. "Caller said: urgent" — always attributed to the caller. */
  readonly urgency_label: string;
  /** The problem in the caller's own words, rendered as a quotation. */
  readonly problem: string;
  readonly problem_caption: string;
  readonly rows: readonly IndustryVisualRow[];
  readonly status: string;
  readonly illustrative_note: string;
}

/**
 * The electricians-style hero visual: the enquiry types a caller may
 * describe, one highlighted, above the structured details. The types are
 * caller-described service context, never a diagnosis or a
 * certification, and the caption must say so.
 */
export interface IndustryEnquiryPanel {
  readonly title: string;
  readonly types_caption: string;
  readonly enquiry_types: readonly string[];
  /** Must be one of `enquiry_types`. */
  readonly highlighted_type: string;
  readonly rows: readonly IndustryVisualRow[];
  readonly status: string;
  readonly illustrative_note: string;
}

export interface IndustryPage {
  readonly slug: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly hero: {
    readonly eyebrow: string;
    readonly headline: string;
    readonly headline_accent: string;
    readonly lead: string;
    readonly bullets: readonly string[];
    readonly primary_cta: { readonly label: string; readonly href: string };
    readonly secondary_cta: { readonly label: string; readonly href: string };
    /** The structured rows the owner actually receives after a call — the default visual. */
    readonly summary_card: {
      readonly title: string;
      readonly rows: readonly IndustryVisualRow[];
      readonly note: string;
    };
    /** Rendered only when `presentation.hero_visual` is `job_ticket`. */
    readonly job_ticket?: IndustryJobTicket;
    /** Rendered only when `presentation.hero_visual` is `enquiry_panel`. */
    readonly enquiry_panel?: IndustryEnquiryPanel;
  };
  /** Optional. Absent means the default rendering — summary card, indigo. */
  readonly presentation?: IndustryPresentation;
  /** Rendered only when `presentation.workflow` is a motif and `section_order` includes `workflow`. */
  readonly workflow?: IndustryWorkflow;
  /** Rendered only when `section_order` includes `mid_cta`. */
  readonly mid_cta?: IndustryMidCta;
  readonly pain_points: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly lead: string;
    /** The default layout renders these as equal cards; the story layouts render them as supporting cards beneath the story. */
    readonly items: readonly { readonly title: string; readonly body: string }[];
    /** Rendered only when `presentation.pain_layout` is `timeline`. Exactly the story's stages, in order. */
    readonly timeline?: {
      readonly stages: readonly IndustryPainStage[];
      /** The one-line consequence under the story. */
      readonly outcome: string;
    };
    /** Rendered only when `presentation.pain_layout` is `contrast`. */
    readonly contrast?: {
      readonly left: IndustryPainColumn;
      readonly right: IndustryPainColumn;
      /** What both columns have in common — the actual problem. */
      readonly shared_truth: string;
    };
  };
  readonly capabilities: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly lead: string;
    readonly items: readonly IndustryCapability[];
  };
  readonly example: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly disclaimer: string;
    readonly customer_says: string;
    readonly remy_does: readonly string[];
  };
  readonly scan: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly lead: string;
    readonly promise: string;
    readonly problem_links: readonly { readonly label: string; readonly href: string }[];
    readonly cta: { readonly label: string; readonly href: string };
  };
  readonly how_it_works: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly steps: readonly { readonly title: string; readonly body: string }[];
  };
  /** The FAQ section heading, per industry — never hard-coded in the view. */
  readonly faq_heading: string;
  readonly faqs: readonly IndustryFaq[];
  readonly final_cta: {
    readonly heading: string;
    readonly lead: string;
    readonly cta: { readonly label: string; readonly href: string };
  };
}

/** The one place the walkthrough lives: the homepage hero's player. */
const HOMEPAGE_WALKTHROUGH_HREF = "/";

export const PLUMBERS_PAGE: IndustryPage = {
  slug: "ai-receptionist-for-plumbers",
  path: "/ai-receptionist-for-plumbers",
  title: "AI Receptionist for Plumbers — Never Miss Another Plumbing Job | NiteOwl AI",
  description:
    "Remy answers your plumbing business’s calls and website enquiries while you’re on a job, captures the customer and job details, and helps book work into your calendar. Start with a free Business Opportunity Scan.",
  keywords: [
    "AI receptionist for plumbers",
    "plumbing answering service",
    "AI phone receptionist for plumbers",
    "plumber call answering",
    "plumbing appointment booking",
    "missed plumbing calls",
    "Remy",
    "NiteOwl",
  ],

  hero: {
    eyebrow: "AI receptionist for plumbers",
    headline: "Never Miss Another",
    headline_accent: "Plumbing Job",
    lead:
      "Remy answers the phone and your website chat when you can’t — under a sink, on a roof, or after hours. It finds out what the customer needs, takes their details and the job address, and helps book the work into your calendar where booking is set up for your business.",
    bullets: [
      "The burst-pipe call is answered while your hands are full",
      "The job, the address and when they need you — taken down, not scribbled",
      "Urgent callers are flagged so you see them first",
    ],
    primary_cta: { label: "Get Your Free Business Scan", href: SCAN_PATH },
    secondary_cta: { label: "Watch How Remy Works", href: HOMEPAGE_WALKTHROUGH_HREF },
    summary_card: {
      title: "What you get after every call",
      rows: [
        { label: "Caller", value: "Name, as the caller gave it" },
        { label: "Service needed", value: "The job, in the caller’s own words" },
        { label: "Service address", value: "Where the work is needed" },
        { label: "Requested time", value: "The day and time they asked for" },
        { label: "Callback number", value: "Confirmed with the caller" },
        { label: "Urgency", value: "Flagged when the caller says it’s urgent" },
      ],
      note: "Each row comes from what the caller actually said. Anything Remy couldn’t confirm is left blank rather than guessed.",
    },
    job_ticket: {
      title: "Incoming job",
      urgency_label: "Caller said: urgent",
      problem: "Leaking pipe under the kitchen sink — it’s dripping into the cupboard.",
      problem_caption: "The problem, in the caller’s own words",
      rows: [
        { label: "Address", value: "The address where the work is needed, read back if unclear" },
        { label: "Requested time", value: "“Tomorrow, first thing” — kept in the caller’s words" },
        { label: "Callback number", value: "Confirmed with the caller" },
        { label: "Email", value: "Read back and confirmed" },
      ],
      status: "Booking request submitted — look out for the confirmation email",
      illustrative_note: "Illustrative — not a real caller. Anything Remy couldn’t confirm is left blank rather than guessed.",
    },
  },
  presentation: {
    theme: "cyan",
    hero_visual: "job_ticket",
    pain_layout: "timeline",
    workflow: "flow_curve",
    section_order: ["pain", "workflow", "mid_cta", "capabilities", "example", "scan", "how_it_works", "faq"],
  },
  workflow: {
    eyebrow: "From ringing phone to booking request",
    heading: "What happens to the next urgent call",
    lead:
      "One continuous flow, with nothing written on a receipt in between. Each step is something Remy actually does on the call — and the last one is a request, not a promise.",
    nodes: [
      {
        title: "Call answered",
        body: "Remy picks up on your dedicated number while you’re under the sink, and asks what’s wrong before it asks who’s calling.",
      },
      {
        title: "Job & address captured",
        body: "The leak in the caller’s own words, the address where the work is needed, a confirmed callback number and an email — read back where it’s easy to mishear.",
      },
      {
        title: "Time checked against your calendar",
        body: "Once the caller names a day and time, Remy checks it against your business hours and calendar and offers alternatives if that slot isn’t free.",
      },
      {
        title: "Booking request submitted",
        body: "After the call, a booking request is created for a service your Knowledge Base lists. The customer is told to look out for the confirmation email — which arrives only once the booking is actually made.",
      },
    ],
    footnote:
      "A free slot is not a booking. Remy never tells a caller the booking is done, never promises that a plumber will be there at a set time, and never diagnoses the problem — it captures the job and gets the time checked; the booking, and the plumbing, stay yours.",
  },
  mid_cta: {
    heading: "See where your plumbing jobs are being lost",
    body: "Nine questions about how calls reach you and what happens next. Free, nothing stored, no account — and an honest “can’t tell” where the answers don’t support an estimate.",
    label: "Get Your Free Business Scan",
    href: SCAN_PATH,
  },

  pain_points: {
    eyebrow: "The job that can’t wait",
    heading: "How a Plumbing Job Gets Lost While You’re Under a Sink",
    lead:
      "A leaking pipe, no hot water since this morning, a blocked drain — the caller wants someone today, and the first plumber to pick up usually gets the job. Here’s how it slips away while your hands are full.",
    timeline: {
      stages: [
        {
          title: "The phone rings on another job",
          body: "You’re under a sink, up in a loft or halfway through fitting a bathroom. It isn’t a moment you can stop.",
        },
        {
          title: "The call goes to voicemail",
          body: "A caller with water coming through the ceiling rarely leaves a message. They want a person, now.",
        },
        {
          title: "They ring the next plumber",
          body: "Their search results have four more numbers on them. One of those will answer.",
        },
        {
          title: "The job is gone before you call back",
          body: "By the time you’re back in the van, someone else has the address and the afternoon slot.",
        },
      ],
      outcome: "The missed call never shows up as a lost job — it just never shows up at all.",
    },
    items: [
      {
        title: "After-hours leaks don’t wait for Monday",
        body: "A burst pipe at 9pm or no hot water on a Saturday morning is exactly the call that reaches nobody, and exactly the job you’d most want.",
      },
      {
        title: "Details scribbled on a receipt in the van",
        body: "Name, address, what’s leaking, when they’re home — written on a receipt in the van, then typed up later or not at all.",
      },
      {
        title: "Arranging the visit takes a chain of calls",
        body: "Agreeing a day and time by phone tag or text means a straightforward job takes three conversations before it takes one visit.",
      },
    ],
  },

  capabilities: {
    eyebrow: "What Remy does",
    heading: "The call is answered, the job is captured, the time is checked",
    lead:
      "Remy is the same AI receptionist on the phone and in your website chat. For a plumbing business the order matters: pick up fast, take the job down properly, get a time checked — then everything else.",
    items: [
      {
        title: "Answers while your hands are full",
        body: "Remy picks up on a dedicated phone number set up for your business, whenever the call comes in — mid-job, after hours, on a Sunday. It asks what’s wrong before it asks who’s calling, so a caller with a leak isn’t made to fill in a form first.",
      },
      {
        title: "Gets a time checked, not just promised",
        body: "Once the caller names a day and time, Remy checks it against your business hours and calendar, offers alternatives if that slot isn’t free, and submits a booking request after the call. The customer receives a confirmation email once the booking is actually made — never an “I’ll be there at two” Remy can’t keep.",
        condition:
          "Booking applies to services listed in your Knowledge Base, and bookings sync to Google Calendar when your calendar is connected.",
      },
      {
        title: "Takes the job down the way you’d write it",
        body: "The problem in the caller’s own words — “the downstairs loo won’t stop running” — the address where the work is needed, their name, a confirmed callback number and an email, with the easily misheard details read back. Urgent callers are flagged so you see them first.",
      },
      {
        title: "Nothing goes missing between the call and the van",
        body: "Every call and chat is saved as a lead in your dashboard, and you receive a summary of each call with the caller’s details, the job and the transcript. A missed call at 9pm is a lead waiting for you at 7am, not a gap in the diary. Anything that needs a human is flagged for review and you’re notified.",
      },
      {
        title: "Answers the questions that interrupt every job",
        body: "Do you do bathroom fitting? Do you cover my area? Can you come out today? Remy answers from a Knowledge Base you write and edit — your services, prices, hours and policies — and never invents an answer. Anything it can’t answer confidently goes to you instead.",
      },
    ],
  },

  example: {
    eyebrow: "Illustrative example",
    heading: "What a typical call looks like",
    disclaimer:
      "This is an illustration of how Remy is designed to handle a call, not a real transcript, and the customer is not a real person.",
    customer_says: "I’ve got a leaking pipe under the kitchen sink and I need someone out tomorrow.",
    remy_does: [
      "Asks what’s happening and notes the job in the caller’s own words.",
      "Takes the day and time they’d like, and checks it against your availability and booking rules.",
      "Collects their name, the address where the work is needed, a confirmed callback number and an email.",
      "Reads back the details, then explains that a booking request will be submitted and to look out for a confirmation email.",
      "Sends you a summary of the call with every detail in its own row.",
    ],
  },

  scan: {
    eyebrow: "Free Business Opportunity Scan",
    heading: "See Where Your Plumbing Business May Be Losing Opportunities",
    lead:
      "Before anything else, run the free scan. Nine short questions about how enquiries reach your business and what happens to them, and a plain report on where calls, follow-up or booking may be costing you work — with an estimate where your own answers allow one, and an honest “can’t tell” where they don’t.",
    promise: SCAN_PROMISE,
    problem_links: [
      { label: PROBLEM_PAGES["enquiry.unanswered"].headline, href: PROBLEM_PAGES["enquiry.unanswered"].path },
      { label: PROBLEM_PAGES["enquiry.no_followup"].headline, href: PROBLEM_PAGES["enquiry.no_followup"].path },
      { label: PROBLEM_PAGES["booking.friction"].headline, href: PROBLEM_PAGES["booking.friction"].path },
    ],
    cta: { label: "Run My Free Business Opportunity Scan", href: SCAN_PATH },
  },

  how_it_works: {
    eyebrow: "How it works",
    heading: "From free scan to answered plumbing calls",
    steps: [
      {
        title: "Run the free Business Opportunity Scan",
        body: "Nine questions, nothing stored, no account. See where enquiries may be getting lost before deciding anything.",
      },
      {
        title: "Put your plumbing work into the Knowledge Base",
        body: "List the jobs you take — call-outs, repairs, installations, servicing — with your prices, your hours and your policies. Connect your calendar if you want booking requests to land in it. Remy answers from what you’ve listed and nothing else.",
      },
      {
        title: "Remy answers while you’re on the tools",
        body: "Calls and website chats are answered whether you’re under a sink or on a roof. Remy takes the problem in the caller’s own words, the job address and their number, and flags the call as urgent when the caller says it is.",
      },
      {
        title: "Pick up the job from your dashboard",
        body: "Every call summary, lead and booking request is waiting for you, with anything Remy couldn’t answer flagged for review — so the day’s enquiries are in one place instead of in your call log.",
      },
    ],
  },

  faq_heading: "Questions plumbers ask about Remy",
  faqs: [
    {
      q: "Can Remy answer the phone when your hands are full?",
      a: "Yes — the burst-pipe call at eight in the evening doesn’t wait for you to be free. Remy answers on a dedicated phone number set up for your business whenever a call comes in, takes the job details and customer details, and sends you a summary of the call — so you can read it when you’re out from under the sink.",
    },
    {
      q: "Can Remy collect information about an urgent plumbing problem?",
      a: "Yes. Remy asks what the problem is in the caller’s own words, notes that it’s urgent, still collects their name, address and contact number, and flags the enquiry as urgent in your summary. It tells the caller the team will be in touch as quickly as possible rather than promising a response time, and it doesn’t transfer live calls. If someone describes a life-threatening emergency, Remy tells them to hang up and call 999.",
    },
    {
      q: "Can Remy help with booking requests for jobs in my week?",
      a: "Yes, for the services listed in your Knowledge Base — a call-out, a repair, a service, whatever you’ve said you take. Once a caller gives a day and time, Remy checks it against your business hours and availability, offers alternatives if that slot is taken, and submits a booking request after the call. The customer receives a confirmation email once the booking is actually made, and it appears in your dashboard — and in Google Calendar when your calendar is connected. If a caller asks for something you don’t list, Remy takes the details and passes the request to you rather than confirming it.",
    },
    {
      q: "Can I control what Remy tells customers?",
      a: "Yes. Remy answers from your Knowledge Base — your services, prices, opening hours, policies, FAQs and any custom instructions — which you can edit at any time. It never invents an answer.",
    },
    {
      q: "What happens if Remy cannot answer something?",
      a: "It politely takes the customer’s details, saves the enquiry as a lead marked for your review and notifies you, so you can follow up. The customer is told someone from the business will get back to them.",
    },
    {
      q: "Can Remy handle calls outside normal hours?",
      a: "Yes. The eleven-o’clock leak is answered the same way the eleven-o’clock-in-the-morning one is. Remy answers whenever the call comes in, day or night. The appointment times it offers respect the business hours you set, and any after-hours enquiry is waiting in your dashboard and your summary email. Remy doesn’t transfer live calls and doesn’t promise a response time — it tells the caller the team will be in touch as quickly as possible.",
    },
    {
      q: "Do I need to change my existing business phone number?",
      a: "No. Remy answers on a dedicated number set up for your business. You can give that number out directly, or keep your existing number and divert calls to it using your phone provider’s call forwarding — whichever suits how your business already works.",
    },
  ],

  final_cta: {
    heading: "Find Out What Your Plumbing Business Could Be Missing",
    lead: "Start with a free scan to see where enquiries or opportunities may be getting lost.",
    cta: { label: "Get My Free Business Scan", href: SCAN_PATH },
  },
};

export const ELECTRICIANS_PAGE: IndustryPage = {
  slug: "ai-receptionist-for-electricians",
  path: "/ai-receptionist-for-electricians",
  title: "AI Receptionist for Electricians — Never Miss Another Electrical Job | NiteOwl AI",
  description:
    "Remy answers your electrical business’s calls and website enquiries while you’re on a job, captures the customer, the work needed and the address, and helps book work into your calendar. Start with a free Business Opportunity Scan.",
  keywords: [
    "AI receptionist for electricians",
    "electrician answering service",
    "AI phone receptionist for electricians",
    "electrician call answering",
    "electrical appointment booking",
    "missed electrician calls",
    "Remy",
    "NiteOwl",
  ],

  hero: {
    eyebrow: "AI receptionist for electricians",
    headline: "Every Electrical Enquiry,",
    headline_accent: "Captured While You’re On Site",
    lead:
      "Remy answers the phone and your website chat when you can’t — up a ladder, in a loft, or with the power off. It takes down what the caller describes, where the work is and when they need you, and helps book the job into your calendar where booking is set up for your business.",
    bullets: [
      "Faults, sockets, lighting, rewires, EV chargers — captured as the caller describes them",
      "Domestic or commercial, the address and the timing, all in one summary",
      "Nothing diagnosed over the phone — the details reach you, the decision stays yours",
    ],
    primary_cta: { label: "Get Your Free Business Scan", href: SCAN_PATH },
    secondary_cta: { label: "Watch How Remy Works", href: HOMEPAGE_WALKTHROUGH_HREF },
    summary_card: {
      title: "What you get after every call",
      rows: [
        { label: "Caller", value: "Name, as the caller gave it" },
        { label: "Service needed", value: "The work, in the caller’s own words" },
        { label: "Service address", value: "Where the work is needed" },
        { label: "Requested time", value: "The day and time they asked for" },
        { label: "Callback number", value: "Confirmed with the caller" },
        { label: "Urgency", value: "Flagged when the caller says it’s urgent" },
      ],
      note: "Each row comes from what the caller actually said. Anything Remy couldn’t confirm is left blank rather than guessed.",
    },
    enquiry_panel: {
      title: "Enquiry panel",
      types_caption: "Enquiry types as callers describe them — not a diagnosis",
      enquiry_types: ["Fault", "Sockets & switches", "Lighting", "Rewire", "Consumer unit", "EV charger", "Commercial"],
      highlighted_type: "Fault",
      rows: [
        { label: "In the caller’s words", value: "“Half the sockets in the kitchen have stopped working and the board keeps tripping.”" },
        { label: "Premises", value: "Domestic — only when the caller says so" },
        { label: "Address", value: "The address where the work is needed" },
        { label: "Requested time", value: "“This week, any afternoon” — kept in the caller’s words" },
        { label: "Callback number", value: "Confirmed with the caller" },
      ],
      status: "Details captured and sent to you in the call summary",
      illustrative_note: "Illustrative — not a real caller. Remy records what was described; it doesn’t diagnose the fault.",
    },
  },
  presentation: {
    theme: "amber",
    hero_visual: "enquiry_panel",
    pain_layout: "contrast",
    workflow: "flow_circuit",
    section_order: ["workflow", "mid_cta", "pain", "capabilities", "example", "scan", "how_it_works", "faq"],
  },
  workflow: {
    eyebrow: "Call → classify → capture → route",
    heading: "How an enquiry reaches you while you’re on site",
    lead:
      "Every enquiry follows the same path, whatever kind of job it is. Remy classifies it by what the caller describes — never by what it thinks is wrong — and routes it truthfully.",
    nodes: [
      {
        title: "Call",
        body: "Remy answers on your dedicated number with the power off and your hands in a board, and asks about the job before the caller’s details.",
      },
      {
        title: "Classify",
        body: "The enquiry is noted as the caller describes it — a fault, sockets, lighting, a rewire, a consumer unit, an EV charger, domestic or commercial when they say so. That is context for you, not a diagnosis.",
      },
      {
        title: "Capture",
        body: "The problem in the caller’s words, the address where the work is needed, a confirmed callback number, an email and the time they’d like — read back where it’s easy to mishear.",
      },
      {
        title: "Route",
        body: "Where the service is one your Knowledge Base lists and a time has been checked against your calendar, Remy submits a booking request after the call. Otherwise the enquiry is captured and flagged for your review — it never guesses whether you can take the job.",
      },
    ],
    footnote:
      "Remy doesn’t diagnose faults, certify work, decide what is safe, or send an electrician anywhere. A booking request is a request: the customer hears “look out for the confirmation email”, and the confirmation arrives only once the booking is actually made.",
  },
  mid_cta: {
    heading: "See which enquiries your electrical business is losing",
    body: "Nine questions about how enquiries reach you and what happens next. Free, nothing stored, no account — and an honest “can’t tell” where the answers don’t support an estimate.",
    label: "Get Your Free Business Scan",
    href: SCAN_PATH,
  },

  pain_points: {
    eyebrow: "Every enquiry needs to be captured and understood",
    heading: "No Two Electrical Enquiries Are the Same Call",
    lead:
      "A homeowner with tripping sockets and a facilities manager pricing a fit-out ring the same number. Both need their enquiry taken down accurately — and both get voicemail while you’re on site.",
    contrast: {
      left: {
        title: "Domestic",
        caption: "What homeowners tend to describe",
        enquiries: [
          "Half the sockets in the kitchen have stopped working",
          "The landing light flickers and then goes off",
          "The consumer unit keeps tripping — can someone look at it?",
          "Can you fit an EV charger on the driveway?",
        ],
      },
      right: {
        title: "Commercial",
        caption: "What businesses and property managers tend to ask",
        enquiries: [
          "We need a quote for the electrics on a shop fit-out",
          "Can you take on a maintenance contract for two units?",
          "The office needs a rewire and a board upgrade before we move in",
          "Are you available for out-of-hours commercial work?",
        ],
      },
      shared_truth:
        "Different jobs, different questions, different follow-up — and every one of them arrives while you’re in a board with the power off. Whoever answers has to get the details right for you, not guess what the job is.",
    },
    items: [
      {
        title: "Evenings and weekends bring the urgent ones",
        body: "A board that trips at 8pm or a shop with no power on a Saturday morning is the call that reaches nobody — and the customer who rings the next electrician.",
      },
      {
        title: "Details get scribbled, then lost",
        body: "Name, address, what’s tripping, domestic or commercial, when they’re there — written on the back of a test sheet, then typed up later or not at all.",
      },
      {
        title: "The same questions interrupt every job",
        body: "Do you fit EV chargers? Do you do rewires? Can you do a commercial job next week? Each one is a stop-and-start with a screwdriver in your hand.",
      },
    ],
  },

  capabilities: {
    eyebrow: "What Remy does",
    heading: "The enquiry is captured as described, then the rest follows",
    lead:
      "Remy is the same AI receptionist on the phone and in your website chat. For an electrical business the order matters: get the enquiry down accurately and in context first, answer what can be answered, then get a time checked.",
    items: [
      {
        title: "Captures the enquiry in the caller’s words",
        body: "A tripping board, a dead socket, a flickering light, a rewire, a consumer-unit upgrade, an EV charger — Remy takes the job down as the caller describes it, plus whether it’s a home or a business premises when they say so, the address where the work is needed, their name, a confirmed callback number and an email. It records what was described; it doesn’t diagnose the fault.",
      },
      {
        title: "Answers the questions you get asked every day",
        body: "Do you fit EV chargers? Do you do rewires? Do you take commercial work? Remy answers from a Knowledge Base you write and edit — your services, prices, hours and policies — and never invents an answer or gives electrical advice. Anything it can’t answer confidently goes to you instead.",
      },
      {
        title: "Answers while you’re on site",
        body: "Remy picks up on a dedicated phone number set up for your business, whenever the call comes in — with the power off, up a ladder, in a loft. It asks about the job before it asks who’s calling, and clarifies a service it isn’t sure it heard.",
      },
      {
        title: "Gets a time checked for the jobs you can book",
        body: "Once the caller names a day and time, Remy checks it against your business hours and calendar, offers alternatives if that slot isn’t free, and submits a booking request after the call. The customer receives a confirmation email once the booking is actually made.",
        condition:
          "Booking applies to services listed in your Knowledge Base, and bookings sync to Google Calendar when your calendar is connected.",
      },
      {
        title: "Every enquiry lands in one place",
        body: "Every call and chat is saved as a lead in your dashboard, and you receive a summary of each call with the caller’s details, the enquiry and the transcript. Domestic or commercial, fault or fit-out, anything that needs a human is flagged for review and you’re notified.",
      },
    ],
  },

  example: {
    eyebrow: "Illustrative example",
    heading: "What a typical call looks like",
    disclaimer:
      "This is an illustration of how Remy is designed to handle a call, not a real transcript, and the customer is not a real person.",
    customer_says: "Half the sockets in my kitchen have stopped working and the board keeps tripping. Can someone come out this week?",
    remy_does: [
      "Asks what’s happening and notes the work in the caller’s own words — it doesn’t try to diagnose the fault.",
      "Takes the day and time they’d like, and checks it against your availability and booking rules.",
      "Collects their name, the address where the work is needed, a confirmed callback number and an email.",
      "Reads back the details, then explains that a booking request will be submitted and to look out for a confirmation email.",
      "Sends you a summary of the call with every detail in its own row.",
    ],
  },

  scan: {
    eyebrow: "Free Business Opportunity Scan",
    heading: "See Where Your Electrical Business May Be Losing Opportunities",
    lead:
      "Before anything else, run the free scan. Nine short questions about how enquiries reach your business and what happens to them, and a plain report on where calls, follow-up or booking may be costing you work — with an estimate where your own answers allow one, and an honest “can’t tell” where they don’t.",
    promise: SCAN_PROMISE,
    problem_links: [
      { label: PROBLEM_PAGES["enquiry.unanswered"].headline, href: PROBLEM_PAGES["enquiry.unanswered"].path },
      { label: PROBLEM_PAGES["enquiry.no_followup"].headline, href: PROBLEM_PAGES["enquiry.no_followup"].path },
      { label: PROBLEM_PAGES["booking.friction"].headline, href: PROBLEM_PAGES["booking.friction"].path },
    ],
    cta: { label: "Run My Free Business Opportunity Scan", href: SCAN_PATH },
  },

  how_it_works: {
    eyebrow: "How it works",
    heading: "From free scan to answered electrical enquiries",
    steps: [
      {
        title: "Run the free Business Opportunity Scan",
        body: "Nine questions, nothing stored, no account. See where enquiries may be getting lost before deciding anything.",
      },
      {
        title: "List the electrical work you take on",
        body: "Domestic and commercial, the jobs you’ll quote for and the ones you won’t, with your prices, hours and policies. Connect your calendar if you want booking requests in it. Remy only offers what you’ve listed.",
      },
      {
        title: "Remy answers and captures the enquiry as described",
        body: "Calls and website chats are answered while you’re on site. Remy takes what the caller says is happening — in their words — with their address and number, and flags it as urgent if they say it is. It doesn’t diagnose the fault.",
      },
      {
        title: "Decide what’s yours from the dashboard",
        body: "Enquiries, call summaries and booking requests are in one place, with anything outside your listed work flagged for review — so you decide what needs a visit and what doesn’t.",
      },
    ],
  },

  faq_heading: "Questions electricians ask about Remy",
  faqs: [
    {
      q: "Can Remy answer calls while I’m on site?",
      a: "Yes — you can’t take a call with a board open and the power off. Remy answers on a dedicated phone number set up for your business whenever a call comes in, takes the job details and customer details, and sends you a summary of the call — so you can read it when you’re back down the ladder.",
    },
    {
      q: "Can Remy take details about an electrical fault?",
      a: "Yes — in the caller’s own words. Remy asks what’s happening, notes it as described, collects their name, address and contact number, and flags the enquiry as urgent if the caller says it is. It doesn’t diagnose the fault or tell the caller what’s wrong; that stays with you. If someone describes a life-threatening emergency, Remy tells them to hang up and call 999.",
    },
    {
      q: "Can Remy handle booking requests for domestic and commercial work?",
      a: "Yes, for the services listed in your Knowledge Base — and only those, so the work you don’t take is never offered on your behalf. Once a caller gives a day and time, Remy checks it against your business hours and availability, offers alternatives if that slot is taken, and submits a booking request after the call. The customer receives a confirmation email once the booking is actually made, and it appears in your dashboard — and in Google Calendar when your calendar is connected. If a caller asks for something you don’t list, Remy takes the details and passes the request to you rather than confirming it.",
    },
    {
      q: "Can I control what Remy tells customers?",
      a: "Yes. Remy answers from your Knowledge Base — your services, prices, opening hours, policies, FAQs and any custom instructions — which you can edit at any time. It never invents an answer.",
    },
    {
      q: "What happens if Remy cannot answer something?",
      a: "It politely takes the customer’s details, saves the enquiry as a lead marked for your review and notifies you, so you can follow up. The customer is told someone from the business will get back to them.",
    },
    {
      q: "Can Remy handle calls outside normal hours?",
      a: "Yes — the Monday-morning call about a unit with no power comes in before you’ve opened the van. Remy answers whenever the call comes in, day or night. The appointment times it offers respect the business hours you set, and any after-hours enquiry is waiting in your dashboard and your summary email. Remy doesn’t transfer live calls and doesn’t promise a response time — it tells the caller the team will be in touch as quickly as possible.",
    },
    {
      q: "Do I need to change my existing business phone number?",
      a: "No. Remy answers on a dedicated number set up for your business. You can give that number out directly, or keep your existing number and divert calls to it using your phone provider’s call forwarding — whichever suits how your business already works.",
    },
  ],

  final_cta: {
    heading: "Find Out What Your Electrical Business Could Be Missing",
    lead: "Start with a free scan to see where enquiries or opportunities may be getting lost.",
    cta: { label: "Get My Free Business Scan", href: SCAN_PATH },
  },
};
