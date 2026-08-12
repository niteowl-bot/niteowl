// Tests for the Google integration.
//
// The provider is stateless and takes an injectable fetch, so the real
// request builders and response parsers are exercised here without a
// network or any Google credentials. What is NOT covered: whether
// Google accepts these requests. Only a live connection proves that.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createGoogleIntegration,
  buildGoogleAuthUrl,
  buildGoogleEventBody,
  parseFreeBusyResponse,
  toGoogleEventId,
  toIntegrationResource,
  loadGoogleConfig,
  GOOGLE_REQUIRED_SCOPES,
} from "@/lib/integrations/providers/google";
import { IntegrationError } from "@/lib/integrations/errors";

const CONFIG = { clientId: "client-123.apps.googleusercontent.com", clientSecret: "secret" };
const OAUTH = {
  strategy: "oauth2",
  accessToken: "ya29.token",
  refreshToken: "1//refresh",
  expiresAtIso: "2099-01-01T00:00:00.000Z",
  scopes: GOOGLE_REQUIRED_SCOPES.join(" "),
};

/** Records requests and replays canned responses. */
function fakeFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      headers: new Headers(next.headers ?? {}),
      text: async () => (typeof next.body === "string" ? next.body : JSON.stringify(next.body ?? {})),
    };
  };
  impl.calls = calls;
  return impl;
}

function google(fetchImpl) {
  return createGoogleIntegration({ ...CONFIG, fetchImpl });
}

describe("configuration", () => {
  test("absent credentials mean the integration is not offered", () => {
    assert.equal(loadGoogleConfig({}), null);
    assert.equal(loadGoogleConfig({ GOOGLE_CALENDAR_CLIENT_ID: "id" }), null);
    assert.deepEqual(
      loadGoogleConfig({
        GOOGLE_CALENDAR_CLIENT_ID: "id",
        GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
      }),
      { clientId: "id", clientSecret: "secret" }
    );
  });

  test("the manifest declares the calendar capability and its resource kind", () => {
    const { manifest } = google();
    assert.equal(manifest.id, "google");
    assert.deepEqual(manifest.capabilities, ["calendar"]);
    assert.equal(manifest.resourceType, "calendar");
  });
});

describe("authorisation URL", () => {
  const url = () => new URL(buildGoogleAuthUrl(CONFIG, {
    redirectUri: "https://niteowlhq.com/api/integrations/google/callback",
    state: "nonce-abc",
  }));

  test("access_type=offline and prompt=consent are both present", () => {
    // Without offline there is no refresh token at all; without consent
    // a reconnecting account gets an access token only and the
    // connection dies silently an hour later.
    const params = url().searchParams;
    assert.equal(params.get("access_type"), "offline");
    assert.equal(params.get("prompt"), "consent");
  });

  test("it asks for exactly the scopes the connection needs", () => {
    const scopes = url().searchParams.get("scope").split(" ");
    for (const required of GOOGLE_REQUIRED_SCOPES) {
      assert.ok(scopes.includes(required), required);
    }
    // Least privilege: no full-calendar scope.
    assert.ok(!scopes.includes("https://www.googleapis.com/auth/calendar"));
  });

  test("state and redirect_uri are carried through", () => {
    const params = url().searchParams;
    assert.equal(params.get("state"), "nonce-abc");
    assert.equal(
      params.get("redirect_uri"),
      "https://niteowlhq.com/api/integrations/google/callback"
    );
    assert.equal(params.get("response_type"), "code");
  });
});

describe("token exchange", () => {
  test("an authorisation code becomes credentials with an absolute expiry", async () => {
    const fetchImpl = fakeFetch({
      body: {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3599,
        scope: GOOGLE_REQUIRED_SCOPES.join(" "),
      },
    });
    const credentials = await google(fetchImpl).auth.exchangeCode(
      "code-abc",
      "https://niteowlhq.com/cb"
    );

    assert.equal(credentials.strategy, "oauth2");
    assert.equal(credentials.accessToken, "access-1");
    assert.equal(credentials.refreshToken, "refresh-1");
    // Converted from expires_in, so nothing downstream needs to know
    // when the response arrived.
    assert.ok(new Date(credentials.expiresAtIso).getTime() > Date.now());

    const call = fetchImpl.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, /oauth2\.googleapis\.com\/token/);
    assert.match(call.body, /grant_type=authorization_code/);
    assert.match(call.body, /code=code-abc/);
  });

  test("a refresh that omits the refresh token reports null, not a fabricated one", async () => {
    // Google does this. The connection layer keeps the stored token.
    const fetchImpl = fakeFetch({ body: { access_token: "access-2", expires_in: 3599 } });
    const credentials = await google(fetchImpl).auth.refresh(OAUTH);
    assert.equal(credentials.accessToken, "access-2");
    assert.equal(credentials.refreshToken, null);
    assert.match(fetchImpl.calls[0].body, /grant_type=refresh_token/);
  });

  test("a revoked refresh token is auth_expired, not a retryable fault", async () => {
    // invalid_grant means reconnect; retrying would loop forever.
    const fetchImpl = fakeFetch({ status: 400, body: { error: "invalid_grant" } });
    await assert.rejects(
      () => google(fetchImpl).auth.refresh(OAUTH),
      (err) => err instanceof IntegrationError && err.kind === "auth_expired"
    );
  });

  test("refreshing without a refresh token fails fast", async () => {
    await assert.rejects(
      () => google(fakeFetch({})).auth.refresh({ ...OAUTH, refreshToken: null }),
      (err) => err instanceof IntegrationError && err.kind === "auth_expired"
    );
  });

  test("a token response with no access token is a permanent failure", async () => {
    const fetchImpl = fakeFetch({ body: { expires_in: 3599 } });
    await assert.rejects(
      () => google(fetchImpl).auth.exchangeCode("c", "https://x/cb"),
      (err) => err instanceof IntegrationError && err.kind === "permanent"
    );
  });

  test("revoke never throws — disconnect must succeed locally regardless", async () => {
    const fetchImpl = fakeFetch({ status: 400, body: { error: "invalid_token" } });
    await google(fetchImpl).auth.revoke(OAUTH);
  });
});

describe("calendars", () => {
  test("only owner and writer calendars are writable", () => {
    assert.equal(toIntegrationResource({ id: "a", accessRole: "owner" }).writable, true);
    assert.equal(toIntegrationResource({ id: "a", accessRole: "writer" }).writable, true);
    // Readable calendars can still be consulted for conflicts, but Remy
    // must not try to create events on them.
    assert.equal(toIntegrationResource({ id: "a", accessRole: "reader" }).writable, false);
    assert.equal(
      toIntegrationResource({ id: "a", accessRole: "freeBusyReader" }).writable,
      false
    );
  });

  test("a calendar's display name falls back sensibly", () => {
    assert.equal(toIntegrationResource({ id: "x", summary: "Work" }).name, "Work");
    assert.equal(
      toIntegrationResource({ id: "x", summary: "Work", summaryOverride: "Mine" }).name,
      "Mine"
    );
    assert.equal(toIntegrationResource({ id: "x" }).name, "x");
  });

  test("deleted calendars are dropped from the list", async () => {
    const fetchImpl = fakeFetch({
      body: {
        items: [
          { id: "a", summary: "Work", accessRole: "owner", primary: true },
          { id: "b", summary: "Old", accessRole: "owner", deleted: true },
        ],
      },
    });
    const resources = await google(fetchImpl).listResources(OAUTH);
    assert.deepEqual(resources.map((r) => r.externalId), ["a"]);
    assert.equal(resources[0].isDefault, true);
    assert.equal(resources[0].resourceType, "calendar");
  });

  test("the access token is sent as a bearer header", async () => {
    const fetchImpl = fakeFetch({ body: { items: [] } });
    await google(fetchImpl).listResources(OAUTH);
    assert.equal(fetchImpl.calls[0].headers.authorization, "Bearer ya29.token");
  });
});

describe("free/busy", () => {
  test("busy windows are normalised to ISO instants", () => {
    const busy = parseFreeBusyResponse(
      {
        calendars: {
          "cal-1": {
            busy: [{ start: "2026-08-06T09:00:00Z", end: "2026-08-06T10:00:00+00:00" }],
          },
        },
      },
      "cal-1"
    );
    assert.deepEqual(busy, [
      { startIso: "2026-08-06T09:00:00.000Z", endIso: "2026-08-06T10:00:00.000Z" },
    ]);
  });

  test("an empty calendar yields no busy windows", () => {
    // The calendar ANSWERED and had nothing on it. Genuinely free.
    assert.deepEqual(parseFreeBusyResponse({ calendars: { "cal-1": { busy: [] } } }, "cal-1"), []);
  });

  // ── REGRESSION: no answer is not the same as "free" ──────────────
  //
  // This case used to be asserted as `[]`, filed under "an empty
  // calendar yields no busy windows" — conflating two different things:
  // the calendar answered and is free, versus the calendar never
  // answered at all. The second produced an empty busy list, which
  // reads downstream as "completely free" and books straight over
  // whatever is really there. It contradicted the very next test's
  // stated rule, and it is the one place the module failed OPEN.
  describe("REGRESSION — a calendar that did not answer is never 'free'", () => {
    test("the requested calendar missing from the response raises", () => {
      assert.throws(
        () => parseFreeBusyResponse({ calendars: {} }, "cal-1"),
        (err) =>
          err instanceof IntegrationError &&
          // NOT auth_expired: a healthy connection must not be parked
          // as needs_reauth because one response came back incomplete.
          err.kind === "transient"
      );
    });

    test("a response carrying only OTHER calendars raises", () => {
      // The subtle shape: Google answered, just not about us.
      assert.throws(
        () => parseFreeBusyResponse({ calendars: { "someone-else": { busy: [] } } }, "cal-1"),
        (err) => err instanceof IntegrationError && err.kind === "transient"
      );
    });

    test("a response with no calendars key at all raises", () => {
      assert.throws(
        () => parseFreeBusyResponse({}, "cal-1"),
        (err) => err instanceof IntegrationError && err.kind === "transient"
      );
      assert.throws(
        () => parseFreeBusyResponse(null, "cal-1"),
        (err) => err instanceof IntegrationError && err.kind === "transient"
      );
    });

    test("the error names the calendar, and carries no credential", () => {
      try {
        parseFreeBusyResponse({ calendars: {} }, "cal-1");
        assert.fail("must throw");
      } catch (err) {
        assert.match(err.message, /cal-1/);
        assert.doesNotMatch(err.message, /token|secret|Bearer|ya29/i);
      }
    });

    test("a genuinely free calendar is still free — the fix is not a blanket refusal", () => {
      assert.deepEqual(
        parseFreeBusyResponse({ calendars: { "cal-1": { busy: [] } } }, "cal-1"),
        [],
        "an answered, empty calendar must remain bookable"
      );
    });
  });

  test("a calendar we cannot read raises rather than looking free", () => {
    // The dangerous failure: treating an unreadable calendar as empty
    // would double-book a customer.
    assert.throws(
      () =>
        parseFreeBusyResponse(
          { calendars: { "cal-1": { errors: [{ reason: "notFound" }] } } },
          "cal-1"
        ),
      (err) => err instanceof IntegrationError && err.kind === "not_found"
    );
    assert.throws(
      () =>
        parseFreeBusyResponse(
          { calendars: { "cal-1": { errors: [{ reason: "forbidden" }] } } },
          "cal-1"
        ),
      (err) => err instanceof IntegrationError && err.kind === "forbidden"
    );
  });

  test("the whole window is fetched in ONE request", async () => {
    const fetchImpl = fakeFetch({ body: { calendars: { "cal-1": { busy: [] } } } });
    await google(fetchImpl).calendar.getBusyIntervals(
      OAUTH,
      "cal-1",
      "2026-08-06T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z"
    );
    assert.equal(fetchImpl.calls.length, 1);
    const body = JSON.parse(fetchImpl.calls[0].body);
    assert.equal(body.timeMin, "2026-08-06T00:00:00.000Z");
    assert.equal(body.timeMax, "2026-08-20T00:00:00.000Z");
    assert.deepEqual(body.items, [{ id: "cal-1" }]);
  });
});

describe("event payloads", () => {
  const INPUT = {
    title: "Boiler service — Brian Murphy",
    description: "Booked by Remy",
    location: "14 Mill Road, Galway",
    startIso: "2026-08-06T13:00:00.000Z",
    durationMinutes: 60,
    timezone: "Europe/London",
    idempotencyKey: "3f8a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8",
    attendeeEmail: "brian@example.com",
    attendeeName: "Brian Murphy",
  };

  test("times are local wall clock plus the IANA zone, never an offset", () => {
    // 13:00 UTC in August is 14:00 in London. Sending an offset would
    // silently break after a daylight-saving change.
    const body = buildGoogleEventBody(INPUT);
    assert.equal(body.start.dateTime, "2026-08-06T14:00:00");
    assert.equal(body.start.timeZone, "Europe/London");
    assert.equal(body.end.dateTime, "2026-08-06T15:00:00");
    assert.equal(body.end.timeZone, "Europe/London");
    assert.ok(!body.start.dateTime.endsWith("Z"));
  });

  test("a booking spanning a DST change keeps its real duration", () => {
    // 00:30 UTC + 60 min on 25 October: 01:30 local both times, because
    // the clocks go back in between. The instants are still an hour apart.
    const body = buildGoogleEventBody({
      ...INPUT,
      startIso: "2026-10-25T00:30:00.000Z",
      durationMinutes: 60,
    });
    assert.equal(body.start.dateTime, "2026-10-25T01:30:00");
    assert.equal(body.end.dateTime, "2026-10-25T01:30:00");
    assert.equal(body.start.timeZone, "Europe/London");
  });

  test("a business in another timezone gets its own local time", () => {
    const body = buildGoogleEventBody({ ...INPUT, timezone: "America/New_York" });
    assert.equal(body.start.dateTime, "2026-08-06T09:00:00");
    assert.equal(body.start.timeZone, "America/New_York");
  });

  test("optional fields are omitted rather than sent empty", () => {
    const body = buildGoogleEventBody({
      ...INPUT,
      description: null,
      location: null,
      attendeeEmail: null,
    });
    assert.equal("description" in body, false);
    assert.equal("location" in body, false);
    assert.equal("attendees" in body, false);
  });

  test("the attendee is included when known", () => {
    const body = buildGoogleEventBody(INPUT);
    assert.deepEqual(body.attendees, [
      { email: "brian@example.com", displayName: "Brian Murphy" },
    ]);
  });
});

describe("idempotent event ids", () => {
  test("a UUID becomes a legal base32hex id", () => {
    const id = toGoogleEventId("3f8a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8");
    // Google's alphabet is 0-9 and a-v only, minimum five characters.
    assert.match(id, /^[0-9a-v]+$/);
    assert.ok(id.length >= 5 && id.length <= 1024);
    assert.ok(id.startsWith("rem"));
  });

  test("the prefix itself is inside the allowed alphabet", () => {
    // "remy" would be illegal — y is past v — which would have made
    // every single create fail.
    assert.match(toGoogleEventId("abc123"), /^[0-9a-v]+$/);
  });

  test("it is deterministic, so a retry targets the same event", () => {
    const key = "3f8a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8";
    assert.equal(toGoogleEventId(key), toGoogleEventId(key));
  });

  test("different leads get different ids", () => {
    assert.notEqual(
      toGoogleEventId("3f8a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8"),
      toGoogleEventId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    );
  });

  test("characters outside the alphabet are stripped, not passed through", () => {
    assert.match(toGoogleEventId("WXYZ-9876"), /^[0-9a-v]+$/);
  });

  test("a key with nothing usable in it is refused", () => {
    assert.throws(() => toGoogleEventId("zzz"), IntegrationError);
  });
});

describe("event writes", () => {
  const INPUT = {
    title: "Boiler service",
    description: null,
    location: null,
    startIso: "2026-08-06T13:00:00.000Z",
    durationMinutes: 60,
    timezone: "Europe/London",
    idempotencyKey: "3f8a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8",
    attendeeEmail: null,
    attendeeName: null,
  };

  test("create sends the client-supplied id, which is what makes it idempotent", async () => {
    const fetchImpl = fakeFetch({ body: { id: "remxyz", etag: "\"tag1\"" } });
    const ref = await google(fetchImpl).calendar.createEvent(OAUTH, "cal-1", INPUT);
    assert.equal(ref.alreadyExisted, false);
    assert.equal(ref.etag, "\"tag1\"");
    const sent = JSON.parse(fetchImpl.calls[0].body);
    assert.equal(sent.id, toGoogleEventId(INPUT.idempotencyKey));
  });

  test("a 409 means the retry already succeeded — reported as success", async () => {
    // This is the duplicate-event guard doing its job. Treating 409 as a
    // failure would leave the queue retrying forever; treating it as a
    // fresh create would double-book.
    const fetchImpl = fakeFetch({ status: 409, body: { error: { message: "duplicate" } } });
    const ref = await google(fetchImpl).calendar.createEvent(OAUTH, "cal-1", INPUT);
    assert.equal(ref.alreadyExisted, true);
    assert.equal(ref.eventId, toGoogleEventId(INPUT.idempotencyKey));
  });

  test("cancelling an event that is already gone is a success", async () => {
    for (const status of [404, 410]) {
      const fetchImpl = fakeFetch({ status, body: { error: { message: "gone" } } });
      await google(fetchImpl).calendar.cancelEvent(OAUTH, "cal-1", "evt-1");
    }
  });

  test("a real failure on cancel still throws", async () => {
    const fetchImpl = fakeFetch({ status: 500, body: {} });
    await assert.rejects(
      () => google(fetchImpl).calendar.cancelEvent(OAUTH, "cal-1", "evt-1"),
      (err) => err instanceof IntegrationError && err.kind === "transient"
    );
  });

  test("the calendar id is URL-encoded", async () => {
    const fetchImpl = fakeFetch({ body: { id: "e", etag: null } });
    await google(fetchImpl).calendar.createEvent(OAUTH, "owner@example.com", INPUT);
    assert.match(fetchImpl.calls[0].url, /owner%40example\.com/);
  });
});

describe("error classification", () => {
  test("403 rate limiting is retryable; 403 permissions is not", async () => {
    // Google overloads 403 and only the reason code separates them.
    const rateLimited = fakeFetch({
      status: 403,
      body: { error: { errors: [{ reason: "rateLimitExceeded" }] } },
    });
    await assert.rejects(
      () => google(rateLimited).listResources(OAUTH),
      (err) => err.kind === "rate_limited"
    );

    const forbidden = fakeFetch({
      status: 403,
      body: { error: { errors: [{ reason: "insufficientPermissions" }] } },
    });
    await assert.rejects(
      () => google(forbidden).listResources(OAUTH),
      (err) => err.kind === "forbidden"
    );
  });

  test("401 asks for a reconnect", async () => {
    const fetchImpl = fakeFetch({ status: 401, body: {} });
    await assert.rejects(
      () => google(fetchImpl).listResources(OAUTH),
      (err) => err.kind === "auth_expired"
    );
  });

  test("a network failure is transient, so it is retried", async () => {
    const exploding = async () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(
      () => google(exploding).listResources(OAUTH),
      (err) => err instanceof IntegrationError && err.kind === "transient"
    );
  });

  test("Retry-After is captured for the queue to honour", async () => {
    const fetchImpl = fakeFetch({ status: 429, body: {}, headers: { "retry-after": "45" } });
    await assert.rejects(
      () => google(fetchImpl).listResources(OAUTH),
      (err) => err.kind === "rate_limited" && err.retryAfterSeconds === 45
    );
  });
});
