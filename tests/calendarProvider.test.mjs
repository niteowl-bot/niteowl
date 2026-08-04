// Tests for the provider abstraction: the registry seam and the
// error taxonomy the sync queue makes retry decisions from.
//
// The point of these is that the booking engine can be written against
// a provider it has never heard of. The fake below implements the full
// CalendarProvider surface and is registered under a made-up id — if a
// future provider needs anything beyond this interface, this test is
// where that shows up first.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  registerCalendarProvider,
  unregisterCalendarProvider,
  getCalendarProvider,
  tryGetCalendarProvider,
  listCalendarProviders,
  isRegisteredProvider,
  resetCalendarProviders,
  UnknownCalendarProviderError,
} from "@/lib/calendar/registry";

import {
  CalendarProviderError,
  classifyHttpStatus,
  isRetryable,
  requiresReauth,
  syncStatusForError,
  isCalendarProviderError,
  asProviderError,
} from "@/lib/calendar/errors";

/** A complete provider for a protocol that does not exist. */
function fakeProvider(id = "fakecal", label = "Fake Calendar") {
  return {
    id,
    label,
    buildAuthUrl: ({ redirectUri, state }) =>
      `https://fake.test/auth?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
    exchangeCode: async () => ({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAtIso: "2026-08-04T12:00:00.000Z",
      scopes: "calendar",
    }),
    refreshAccessToken: async () => ({
      accessToken: "access-2",
      refreshToken: null,
      expiresAtIso: "2026-08-04T13:00:00.000Z",
      scopes: "calendar",
    }),
    revokeAccess: async () => {},
    getAccount: async () => ({
      accountId: "acct-1",
      email: "owner@example.com",
      displayName: "Owner",
    }),
    listCalendars: async () => [
      { id: "cal-1", name: "Work", writable: true, isDefault: true, timezone: "Europe/Dublin" },
    ],
    getBusyIntervals: async () => [
      { startIso: "2026-08-06T09:00:00.000Z", endIso: "2026-08-06T10:00:00.000Z" },
    ],
    createEvent: async () => ({ eventId: "evt-1", etag: "tag-1", alreadyExisted: false }),
    updateEvent: async () => ({ eventId: "evt-1", etag: "tag-2", alreadyExisted: false }),
    cancelEvent: async () => {},
  };
}

describe("provider registry", () => {
  beforeEach(() => resetCalendarProviders());

  test("a provider the engine has never heard of can be registered and used", async () => {
    registerCalendarProvider(fakeProvider());

    const provider = getCalendarProvider("fakecal");
    assert.equal(provider.label, "Fake Calendar");

    // The whole contract is reachable through the interface alone.
    const account = await provider.getAccount("token");
    assert.equal(account.email, "owner@example.com");
    const calendars = await provider.listCalendars("token");
    assert.equal(calendars[0].id, "cal-1");
    const busy = await provider.getBusyIntervals("token", "cal-1", "a", "b");
    assert.equal(busy.length, 1);
    const created = await provider.createEvent("token", "cal-1", {});
    assert.equal(created.eventId, "evt-1");
  });

  test("an unregistered id throws, naming what is available", () => {
    registerCalendarProvider(fakeProvider());
    assert.throws(() => getCalendarProvider("apple"), UnknownCalendarProviderError);
    try {
      getCalendarProvider("apple");
    } catch (err) {
      assert.match(err.message, /Unknown calendar provider "apple"/);
      assert.match(err.message, /fakecal/);
      assert.equal(err.providerId, "apple");
    }
  });

  test("tryGet returns null instead of throwing", () => {
    assert.equal(tryGetCalendarProvider("nope"), null);
  });

  test("registering the same id twice replaces it", () => {
    registerCalendarProvider(fakeProvider("dup", "First"));
    registerCalendarProvider(fakeProvider("dup", "Second"));
    assert.equal(getCalendarProvider("dup").label, "Second");
    assert.equal(listCalendarProviders().length, 1);
  });

  test("providers list in a stable order", () => {
    registerCalendarProvider(fakeProvider("microsoft", "Outlook"));
    registerCalendarProvider(fakeProvider("google", "Google"));
    registerCalendarProvider(fakeProvider("apple", "Apple"));
    assert.deepEqual(
      listCalendarProviders().map((p) => p.id),
      ["apple", "google", "microsoft"]
    );
  });

  test("unregistering removes it", () => {
    registerCalendarProvider(fakeProvider("temp"));
    assert.equal(isRegisteredProvider("temp"), true);
    assert.equal(unregisterCalendarProvider("temp"), true);
    assert.equal(isRegisteredProvider("temp"), false);
    assert.equal(unregisterCalendarProvider("temp"), false);
  });

  test("a provider without an id is rejected", () => {
    assert.throws(() => registerCalendarProvider({}), /must declare an id/);
  });
});

describe("error classification", () => {
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

  test("only an expired token asks the owner to reconnect", () => {
    assert.equal(requiresReauth("auth_expired"), true);
    assert.equal(requiresReauth("forbidden"), false);
    assert.equal(requiresReauth("transient"), false);
  });

  test("a vanished event is recorded as deleted, not failed", () => {
    assert.equal(syncStatusForError("not_found"), "deleted");
    assert.equal(syncStatusForError("transient"), "failed");
    assert.equal(syncStatusForError("auth_expired"), "failed");
  });

  test("provider errors carry diagnostics without leaking them downstream", () => {
    const err = new CalendarProviderError("token revoked", {
      kind: "auth_expired",
      provider: "google",
      httpStatus: 401,
      providerCode: "invalid_grant",
      retryAfterSeconds: 30,
    });
    assert.equal(isCalendarProviderError(err), true);
    assert.equal(err.kind, "auth_expired");
    assert.equal(err.provider, "google");
    assert.equal(err.httpStatus, 401);
    assert.equal(err.providerCode, "invalid_grant");
    assert.equal(err.retryAfterSeconds, 30);
    assert.ok(err instanceof Error);
  });

  test("optional diagnostics default to null rather than undefined", () => {
    const err = new CalendarProviderError("boom", { kind: "transient" });
    assert.equal(err.provider, null);
    assert.equal(err.httpStatus, null);
    assert.equal(err.providerCode, null);
    assert.equal(err.retryAfterSeconds, null);
  });

  test("an unexpected throw becomes a retryable provider error", () => {
    const wrapped = asProviderError(new TypeError("fetch failed"), "google");
    assert.equal(wrapped.kind, "transient");
    assert.equal(wrapped.provider, "google");
    assert.match(wrapped.message, /google request failed: fetch failed/);
    assert.equal(isRetryable(wrapped.kind), true);
  });

  test("an already-classified error passes through untouched", () => {
    const original = new CalendarProviderError("nope", { kind: "auth_expired" });
    assert.equal(asProviderError(original, "google"), original);
  });

  test("non-Error throws are still wrapped", () => {
    const wrapped = asProviderError("string failure", "microsoft");
    assert.equal(wrapped.kind, "transient");
    assert.match(wrapped.message, /string failure/);
  });
});
