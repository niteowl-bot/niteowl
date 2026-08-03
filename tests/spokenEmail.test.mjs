// Spoken email addresses reaching the lead as usable addresses.
//
// A caller reads an address aloud — "michael ryan at hotmail dot com".
// The assistant and the transcript extractor are both told to convert
// it, but they are model instructions; this is the deterministic step
// that runs regardless, in toExtractedLead, alongside the equivalent
// one for phone numbers.
//
// The rule these pin: convert what can be converted, store nothing
// that cannot. leads.email is the address booking confirmations are
// sent to, so a spoken form saved there is a confirmation the customer
// never receives.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normaliseSpokenEmail } from "@/lib/voice/spokenEmail";

describe("normaliseSpokenEmail — spoken forms", () => {
  test("the reported case: 'michael ryan at hotmail dot com'", () => {
    assert.equal(
      normaliseSpokenEmail("michael ryan at hotmail dot com"),
      "michaelryan@hotmail.com"
    );
  });

  test("a dotted local part stays dotted", () => {
    assert.equal(
      normaliseSpokenEmail("john dot smith at gmail dot com"),
      "john.smith@gmail.com"
    );
  });

  test("multi-part domains survive", () => {
    assert.equal(
      normaliseSpokenEmail("mary at yahoo dot co dot uk"),
      "mary@yahoo.co.uk"
    );
  });

  test("underscore, dash and hyphen are spoken punctuation", () => {
    assert.equal(
      normaliseSpokenEmail("j underscore smith at outlook dot com"),
      "j_smith@outlook.com"
    );
    assert.equal(
      normaliseSpokenEmail("mary dash jane at outlook dot com"),
      "mary-jane@outlook.com"
    );
    assert.equal(
      normaliseSpokenEmail("mary hyphen jane at outlook dot com"),
      "mary-jane@outlook.com"
    );
  });

  test("'at sign' and 'point' are handled too", () => {
    assert.equal(
      normaliseSpokenEmail("sam at sign gmail point com"),
      "sam@gmail.com"
    );
  });

  test("a half-converted transcript still lands", () => {
    // Speech-to-text often gets the domain right and the rest wrong.
    assert.equal(
      normaliseSpokenEmail("michael ryan at hotmail.com"),
      "michaelryan@hotmail.com"
    );
  });

  test("case and surrounding whitespace are normalised", () => {
    assert.equal(
      normaliseSpokenEmail("  Michael Ryan AT Hotmail DOT com "),
      "michaelryan@hotmail.com"
    );
  });
});

describe("normaliseSpokenEmail — valid addresses pass through", () => {
  test("an already-valid address is returned unchanged", () => {
    assert.equal(
      normaliseSpokenEmail("michaelryan@hotmail.com"),
      "michaelryan@hotmail.com"
    );
    assert.equal(normaliseSpokenEmail("john.smith@gmail.co.uk"), "john.smith@gmail.co.uk");
    assert.equal(normaliseSpokenEmail("a+tag@example.com"), "a+tag@example.com");
  });

  test("a valid address is never run through the spoken-word pass", () => {
    // The danger case: real addresses containing the LETTERS of spoken
    // punctuation. These must survive untouched.
    assert.equal(normaliseSpokenEmail("pat@gmail.com"), "pat@gmail.com");
    assert.equal(normaliseSpokenEmail("dorothy.dotson@gmail.com"), "dorothy.dotson@gmail.com");
    assert.equal(normaliseSpokenEmail("matt@atlas.com"), "matt@atlas.com");
  });

  test("spoken words around a real name keep the name intact", () => {
    // "pat" must not lose its "at" when the rest still needs converting.
    assert.equal(normaliseSpokenEmail("pat at gmail dot com"), "pat@gmail.com");
    assert.equal(
      normaliseSpokenEmail("dorothy at hotmail dot com"),
      "dorothy@hotmail.com"
    );
  });
});

describe("normaliseSpokenEmail — unusable input is dropped", () => {
  test("an address with no domain is null, not a guess", () => {
    assert.equal(normaliseSpokenEmail("michael ryan at"), null);
    assert.equal(normaliseSpokenEmail("michael ryan at hotmail"), null);
  });

  test("plain speech that is not an address at all is null", () => {
    assert.equal(normaliseSpokenEmail("I'd rather not give one"), null);
    assert.equal(normaliseSpokenEmail("no email"), null);
  });

  test("empty and missing values are null", () => {
    assert.equal(normaliseSpokenEmail(""), null);
    assert.equal(normaliseSpokenEmail("   "), null);
    assert.equal(normaliseSpokenEmail(null), null);
    assert.equal(normaliseSpokenEmail(undefined), null);
  });

  test("nothing invalid is ever returned", () => {
    for (const input of [
      "michael ryan at hotmail dot",
      "at dot com",
      "just some words entirely",
    ]) {
      const result = normaliseSpokenEmail(input);
      assert.equal(result, null, `${input} should be dropped, got ${result}`);
    }
  });
});
