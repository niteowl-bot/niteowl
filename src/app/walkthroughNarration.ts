// ─────────────────────────────────────────────────────────────────────
//  Walkthrough narration — timing table
//
//  The single source of truth for three things that must never drift
//  apart: which caption is on screen, where the narration audio should
//  be, and when the background music ducks.
//
//  `public/audio/remy-walkthrough-narration.mp3` is one continuous 90s
//  track containing all eleven spoken sentences at the offsets below, with
//  silence between them. Because the track is exactly TOTAL_MS long and
//  starts at the same instant as the walkthrough clock, "where the audio
//  should be" is simply the walkthrough's own elapsed time — there is no
//  second clock to keep in step. See RemyWalkthrough.tsx.
//
//  `startMs`/`endMs` are the *measured* speech boundaries of each clip in
//  the mixed track (ffmpeg silencedetect at -45dB), not estimates. Edit
//  these only alongside a regenerated mp3, or captions will lie.
//
//  Each entry is one spoken sentence, which is also one caption. Sentence
//  granularity is deliberate: a caption that changes on the sentence is
//  readable, whereas one that changes per scene would sit still through
//  several sentences and one that changes per word would strobe.
// ─────────────────────────────────────────────────────────────────────

export const NARRATION_SRC = "/audio/remy-walkthrough-narration.mp3";

export interface NarrationLine {
  /** Measured start of speech in the mixed track, ms. */
  startMs: number;
  /** Measured end of speech in the mixed track, ms. */
  endMs: number;
  /** Caption text — verbatim what is spoken. */
  text: string;
  /** Which walkthrough scene this line is anchored to (documentation). */
  scene: string;
}

export const NARRATION: NarrationLine[] = [
  {
    startMs: 350,
    endMs: 6356,
    scene: "two-assistants",
    text: "Meet Remy, your AI receptionist that never misses another customer enquiry.",
  },
  {
    startMs: 7017,
    endMs: 9438,
    scene: "onboarding-business",
    text: "Getting started takes just a few minutes.",
  },
  {
    startMs: 12616,
    endMs: 18531,
    scene: "onboarding-business → onboarding-hours",
    text: "Add your business details, services, opening hours and booking preferences.",
  },
  {
    // Lands "and booking rules" on the Settings → Hours cut at 23.0s,
    // which is the scene that shows appointment length and capacity.
    startMs: 19712,
    endMs: 27578,
    scene: "onboarding-hours → settings-hours",
    text: "Remy automatically uses your business hours and booking rules to ensure customers are only offered appointments when you're available.",
  },
  {
    startMs: 29415,
    endMs: 35460,
    scene: "knowledge",
    text: "Build your Knowledge Base so Remy can answer customer questions using your own business information.",
  },
  {
    startMs: 39515,
    endMs: 46036,
    scene: "customer-question",
    text: "Customers receive accurate answers instantly, any time of day, without waiting for someone to answer the phone.",
  },
  {
    startMs: 50414,
    endMs: 58058,
    scene: "customer-booking",
    text: "When an appointment is requested, Remy checks your business hours and availability before offering suitable appointment times.",
  },
  {
    startMs: 59411,
    endMs: 65198,
    scene: "customer-booking (confirmation)",
    text: "Once confirmed, the appointment is booked automatically and the customer receives confirmation.",
  },
  {
    startMs: 65913,
    endMs: 74167,
    scene: "leads",
    text: "Every enquiry becomes a lead, with customer details, conversation history and booking information saved for your business.",
  },
  {
    startMs: 74818,
    endMs: 85534,
    scene: "notification → closing",
    text: "Answer more enquiries, capture more leads and book more appointments with Remy—your AI receptionist, available twenty-four hours a day, seven days a week.",
  },
  {
    // The 1.018s gap before this line is the scripted one-second pause.
    startMs: 86552,
    endMs: 89574,
    scene: "closing (call to action)",
    text: "Start your free 14-day trial today.",
  },
];

// A caption appears fractionally before the first word and lingers after
// the last, which is standard subtitle practice — text that lands exactly
// on the syllable reads as late.
const CAPTION_LEAD_MS = 140;
const CAPTION_TAIL_MS = 420;

// The music dips a little earlier and recovers a little later than the
// speech itself, so the duck is never audible *underneath* a word.
const DUCK_LEAD_MS = 260;
const DUCK_TAIL_MS = 420;

/** The caption to show at `elapsed` ms into the walkthrough, or null. */
export function captionAt(elapsed: number): NarrationLine | null {
  for (const line of NARRATION) {
    if (
      elapsed >= line.startMs - CAPTION_LEAD_MS &&
      elapsed <= line.endMs + CAPTION_TAIL_MS
    ) {
      return line;
    }
  }
  return null;
}

/** True while narration is speaking — drives the music duck. */
export function isSpeakingAt(elapsed: number): boolean {
  for (const line of NARRATION) {
    if (
      elapsed >= line.startMs - DUCK_LEAD_MS &&
      elapsed <= line.endMs + DUCK_TAIL_MS
    ) {
      return true;
    }
  }
  return false;
}
