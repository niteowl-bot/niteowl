"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

// ─────────────────────────────────────────────────────────────────────
//  Remy product walkthrough (homepage hero demo)
//
//  A self-contained, asset-free animated walkthrough of the real product
//  journey, in the order a business actually experiences it:
//
//    1. Two assistants — our HQ website assistant vs. the business's own Remy
//    2. Onboarding step 1 — business details
//    3. Onboarding step 2 — opening hours
//    4. Settings → Hours — appointment length + capacity
//    5. Knowledge Base — services, pricing, FAQs, policies, contact details
//    6. A customer asks a question, answered from the Knowledge Base
//    7. The customer books; Remy checks hours + availability and confirms
//    8. The lead appears in Leads with contact + appointment details
//    9. The owner's booking notification email
//   10. Closing message + call to action
//
//  Every screen mirrors UI that exists in this repo today — the onboarding
//  wizard (src/app/onboarding), Settings → Hours, the Knowledge Base list,
//  the Leads table (desktop table + mobile cards) and the owner booking
//  email (src/lib/email.ts). Nothing here depicts a page, field, button or
//  behaviour the product does not have. It is a scripted illustration of
//  real screens, clearly framed as a demo — not a screen recording.
//
//  Rendering strategy: the whole walkthrough is laid out on a fixed-size
//  16:9 "stage" that is CSS-scaled to whatever box it is dropped into, so
//  it behaves like a video — identical composition at every width. Narrow
//  containers (hero preview, phones) switch to a smaller stage that shows
//  fewer, larger elements, the same way the product's own responsive UI
//  drops from a table to cards.
//
//  Respects prefers-reduced-motion by rendering a static summary instead
//  of animating, and pauses entirely while scrolled out of view.
// ─────────────────────────────────────────────────────────────────────

// Stage design sizes (both 16:9). Content is authored in these pixel
// units and scaled to fit; a *smaller* canvas means larger apparent text,
// which is why the compact stage is used for narrow containers.
const WIDE_STAGE = { w: 960, h: 540 };
const COMPACT_STAGE = { w: 400, h: 225 };

// Below this container width the compact stage takes over. The hero
// preview column (~530px on desktop) sits below it deliberately: the
// preview is a teaser, the modal is where the detail is readable.
const COMPACT_BREAKPOINT = 660;

// Animation clock resolution. 20fps is plenty for typing/reveal effects
// and keeps re-renders modest on a page that also runs the sales widget.
const TICK_MS = 50;

const BUSINESS_NAME = "Bright Plumbing Co.";
const BUSINESS_SITE = "brightplumbing.co.uk";
const CUSTOMER_NAME = "Dan Whelan";
const CUSTOMER_EMAIL = "dan.whelan@gmail.com";
const CUSTOMER_PHONE = "07700 900412";
const SERVICE = "Boiler repair — won't fire up";
const BOOKING_REFERENCE = "9F3C1A2B"; // leads use id.slice(0,8).toUpperCase()

// Which "world" a scene takes place in. Rendered as a persistent chip so
// a viewer can never confuse our own website assistant with the Remy that
// belongs to the business.
type World = "hq" | "dashboard" | "customer";

const WORLD_CHIPS: Record<World, { label: string; className: string }> = {
  hq: {
    label: "niteowlhq.com — our website assistant",
    className: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/30",
  },
  dashboard: {
    label: "Your Niteowl AI dashboard",
    className: "bg-blue-500/15 text-blue-300 ring-blue-400/30",
  },
  customer: {
    label: `${BUSINESS_SITE} — your customer, your Remy`,
    className: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  },
};

// ── Demo dates ───────────────────────────────────────────────────────
// The appointment is always "this coming Thursday", computed in the
// browser so the Leads row and the email never go stale. They are
// deliberately not computed during SSR: a server/client timezone
// difference would be a hydration mismatch, and until they resolve the
// date cells render the same "—" the real Leads table uses for a missing
// value. By the time those scenes play (~50s in) the values are set.
interface DemoDates {
  /** "31 Jul 2026, 14:00" — Leads table format (en-IE). */
  leadsAppointment: string;
  /** "30 Jul 2026, 18:42" — Leads "Created" column. */
  leadsCreated: string;
  /** "Thursday 31 July 2026 at 14:00" — booking email format (en-GB). */
  emailAppointment: string;
}

// Memoised so the client snapshot below keeps a stable identity — a fresh
// object every read would make useSyncExternalStore loop forever.
let cachedDemoDates: DemoDates | null = null;

function clientDemoDates(): DemoDates {
  if (!cachedDemoDates) cachedDemoDates = buildDemoDates();
  return cachedDemoDates;
}

/**
 * Resolves the demo dates on the client only. The server snapshot is `null`,
 * so the SSR markup and the first client render agree; the real values swap
 * in immediately after hydration, long before the scenes that use them.
 */
function useDemoDates(): DemoDates | null {
  return useSyncExternalStore(
    () => () => {}, // nothing to subscribe to: the value never changes
    clientDemoDates,
    () => null
  );
}

function buildDemoDates(): DemoDates {
  const now = new Date();
  const appointment = new Date(now);
  // 4 === Thursday. Always land on the next Thursday that is still ahead.
  const daysAhead = (4 - now.getDay() + 7) % 7 || 7;
  appointment.setDate(now.getDate() + daysAhead);
  appointment.setHours(14, 0, 0, 0);

  const leadsFormat: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };

  return {
    leadsAppointment: new Intl.DateTimeFormat("en-IE", leadsFormat).format(
      appointment
    ),
    leadsCreated: new Intl.DateTimeFormat("en-IE", leadsFormat).format(now),
    emailAppointment: appointment.toLocaleString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

// ── Timing helpers ───────────────────────────────────────────────────

/** Progressive text reveal, used for form fields being filled in. */
function typed(text: string, t: number, start: number, dur: number): string {
  if (t < start) return "";
  const p = Math.min(1, (t - start) / dur);
  return text.slice(0, Math.round(text.length * p));
}

/** True once `t` has passed `at`. */
function shown(t: number, at: number): boolean {
  return t >= at;
}

/** 0 → 1 ramp, for fades and slides. */
function ramp(t: number, start: number, dur: number): number {
  if (t <= start) return 0;
  return Math.min(1, (t - start) / dur);
}

// ── Scene model ──────────────────────────────────────────────────────

interface SceneCtx {
  /** Milliseconds elapsed within the current scene. */
  t: number;
  compact: boolean;
  dates: DemoDates | null;
}

interface Scene {
  id: string;
  world: World;
  /** Short chapter name, shown in the caption bar and the static summary. */
  chapter: string;
  caption: string;
  /** Shorter caption used on the compact stage. */
  captionShort: string;
  ms: number;
  render: (ctx: SceneCtx) => ReactNode;
}

// ── Chat scripts ─────────────────────────────────────────────────────

interface Bubble {
  role: "customer" | "remy";
  text: string;
  /** When the finished bubble appears (ms into the scene). */
  at: number;
  /** How long the typing indicator shows before it. */
  typing: number;
}

const QUESTION_SCRIPT: Bubble[] = [
  {
    role: "customer",
    text: "Hi — my boiler won't fire up. Do you charge a call-out fee?",
    at: 1800,
    typing: 1400,
  },
  {
    role: "remy",
    text: "Yes — our call-out is £75 and covers the first 30 minutes on site. Boiler repair and servicing is one of our main services, so we can take a look for you.",
    at: 5200,
    typing: 1800,
  },
];

const BOOKING_SCRIPT: Bubble[] = [
  {
    role: "customer",
    text: "Great — can someone come out Thursday at 2pm?",
    at: 1500,
    typing: 1200,
  },
  {
    role: "remy",
    text: "Thursday we're open 9:00 AM to 5:00 PM, and 2:00 PM is free. Can I take your name?",
    at: 4400,
    typing: 1600,
  },
  { role: "customer", text: CUSTOMER_NAME, at: 6900, typing: 900 },
  {
    role: "remy",
    text: "Thanks Dan — what's the best email and phone number to confirm on?",
    at: 9200,
    typing: 1400,
  },
  {
    role: "customer",
    text: `${CUSTOMER_EMAIL}, ${CUSTOMER_PHONE}`,
    at: 11600,
    typing: 1200,
  },
  {
    role: "remy",
    text: "You're booked in for a boiler repair on Thursday at 2:00 PM. I've emailed your confirmation 👍",
    at: 14000,
    typing: 1500,
  },
];

// ── Knowledge Base records added in scene 5 ──────────────────────────
// Categories and labels match src/app/(dashboard)/knowledge/KnowledgeClient.tsx.
const KB_RECORDS: { category: string; label: string; title: string; at: number }[] =
  [
    { category: "service", label: "Service", title: "Boiler repair & servicing", at: 900 },
    { category: "pricing", label: "Pricing", title: "Call-out fee — £75", at: 2400 },
    { category: "faq", label: "FAQ", title: "Do you charge a call-out fee?", at: 3900 },
    { category: "faq", label: "FAQ", title: "How can I contact you?", at: 5400 },
    { category: "policy", label: "Policy", title: "Cancellations & rescheduling", at: 6900 },
  ];

// ── Opening hours shown in scenes 3 and 4 ────────────────────────────
const DEMO_HOURS: { day: string; open: string; close: string; closed?: boolean }[] =
  [
    { day: "Monday", open: "09:00", close: "17:00" },
    { day: "Tuesday", open: "09:00", close: "17:00" },
    { day: "Wednesday", open: "09:00", close: "17:00" },
    { day: "Thursday", open: "09:00", close: "17:00" },
    { day: "Friday", open: "09:00", close: "17:00" },
    { day: "Saturday", open: "09:00", close: "13:00" },
    { day: "Sunday", open: "", close: "", closed: true },
  ];

// ─────────────────────────────────────────────────────────────────────
//  Scenes
// ─────────────────────────────────────────────────────────────────────

const SCENES: Scene[] = [
  {
    id: "two-assistants",
    world: "hq",
    chapter: "Two different assistants",
    caption:
      "On our site, our assistant answers questions about Remy and books demos. On your site, your own Remy answers your customers.",
    captionShort:
      "Our website assistant answers questions about Remy. Your Remy answers your customers.",
    ms: 6000,
    render: (ctx) => <SceneTwoAssistants {...ctx} />,
  },
  {
    id: "onboarding-business",
    world: "dashboard",
    chapter: "Onboarding · Step 1 of 4",
    caption:
      "Sign up and tell Remy about your business — name, type, website and what you want Remy to focus on.",
    captionShort: "Step 1 — your business name, type, website and primary goal.",
    ms: 9000,
    render: (ctx) => <SceneOnboardingBusiness {...ctx} />,
  },
  {
    id: "onboarding-hours",
    world: "dashboard",
    chapter: "Onboarding · Step 2 of 4",
    caption:
      "Set your opening hours and lunch breaks. Remy will never book a customer outside them.",
    captionShort: "Step 2 — your opening hours. Remy never books outside them.",
    ms: 8000,
    render: (ctx) => <SceneOnboardingHours {...ctx} />,
  },
  {
    id: "settings-hours",
    world: "dashboard",
    chapter: "Settings · Hours",
    caption:
      "Appointment length and how many bookings fit in one slot are set in Settings → Hours — the booking engine enforces both.",
    captionShort: "Settings → Hours: appointment length and slot capacity.",
    ms: 6000,
    render: (ctx) => <SceneSettingsHours {...ctx} />,
  },
  {
    id: "knowledge",
    world: "dashboard",
    chapter: "Knowledge Base",
    caption:
      "Add your services, prices, FAQs, policies and contact details. This is the only thing Remy answers from — it never invents details.",
    captionShort:
      "Add services, prices, FAQs and policies. Remy answers only from these.",
    ms: 10000,
    render: (ctx) => <SceneKnowledge {...ctx} />,
  },
  {
    id: "customer-question",
    world: "customer",
    chapter: "A customer asks",
    caption:
      "A real customer, on your website. Remy answers from your Pricing and Service records — nothing invented.",
    captionShort: "Your customer asks. Remy answers from your Knowledge Base.",
    ms: 11000,
    render: (ctx) => <SceneCustomerQuestion {...ctx} />,
  },
  {
    id: "customer-booking",
    world: "customer",
    chapter: "Remy books the appointment",
    caption:
      "Remy checks your configured hours, appointment length and remaining capacity before offering the slot — then takes the details and confirms.",
    captionShort:
      "Remy checks your hours and availability, then books and confirms.",
    ms: 15000,
    render: (ctx) => <SceneCustomerBooking {...ctx} />,
  },
  {
    id: "leads",
    world: "dashboard",
    chapter: "Leads",
    caption:
      "The customer lands in Leads with their name, phone, email, enquiry and confirmed appointment — marked Booked, from the web widget.",
    captionShort:
      "The customer lands in Leads — contact details, enquiry and appointment.",
    ms: 9000,
    render: (ctx) => <SceneLeads {...ctx} />,
  },
  {
    id: "notification",
    world: "dashboard",
    chapter: "You get notified",
    caption:
      "Remy emails you the booking straight away, so you know about it before the customer has closed the chat.",
    captionShort: "Remy emails you the booking straight away.",
    ms: 7000,
    render: (ctx) => <SceneNotification {...ctx} />,
  },
  {
    id: "closing",
    world: "dashboard",
    chapter: "Every enquiry, answered",
    caption: "Remy answers enquiries, captures leads and books appointments—24/7.",
    captionShort:
      "Remy answers enquiries, captures leads and books appointments—24/7.",
    ms: 6000,
    render: (ctx) => <SceneClosing {...ctx} />,
  },
];

const TOTAL_MS = SCENES.reduce((sum, s) => sum + s.ms, 0);

// ─────────────────────────────────────────────────────────────────────
//  Player
// ─────────────────────────────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

export default function RemyWalkthrough() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const dates = useDemoDates();
  const reducedMotion = usePrefersReducedMotion();

  // Track the container width so the stage can be scaled to fit it.
  // ResizeObserver fires once immediately on observe(), which is what gives
  // us the initial measurement — no synchronous setState needed here.
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Don't burn frames animating a walkthrough nobody is looking at —
  // it sits in the hero of a long marketing page.
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.05 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // One clock for the whole walkthrough. Deriving scene + local time from
  // a single elapsed value (rather than chaining timeouts) keeps the
  // progress bar, captions and content perfectly in step, and makes every
  // frame a pure function of the clock.
  useEffect(() => {
    if (reducedMotion || !visible) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      // Advancing by the measured delta (rather than a fixed TICK_MS) keeps
      // the walkthrough honest when the browser throttles the interval —
      // e.g. in a background tab — instead of drifting slower and slower.
      setElapsed((prev) => (prev + delta) % TOTAL_MS);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion, visible]);

  const compact = width > 0 ? width < COMPACT_BREAKPOINT : false;
  const stage = compact ? COMPACT_STAGE : WIDE_STAGE;
  const scale = width > 0 ? width / stage.w : 0;

  // Resolve the current scene and the time within it.
  let sceneIndex = 0;
  let sceneT = elapsed;
  for (let i = 0; i < SCENES.length; i++) {
    if (sceneT < SCENES[i].ms) {
      sceneIndex = i;
      break;
    }
    sceneT -= SCENES[i].ms;
    sceneIndex = i;
  }
  const scene = SCENES[sceneIndex];
  const chip = WORLD_CHIPS[scene.world];

  return (
    <div
      ref={wrapperRef}
      role="img"
      aria-label="Product walkthrough: a business completes Remy's onboarding with its details and opening hours, adds services, pricing, FAQs and policies to the Knowledge Base, then a customer on the business's own website asks a question, Remy answers from the Knowledge Base, checks the configured hours and availability, books the appointment, and the captured lead and a booking notification email reach the business."
      className="absolute inset-0 overflow-hidden bg-[#0b0d12]"
    >
      {reducedMotion ? (
        <StaticSummary compact={compact} />
      ) : (
        scale > 0 && (
          <div
            aria-hidden="true"
            style={{
              width: stage.w,
              height: stage.h,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
            className="flex flex-col"
          >
            {/* ── Player chrome: title + world chip ── */}
            <div
              className={`flex shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#0d0f14] ${
                compact ? "px-2 py-1" : "px-5 py-2.5"
              }`}
            >
              <Wordmark compact={compact} />
              <span
                className={`ml-auto truncate rounded-full px-2 py-0.5 font-medium ring-1 ${chip.className} ${
                  compact ? "text-[8px]" : "text-[11px]"
                }`}
              >
                {chip.label}
              </span>
            </div>

            {/* ── Chapter progress ── */}
            <div className="flex shrink-0 gap-[2px] bg-[#0d0f14] px-0">
              {SCENES.map((s, i) => (
                <div
                  key={s.id}
                  className="h-[3px] flex-1 overflow-hidden bg-white/10"
                >
                  <div
                    className="h-full origin-left bg-blue-500"
                    style={{
                      transform: `scaleX(${
                        i < sceneIndex ? 1 : i > sceneIndex ? 0 : sceneT / s.ms
                      })`,
                    }}
                  />
                </div>
              ))}
            </div>

            {/* ── Screen ── */}
            <div className="relative flex-1 overflow-hidden bg-[#0d0f14]">
              {scene.render({ t: sceneT, compact, dates })}
            </div>

            {/* ── Caption ── */}
            <div
              className={`shrink-0 border-t border-white/[0.07] bg-[#0b0d12] ${
                compact ? "px-2 py-1" : "px-5 py-3"
              }`}
              style={{ height: compact ? 40 : 74 }}
            >
              <p
                className={`font-semibold text-white ${
                  compact ? "text-[9px]" : "text-[13px]"
                }`}
              >
                <span className="text-blue-400">
                  {sceneIndex + 1}/{SCENES.length}
                </span>{" "}
                {scene.chapter}
              </p>
              <p
                className={`mt-0.5 leading-snug text-white/50 ${
                  compact ? "text-[8px]" : "text-[12px]"
                }`}
              >
                {compact ? scene.captionShort : scene.caption}
              </p>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Shared chrome
// ─────────────────────────────────────────────────────────────────────

function Wordmark({ compact }: { compact: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`flex items-center justify-center rounded-md bg-blue-600 text-white ${
          compact ? "h-3.5 w-3.5" : "h-5 w-5"
        }`}
      >
        <svg
          width={compact ? 8 : 11}
          height={compact ? 8 : 11}
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8c0 1.74.65 3.33 1.72 4.54L1.5 14.5l2.04-1.69A6.48 6.48 0 0 0 8 14.5c3.59 0 6.5-2.91 6.5-6.5S11.59 1.5 8 1.5Z"
            fill="currentColor"
            opacity=".3"
          />
          <circle cx="5.5" cy="8.5" r="1" fill="currentColor" />
          <circle cx="8" cy="8.5" r="1" fill="currentColor" />
          <circle cx="10.5" cy="8.5" r="1" fill="currentColor" />
        </svg>
      </span>
      <span
        className={`font-semibold tracking-tight text-white ${
          compact ? "text-[9px]" : "text-[12px]"
        }`}
      >
        Niteowl <span className="text-white/40">AI</span>
      </span>
    </span>
  );
}

/** Browser window framing for anything shown on a public website. */
function BrowserFrame({
  url,
  compact,
  children,
  className = "",
}: {
  url: string;
  compact: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border border-white/10 bg-[#111827] ${className}`}
    >
      <div
        className={`flex shrink-0 items-center gap-1.5 border-b border-white/10 bg-[#1b2130] ${
          compact ? "px-1.5 py-1" : "px-2.5 py-1.5"
        }`}
      >
        {["#f87171", "#fbbf24", "#4ade80"].map((c) => (
          <span
            key={c}
            className={compact ? "h-1 w-1 rounded-full" : "h-1.5 w-1.5 rounded-full"}
            style={{ background: c }}
          />
        ))}
        <span
          className={`ml-1 truncate rounded bg-black/30 px-1.5 text-white/40 ${
            compact ? "text-[6px]" : "text-[9px]"
          }`}
        >
          {url}
        </span>
      </div>
      <div className="relative flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Dashboard framing: the real sidebar at wide sizes, the real mobile top
 * bar at compact sizes — matching src/components/dashboard/DashboardNav.tsx.
 */
const NAV_ITEMS = [
  "Dashboard",
  "Chat Preview",
  "Knowledge Base",
  "Leads",
  "Calendar",
  "Settings",
];

function AppFrame({
  active,
  compact,
  children,
}: {
  active: string;
  compact: boolean;
  children: ReactNode;
}) {
  if (compact) {
    return (
      <div className="flex h-full w-full flex-col bg-[#0d0f14]">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-2 py-1">
          <Wordmark compact />
          <span className="flex flex-col gap-[2px]">
            {[0, 1, 2].map((i) => (
              <span key={i} className="block h-[1px] w-3 bg-white/40" />
            ))}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-[#0d0f14]">
      <aside className="flex w-[150px] shrink-0 flex-col border-r border-white/[0.07] p-2.5">
        <div className="mb-4 px-1">
          <Wordmark compact={false} />
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <span
              key={item}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] ${
                item === active
                  ? "bg-blue-600/15 font-medium text-blue-400"
                  : "text-white/50"
              }`}
            >
              {item}
            </span>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

/** A blinking text caret for fields being filled in. */
function Caret({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="ml-px inline-block h-[1em] w-px translate-y-[2px] bg-blue-400" />
  );
}

/** The three-dot "typing" bubble used by both chat scenes. */
function TypingDots({ remy, compact }: { remy: boolean; compact: boolean }) {
  return (
    <div className={`flex ${remy ? "justify-start" : "justify-end"}`}>
      <div
        className="flex items-center gap-1 rounded-2xl px-2.5 py-2"
        style={{ background: remy ? "#f3f4f6" : "#2563eb" }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`animate-bounce rounded-full ${
              compact ? "h-[3px] w-[3px]" : "h-1.5 w-1.5"
            }`}
            style={{
              animationDelay: `${i * 150}ms`,
              background: remy ? "#9ca3af" : "rgba(255,255,255,.8)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The customer-facing chat window: the real embedded widget from
 * public/widget.js — blue header, white panel, "Powered by NiteOwl AI".
 */
function WidgetChat({
  script,
  t,
  compact,
  headerLabel = "Chat with us",
}: {
  script: Bubble[];
  t: number;
  compact: boolean;
  headerLabel?: string;
}) {
  const visibleBubbles = script.filter((b) => shown(t, b.at));
  const pending = script.find((b) => t >= b.at - b.typing && t < b.at);

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div
        className={`flex shrink-0 items-center justify-between text-white ${
          compact ? "px-2 py-1.5 text-[8px]" : "px-3 py-2.5 text-[12px]"
        }`}
        style={{ background: "#2563eb" }}
      >
        <span className="font-semibold">{headerLabel}</span>
        <span className="leading-none opacity-80">×</span>
      </div>

      <div
        className={`flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden ${
          compact ? "px-2 py-2" : "px-3 py-3"
        }`}
      >
        {visibleBubbles.map((b, i) => {
          const remy = b.role === "remy";
          return (
            <div key={i} className={`flex ${remy ? "justify-start" : "justify-end"}`}>
              <span
                className={`max-w-[85%] rounded-2xl leading-snug ${
                  compact
                    ? "px-2 py-1 text-[7.5px]"
                    : "px-3 py-2 text-[11.5px]"
                } ${remy ? "rounded-tl-sm" : "rounded-tr-sm"}`}
                style={{
                  background: remy ? "#f3f4f6" : "#2563eb",
                  color: remy ? "#111827" : "#ffffff",
                }}
              >
                {b.text}
              </span>
            </div>
          );
        })}
        {pending && <TypingDots remy={pending.role === "remy"} compact={compact} />}
      </div>

      <div
        className={`flex shrink-0 gap-1.5 border-t border-slate-200 ${
          compact ? "p-1.5" : "p-2.5"
        }`}
      >
        <span
          className={`flex-1 rounded-lg border border-slate-300 text-slate-400 ${
            compact ? "px-1.5 py-1 text-[7px]" : "px-2.5 py-2 text-[10px]"
          }`}
        >
          Type a message…
        </span>
        <span
          className={`rounded-lg font-semibold text-white ${
            compact ? "px-2 py-1 text-[7px]" : "px-3 py-2 text-[10px]"
          }`}
          style={{ background: "#2563eb" }}
        >
          Send
        </span>
      </div>
      <p
        className={`shrink-0 pb-1 text-center text-slate-400 ${
          compact ? "text-[5.5px]" : "text-[8px]"
        }`}
      >
        Powered by NiteOwl AI · Privacy Policy
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Scene 1 — two assistants
// ─────────────────────────────────────────────────────────────────────

function SceneTwoAssistants({ t, compact }: SceneCtx) {
  const left = ramp(t, 200, 500);
  const right = ramp(t, 900, 500);

  // Compact has nowhere near the height for two browser windows, so it makes
  // the same point with two labelled rows instead of two screenshots.
  if (compact) {
    const rows = [
      {
        opacity: left,
        colour: "#4f46e5",
        site: "niteowlhq.com",
        title: "Our website assistant",
        body: "Answers questions about Remy and books demos.",
      },
      {
        opacity: right,
        colour: "#2563eb",
        site: BUSINESS_SITE,
        title: "Your Remy, on your website",
        body: "Answers your customers from your Knowledge Base, captures leads, books appointments.",
      },
    ];

    return (
      <div className="flex h-full w-full flex-col justify-center gap-2 px-2.5">
        {rows.map((r) => (
          <div
            key={r.site}
            style={{ opacity: r.opacity }}
            className="overflow-hidden rounded-md border border-white/10"
          >
            <div
              className="flex items-center justify-between px-1.5 py-1 text-[7px] font-semibold text-white"
              style={{ background: r.colour }}
            >
              <span>{r.title}</span>
              <span className="font-normal opacity-70">{r.site}</span>
            </div>
            <p className="bg-[#13151c] px-1.5 py-1 text-[6.5px] leading-snug text-white/55">
              {r.body}
            </p>
          </div>
        ))}
      </div>
    );
  }

  const hq = (
    <div className="flex min-w-0 flex-1 flex-col" style={{ opacity: left }}>
      <p
        className={`font-semibold text-indigo-300 ${
          compact ? "text-[8px]" : "text-[12px]"
        }`}
      >
        Our website assistant
      </p>
      <p
        className={`mb-1 text-white/45 ${compact ? "text-[6.5px]" : "text-[10px]"}`}
      >
        Answers questions about Remy and books demos. Not connected to any
        business.
      </p>
      <BrowserFrame url="niteowlhq.com" compact={compact} className="min-h-0 flex-1">
        <div className="flex h-full flex-col bg-white">
          <div
            className={`flex shrink-0 items-center justify-between bg-indigo-600 text-white ${
              compact ? "px-1.5 py-1 text-[7px]" : "px-2.5 py-2 text-[11px]"
            }`}
          >
            <span className="font-semibold">Chat with us about Remy</span>
            <span className="opacity-80">×</span>
          </div>
          <div className={`flex-1 ${compact ? "p-1.5" : "p-2.5"}`}>
            <p
              className={`text-slate-500 ${compact ? "text-[6.5px]" : "text-[10px]"}`}
            >
              Hi! Ask me anything about Remy, your AI receptionist — or tell me
              about your business and I&apos;ll show you how it fits.
            </p>
          </div>
          <div className={`shrink-0 ${compact ? "px-1.5 pb-1.5" : "px-2.5 pb-2.5"}`}>
            <span
              className={`block rounded-lg bg-indigo-600 text-center font-semibold text-white ${
                compact ? "py-1 text-[6.5px]" : "py-1.5 text-[10px]"
              }`}
            >
              Start free trial — 14 days free, no card required
            </span>
          </div>
        </div>
      </BrowserFrame>
    </div>
  );

  const tenant = (
    <div className="flex min-w-0 flex-1 flex-col" style={{ opacity: right }}>
      <p
        className={`font-semibold text-emerald-300 ${
          compact ? "text-[8px]" : "text-[12px]"
        }`}
      >
        Your Remy, on your website
      </p>
      <p
        className={`mb-1 text-white/45 ${compact ? "text-[6.5px]" : "text-[10px]"}`}
      >
        Answers your customers from your Knowledge Base, captures leads and
        books appointments.
      </p>
      <BrowserFrame url={BUSINESS_SITE} compact={compact} className="min-h-0 flex-1">
        <WidgetChat
          compact={compact}
          t={4000}
          script={[
            {
              role: "customer",
              text: "Do you cover the north side of the city?",
              at: 0,
              typing: 0,
            },
            {
              role: "remy",
              text: "We do — and I can book you in while we chat.",
              at: 0,
              typing: 0,
            },
          ]}
        />
      </BrowserFrame>
    </div>
  );

  return (
    <div
      className={`flex h-full w-full gap-2 ${
        compact ? "flex-col p-1.5" : "flex-row p-4"
      }`}
    >
      {hq}
      {tenant}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Scene 2 — onboarding step 1
// ─────────────────────────────────────────────────────────────────────

function SceneOnboardingBusiness({ t, compact }: SceneCtx) {
  const name = typed(BUSINESS_NAME, t, 700, 1400);
  const type = shown(t, 3000) ? "Other" : "";
  const website = typed(`https://${BUSINESS_SITE}`, t, 3600, 1500);
  const goal = shown(t, 6000) ? "Book appointments" : "";
  const pressed = shown(t, 7600);

  const label = compact
    ? "text-[6px] uppercase tracking-wide text-white/40"
    : "text-[9px] uppercase tracking-wide text-white/50";
  const field = compact
    ? "rounded-md px-1.5 py-1 text-[7.5px]"
    : "rounded-lg px-3 py-2 text-[12px]";

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0d0f14]">
      <div
        className={`w-full rounded-xl border border-white/[0.07] bg-[#13151c] ${
          compact ? "mx-3 max-w-[290px] p-2.5" : "max-w-[430px] p-5"
        }`}
      >
        {/* Step dots — 4-step wizard, step 1 active */}
        <div className="mb-3 flex items-center gap-1.5">
          {[1, 2, 3, 4].map((s) => (
            <span
              key={s}
              className={`h-1 rounded-full ${
                s === 1 ? "w-6 bg-blue-500" : "w-3 bg-white/10"
              }`}
            />
          ))}
          <span
            className={`ml-auto text-white/30 ${
              compact ? "text-[6px]" : "text-[9px]"
            }`}
          >
            Step 1 of 4
          </span>
        </div>

        <p
          className={`font-semibold text-white ${
            compact ? "mb-1.5 text-[9px]" : "text-[14px]"
          }`}
        >
          Tell us about your business
        </p>
        {/* The 16:9 stage leaves very little height at compact sizes, so the
            supporting copy and the optional fields drop away first — the same
            order of importance the real form has. */}
        {!compact && (
          <p className="mb-3 text-[10px] text-white/40">
            This helps Remy personalise your AI assistant.
          </p>
        )}

        <div className={compact ? "space-y-1.5" : "space-y-2.5"}>
          <div>
            <p className={`mb-1 ${label}`}>
              Business name <span className="text-blue-400">*</span>
            </p>
            <p
              className={`border border-white/10 bg-white/5 text-white ${field}`}
            >
              {name || (
                <span className="text-white/25">e.g. Bright Plumbing Co.</span>
              )}
              <Caret on={!!name && name !== BUSINESS_NAME} />
            </p>
          </div>

          {!compact && (
            <div>
              <p className={`mb-1 ${label}`}>
                Business type <span className="text-blue-400">*</span>
              </p>
              <p
                className={`flex items-center justify-between border border-white/10 bg-white/5 ${field} ${
                  type ? "text-white" : "text-white/25"
                }`}
              >
                {type || "Select a type"}
                <span className="text-white/30">⌄</span>
              </p>
            </div>
          )}

          {!compact && (
            <div>
              <p className={`mb-1 ${label}`}>
                Website{" "}
                <span className="font-normal normal-case text-white/25">
                  (optional)
                </span>
              </p>
              <p className={`border border-white/10 bg-white/5 text-white ${field}`}>
                {website || (
                  <span className="text-white/25">https://yourwebsite.com</span>
                )}
                <Caret on={!!website && website !== `https://${BUSINESS_SITE}`} />
              </p>
            </div>
          )}

          <div>
            <p className={`mb-1 ${label}`}>
              Primary goal <span className="text-blue-400">*</span>
            </p>
            <p
              className={`flex items-center justify-between border border-white/10 bg-white/5 ${field} ${
                goal ? "text-white" : "text-white/25"
              }`}
            >
              {goal || "What should Remy focus on?"}
              <span className="text-white/30">⌄</span>
            </p>
          </div>
        </div>

        <p
          className={`mt-3 rounded-xl bg-blue-600 text-center font-semibold text-white transition ${
            compact ? "py-1.5 text-[8px]" : "py-2.5 text-[12px]"
          } ${pressed ? "scale-[0.98] bg-blue-500" : ""}`}
        >
          {pressed ? "Setting up…" : "Continue →"}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Scene 3 — onboarding step 2 (hours)
// ─────────────────────────────────────────────────────────────────────

function SceneOnboardingHours({ t, compact }: SceneCtx) {
  const rows = compact ? DEMO_HOURS.slice(0, 3) : DEMO_HOURS;
  const saved = shown(t, 6600);

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0d0f14]">
      <div
        className={`w-full rounded-xl border border-white/[0.07] bg-[#13151c] ${
          compact ? "mx-3 max-w-[320px] p-2.5" : "max-w-[520px] p-5"
        }`}
      >
        <div className="mb-3 flex items-center gap-1.5">
          {[1, 2, 3, 4].map((s) => (
            <span
              key={s}
              className={`h-1 rounded-full ${
                s === 2
                  ? "w-6 bg-blue-500"
                  : s < 2
                    ? "w-3 bg-blue-500/40"
                    : "w-3 bg-white/10"
              }`}
            />
          ))}
          <span
            className={`ml-auto text-white/30 ${
              compact ? "text-[6px]" : "text-[9px]"
            }`}
          >
            Step 2 of 4
          </span>
        </div>

        <p
          className={`font-semibold text-white ${
            compact ? "mb-1.5 text-[9px]" : "text-[14px]"
          }`}
        >
          Business Hours
        </p>
        {!compact && (
          <p className="mb-2.5 text-[10px] text-slate-400">
            Remy uses this to avoid booking outside your working hours.
          </p>
        )}

        {!compact && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2">
            <span className="text-[11px] font-medium text-white">
              24/7 Emergency Mode
            </span>
            <span className="relative h-4 w-7 rounded-full bg-slate-700">
              <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white" />
            </span>
          </div>
        )}

        <div className={compact ? "space-y-1" : "space-y-1.5"}>
          {rows.map((row, i) => {
            const appear = ramp(t, 400 + i * 380, 320);
            return (
              <div
                key={row.day}
                style={{ opacity: appear }}
                className={`flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/50 ${
                  compact ? "px-1.5 py-1" : "px-3 py-2"
                }`}
              >
                <span
                  className={`shrink-0 font-medium text-white ${
                    compact ? "w-12 text-[7px]" : "w-20 text-[11px]"
                  }`}
                >
                  {row.day}
                </span>
                {row.closed ? (
                  <span
                    className={`text-slate-500 ${
                      compact ? "text-[6.5px]" : "text-[10px]"
                    }`}
                  >
                    ☑ Closed
                  </span>
                ) : (
                  <span
                    className={`flex items-center gap-1.5 text-slate-400 ${
                      compact ? "text-[6.5px]" : "text-[10px]"
                    }`}
                  >
                    Open
                    <span
                      className={`rounded border border-slate-700 bg-slate-800 text-white ${
                        compact ? "px-1" : "px-1.5 py-0.5"
                      }`}
                    >
                      {row.open}
                    </span>
                    Close
                    <span
                      className={`rounded border border-slate-700 bg-slate-800 text-white ${
                        compact ? "px-1" : "px-1.5 py-0.5"
                      }`}
                    >
                      {row.close}
                    </span>
                  </span>
                )}
              </div>
            );
          })}
          {compact && (
            <p className="pt-0.5 text-[6px] text-white/30">
              Thursday, Friday, Saturday · Sunday closed
            </p>
          )}
        </div>

        <p
          className={`mt-2.5 inline-block rounded-lg bg-blue-600 font-medium text-white ${
            compact ? "px-2 py-1 text-[7.5px]" : "px-4 py-2 text-[11px]"
          }`}
        >
          {saved ? "Saving…" : "Save & Continue"}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Scene 4 — Settings → Hours (appointment length + capacity)
// ─────────────────────────────────────────────────────────────────────

function SceneSettingsHours({ t, compact }: SceneCtx) {
  const duration = typed("60", t, 1200, 500);
  const capacity = typed("2", t, 3000, 300);
  const saved = shown(t, 4600);

  const cardCls = `rounded-xl border border-slate-800 bg-slate-800/50 ${
    compact ? "p-1.5" : "p-3.5"
  }`;
  const labelCls = `mb-1 block uppercase tracking-wide text-slate-400 ${
    compact ? "text-[6px]" : "text-[9px]"
  }`;
  const inputCls = `inline-block rounded-lg border border-slate-700 bg-slate-800 text-white ${
    compact ? "w-12 px-1.5 py-0.5 text-[7.5px]" : "w-24 px-3 py-1.5 text-[12px]"
  }`;

  return (
    <AppFrame active="Settings" compact={compact}>
      <div className={compact ? "p-2" : "p-5"}>
        <p
          className={`font-semibold text-white ${
            compact ? "mb-1.5 text-[9px]" : "text-[15px]"
          }`}
        >
          Business Hours
        </p>
        {!compact && (
          <p className="mb-2.5 text-[11px] text-slate-400">
            Set your opening hours, lunch breaks, and appointment length. Remy
            uses this to avoid booking outside your working hours.
          </p>
        )}

        <div className={compact ? "space-y-1.5" : "space-y-2.5"}>
          <div className={cardCls}>
            <span className={labelCls}>Appointment Duration (minutes)</span>
            <span className={inputCls}>
              {duration}
              <Caret on={!!duration && duration !== "60"} />
            </span>
          </div>

          <div className={cardCls}>
            <span className={labelCls}>Max Concurrent Bookings</span>
            {!compact && (
              <p className="mb-1.5 text-[10px] text-slate-500">
                How many appointments Remy can book into the same time slot.
              </p>
            )}
            <span className={inputCls}>{capacity}</span>
          </div>
        </div>

        <div className={`flex items-center gap-2 ${compact ? "mt-2" : "mt-3"}`}>
          <span
            className={`inline-block rounded-lg bg-blue-600 font-medium text-white ${
              compact ? "px-2 py-1 text-[7.5px]" : "px-3.5 py-2 text-[11px]"
            }`}
          >
            Save changes
          </span>
          {saved && (
            <span
              className={`text-emerald-400 ${
                compact ? "text-[7px]" : "text-[11px]"
              }`}
            >
              Saved
            </span>
          )}
        </div>
      </div>
    </AppFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Scene 5 — Knowledge Base
// ─────────────────────────────────────────────────────────────────────

function SceneKnowledge({ t, compact }: SceneCtx) {
  // Compact drops the last record rather than clipping the list mid-row.
  const source = compact ? KB_RECORDS.slice(0, 4) : KB_RECORDS;
  const records = source.filter((r) => shown(t, r.at));

  return (
    <AppFrame active="Knowledge Base" compact={compact}>
      <div className={compact ? "p-2" : "p-5"}>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p
              className={`font-semibold text-white ${
                compact ? "text-[9px]" : "text-[15px]"
              }`}
            >
              Knowledge Base
            </p>
            {!compact && (
              <p className="text-[11px] text-slate-400">
                What Remy knows about {BUSINESS_NAME}.
              </p>
            )}
          </div>
          <span
            className={`rounded-lg bg-blue-600 font-medium text-white ${
              compact ? "px-1.5 py-0.5 text-[6.5px]" : "px-3 py-1.5 text-[11px]"
            }`}
          >
            Add record
          </span>
        </div>

        <div className={compact ? "space-y-1" : "space-y-1.5"}>
          {records.map((r) => (
            <div
              key={r.title}
              className={`flex items-center gap-2 rounded-lg border border-white/[0.07] bg-[#13151c] ${
                compact ? "px-1.5 py-1" : "px-3 py-2"
              }`}
            >
              <span
                className={`shrink-0 rounded-md bg-blue-600/15 font-medium text-blue-400 ${
                  compact ? "px-1 py-px text-[5.5px]" : "px-2 py-0.5 text-[9px]"
                }`}
              >
                {r.label}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-white/80 ${
                  compact ? "text-[7px]" : "text-[11.5px]"
                }`}
              >
                {r.title}
              </span>
              <span
                className={`shrink-0 text-emerald-400 ${
                  compact ? "text-[7px]" : "text-[11px]"
                }`}
              >
                ✓
              </span>
            </div>
          ))}
        </div>

        {shown(t, 8200) && (
          <p
            className={`mt-2 text-white/40 ${
              compact ? "text-[6.5px]" : "text-[11px]"
            }`}
          >
            {records.length} records · Remy answers from these only.
          </p>
        )}
      </div>
    </AppFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Scenes 6 & 7 — the customer's chat
// ─────────────────────────────────────────────────────────────────────

function CustomerScene({
  script,
  t,
  compact,
  note,
}: {
  script: Bubble[];
  t: number;
  compact: boolean;
  note?: { text: string; at: number };
}) {
  return (
    <div
      className={`flex h-full w-full items-stretch justify-center ${
        compact ? "p-1.5" : "p-3"
      }`}
    >
      <BrowserFrame
        url={BUSINESS_SITE}
        compact={compact}
        className={compact ? "w-full" : "w-[520px]"}
      >
        <WidgetChat script={script} t={t} compact={compact} />
      </BrowserFrame>

      {!compact && note && (
        <div
          className="ml-3 flex w-[220px] shrink-0 items-center"
          style={{ opacity: ramp(t, note.at, 600) }}
        >
          <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] leading-snug text-emerald-300">
            {note.text}
          </p>
        </div>
      )}
    </div>
  );
}

function SceneCustomerQuestion({ t, compact }: SceneCtx) {
  return (
    <CustomerScene
      script={QUESTION_SCRIPT}
      t={t}
      compact={compact}
      note={{
        at: 6200,
        text: "Answered from the Knowledge Base — the Pricing and Service records added a moment ago.",
      }}
    />
  );
}

function SceneCustomerBooking({ t, compact }: SceneCtx) {
  return (
    <CustomerScene
      script={BOOKING_SCRIPT}
      t={t}
      compact={compact}
      note={{
        at: 4600,
        text: "Checked against the configured opening hours, 60-minute appointment length and remaining capacity — so the slot is genuinely free.",
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Scene 8 — Leads
// ─────────────────────────────────────────────────────────────────────

function SceneLeads({ t, compact, dates }: SceneCtx) {
  const rowIn = ramp(t, 1400, 700);
  const created = dates?.leadsCreated ?? "—";
  const appointment = dates?.leadsAppointment ?? "—";

  return (
    <AppFrame active="Leads" compact={compact}>
      <div className={compact ? "p-2" : "p-5"}>
        <p
          className={`font-semibold text-white ${
            compact ? "text-[9px]" : "text-[16px]"
          }`}
        >
          Leads
        </p>
        <p
          className={`mb-2 text-slate-400 ${
            compact ? "text-[6.5px]" : "text-[11px]"
          }`}
        >
          Captured by Remy for {BUSINESS_NAME}.
        </p>

        {!compact && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[
              { label: "New", count: 0 },
              { label: "Contacted", count: 0 },
              { label: "Booked", count: shown(t, 1400) ? 1 : 0 },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2"
              >
                <p className="text-[10px] text-slate-400">{s.label}</p>
                <p className="text-[18px] font-semibold text-white">{s.count}</p>
              </div>
            ))}
          </div>
        )}

        {/* Desktop: the real Leads table. Compact: the real mobile card. */}
        {compact ? (
          <div
            style={{ opacity: rowIn }}
            className="rounded-lg border border-slate-800 bg-slate-950/60 p-1.5"
          >
            <div className="flex items-start justify-between gap-1">
              <div>
                <p className="text-[7.5px] font-semibold text-white">
                  {CUSTOMER_NAME}
                </p>
                <p className="text-[5.5px] text-slate-500">{created}</p>
              </div>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 text-[5.5px] text-emerald-300">
                booked
              </span>
            </div>
            <div className="mt-1 space-y-px text-[6px] text-slate-300">
              <p>{CUSTOMER_PHONE}</p>
              <p>{CUSTOMER_EMAIL}</p>
              <p className="text-slate-400">{SERVICE}</p>
              <p>
                <span className="text-slate-500">Appointment </span>
                {appointment}
              </p>
              <p className="capitalize text-slate-500">web_widget</p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
            <div className="grid grid-cols-[1.1fr_.9fr_.9fr_1.1fr_1.3fr_1.1fr_.7fr_.8fr] gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2 text-[8.5px] uppercase tracking-wide text-slate-400">
              <span>Created</span>
              <span>Name</span>
              <span>Phone</span>
              <span>Email</span>
              <span>Service</span>
              <span>Appointment time</span>
              <span>Status</span>
              <span>Source</span>
            </div>
            <div
              style={{ opacity: rowIn }}
              className="grid grid-cols-[1.1fr_.9fr_.9fr_1.1fr_1.3fr_1.1fr_.7fr_.8fr] items-center gap-2 px-3 py-2.5 text-[9.5px] text-white"
            >
              <span className="text-slate-300">{created}</span>
              <span>{CUSTOMER_NAME}</span>
              <span>{CUSTOMER_PHONE}</span>
              <span className="truncate">{CUSTOMER_EMAIL}</span>
              <span className="text-slate-300">{SERVICE}</span>
              <span>{appointment}</span>
              <span>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[8px] text-emerald-300">
                  booked
                </span>
              </span>
              <span className="capitalize text-slate-300">web_widget</span>
            </div>
          </div>
        )}
      </div>
    </AppFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Scene 9 — the owner's booking email
// ─────────────────────────────────────────────────────────────────────

function SceneNotification({ t, compact, dates }: SceneCtx) {
  const appointment = dates?.emailAppointment ?? "your appointment time";
  const appear = ramp(t, 300, 600);

  const rows: [string, string][] = [
    ["Customer", CUSTOMER_NAME],
    ["Email", CUSTOMER_EMAIL],
    ["Date & time", appointment],
    ["Service", SERVICE],
    ["Reference", BOOKING_REFERENCE],
  ];

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-[#0d0f14]"
      style={{ opacity: appear }}
    >
      <div
        className={`w-full overflow-hidden rounded-xl border border-slate-700 ${
          compact ? "mx-3 max-w-[300px]" : "max-w-[430px]"
        }`}
      >
        {/* Inbox row — framing only; the card below is the real email. */}
        <div
          className={`border-b border-slate-700 bg-[#1b2130] ${
            compact ? "px-2 py-1" : "px-3.5 py-2"
          }`}
        >
          <p
            className={`font-semibold text-white ${
              compact ? "text-[7px]" : "text-[11px]"
            }`}
          >
            New booking: {CUSTOMER_NAME} — {appointment}
          </p>
          <p
            className={`text-white/40 ${compact ? "text-[6px]" : "text-[9px]"}`}
          >
            to you · from Remy
          </p>
        </div>

        <div
          className={compact ? "bg-[#f4f5f7] p-2" : "bg-[#f4f5f7] p-4"}
          style={{ fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif" }}
        >
          <div className="mb-2 flex items-center justify-center gap-1.5">
            <span
              className={`flex items-center justify-center rounded-lg bg-[#2563eb] font-bold text-white ${
                compact ? "h-3 w-3 text-[6px]" : "h-5 w-5 text-[10px]"
              }`}
            >
              N
            </span>
            <span
              className={`font-semibold text-[#111827] ${
                compact ? "text-[7px]" : "text-[11px]"
              }`}
            >
              Niteowl <span className="text-[#9ca3af]">AI</span>
            </span>
          </div>

          <div
            className={`rounded-xl border border-[#e5e7eb] bg-white ${
              compact ? "p-2" : "p-3.5"
            }`}
          >
            <p
              className={`text-[#1f2937] ${compact ? "text-[6.5px]" : "text-[11px]"}`}
            >
              You&apos;ve got a new booking via Remy.
            </p>
            <table
              className={`mt-1.5 ${compact ? "text-[6px]" : "text-[10px]"}`}
            >
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}>
                    <td className="whitespace-nowrap pr-2 align-top text-[#6b7280]">
                      {k}
                    </td>
                    <td className="font-medium text-[#111827]">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p
            className={`mt-1.5 text-center text-[#9ca3af] ${
              compact ? "text-[5.5px]" : "text-[8.5px]"
            }`}
          >
            Sent by Remy, your AI receptionist.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Scene 10 — closing
// ─────────────────────────────────────────────────────────────────────

const CLOSING_POINTS = [
  "Answers enquiries from your Knowledge Base",
  "Captures every lead with contact details",
  "Books appointments inside your hours",
  "Notifies you the moment it happens",
];

function SceneClosing({ t, compact }: SceneCtx) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center text-center ${
        compact ? "px-3" : "px-8"
      }`}
      style={{
        background:
          "linear-gradient(135deg, #0d0f14 0%, #101423 55%, #141a33 100%)",
      }}
    >
      <p
        className={`font-bold leading-tight text-white ${
          compact ? "max-w-[320px] text-[11px]" : "max-w-[620px] text-[24px]"
        }`}
        style={{ opacity: ramp(t, 200, 600) }}
      >
        Remy answers enquiries, captures leads and books appointments—24/7.
      </p>

      {!compact && (
        <div
          className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1"
          style={{ opacity: ramp(t, 1200, 600) }}
        >
          {CLOSING_POINTS.map((p) => (
            <span
              key={p}
              className="flex items-center gap-1.5 text-[11px] text-white/55"
            >
              <span className="text-emerald-400">✓</span>
              {p}
            </span>
          ))}
        </div>
      )}

      <span
        className={`mt-4 rounded-xl bg-blue-600 font-semibold text-white ${
          compact ? "px-3 py-1.5 text-[9px]" : "px-6 py-3 text-[14px]"
        }`}
        style={{ opacity: ramp(t, 2200, 600) }}
      >
        Start your free 14-day trial
      </span>

      <p
        className={`mt-2 text-white/35 ${compact ? "text-[6.5px]" : "text-[10px]"}`}
        style={{ opacity: ramp(t, 2800, 600) }}
      >
        No credit card required · Cancel anytime
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Reduced-motion fallback
// ─────────────────────────────────────────────────────────────────────

function StaticSummary({ compact }: { compact: boolean }) {
  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-2 overflow-hidden px-5 py-4"
      style={{
        background:
          "linear-gradient(135deg, #0d0f14 0%, #101423 55%, #141a33 100%)",
      }}
    >
      <p
        className={`font-bold leading-tight text-white ${
          compact ? "text-sm" : "text-lg"
        }`}
      >
        Remy answers enquiries, captures leads and books appointments—24/7.
      </p>
      <ol
        className={`grid gap-x-4 gap-y-0.5 text-white/55 ${
          compact ? "text-[10px]" : "grid-cols-2 text-xs"
        }`}
      >
        {SCENES.slice(0, compact ? 6 : SCENES.length).map((s, i) => (
          <li key={s.id}>
            <span className="text-blue-400">{i + 1}.</span> {s.chapter}
          </li>
        ))}
      </ol>
      <p
        className={`font-semibold text-white ${compact ? "text-[11px]" : "text-sm"}`}
      >
        Start your free 14-day trial
      </p>
    </div>
  );
}
