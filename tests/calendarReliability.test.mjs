// Reliability of the external-calendar availability path.
//
// These pin the three properties the 2026-08-07 production failure
// showed were unproven:
//
//   1. A provider request is BOUNDED and CANCELLED. The blocking test
//      timed out after 8s and the OAuth refresh still landed 4.0s
//      later, because fetch was called with no signal — the caller gave
//      up but the work did not.
//   2. ONE freeBusy request answers one availability question. The
//      alternatives search used to call back into checkBookingSlot per
//      candidate, each issuing its own fresh 14-day window.
//   3. Uncertainty is never "available". Every failure resolves to
//      AVAILABILITY UNKNOWN.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import — see the file

import {
  integrationFetch,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  needsRefresh,
  mergeRefreshedCredentials,
} from "@/lib/integrations/auth";
import { createGoogleIntegration } from "@/lib/integrations/providers/google";
import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";
import { checkVoiceAvailability } from "@/lib/voice/availabilityTool";
import { AVAILABILITY_REQUEST_TIMEOUT_MS } from "@/lib/integrations/capabilities/calendarService";

// ── 1. Bounded, cancellable provider requests ─────────────────────

describe("provider HTTP is bounded and cancelled", () => {
  test("a hanging request aborts at the deadline instead of running on", async () => {
    let seenSignal;
    // Never settles on its own — only the abort can end it, which is
    // precisely the production shape: Google accepted the connection
    // and then went quiet.
    const hangingFetch = async (_url, init = {}) => {
      seenSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("The operation was aborted"))
        );
      });
    };

    const started = Date.now();
    await assert.rejects(
      () =>
        integrationFetch({
          url: "https://example.test/slow",
          provider: "google",
          fetchImpl: hangingFetch,
          timeoutMs: 40,
        }),
      (err) => {
        assert.ok(err instanceof IntegrationError);
        // Retryable: too slow is not the same as refused.
        assert.equal(err.kind, "transient");
        assert.match(err.message, /timed out after 40ms/);
        return true;
      }
    );

    // The signal really fired — the request was cancelled, not merely
    // abandoned. This is the assertion that would have caught the bug.
    assert.ok(seenSignal, "a signal must be passed to fetch");
    assert.equal(seenSignal.aborted, true);
    assert.ok(
      Date.now() - started < 2000,
      "must give up at the deadline, not wait for the provider"
    );
  });

  test("a successful request is unaffected and still carries a signal", async () => {
    let seenSignal;
    const okFetch = async (_url, init = {}) => {
      seenSignal = init.signal;
      return new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const { status, body } = await integrationFetch({
      url: "https://example.test/ok",
      provider: "google",
      fetchImpl: okFetch,
    });

    assert.equal(status, 200);
    assert.deepEqual(body, { hello: "world" });
    assert.ok(seenSignal, "a signal is always supplied");
    // Not aborted: the deadline must not fire on a healthy request.
    assert.equal(seenSignal.aborted, false);
  });

  test("the availability budget leaves room for a refresh AND a freeBusy inside 8s", () => {
    assert.ok(AVAILABILITY_REQUEST_TIMEOUT_MS > 0);
    assert.ok(
      AVAILABILITY_REQUEST_TIMEOUT_MS * 2 < 8000,
      "two sequential provider calls must fit the voice lookup budget"
    );
  });

  test("the availability budget is NOT the global default", () => {
    // The whole point of the split: connect, resource listing and event
    // writes have no caller on a phone line, so they must not inherit a
    // deadline sized for one.
    assert.ok(
      DEFAULT_REQUEST_TIMEOUT_MS > AVAILABILITY_REQUEST_TIMEOUT_MS,
      "the global backstop must be more generous than the availability budget"
    );
  });

  test("a request with no explicit budget does NOT abort at the availability deadline", async () => {
    let seenSignal;
    let release;
    const controlledFetch = async (_url, init = {}) => {
      seenSignal = init.signal;
      return new Promise((resolve, reject) => {
        release = () =>
          resolve(
            new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        );
      });
    };

    // No timeoutMs: this is what connect, listResources and event writes
    // look like.
    const pending = integrationFetch({
      url: "https://example.test/unrelated",
      provider: "google",
      fetchImpl: controlledFetch,
    });

    // Well past the 3.5s availability budget in spirit — we cannot wait
    // that long in a test, so the property pinned is that the signal is
    // NOT armed at anything near it, and the request is still alive.
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(
      seenSignal.aborted,
      false,
      "an unrelated call must not be cancelled on the availability schedule"
    );

    release();
    const { status } = await pending;
    assert.equal(status, 200);
  });
});

// ── 1b. The budget is scoped to availability, not global ──────────

describe("only the availability operations carry the tight budget", () => {
  /**
   * Hangs until aborted, and reports the signal it was handed.
   *
   * `releaseAll` exists so a test that deliberately does NOT abort can
   * still let the request finish — otherwise the generous default
   * deadline stays armed and holds the whole suite open for 15s.
   */
  function hangingProvider() {
    const seen = [];
    const releases = [];
    const impl = async (url, init = {}) => {
      seen.push({ url, signal: init.signal });
      return new Promise((resolve, reject) => {
        releases.push(() =>
          resolve(
            new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          )
        );
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        );
      });
    };
    return { seen, impl, releaseAll: () => releases.forEach((r) => r()) };
  }

  test("getBusyIntervals honours the budget it is given", async () => {
    const { seen, impl } = hangingProvider();
    const google = createGoogleIntegration({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: impl,
    });

    await assert.rejects(
      () =>
        google.calendar.getBusyIntervals(
          { strategy: "oauth2", accessToken: "at" },
          "cal-1",
          "2026-08-11T09:00:00.000Z",
          "2026-08-25T09:00:00.000Z",
          { timeoutMs: 30 }
        ),
      (err) => {
        assert.match(err.message, /timed out after 30ms/);
        return true;
      }
    );
    assert.equal(seen[0].signal.aborted, true);
  });

  test("refresh honours the budget it is given", async () => {
    const { impl } = hangingProvider();
    const google = createGoogleIntegration({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: impl,
    });

    await assert.rejects(
      () =>
        google.auth.refresh(
          { strategy: "oauth2", accessToken: "at", refreshToken: "rt" },
          { timeoutMs: 30 }
        ),
      (err) => {
        assert.match(err.message, /timed out after 30ms/);
        return true;
      }
    );
  });

  test("listResources and exchangeCode do NOT inherit the availability budget", async () => {
    const { seen, impl, releaseAll } = hangingProvider();
    const google = createGoogleIntegration({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: impl,
    });

    // Neither call is given a budget — they are Settings/connect work.
    const listing = google
      .listResources({ strategy: "oauth2", accessToken: "at" })
      .catch(() => {});
    const exchange = google.auth
      .exchangeCode("code", "https://app.test/cb")
      .catch(() => {});

    // Long past a 30ms budget, and well past anything the availability
    // path would tolerate: still alive, still not cancelled.
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(seen.length, 2);
    for (const call of seen) {
      assert.equal(
        call.signal.aborted,
        false,
        `${call.url} must not be cancelled on the availability schedule`
      );
    }

    // Let both finish so their (generous) deadlines are cleared.
    releaseAll();
    await Promise.all([listing, exchange]);
  });
});

// ── 2. Token refresh ──────────────────────────────────────────────

describe("expired-token refresh", () => {
  const base = {
    strategy: "oauth2",
    accessToken: "at",
    refreshToken: "rt",
    scopes: "s",
  };

  test("an expired token needs refreshing", () => {
    assert.equal(
      needsRefresh({ ...base, expiresAtIso: "2020-01-01T00:00:00.000Z" }),
      true
    );
  });

  test("a token inside the safety skew needs refreshing", () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const soon = new Date(now.getTime() + 30_000).toISOString();
    assert.equal(needsRefresh({ ...base, expiresAtIso: soon }, now), true);
  });

  test("a healthy token does not", () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const later = new Date(now.getTime() + 3_600_000).toISOString();
    assert.equal(needsRefresh({ ...base, expiresAtIso: later }, now), false);
  });

  test("no refresh token means no refresh attempt", () => {
    assert.equal(
      needsRefresh({
        ...base,
        refreshToken: undefined,
        expiresAtIso: "2020-01-01T00:00:00.000Z",
      }),
      false
    );
  });

  test("refreshing keeps the existing refresh token when Google omits one", () => {
    const merged = mergeRefreshedCredentials(
      { ...base, expiresAtIso: "2020-01-01T00:00:00.000Z" },
      { strategy: "oauth2", accessToken: "new", expiresAtIso: "2030-01-01T00:00:00.000Z" }
    );
    assert.equal(merged.accessToken, "new");
    // Losing this would force the owner to reconnect.
    assert.equal(merged.refreshToken, "rt");
  });

  test("a missing refresh token surfaces as auth_expired, not a crash", async () => {
    const google = createGoogleIntegration({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: async () => {
        throw new Error("must not reach the network");
      },
    });

    await assert.rejects(
      () => google.auth.refresh({ strategy: "oauth2", accessToken: "at" }),
      (err) => {
        assert.ok(err instanceof IntegrationError);
        assert.equal(err.kind, "auth_expired");
        return true;
      }
    );
  });
});

// ── 3. Blocking and alternatives, end to end ──────────────────────

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const CALENDAR_ID = "owner@example.com";

// Tuesday 11 August 2026, 10:00 Europe/London (BST) = 09:00Z.
const REQUESTED = { date: "2026-08-11", time: "10:00" };
const REQUESTED_ISO = "2026-08-11T09:00:00.000Z";

function installStubs({ expiresAtIso = "2099-01-01T00:00:00.000Z" } = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_AVAILABILITY_BLOCKING = "true";
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://app.example.test/callback";

  const credentials = encryptCredentials(
    {
      strategy: "oauth2",
      accessToken: "ya29.token",
      refreshToken: "1//refresh",
      expiresAtIso,
      scopes: "calendar",
    },
    loadKeyringFromEnv()
  );

  const realFetch = globalThis.fetch;
  const calls = { freeBusy: 0, token: 0, writes: [] };

  const json = (body, headers = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const wantsObject = (headers.get("accept") ?? "").includes("pgrst.object");

    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      calls.token++;
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }

    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      calls.freeBusy++;
      // Busy exactly over the requested hour; everything after is free.
      return json({
        calendars: {
          [CALENDAR_ID]: {
            busy: [{ start: REQUESTED_ISO, end: "2026-08-11T10:00:00.000Z" }],
          },
        },
      });
    }

    // Any other Google call, or any write, is a failure of the
    // read-only contract — recorded rather than silently allowed.
    if (url.includes("googleapis.com")) {
      calls.writes.push({ method, url });
      return json({});
    }
    if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      calls.writes.push({ method, url });
      return json([]);
    }

    if (url.includes("/rest/v1/integration_resources")) {
      const row = {
        id: "res-1",
        connection_id: CONNECTION_ID,
        resource_type: "calendar",
        external_id: CALENDAR_ID,
        name: CALENDAR_ID,
        is_primary: true,
        sync_enabled: true,
        availability_enabled: true,
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/integration_connections")) {
      const row = {
        id: CONNECTION_ID,
        org_id: ORG_ID,
        provider: "google",
        capabilities: ["calendar"],
        auth_strategy: "oauth2",
        account_id: "acct",
        account_email: CALENDAR_ID,
        account_name: "Owner",
        status: "connected",
        last_error: null,
        token_expires_at: expiresAtIso,
        last_verified_at: null,
        created_at: "2026-08-01T00:00:00.000Z",
        credentials_encrypted: credentials,
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/business_hours")) {
      return json(
        [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
          day_of_week,
          is_closed: false,
          open_time: "09:00",
          close_time: "17:00",
          lunch_start: null,
          lunch_end: null,
        }))
      );
    }

    if (url.includes("/rest/v1/organisations")) {
      const row = {
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/leads")) {
      // No internal bookings and no pending requests.
      return json([], { "content-range": "*/0" });
    }

    throw new Error(`unstubbed request: ${method} ${url}`);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
      delete process.env.CALENDAR_AVAILABILITY_BLOCKING;
      delete process.env.CALENDAR_SYNC_ENABLED;
      delete process.env.INTEGRATIONS_ENABLED;
    },
  };
}

describe("an externally busy slot is blocked, and alternatives cost no extra lookups", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("the busy slot is refused rather than offered", async () => {
    const outcome = await checkVoiceAvailability(ORG_ID, REQUESTED);
    assert.equal(outcome.status, "unavailable");
    assert.equal(outcome.requestedIso, REQUESTED_ISO);
    assert.match(outcome.result, /NOT AVAILABLE/);
  });

  test("real alternatives are offered, and none of them is the busy hour", async () => {
    const outcome = await checkVoiceAvailability(ORG_ID, REQUESTED);
    assert.ok(outcome.alternativeIsos.length > 0, "must offer something");
    assert.ok(
      !outcome.alternativeIsos.includes(REQUESTED_ISO),
      "the busy slot must never come back as an alternative"
    );
    // 11:00 BST is the first free hour after the busy window.
    assert.equal(outcome.alternativeIsos[0], "2026-08-11T10:00:00.000Z");
  });

  test("exactly ONE freeBusy request answers the whole question", async () => {
    await checkVoiceAvailability(ORG_ID, REQUESTED);
    // The regression: this was up to 7 — one for the requested slot and
    // one per alternative probe, each a fresh 14-day window.
    assert.equal(stubs.calls.freeBusy, 1);
  });

  test("nothing is written — no calendar event, no row", async () => {
    await checkVoiceAvailability(ORG_ID, REQUESTED);
    assert.deepEqual(stubs.calls.writes, []);
  });
});

describe("an expired access token is refreshed inside the availability budget", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs({ expiresAtIso: "2020-01-01T00:00:00.000Z" });
  });
  afterEach(() => stubs.restore());

  test("the refresh happens and the lookup still completes", async () => {
    const outcome = await checkVoiceAvailability(ORG_ID, REQUESTED);
    assert.equal(stubs.calls.token, 1, "the expired token must be refreshed");
    assert.equal(stubs.calls.freeBusy, 1, "still one freeBusy after refreshing");
    // Crucially NOT "unknown": a refresh that works must not degrade
    // the answer.
    assert.equal(outcome.status, "unavailable");
  });
});

describe("uncertainty is never available", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("a freeBusy failure yields AVAILABILITY UNKNOWN, not a free slot", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("freeBusy")) {
        return new Response(JSON.stringify({ error: { message: "boom" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input, init);
    };

    const outcome = await checkVoiceAvailability(ORG_ID, REQUESTED);
    assert.equal(outcome.status, "unknown");
    assert.match(outcome.result, /AVAILABILITY UNKNOWN/);
    assert.deepEqual(outcome.alternativeIsos, []);
  });
});
