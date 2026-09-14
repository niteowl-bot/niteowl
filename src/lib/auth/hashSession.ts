// Consumes a Supabase IMPLICIT-flow auth redirect — tokens carried in the
// URL fragment (`#access_token=…&refresh_token=…&type=…`) — and turns it
// into the same cookie-backed session every other sign-in path produces.
//
// Why this exists. Both auth landing routes (/auth/callback and
// /auth/confirm-reset) are server route handlers that exchange `?code=`,
// and a fragment is never sent to the server. Nor can the browser client
// pick it up: @supabase/ssr hard-codes `flowType: "pkce"`, and auth-js
// rejects an implicit fragment on a PKCE client ("Not a valid PKCE flow
// url"). So an emailed magic link or recovery link that Supabase answers
// with a fragment was consumed by nobody, and the visitor stayed signed
// out with live tokens sitting in the address bar.
//
// The fix is deliberately narrow: parse the fragment, remove it from the
// URL BEFORE any network call, and hand the tokens to the official
// `auth.setSession()` — which verifies the access token against Supabase
// (or refreshes it) before saving, and writes through the existing cookie
// storage so middleware and server components see the session exactly as
// they do after a password sign-in. No token is stored, logged or
// re-emitted by this module; a malformed or rejected fragment is dropped.
//
// Pure with respect to its dependencies: the client and the window are
// injected, so the exact failure modes are testable without a browser.

export type AuthHashType = "recovery" | "other";

export type ParsedAuthHash =
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "malformed" }
  | { kind: "tokens"; access_token: string; refresh_token: string; type: AuthHashType };

export type AuthHashOutcome =
  | { kind: "none" }
  | { kind: "rejected"; reason: "error_in_url" | "malformed" | "session_rejected" }
  | { kind: "session"; type: AuthHashType };

/** The minimal slice of the Supabase client this module relies on. */
export interface HashSessionClient {
  auth: {
    setSession(session: {
      access_token: string;
      refresh_token: string;
    }): Promise<{ error: unknown | null }>;
  };
}

/** The minimal slice of `window` this module relies on. */
export interface HashSessionWindow {
  location: { hash: string; pathname: string; search: string };
  history: {
    state: unknown;
    replaceState(state: unknown, unused: string, url: string): void;
  };
}

/**
 * Reads an auth redirect out of a URL fragment. Never throws; anything
 * that is not a complete, well-formed Supabase auth fragment is reported
 * as such rather than partially trusted.
 */
export function parseAuthHash(hash: string): ParsedAuthHash {
  if (!hash || hash === "#") return { kind: "none" };
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { kind: "none" };
  }

  // Supabase reports a failed link (expired, already used) in the same
  // place it would have put the tokens. That is an answer, not a session.
  if (params.has("error") || params.has("error_code") || params.has("error_description")) {
    return { kind: "error" };
  }

  const accessToken = params.get("access_token") ?? "";
  const refreshToken = params.get("refresh_token") ?? "";
  const hasAny = params.has("access_token") || params.has("refresh_token");

  if (!hasAny) return { kind: "none" };
  if (accessToken.trim() === "" || refreshToken.trim() === "") {
    return { kind: "malformed" };
  }

  return {
    kind: "tokens",
    access_token: accessToken,
    refresh_token: refreshToken,
    type: params.get("type") === "recovery" ? "recovery" : "other",
  };
}

/**
 * Where a successfully consumed fragment should send the visitor. Fixed
 * literals — nothing in the URL can choose the destination.
 */
export function postAuthHashPath(type: AuthHashType): "/reset-password" | "/dashboard" {
  return type === "recovery" ? "/reset-password" : "/dashboard";
}

// replaceState rather than `location.hash = ""`: the latter leaves a
// trailing "#" and adds a history entry, so the token-bearing URL would
// still be one Back press away.
function stripHash(win: HashSessionWindow): void {
  try {
    win.history.replaceState(
      win.history.state,
      "",
      `${win.location.pathname}${win.location.search}`
    );
  } catch {
    // replaceState can throw in exotic embedding contexts. The fragment
    // has already been read into local variables and is never re-read,
    // so consumption still proceeds; only the cosmetic cleanup is lost.
  }
}

async function run(
  getClient: () => HashSessionClient,
  win: HashSessionWindow
): Promise<AuthHashOutcome> {
  const parsed = parseAuthHash(win.location.hash);
  if (parsed.kind === "none") return { kind: "none" };

  // The fragment leaves the address bar before anything else happens —
  // including on the failure paths, so an unusable token is never left
  // on display or in history.
  stripHash(win);

  if (parsed.kind === "error") return { kind: "rejected", reason: "error_in_url" };
  if (parsed.kind === "malformed") return { kind: "rejected", reason: "malformed" };

  try {
    const { error } = await getClient().auth.setSession({
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
    });
    if (error) return { kind: "rejected", reason: "session_rejected" };
  } catch {
    return { kind: "rejected", reason: "session_rejected" };
  }

  return { kind: "session", type: parsed.type };
}

let inFlight: Promise<AuthHashOutcome> | null = null;

/**
 * Consumes the current page's auth fragment at most once at a time.
 * Concurrent callers on one page load (the global handler and the
 * reset-password page) share the same promise, so `setSession` is never
 * invoked twice for one fragment and a page checking `getUser()` can
 * await the consumption first instead of racing it.
 *
 * `getClient` is only called when a fragment is actually present, so a
 * page without one creates no client and does no work.
 */
export function consumeAuthHashSession(
  getClient: () => HashSessionClient,
  win: HashSessionWindow
): Promise<AuthHashOutcome> {
  if (inFlight) return inFlight;
  const p = run(getClient, win).finally(() => {
    if (inFlight === p) inFlight = null;
  });
  inFlight = p;
  return p;
}
