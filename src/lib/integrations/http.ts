import {
  IntegrationError,
  classifyHttpStatus,
  type IntegrationErrorKind,
} from "@/lib/integrations/errors";

// ── Shared HTTP client for integrations ───────────────────────────
//
// One place that turns a provider's HTTP response into the framework's
// error taxonomy, so every provider retries, re-authorises and gives up
// on the same rules. Providers supply only the part that is genuinely
// vendor-specific: how to read a reason code out of their error body.
//
// `fetchImpl` is injectable so providers stay unit-testable without a
// network — the Google tests drive the real request builders against a
// fake fetch.

export type FetchLike = typeof fetch;

export interface IntegrationRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Sent as JSON. Mutually exclusive with `form`. */
  json?: unknown;
  /** Sent as application/x-www-form-urlencoded — what OAuth token endpoints want. */
  form?: Record<string, string>;
  accessToken?: string;
  provider: string;
  fetchImpl?: FetchLike;
  /**
   * Lets a provider override the default status mapping using its own
   * error body — Google returns 403 for both "rate limited" and
   * "insufficient permission", and only the body tells them apart.
   */
  refineError?: (status: number, body: unknown) => IntegrationErrorKind | null;
}

export interface IntegrationResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  // The header may also be an HTTP date.
  const asDate = Date.parse(raw);
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, Math.round((asDate - Date.now()) / 1000));
}

/** Best-effort provider error code, for logs only — never branched on. */
function extractProviderCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;

  // OAuth token endpoints: { error: "invalid_grant" }
  if (typeof record.error === "string") return record.error;

  // Google API: { error: { errors: [{ reason }], message } }
  const error = record.error as Record<string, unknown> | undefined;
  if (error && typeof error === "object") {
    const errors = error.errors as Array<Record<string, unknown>> | undefined;
    const reason = errors?.[0]?.reason;
    if (typeof reason === "string") return reason;
    if (typeof error.message === "string") return error.message.slice(0, 200);
  }

  // Microsoft Graph: { error: { code, message } }
  if (error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }

  return undefined;
}

/**
 * Performs a request and returns the parsed body, or throws an
 * IntegrationError carrying the kind the job queue needs.
 *
 * A non-2xx is always an error here. Callers that treat a particular
 * status as success — a 409 on an idempotent create, a 404 on a delete
 * — catch the typed error and decide, which keeps that decision visible
 * at the call site instead of buried in transport code.
 */
export async function integrationFetch<T = unknown>(
  request: IntegrationRequest
): Promise<IntegrationResponse<T>> {
  const {
    url,
    method = "GET",
    headers = {},
    json,
    form,
    accessToken,
    provider,
    fetchImpl = fetch,
    refineError,
  } = request;

  const requestHeaders: Record<string, string> = { ...headers };
  let body: string | undefined;

  if (json !== undefined) {
    requestHeaders["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    requestHeaders["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }

  if (accessToken) {
    requestHeaders.authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(url, { method, headers: requestHeaders, body });
  } catch (cause) {
    // Network failure, DNS, timeout — always worth retrying.
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new IntegrationError(`${provider} request failed: ${message}`, {
      kind: "transient",
      provider,
      cause,
    });
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Some endpoints (Google's revoke) return an empty or non-JSON body.
      parsed = text;
    }
  }

  if (!response.ok) {
    const kind =
      refineError?.(response.status, parsed) ?? classifyHttpStatus(response.status);
    const providerCode = extractProviderCode(parsed);
    throw new IntegrationError(
      `${provider} returned ${response.status}${providerCode ? ` (${providerCode})` : ""}`,
      {
        kind,
        provider,
        httpStatus: response.status,
        providerCode,
        retryAfterSeconds: parseRetryAfter(response.headers),
      }
    );
  }

  return { status: response.status, body: parsed as T, headers: response.headers };
}
