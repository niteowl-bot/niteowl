// ── Free Tools: the Receptionist Setup derivation ──────────────────
//
// One pure function, `buildReceptionistSetup`, turning a
// BusinessSetupProfile into the setup a visitor reads.
//
// PURE, AND THAT IS THE POINT. No network, no storage, no clock, no
// randomness, no React, no Remy import, no provider. Given the same
// profile it returns the same setup forever, which is what makes it
// testable without a harness and what keeps the free-product boundary
// honest: a function that cannot reach anything cannot leak anything.
//
// IT DERIVES; IT NEVER INVENTS. Every line traces to something the
// visitor typed. There is no default opening-hours block, no assumed
// service list, no "most businesses also…" filler. Where an answer is
// missing the setup SAYS SO — see `note` — because a gap the owner can
// see is useful and a gap quietly filled with a plausible guess is a
// fabricated fact about a real business.
//
// NOTHING IS VERIFIED. Everything here is what somebody typed into a
// public form. The wording says "you told us" and "based on what you
// provided" throughout, never "your business is". §26 requires free-tool
// input to stay `business_provided` and never become `verified`.
//
// OPENING HOURS ARE PLAIN TEXT, DELIBERATELY. A structured weekly
// schedule would be a second scheduling model living outside Remy, and
// the brief asks for a simple practical representation. Text also
// survives the things real businesses actually say — "9-5 weekdays, Sat
// mornings by arrangement" — which a grid forces them to lie about.

import type {
  BusinessSetupProfile,
  CommonQuestion,
  ReceptionistSetup,
  SetupSection,
} from "@/lib/freetools/types";

/** The details a business can ask a receptionist to collect. */
export const COLLECT_FIELD_LABELS: Record<string, string> = {
  name: "Their name",
  phone: "A phone number",
  email: "An email address",
  address: "Their address or location",
  reason: "What they are getting in touch about",
  preferred_time: "A preferred appointment time",
};

/** The order collected details are shown in, regardless of tick order. */
const COLLECT_FIELD_ORDER = [
  "name",
  "phone",
  "email",
  "address",
  "reason",
  "preferred_time",
];

/** An empty profile — the wizard's starting state. */
export function emptyProfile(): BusinessSetupProfile {
  return {
    businessName: "",
    businessType: "",
    description: "",
    openingHours: "",
    services: [],
    commonQuestions: [],
    collectFields: [],
    acceptsAppointments: false,
    appointmentRules: "",
    outOfHours: "",
    urgentCriteria: "",
    escalation: "",
  };
}

const clean = (value: string): string => value.trim();
const isPresent = (value: string): boolean => clean(value).length > 0;

/** Non-empty entries only, trimmed, order preserved. */
function cleanList(values: string[]): string[] {
  return values.map(clean).filter((v) => v.length > 0);
}

/** Question/answer pairs where BOTH halves were filled in. */
export function cleanQuestions(questions: CommonQuestion[]): CommonQuestion[] {
  return questions
    .map((q) => ({ question: clean(q.question), answer: clean(q.answer) }))
    .filter((q) => q.question.length > 0 && q.answer.length > 0);
}

/**
 * The generated setup.
 *
 * Sections appear only when the visitor gave something to put in them.
 * `totalSections` is therefore the number of sections this tool CAN
 * produce, and `completedSections` how many this profile filled — a
 * count of the visitor's own answers, compared with nobody.
 */
export function buildReceptionistSetup(
  profile: BusinessSetupProfile
): ReceptionistSetup {
  const sections: SetupSection[] = [];

  // ── Business overview ────────────────────────────────────────────
  const overview: string[] = [];
  if (isPresent(profile.businessName)) {
    overview.push(`Business name: ${clean(profile.businessName)}`);
  }
  if (isPresent(profile.businessType)) {
    overview.push(`Type of business: ${clean(profile.businessType)}`);
  }
  if (isPresent(profile.description)) {
    overview.push(clean(profile.description));
  }
  if (overview.length > 0) {
    sections.push({ id: "overview", title: "Business overview", lines: overview });
  }

  // ── Opening hours ────────────────────────────────────────────────
  if (isPresent(profile.openingHours)) {
    sections.push({
      id: "hours",
      title: "Opening hours",
      lines: [clean(profile.openingHours)],
      note: "Anyone answering enquiries should know these hours, and know what to do outside them.",
    });
  }

  // ── Services and enquiries ───────────────────────────────────────
  const services = cleanList(profile.services);
  if (services.length > 0) {
    sections.push({
      id: "services",
      title: "Services and enquiries handled",
      lines: services,
      note: "An enquiry that is not on this list is one to pass to a person rather than answer.",
    });
  }

  // ── Common questions ─────────────────────────────────────────────
  const questions = cleanQuestions(profile.commonQuestions);
  if (questions.length > 0) {
    sections.push({
      id: "questions",
      title: "Common questions and answers",
      lines: questions.map((q) => `${q.question} — ${q.answer}`),
      note: "These are the answers you want given. Anything not covered here should not be guessed at.",
    });
  }

  // ── Information to collect ───────────────────────────────────────
  const collect = COLLECT_FIELD_ORDER.filter((f) =>
    profile.collectFields.includes(f)
  ).map((f) => COLLECT_FIELD_LABELS[f]);
  if (collect.length > 0) {
    sections.push({
      id: "collect",
      title: "Information to collect",
      lines: collect,
      note: "Ask for anything still missing before the conversation ends — it is far harder to get afterwards.",
    });
  }

  // ── Appointment handling ─────────────────────────────────────────
  const appointment: string[] = [];
  if (profile.acceptsAppointments) {
    appointment.push("This business takes appointment and booking enquiries.");
    if (isPresent(profile.appointmentRules)) {
      appointment.push(clean(profile.appointmentRules));
    }
  } else {
    appointment.push(
      "This business does not take appointment or booking enquiries. Anyone asking to book should be told a person will follow up."
    );
  }
  sections.push({
    id: "appointments",
    title: "Appointment handling",
    lines: appointment,
    note:
      profile.acceptsAppointments && !isPresent(profile.appointmentRules)
        ? "You did not give any booking rules. Worth adding what you will and will not accept — how much notice you need, and anything you never book without checking first."
        : undefined,
  });

  // ── Out of hours ─────────────────────────────────────────────────
  if (isPresent(profile.outOfHours)) {
    sections.push({
      id: "out-of-hours",
      title: "Out-of-hours handling",
      lines: [clean(profile.outOfHours)],
    });
  }

  // ── Escalation ───────────────────────────────────────────────────
  const escalation: string[] = [];
  if (isPresent(profile.urgentCriteria)) {
    escalation.push(`Treat as urgent: ${clean(profile.urgentCriteria)}`);
  }
  if (isPresent(profile.escalation)) {
    escalation.push(clean(profile.escalation));
  }
  if (escalation.length > 0) {
    sections.push({
      id: "escalation",
      title: "Escalation instructions",
      lines: escalation,
      note: "When it is not clear whether something is urgent, treat it as urgent and pass it on.",
    });
  }

  return {
    businessName: clean(profile.businessName),
    sections,
    completedSections: sections.length,
    // Every section this tool can produce. Appointment handling always
    // appears (both answers are meaningful), so the ceiling is 8.
    totalSections: 8,
  };
}
