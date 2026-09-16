// ── Public route inventory — Organic Acquisition Engine, A-1 ─────────
//
// ONE LIST, THREE READERS. `sitemap.ts`, `robots.ts` and the
// discoverability tests all read these constants, so a route cannot be
// in the sitemap without being public here, and a private family cannot
// be crawlable without being removed from the disallow list here — in
// one place, in a diff a reviewer sees.
//
// STATIC, DETERMINISTIC, IDENTITY-FREE. Nothing here reads a clock, a
// request, a cookie, a header or a store. The sitemap carries NO
// lastModified: no reliable per-route modification date exists (a route
// is a layout plus components plus shared modules), and a date that is
// not known is not stated — neither `new Date()`, nor a file mtime, nor
// a hand-typed stamp. Two builds of the same commit therefore produce
// byte-identical output and nothing about a visitor can leak into what a
// crawler is told (docs/ARCHITECTURE.md §26, docs/AGENT_ACCESS_LAYER.md
// §25.1).
//
// PUBLIC MEANS PUBLIC. A route is listed below only if it renders full
// value to an anonymous visitor with no session, token or parameter.
// /booking/manage is reachable without login but only by a customer's
// private manage token, so it is private here. A route that is neither
// public below nor covered by a private family fails the test that pins
// the two lists against the real src/app inventory — a new page must be
// classified before it ships, never discovered by a crawler first.

/** The canonical origin. Mirrors `metadataBase` in src/app/layout.tsx. */
export const SITE_URL = "https://niteowlhq.com";

export interface PublicRoute {
  readonly path: string;
  readonly changeFrequency: "yearly" | "monthly" | "weekly";
  readonly priority: number;
}

/**
 * Every page a crawler should index, and nothing else.
 *
 * Priorities are relative hints inside this site only. The free tools
 * sit above the legal pages because they are the pages a visitor
 * searching for a business problem should land on.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: "/", changeFrequency: "monthly", priority: 1 },
  { path: "/free-tools", changeFrequency: "monthly", priority: 0.9 },
  { path: "/free-tools/business-opportunity-scan", changeFrequency: "monthly", priority: 0.9 },
  { path: "/free-tools/ai-receptionist-setup-kit", changeFrequency: "monthly", priority: 0.9 },
  // A-2a — problem-led discovery pages, one per canonical Scan condition
  // class (src/lib/site/problemPages.ts). Three, and only three.
  { path: "/free-tools/problems/unanswered-enquiries", changeFrequency: "monthly", priority: 0.8 },
  { path: "/free-tools/problems/enquiries-that-do-not-book", changeFrequency: "monthly", priority: 0.8 },
  { path: "/free-tools/problems/booking-back-and-forth", changeFrequency: "monthly", priority: 0.8 },
  // A-2b — the Lost Revenue framing / entry page into the same nine-question
  // Scan (src/lib/site/lostRevenuePage.ts). Entry only; it sizes nothing.
  { path: "/free-tools/lost-revenue", changeFrequency: "monthly", priority: 0.8 },
  // Industry landing pages — marketing only, one Remy
  // (src/lib/site/industryPages.ts). Plumbers is the first and only one.
  { path: "/ai-receptionist-for-plumbers", changeFrequency: "monthly", priority: 0.8 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

/**
 * Route families no crawler may enter.
 *
 * Authenticated application areas, the auth flows, the admin area, every
 * API route and the customer manage-booking link. Prefixes, so a page
 * added under one of them is protected without a change here.
 */
export const PRIVATE_ROUTE_PREFIXES: readonly string[] = [
  "/dashboard",
  "/chat",
  "/leads",
  "/calendar",
  "/knowledge",
  "/settings",
  "/onboarding",
  "/admin",
  "/api",
  "/auth",
  "/login",
  "/signup",
  "/reset-password",
  "/forgot-password",
  "/booking",
];

/** Absolute URL for a public path. */
export function publicUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/** True when a path falls under a private family. */
export function isPrivatePath(path: string): boolean {
  return PRIVATE_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}
