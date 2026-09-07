// ── Free Tools: provider-neutral types ─────────────────────────────
//
// The vocabulary the free-product surface speaks. It is deliberately
// NOT Remy's vocabulary: nothing here mentions an organisation, a lead,
// a calendar, a provider or a tenant, and nothing here carries an
// `org_id`.
//
// That absence is the architecture, not an oversight. The free-product
// surface is the only NiteOwl surface that legitimately has no `org_id`
// (docs/ARCHITECTURE.md §26, docs/AGENT_ACCESS_LAYER.md §25.1), so its
// isolation has to be STRUCTURAL — its own namespace — because the
// "every query carries an explicit org_id" discipline that protects
// every other surface has nothing to bind to here.
//
// EVERYTHING IN A PROFILE IS BUSINESS-PROVIDED, NEVER VERIFIED. Every
// value is text a visitor typed into a public form. Nothing has been
// checked against anything, and no consumer of these types may present
// them as established fact. §26 is explicit that free-tool input stays
// `business_provided` and never becomes `verified`.
//
// IDENTITY IS NEVER INFERRED. A business name here is a label the
// visitor typed. It must never be matched against `organisations` or any
// other tenant record — the architecture forbids that outright as the
// most plausible accidental route to cross-tenant leakage, precisely
// because it arrives disguised as a helpful feature ("we found your
// business!").

/** A single question the business wants answered a particular way. */
export interface CommonQuestion {
  question: string;
  answer: string;
}

/**
 * What a business tells us about how it handles enquiries.
 *
 * Provider-neutral by construction: this shape would be equally valid
 * handed to a human receptionist, a rota sheet or a different product
 * entirely. Any later import into Remy is an explicit, recorded,
 * consented step that translates this — it is not this.
 */
export interface BusinessSetupProfile {
  /** What the business calls itself. Typed by the visitor, unverified. */
  businessName: string;
  /** Trade or category, in the visitor's own words. */
  businessType: string;
  /** Optional one-line description of what they do. */
  description: string;
  /** Opening hours as plain text — see the note in setupKit.ts. */
  openingHours: string;
  /** Main services, or the reasons customers get in touch. */
  services: string[];
  /** Questions the business wants answered a specific way. */
  commonQuestions: CommonQuestion[];
  /** Details to take from a caller. Keys are stable; labels live in the UI. */
  collectFields: string[];
  /** Whether the business takes appointment or booking enquiries at all. */
  acceptsAppointments: boolean;
  /** Any plain-language booking rules the business wants followed. */
  appointmentRules: string;
  /** What should happen to an enquiry outside normal hours. */
  outOfHours: string;
  /** What this business considers genuinely urgent. */
  urgentCriteria: string;
  /** When and how an enquiry should be handed to a person. */
  escalation: string;
}

/** One rendered section of the generated setup. */
export interface SetupSection {
  /** Stable identifier, for keys and tests. */
  id: string;
  /** Heading shown to the visitor. */
  title: string;
  /**
   * The lines of this section, already ordered for display.
   *
   * Every line is derived from what the visitor entered. A section with
   * no supporting input is omitted entirely rather than padded — see
   * `note` for how a gap is reported instead.
   */
  lines: string[];
  /**
   * An honest observation about a gap, shown beneath the lines.
   *
   * Only ever says what the visitor did NOT provide. It never guesses a
   * value, and it never asserts anything about the business.
   */
  note?: string;
}

/** The complete generated setup. A pure function of one profile. */
export interface ReceptionistSetup {
  /** The business name, echoed back for the heading. */
  businessName: string;
  sections: SetupSection[];
  /**
   * How complete the answers were, as a plain count — NOT a score,
   * grade or benchmark.
   *
   * §26 forbids cohort claims over unverified form input ("businesses
   * like yours report X"), and a score invites exactly that reading. This
   * counts the visitor's own sections and nothing else: it compares them
   * to no one.
   */
  completedSections: number;
  totalSections: number;
}
