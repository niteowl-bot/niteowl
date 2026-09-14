// Reads the parameters of a password-recovery landing at /auth/confirm-reset.
//
// Two link shapes reach that route:
//
//   token_hash=…&type=recovery  — Supabase's documented server-side pattern.
//     The Reset Password email template links straight here with the
//     token hash, so the route verifies it with `verifyOtp` and nothing
//     about the browser that REQUESTED the reset is needed. This is what
//     makes recovery work when a customer asks on their phone and opens
//     the email on a laptop.
//
//   code=…                      — the PKCE exchange, kept exactly as it was
//     for links already sitting in inboxes. It works only in the browser
//     profile that requested the reset (the code verifier cookie lives
//     there), which is the limitation the first shape exists to remove.
//
// A landing with NEITHER is not an error here: the implicit-flow fragment
// is invisible to the server, and the route forwards it to the reset page
// (src/lib/auth/hashSession.ts). Anything else — a type without a hash, a
// hash with the wrong or no type, both shapes at once — is refused, so the
// route never has to guess which credential it was meant to trust.
//
// Pure: no network, no clock, no logging. The hash is passed through
// untouched and never inspected beyond its shape; it is a credential and
// is not to be printed by anything that calls this.

export type RecoveryLinkParams =
  | { kind: "token_hash"; token_hash: string }
  | { kind: "code"; code: string }
  | { kind: "none" }
  | { kind: "invalid" };

/** Generous cap on the token hash. Supabase's are far shorter; this only
 *  stops arbitrarily long input reaching the verify call. */
export const MAX_TOKEN_HASH_LENGTH = 512;

const RECOVERY_TYPE = "recovery";

/** Non-empty, whitespace-free, bounded. Nothing else is assumed about it. */
export function isWellFormedTokenHash(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TOKEN_HASH_LENGTH && !/\s/.test(value);
}

export function parseRecoveryLinkParams(searchParams: URLSearchParams): RecoveryLinkParams {
  const hasTokenHash = searchParams.has("token_hash");
  const hasType = searchParams.has("type");
  const hasCode = searchParams.has("code");

  // Both credential shapes at once: ambiguous, so neither is trusted.
  if (hasTokenHash && hasCode) return { kind: "invalid" };

  if (hasTokenHash || hasType) {
    // The two travel together or not at all.
    if (!hasTokenHash || !hasType) return { kind: "invalid" };
    if (searchParams.get("type") !== RECOVERY_TYPE) return { kind: "invalid" };
    const tokenHash = searchParams.get("token_hash") ?? "";
    if (!isWellFormedTokenHash(tokenHash)) return { kind: "invalid" };
    return { kind: "token_hash", token_hash: tokenHash };
  }

  if (hasCode) {
    const code = searchParams.get("code") ?? "";
    // Mirrors the route's original `if (code)` truthiness check exactly:
    // an empty code was never exchanged, and still is not.
    if (code === "") return { kind: "none" };
    return { kind: "code", code };
  }

  return { kind: "none" };
}
