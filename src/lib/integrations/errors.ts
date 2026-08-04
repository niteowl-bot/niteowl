// ── Provider-independent error taxonomy ───────────────────────────
//
// The sync queue has to decide three things about any failure without
// knowing which provider produced it: retry now, retry later, or stop
// and ask the owner to reconnect. Providers translate their own error
// shapes into these kinds; nothing downstream reads an HTTP status or a
// Google/Microsoft error code.

export type IntegrationErrorKind =
  /** Token rejected or revoked. Retrying cannot help — the owner must reconnect. */
  | "auth_expired"
  /** Token is valid but lacks the scope, or the calendar is read-only. */
  | "forbidden"
  /** Provider asked us to slow down. Retryable, honouring Retry-After. */
  | "rate_limited"
  /** Calendar or event no longer exists. */
  | "not_found"
  /** The event already exists — for creates this is a success in disguise. */
  | "conflict"
  /** Network blip, timeout, or provider 5xx. Retryable. */
  | "transient"
  /** Malformed request or a bug on our side. Retrying repeats the bug. */
  | "permanent";

export interface IntegrationErrorOptions {
  kind: IntegrationErrorKind;
  /** Which provider raised it, for logs. */
  provider?: string;
  httpStatus?: number;
  /** Provider's own code, e.g. "invalid_grant". Logged, never branched on downstream. */
  providerCode?: string;
  /** Seconds the provider asked us to wait, when it says so. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class IntegrationError extends Error {
  readonly kind: IntegrationErrorKind;
  readonly provider: string | null;
  readonly httpStatus: number | null;
  readonly providerCode: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, options: IntegrationErrorOptions) {
    super(message);
    this.name = "IntegrationError";
    this.kind = options.kind;
    this.provider = options.provider ?? null;
    this.httpStatus = options.httpStatus ?? null;
    this.providerCode = options.providerCode ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Whether another attempt could plausibly succeed.
 *
 * "conflict" is retryable=false because the create already landed —
 * the caller treats it as success rather than trying again.
 */
export function isRetryable(kind: IntegrationErrorKind): boolean {
  return kind === "rate_limited" || kind === "transient";
}

/**
 * Whether the connection should be flipped to needs_reauth, which stops
 * the queue and prompts the owner to reconnect.
 */
export function requiresReauth(kind: IntegrationErrorKind): boolean {
  return kind === "auth_expired";
}

/**
 * Default mapping from HTTP status to kind. Providers may override for
 * cases only they can tell apart — notably Google returning 403 for both
 * "rate limited" and "insufficient permission" depending on the body.
 */
export function classifyHttpStatus(status: number): IntegrationErrorKind {
  if (status === 401) return "auth_expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 410) return "not_found"; // Gone: event already deleted
  if (status === 429) return "rate_limited";
  if (status >= 500) return "transient";
  if (status >= 400) return "permanent";
  return "permanent";
}

/**
 * The lead's sync status implied by a failure, so the calendar UI can
 * show why an appointment is not mirrored.
 */
export function syncStatusForError(
  kind: IntegrationErrorKind
): "failed" | "deleted" {
  return kind === "not_found" ? "deleted" : "failed";
}

/** Narrowing helper — avoids `instanceof` checks scattered across routes. */
export function isIntegrationError(
  error: unknown
): error is IntegrationError {
  return error instanceof IntegrationError;
}

/**
 * Wraps anything thrown by fetch/JSON parsing as a transient provider
 * error, so a network blip is retried rather than surfacing as an
 * unhandled crash in the sync queue.
 */
export function asProviderError(
  error: unknown,
  provider: string
): IntegrationError {
  if (isIntegrationError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new IntegrationError(`${provider} request failed: ${message}`, {
    kind: "transient",
    provider,
    cause: error,
  });
}
