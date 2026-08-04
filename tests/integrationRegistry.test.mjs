// Tests for the Integration Framework's registry and error taxonomy.
//
// The claim being tested is the whole point of the framework: a domain
// caller can obtain and use a CAPABILITY without knowing, or being able
// to discover, which vendor implements it. Both fakes below are for
// services that do not exist — one a calendar over OAuth, one an SMS
// sender authenticated with an API key — and neither required a change
// to anything outside its own object.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  registerIntegration,
  unregisterIntegration,
  getIntegration,
  tryGetIntegration,
  listIntegrations,
  listIntegrationsWithCapability,
  isRegisteredIntegration,
  supportsCapability,
  getCalendarCapability,
  resetIntegrations,
  UnknownIntegrationError,
  CapabilityNotSupportedError,
} from "@/lib/integrations/registry";

import {
  IntegrationError,
  classifyHttpStatus,
  isRetryable,
  requiresReauth,
  syncStatusForError,
  isIntegrationError,
  asProviderError,
} from "@/lib/integrations/errors";

/** A calendar integration for a protocol that does not exist. */
function fakeCalendarIntegration(id = "fakecal") {
  return {
    manifest: {
      id,
      label: "Fake Calendar",
      description: "A calendar that does not exist.",
      capabilities: ["calendar"],
      resourceType: "calendar",
      resourceLabel: "Calendar",
    },
    auth: {
      id: "oauth2",
      buildAuthUrl: ({ redirectUri, state }) =>
        `https://fake.test/auth?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
      exchangeCode: async () => ({
        strategy: "oauth2",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAtIso: "2026-08-04T12:00:00.000Z",
        scopes: "calendar",
      }),
      refresh: async () => ({
        strategy: "oauth2",
        accessToken: "access-2",
        refreshToken: null,
        expiresAtIso: "2026-08-04T13:00:00.000Z",
        scopes: "calendar",
      }),
      revoke: async () => {},
    },
    getAccount: async () => ({
      accountId: "acct-1",
      email: "owner@example.com",
      displayName: "Owner",
    }),
    listResources: async () => [
      {
        externalId: "cal-1",
        name: "Work",
        resourceType: "calendar",
        writable: true,
        isDefault: true,
        metadata: { timezone: "Europe/Dublin" },
      },
    ],
    calendar: {
      getBusyIntervals: async () => [
        { startIso: "2026-08-06T09:00:00.000Z", endIso: "2026-08-06T10:00:00.000Z" },
      ],
      createEvent: async () => ({ eventId: "evt-1", etag: "tag-1", alreadyExisted: false }),
      updateEvent: async () => ({ eventId: "evt-1", etag: "tag-2", alreadyExisted: false }),
      cancelEvent: async () => {},
    },
  };
}

/**
 * An SMS integration: no calendar, and authenticated with an API key
 * pair rather than OAuth. Its existence is what proves the framework is
 * not an OAuth-and-calendars framework wearing a general name.
 */
function fakeSmsIntegration(id = "fakesms") {
  return {
    manifest: {
      id,
      label: "Fake SMS",
      description: "An SMS sender that does not exist.",
      capabilities: [],
      resourceType: "phone_number",
      resourceLabel: "Sending number",
    },
    auth: {
      id: "api_key",
      fields: [
        { key: "accountSid", label: "Account SID", secret: false, required: true },
        { key: "authToken", label: "Auth token", secret: true, required: true },
      ],
      validate: async (values) => ({ strategy: "api_key", values }),
    },
    getAccount: async () => ({
      accountId: "AC123",
      email: null,
      displayName: "Fake SMS account",
    }),
    listResources: async () => [
      {
        externalId: "+353861234567",
        name: "Main line",
        resourceType: "phone_number",
        writable: true,
        isDefault: true,
        metadata: { country: "IE" },
      },
    ],
  };
}

describe("integration registry", () => {
  beforeEach(() => resetIntegrations());

  test("a capability can be used without knowing which vendor answered", async () => {
    registerIntegration(fakeCalendarIntegration());

    // This is the booking engine's entire view of the framework.
    const calendar = getCalendarCapability("fakecal");

    const busy = await calendar.getBusyIntervals({ strategy: "none" }, "cal-1", "a", "b");
    assert.equal(busy.length, 1);
    const created = await calendar.createEvent({ strategy: "none" }, "cal-1", {});
    assert.equal(created.eventId, "evt-1");

    // Nothing about the vendor is reachable from the capability itself.
    assert.equal(calendar.manifest, undefined);
    assert.equal(calendar.auth, undefined);
  });

  test("a non-OAuth integration with no calendar registers just as well", async () => {
    registerIntegration(fakeSmsIntegration());

    const sms = getIntegration("fakesms");
    assert.equal(sms.auth.id, "api_key");
    assert.equal(sms.manifest.resourceType, "phone_number");

    // API-key credentials come from validated fields, not a redirect.
    const credentials = await sms.auth.validate({ accountSid: "AC1", authToken: "t" });
    assert.deepEqual(credentials, {
      strategy: "api_key",
      values: { accountSid: "AC1", authToken: "t" },
    });

    const resources = await sms.listResources(credentials);
    assert.equal(resources[0].resourceType, "phone_number");
  });

  test("asking a non-calendar integration for a calendar is a typed failure", () => {
    registerIntegration(fakeSmsIntegration());
    assert.throws(
      () => getCalendarCapability("fakesms"),
      CapabilityNotSupportedError
    );
    assert.equal(supportsCapability("fakesms", "calendar"), false);
  });

  test("capabilities can be listed, so Settings renders itself", () => {
    registerIntegration(fakeCalendarIntegration("google"));
    registerIntegration(fakeCalendarIntegration("microsoft"));
    registerIntegration(fakeSmsIntegration("twilio"));

    assert.deepEqual(
      listIntegrationsWithCapability("calendar").map((i) => i.manifest.id),
      ["google", "microsoft"]
    );
    assert.equal(listIntegrations().length, 3);
  });

  test("a manifest that claims a capability it lacks is rejected at registration", () => {
    // Otherwise this fails much later, inside a job, against a real
    // customer's calendar.
    const liar = fakeSmsIntegration("liar");
    liar.manifest.capabilities = ["calendar"];
    assert.throws(() => registerIntegration(liar), /does not implement it/);
  });

  test("an unregistered id throws, naming what is available", () => {
    registerIntegration(fakeCalendarIntegration());
    assert.throws(() => getIntegration("apple"), UnknownIntegrationError);
    try {
      getIntegration("apple");
    } catch (err) {
      assert.match(err.message, /Unknown integration "apple"/);
      assert.match(err.message, /fakecal/);
      assert.equal(err.integrationId, "apple");
    }
  });

  test("tryGet returns null instead of throwing", () => {
    assert.equal(tryGetIntegration("nope"), null);
  });

  test("registering the same id twice replaces it", () => {
    const first = fakeCalendarIntegration("dup");
    const second = fakeCalendarIntegration("dup");
    second.manifest.label = "Second";
    registerIntegration(first);
    registerIntegration(second);
    assert.equal(getIntegration("dup").manifest.label, "Second");
    assert.equal(listIntegrations().length, 1);
  });

  test("integrations list in a stable order", () => {
    registerIntegration(fakeCalendarIntegration("microsoft"));
    registerIntegration(fakeCalendarIntegration("google"));
    registerIntegration(fakeCalendarIntegration("apple"));
    assert.deepEqual(
      listIntegrations().map((i) => i.manifest.id),
      ["apple", "google", "microsoft"]
    );
  });

  test("unregistering removes it", () => {
    registerIntegration(fakeCalendarIntegration("temp"));
    assert.equal(isRegisteredIntegration("temp"), true);
    assert.equal(unregisterIntegration("temp"), true);
    assert.equal(isRegisteredIntegration("temp"), false);
    assert.equal(unregisterIntegration("temp"), false);
  });

  test("an integration without a manifest id or auth strategy is rejected", () => {
    assert.throws(() => registerIntegration({}), /must declare a manifest id/);
    assert.throws(
      () => registerIntegration({ manifest: { id: "x", capabilities: [] } }),
      /must declare an auth strategy/
    );
  });
});

describe("error taxonomy", () => {
  test("HTTP statuses map to provider-independent kinds", () => {
    assert.equal(classifyHttpStatus(401), "auth_expired");
    assert.equal(classifyHttpStatus(403), "forbidden");
    assert.equal(classifyHttpStatus(404), "not_found");
    assert.equal(classifyHttpStatus(409), "conflict");
    assert.equal(classifyHttpStatus(410), "not_found");
    assert.equal(classifyHttpStatus(429), "rate_limited");
    assert.equal(classifyHttpStatus(500), "transient");
    assert.equal(classifyHttpStatus(503), "transient");
    assert.equal(classifyHttpStatus(400), "permanent");
    assert.equal(classifyHttpStatus(422), "permanent");
  });

  test("only rate limits and transient faults are retried", () => {
    assert.equal(isRetryable("rate_limited"), true);
    assert.equal(isRetryable("transient"), true);
    assert.equal(isRetryable("auth_expired"), false);
    assert.equal(isRetryable("forbidden"), false);
    assert.equal(isRetryable("permanent"), false);
    assert.equal(isRetryable("not_found"), false);
    // A create that conflicted already landed — retrying would duplicate it.
    assert.equal(isRetryable("conflict"), false);
  });

  test("only an expired credential asks the owner to reconnect", () => {
    assert.equal(requiresReauth("auth_expired"), true);
    assert.equal(requiresReauth("forbidden"), false);
    assert.equal(requiresReauth("transient"), false);
  });

  test("a vanished remote object is recorded as deleted, not failed", () => {
    assert.equal(syncStatusForError("not_found"), "deleted");
    assert.equal(syncStatusForError("transient"), "failed");
    assert.equal(syncStatusForError("auth_expired"), "failed");
  });

  test("errors carry diagnostics without leaking them downstream", () => {
    const err = new IntegrationError("token revoked", {
      kind: "auth_expired",
      provider: "google",
      httpStatus: 401,
      providerCode: "invalid_grant",
      retryAfterSeconds: 30,
    });
    assert.equal(isIntegrationError(err), true);
    assert.equal(err.kind, "auth_expired");
    assert.equal(err.provider, "google");
    assert.equal(err.providerCode, "invalid_grant");
    assert.equal(err.retryAfterSeconds, 30);
    assert.ok(err instanceof Error);
  });

  test("optional diagnostics default to null rather than undefined", () => {
    const err = new IntegrationError("boom", { kind: "transient" });
    assert.equal(err.provider, null);
    assert.equal(err.httpStatus, null);
    assert.equal(err.providerCode, null);
    assert.equal(err.retryAfterSeconds, null);
  });

  test("an unexpected throw becomes a retryable integration error", () => {
    const wrapped = asProviderError(new TypeError("fetch failed"), "google");
    assert.equal(wrapped.kind, "transient");
    assert.equal(wrapped.provider, "google");
    assert.equal(isRetryable(wrapped.kind), true);
  });

  test("an already-classified error passes through untouched", () => {
    const original = new IntegrationError("nope", { kind: "auth_expired" });
    assert.equal(asProviderError(original, "google"), original);
  });
});
