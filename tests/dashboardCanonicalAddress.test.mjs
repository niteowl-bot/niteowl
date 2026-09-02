// Regression: the canonical service address was invisible in the
// dashboard.
//
// recordLeadCallDetails writes the RESOLVED address
// (voice/addressIntegrity.ts) to leads.metadata.service_address. It
// reaches the engineer's calendar event and the owner's call-summary
// email. The leads drawer reads caller_id, alternate_phone and
// callback_urgency out of that same JSONB column — and never read
// service_address. So the CRM the owner actually dispatches from, and
// the only surface that persists once the email is buried, did not show
// the address the rest of the system had agreed on.
//
// It also explains a loose end already on the record: the Finding B
// write-up lists "whether leads.metadata.service_address also holds
// 81 Oakland Drive" as NOT verified. The deeper reason it stayed
// unverified is that no surface in the product would have shown it.
//
// The rule under test, in one line:
//   the dashboard DISPLAYS the stored canonical address and does
//   nothing else to it — no recompute, no repair, no fallback.
//
// These render the REAL drawer component through react-dom/server, not
// a copy of its logic. .tsx support in the Node test runner is new (see
// tests/register.mjs); before it, no test in this repository could
// assert on what a dashboard surface actually puts on screen.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditPanel } from "@/app/(dashboard)/leads/LeadsTable";

/** A lead as the drawer receives it. Overrides go on top. */
const lead = (over = {}) => ({
  id: "lead-1",
  name: "Ernesto",
  phone: "+353861234567",
  email: "ernesto@gmail.com",
  service_needed: "Leaking radiator",
  preferred_datetime: null,
  appointment_datetime: null,
  message: "Caller has a leaking radiator.",
  source: "voice",
  status: "new",
  ai_confidence: 0.75,
  notes: null,
  metadata: null,
  created_at: "2026-09-02T15:00:00.000Z",
  ...over,
});

function render(over = {}) {
  return renderToStaticMarkup(
    createElement(EditPanel, {
      lead: lead(over),
      timezone: "Europe/London",
      onClose: () => {},
      onUpdate: () => {},
    })
  );
}

/**
 * The value shown against one label in the drawer's contact grid.
 *
 * Scoped to the labelled pair rather than searching the whole document,
 * for the same reason the owner-email tests scope to a row: the drawer
 * also renders the free-text enquiry summary, which legitimately
 * repeats the address in prose. Finding it there would not prove the
 * canonical field is displayed.
 */
function contactValue(html, label) {
  const m = html.match(
    new RegExp(`>${label}</span><span[^>]*>([^<]*)</span>`)
  );
  return m ? m[1] : null;
}

describe("the leads drawer shows the canonical service address", () => {
  // ── A + B. the stored value is displayed ────────────────────────

  test("A. metadata.service_address is rendered in the drawer", () => {
    const html = render({ metadata: { service_address: "81 Oakland Drive" } });
    assert.equal(contactValue(html, "Service address"), "81 Oakland Drive");
  });

  test("B. an ordinary valid address displays exactly as stored", () => {
    for (const address of [
      "81 Oakland Drive",
      "12 Meadow Court, Galway",
      "3 The Old Mill, Church Street, Cork",
    ]) {
      const html = render({ metadata: { service_address: address } });
      assert.equal(
        contactValue(html, "Service address"),
        address,
        `displayed unchanged: ${address}`
      );
    }
  });

  // ── C. no second validation layer in the UI ─────────────────────

  test("C. alphanumeric, flat, unit and named-property forms are untouched", () => {
    // The UI must not decide what an address may look like. Address
    // integrity already made that decision upstream, once, on the value
    // that was stored — a second opinion here could only disagree with
    // it. Every one of these is a real Irish/UK address shape, and a
    // naive "a house number is digits" rule in the UI would break the
    // last three.
    for (const address of [
      "Apt 4B, Oakland Court",
      "Flat 12, 81 Oakland Drive",
      "Unit 3A Blackrock Business Park",
      "Rose Cottage, Oakland Drive",
      "The Old Rectory, Kinvara",
      "81A Oakland Drive",
    ]) {
      const html = render({ metadata: { service_address: address } });
      assert.equal(
        contactValue(html, "Service address"),
        address,
        `displayed unchanged: ${address}`
      );
    }
  });

  test("C2. the drawer displays a stored value it would not have chosen", () => {
    // The strongest statement of "display only": even the transcription
    // noise that motivated addressIntegrity.ts renders as-is IF it is
    // what is stored. The UI is not the place that judgement is made,
    // and adding it here would create the second fact-source this whole
    // change exists to remove.
    const html = render({ metadata: { service_address: "A c 1 Oakland Drive" } });
    assert.equal(contactValue(html, "Service address"), "A c 1 Oakland Drive");
  });

  // ── D. absence is absence ───────────────────────────────────────

  test("D. a missing service_address displays no row and no fallback", () => {
    for (const metadata of [
      null,
      {},
      { caller_id: "+353861234567" },
      { service_address: null },
      { service_address: "" },
      { service_address: "   " },
      { service_address: 81 }, // not a string — metadataString refuses it
    ]) {
      const html = render({ metadata });
      assert.equal(
        contactValue(html, "Service address"),
        null,
        `no row for metadata: ${JSON.stringify(metadata)}`
      );
      assert.ok(
        !/Service address/.test(html),
        "the label itself is absent — not an empty or dashed row"
      );
    }
  });

  test("D2. address integrity failing closed does not resurrect the message text", () => {
    // The enquiry summary in `message` mentions an address. With no
    // canonical value stored, the drawer must not reach for it.
    const html = render({
      metadata: { caller_id: "+353861234567" },
      message: "Caller has a leaking radiator at A c 1 Oakland Drive.",
    });
    assert.equal(contactValue(html, "Service address"), null);
    assert.ok(
      !/Service address/.test(html),
      "no canonical row is manufactured from free text"
    );
  });

  // ── E. the neighbouring metadata rows are unchanged ─────────────

  test("E. caller_id, alternate_phone and callback_urgency still render", () => {
    const html = render({
      metadata: {
        caller_id: "+353861234567",
        alternate_phone: "+35317654321",
        callback_urgency: "Urgent — no specific day or time given",
        service_address: "81 Oakland Drive",
      },
    });

    // caller_id is not printed as its own value: it relabels the phone
    // row from "Phone" to "Caller ID". Assert the behaviour, not a row.
    assert.ok(/Caller ID/.test(html), "caller_id still relabels the phone row");
    assert.ok(!/>Phone</.test(html), "and the chat-lead label is not used");
    assert.equal(contactValue(html, "Caller ID"), "+353861234567");
    assert.equal(contactValue(html, "Alternate number"), "+35317654321");
    assert.equal(contactValue(html, "Service address"), "81 Oakland Drive");
    assert.equal(contactValue(html, "Email"), "ernesto@gmail.com");
    assert.ok(
      /Callback urgency: Urgent — no specific day or time given/.test(html),
      "PR #35's read-only urgency note still renders"
    );
  });

  test("E2. a chat lead with no metadata renders exactly as before", () => {
    const html = render({ source: "chat", metadata: null });
    assert.ok(/>Phone</.test(html), "the Phone label is unchanged for chat leads");
    assert.ok(!/Service address/.test(html));
    assert.ok(!/Alternate number/.test(html));
    assert.ok(!/Callback urgency/.test(html));
    assert.equal(contactValue(html, "Email"), "ernesto@gmail.com");
  });

  test("E3. the urgency note stays OUTSIDE the appointment input", () => {
    // Pins PR #35's rule while this file is editing the same component:
    // the urgency is not a time and must never become saveable into
    // preferred_datetime.
    const html = render({
      metadata: { callback_urgency: "Urgent — no specific day or time given" },
    });
    const noteIndex = html.indexOf("Callback urgency:");
    assert.ok(noteIndex > -1, "the note renders");
    assert.ok(
      !/value="[^"]*Urgent[^"]*"/.test(html),
      "and it is never the value of an input"
    );
  });
});
