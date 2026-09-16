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
// segment or a configuration framework. Only plumbers exist today.
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
    /** The structured rows the owner actually receives after a call. */
    readonly summary_card: {
      readonly title: string;
      readonly rows: readonly { readonly label: string; readonly value: string }[];
      readonly note: string;
    };
  };
  readonly pain_points: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly lead: string;
    readonly items: readonly { readonly title: string; readonly body: string }[];
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
      "Handle calls while you’re on a job",
      "Capture customer and job details",
      "Help book jobs into your calendar",
      "Reduce missed enquiries",
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
  },

  pain_points: {
    eyebrow: "The problem",
    heading: "Built Around the Way Plumbing Businesses Actually Work",
    lead:
      "Plumbing enquiries tend to arrive while you’re working. The phone rings mid-job, the caller gets voicemail, and by the time you ring back they may have tried someone else.",
    items: [
      {
        title: "You can’t answer while you’re working",
        body: "Hands full, on a ladder, under a floor — the call goes to voicemail, and a caller who gets voicemail may not leave one.",
      },
      {
        title: "Urgent calls arrive when the team is busy",
        body: "A burst pipe doesn’t wait for a quiet moment. The caller needs someone to pick up and take the details now.",
      },
      {
        title: "After-hours calls go nowhere",
        body: "Evenings and weekends bring some of the most urgent enquiries, and the ones that reach nobody are the easiest to lose.",
      },
      {
        title: "Callers leave before you can respond",
        body: "A missed call that nobody notices can’t be returned. Without a record of it, the enquiry is simply gone.",
      },
      {
        title: "The same basic questions interrupt every job",
        body: "Do you do bathroom fitting? Do you cover my area? What are your hours? Each one is a stop-and-start in the middle of real work.",
      },
      {
        title: "Details get written down by hand",
        body: "Name, address, what’s wrong, when they’re free — scribbled on whatever’s nearby, then typed up later or lost.",
      },
      {
        title: "Arranging the visit takes a chain of calls",
        body: "Agreeing a day and time by phone tag or text means the job takes several conversations before it takes one visit.",
      },
    ],
  },

  capabilities: {
    eyebrow: "What Remy does",
    heading: "One receptionist for calls and website enquiries",
    lead:
      "Remy is the same AI receptionist on the phone and in your website chat. It answers from the knowledge you give it, collects what a plumbing job needs, and hands anything unusual to you.",
    items: [
      {
        title: "Call handling",
        body: "Remy answers on a dedicated phone number set up for your business, whenever the call comes in. It asks about the job before it asks about the caller, clarifies a service it isn’t sure it heard, and doesn’t promise anything it can’t know.",
      },
      {
        title: "Customer & job detail capture",
        body: "For work at the customer’s premises, Remy collects the job in their own words, the address where the work is needed, their name, a confirmed callback number and an email address — reading back the details that are easy to mishear.",
      },
      {
        title: "Appointment / job booking",
        body: "Once a caller has a day and time, Remy checks it against your business hours and calendar, offers alternatives if that slot isn’t free, and submits a booking request after the call. The customer gets a confirmation email once the booking is actually made.",
        condition:
          "Booking applies to services listed in your Knowledge Base, and bookings sync to Google Calendar when your calendar is connected.",
      },
      {
        title: "Business knowledge responses",
        body: "Remy answers questions about your services, prices, hours and policies from a Knowledge Base you write and edit. It never invents details — anything it can’t answer confidently goes to you instead.",
      },
      {
        title: "Lead / enquiry capture",
        body: "Every call and chat is saved as a lead in your dashboard, and you receive a summary of each call with the caller’s details, what they need and the transcript. Anything that needs a human is flagged for review and you’re notified.",
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
    heading: "From free scan to answered calls",
    steps: [
      {
        title: "Run the free Business Opportunity Scan",
        body: "Nine questions, nothing stored, no account. See where enquiries may be getting lost before deciding anything.",
      },
      {
        title: "Configure Remy for your business",
        body: "Add your services, prices, hours and policies to the Knowledge Base, connect your calendar if you want bookings in it, and Remy answers from that.",
      },
      {
        title: "Remy handles incoming enquiries",
        body: "Calls and website chats are answered, the job and customer details are captured, and booking requests are made where they can be.",
      },
      {
        title: "Review enquiries and bookings in your dashboard",
        body: "Every lead, call summary and booking is there to check and follow up, with anything unusual flagged for you.",
      },
    ],
  },

  faqs: [
    {
      q: "Can Remy answer calls while I’m working on a job?",
      a: "Yes. Remy answers on a dedicated phone number set up for your business whenever a call comes in, takes the job and customer details, and sends you a summary of the call — so you can look at it when you’ve got a free hand.",
    },
    {
      q: "Can Remy collect information about an urgent plumbing problem?",
      a: "Yes. Remy asks what the problem is in the caller’s own words, notes that it’s urgent, still collects their name, address and contact number, and flags the enquiry as urgent in your summary. It tells the caller the team will be in touch as quickly as possible rather than promising a response time, and it doesn’t transfer live calls. If someone describes a life-threatening emergency, Remy tells them to hang up and call 999.",
    },
    {
      q: "Can Remy help book jobs?",
      a: "Yes, for the services listed in your Knowledge Base. Once a caller gives a day and time, Remy checks it against your business hours and availability, offers alternatives if that slot is taken, and submits a booking request after the call. The customer receives a confirmation email once the booking is actually made, and it appears in your dashboard — and in Google Calendar when your calendar is connected. If a caller asks for something you don’t list, Remy takes the details and passes the request to you rather than confirming it.",
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
      a: "Yes. Remy answers whenever the call comes in, day or night. The appointment times it offers respect the business hours you set, and any after-hours enquiry is waiting in your dashboard and your summary email.",
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
