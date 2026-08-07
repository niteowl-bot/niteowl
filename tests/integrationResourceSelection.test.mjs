// Choosing a Google Calendar in Settings must actually save.
//
// The bug (production, 2026-08-07): selecting a calendar showed "Could
// not save your selection." and reset the dropdown. setPrimaryResource
// upserted with onConflict "connection_id,resource_type,external_id",
// but uniqueness for org-level resources is a PARTIAL index
// (… WHERE staff_id IS NULL). Postgres only matches ON CONFLICT to a
// partial index when the statement repeats the predicate, and
// PostgREST's `onConflict` cannot express one — so every attempt was
// rejected at planning time with 42P10 and nothing was ever written.
//
// Reproduced against the real database before the fix:
//   ERROR: 42P10: there is no unique or exclusion constraint
//          matching the ON CONFLICT specification
//
// These drive the REAL setPrimaryResource with the PostgREST HTTP layer
// stubbed, so the assertions are about the requests that actually reach
// the database — in particular that no upsert is attempted.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import — see the file
import { setPrimaryResource } from "@/lib/integrations/connections";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const ROW_ID = "00000000-0000-4000-8000-0000000000ff";

const CALENDAR = {
  externalId: "admin@niteowlhq.com",
  name: "NiteOwl Admin",
  resourceType: "calendar",
  writable: true,
  isDefault: true,
  metadata: {},
};

/**
 * Stubs PostgREST and records every request.
 *
 * `existingRow` models whether the chosen calendar has already been
 * selected before — the update branch versus the insert branch.
 * `insertStatus` lets a test simulate the concurrent-insert race.
 */
function installStubs({ existingRow = null, insertStatus = 201 } = {}) {
  const realFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    requests.push({
      url,
      method,
      prefer: headers.get("prefer") ?? "",
      body: init.body ? JSON.parse(init.body) : null,
    });

    const json = (body, status = 200) =>
      new Response(body === null ? "null" : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (!url.includes("/rest/v1/integration_resources")) {
      throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
    }

    if (method === "GET") return json(existingRow);
    if (method === "PATCH") return json([]);
    if (method === "POST") {
      if (insertStatus === 409) {
        return json(
          {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "integration_resources_org_level_idx"',
            details: null,
            hint: null,
          },
          409
        );
      }
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected method ${method}`);
  };

  return {
    requests,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

const writes = (reqs) => reqs.filter((r) => r.method === "PATCH" || r.method === "POST");

let stubs;
afterEach(() => stubs?.restore());

describe("selecting a calendar saves it", () => {
  test("a calendar never selected before is INSERTed", async () => {
    stubs = installStubs({ existingRow: null });
    await setPrimaryResource(ORG_ID, CONNECTION_ID, CALENDAR);

    const insert = stubs.requests.find((r) => r.method === "POST");
    assert.ok(insert, "expected an INSERT for a first-time selection");
    assert.equal(insert.body.org_id, ORG_ID);
    assert.equal(insert.body.connection_id, CONNECTION_ID);
    assert.equal(insert.body.external_id, CALENDAR.externalId);
    assert.equal(insert.body.is_primary, true);
    assert.equal(insert.body.availability_enabled, true);
  });

  test("re-selecting an already-stored calendar UPDATEs it, never inserts", async () => {
    stubs = installStubs({ existingRow: { id: ROW_ID } });
    await setPrimaryResource(ORG_ID, CONNECTION_ID, CALENDAR);

    assert.equal(
      stubs.requests.filter((r) => r.method === "POST").length,
      0,
      "an existing row must not be inserted a second time"
    );
    const update = stubs.requests.filter((r) => r.method === "PATCH").at(-1);
    assert.match(update.url, /id=eq\./, "the update should target the found row");
    assert.equal(update.body.is_primary, true);
  });

  test("the previous primary is cleared first", async () => {
    stubs = installStubs({ existingRow: null });
    await setPrimaryResource(ORG_ID, CONNECTION_ID, CALENDAR);

    const clear = writes(stubs.requests)[0];
    assert.equal(clear.method, "PATCH");
    assert.equal(clear.body.is_primary, false, "the old primary must be unset first");
    assert.match(clear.url, /staff_id=is\.null/, "org-level rows only");
    assert.match(clear.url, /resource_type=eq\.calendar/);
  });

  test("the lookup matches the partial index's own key", async () => {
    stubs = installStubs({ existingRow: null });
    await setPrimaryResource(ORG_ID, CONNECTION_ID, CALENDAR);

    const lookup = stubs.requests.find((r) => r.method === "GET");
    assert.ok(lookup, "expected a lookup before writing");
    for (const fragment of [
      /connection_id=eq\./,
      /resource_type=eq\.calendar/,
      /external_id=eq\./,
      /staff_id=is\.null/,
    ]) {
      assert.match(lookup.url, fragment);
    }
  });
});

describe("the 42P10 regression", () => {
  test("no request may attempt an upsert", async () => {
    // The two things PostgREST's upsert() sends, and the two things
    // Postgres rejected against a partial index.
    for (const existingRow of [null, { id: ROW_ID }]) {
      stubs = installStubs({ existingRow });
      await setPrimaryResource(ORG_ID, CONNECTION_ID, CALENDAR);

      for (const req of stubs.requests) {
        assert.doesNotMatch(
          req.url,
          /on_conflict=/,
          `on_conflict must never be sent (${req.method} ${req.url})`
        );
        assert.doesNotMatch(
          req.prefer,
          /merge-duplicates/,
          `upsert Prefer header must never be sent (${req.method})`
        );
      }
      stubs.restore();
    }
  });
});

describe("failure handling", () => {
  test("a concurrent insert is adopted rather than shown as an error", async () => {
    // Select-then-insert is not atomic the way the upsert was: another
    // selection can win the race. The partial index rejects the second
    // insert with 23505, which must resolve to an update, not a failure.
    stubs = installStubs({ existingRow: null, insertStatus: 409 });
    await setPrimaryResource(ORG_ID, CONNECTION_ID, CALENDAR);

    const retry = stubs.requests.filter((r) => r.method === "PATCH").at(-1);
    assert.match(retry.url, /external_id=eq\./, "retry should match the partial key");
    assert.match(retry.url, /staff_id=is\.null/);
    assert.equal(retry.body.is_primary, true);
  });

  test("a genuine database error still fails loudly", async () => {
    stubs = installStubs({ existingRow: null });
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "POST") {
        return new Response(
          JSON.stringify({ code: "42501", message: "permission denied", details: null, hint: null }),
          { status: 403, headers: { "content-type": "application/json" } }
        );
      }
      return inner(input, init);
    };

    await assert.rejects(
      () => setPrimaryResource(ORG_ID, CONNECTION_ID, CALENDAR),
      /Failed to select resource: permission denied/
    );
  });
});
