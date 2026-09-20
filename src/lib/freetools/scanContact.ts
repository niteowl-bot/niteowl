// ── Business Opportunity Scan, Phase B: the contact contract (BC-1) ──
//
// The field list, validation and refusal codes for the OPTIONAL contact
// card that Phase B will show beneath a complete Scan report
// (docs/ARCHITECTURE.md §26.1). This module is BC-1 and nothing more:
// no surface, no route, no network, no storage, no schema, and NO
// IMPORT OF ANY KIND — not even a sibling Scan module.
//
// THAT LAST POINT IS THE ARCHITECTURE. §26's rule is that no free-tool
// output ever travels with a contact and none is ever joined to one. A
// contact validator that cannot name a Scan answer, finding,
// recommendation, estimate, condition, version stamp, run, session or
// visitor cannot accidentally carry one. So the module is a leaf, the
// field list is closed, and an unknown key is REFUSED rather than
// ignored — "ignored" is how a smuggled `answers` object would reach a
// request body with nothing having said no.
//
// A CONTACT IS A FUNNEL RECORD, NOT ASSESSMENT DATA (§26). Nothing here
// mentions a tenant, and the validated shape has exactly five fields
// with no metadata slot for anything else to be attached to later.
//
// IT NEVER REPAIRS AND IT NEVER COERCES — the same discipline as
// `validateScanAnswers`. A value is trimmed of surrounding whitespace
// (and internal runs of horizontal whitespace collapsed) and then
// judged as it stands. Nothing is truncated to fit a limit, no stray
// character is removed to make an address valid, no digits are pulled
// out of a phone number, no number is stringified, and the email keeps
// the visitor's own casing. A wrong value refused is a form error the
// visitor can see; a wrong value repaired is a lead nobody can reach.
//
// THERE IS NO PREFILL. This module exports no default, no initial
// state and no factory — deliberately, so a later surface has nothing
// it could seed from a Scan answer. A blank form starts blank.
//
// THE SAME VALIDATOR SERVES BOTH SIDES. It is pure and free of React,
// the network and any request object, so the card can run it as the
// visitor types and the intake route can run the identical rules on
// what arrives.

/** The five fields, and no more. Closed: an unknown key is refused. */
export const SCAN_CONTACT_FIELDS = [
  "name",
  "email",
  "phone",
  "business_name",
  "message",
] as const;

export type ScanContactField = (typeof SCAN_CONTACT_FIELDS)[number];

/**
 * Length limits, applied AFTER whitespace normalisation and never used
 * to truncate. The DB columns behind them are unbounded `text`, so
 * these are the only bounds that exist.
 *
 * `phone.min_digits` is the floor on digits after the non-digits are
 * set aside for counting only — the stored value keeps its spaces and
 * punctuation. It exists because the character-class pattern alone
 * would pass a run of dashes.
 */
export const SCAN_CONTACT_LIMITS = {
  name: { min: 2, max: 100 },
  email: { max: 254 },
  phone: { max: 30, min_digits: 7 },
  business_name: { min: 2, max: 150 },
  message: { min: 1, max: 2000 },
} as const;

/** Why a value was refused. Codes, not prose (§20.7 rule 1). */
export type ScanContactErrorCode =
  | "not_an_object"
  | "unexpected_field"
  | "required"
  | "malformed"
  | "too_short"
  | "too_long"
  | "invalid_email"
  | "invalid_phone"
  | "looks_like_contact_detail"
  | "contact_method_required"
  | "contact_method_conflict";

/** One refusal, tied to the field it came from. */
export interface ScanContactValidationError {
  /** null only for whole-payload problems: not an object, or a key that is not a field. */
  readonly field: ScanContactField | null;
  readonly code: ScanContactErrorCode;
  readonly message: string;
}

/**
 * A validated contact. Exactly one of `email` / `phone` is a string and
 * the other is null — the visitor's choice, expressed in the type so a
 * consumer cannot be handed both or neither.
 */
export type ScanContact =
  | {
      readonly name: string;
      readonly email: string;
      readonly phone: null;
      readonly business_name: string | null;
      readonly message: string | null;
    }
  | {
      readonly name: string;
      readonly email: null;
      readonly phone: string;
      readonly business_name: string | null;
      readonly message: string | null;
    };

export interface ScanContactValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ScanContactValidationError[];
  /** The validated contact, or null when anything was refused. */
  readonly contact: ScanContact | null;
}

// The same shapes the existing sales-lead path accepts
// (src/lib/salesLeadCapture.ts), re-declared here rather than imported:
// that module reaches the database and the mailer, and this one may
// import nothing.
const EMAIL_PATTERN = /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i;
const PHONE_PATTERN = /^[\d\s\-()+]{7,}$/;

const err = (
  field: ScanContactField | null,
  code: ScanContactErrorCode,
  message: string
): ScanContactValidationError => ({ field, code, message });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Absent means "not supplied". A blank string is malformed, not absent. */
const isAbsent = (v: unknown): boolean => v === undefined || v === null;

/**
 * Whitespace normalisation — the only transformation this module makes.
 *
 * Surrounding whitespace is removed. Inside, runs of horizontal
 * whitespace collapse to one space. Line breaks are kept only where
 * `multiline` is true (the message), and are normalised to `\n` so a
 * Windows and a Unix visitor produce the same stored text; elsewhere a
 * line break is treated as horizontal whitespace, because a name or a
 * phone number has no second line.
 */
function normaliseWhitespace(value: string, multiline: boolean): string {
  if (!multiline) {
    return value.replace(/\s+/g, " ").trim();
  }
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .trim();
}

/**
 * Read one string field: must be a string, and must not be blank after
 * normalisation. Returns the normalised value or null with an error
 * recorded. Length is judged by the caller, because the optional fields
 * and the required ones share this step but not their bounds.
 */
function readText(
  field: ScanContactField,
  raw: unknown,
  multiline: boolean,
  errors: ScanContactValidationError[]
): string | null {
  if (typeof raw !== "string") {
    errors.push(err(field, "malformed", `${field}: expected text`));
    return null;
  }
  const value = normaliseWhitespace(raw, multiline);
  if (value.length === 0) {
    errors.push(err(field, "malformed", `${field}: must not be blank`));
    return null;
  }
  return value;
}

/** Length bounds. Refused, never truncated. */
function withinLength(
  field: ScanContactField,
  value: string,
  min: number,
  max: number,
  errors: ScanContactValidationError[]
): boolean {
  if (value.length < min) {
    errors.push(err(field, "too_short", `${field}: at least ${min} characters`));
    return false;
  }
  if (value.length > max) {
    errors.push(err(field, "too_long", `${field}: at most ${max} characters`));
    return false;
  }
  return true;
}

/**
 * Validate one contact payload against the five-field contract.
 *
 * Accepts `unknown` deliberately: the caller is a form or a request
 * body, and a validator that requires its input to already be the right
 * shape validates nothing.
 */
export function validateScanContact(input: unknown): ScanContactValidationResult {
  const errors: ScanContactValidationError[] = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: [err(null, "not_an_object", "expected a contact object")],
      contact: null,
    };
  }

  // The contract is EXACTLY five fields. Anything else is refused, not
  // dropped: this is where a Scan answer, report, version stamp or
  // identifier would otherwise ride along unnoticed.
  for (const key of Object.keys(input)) {
    if (!(SCAN_CONTACT_FIELDS as readonly string[]).includes(key)) {
      errors.push(err(null, "unexpected_field", `"${key}" is not a contact field`));
    }
  }

  // ── name — required ────────────────────────────────────────────
  let name: string | null = null;
  if (isAbsent(input.name)) {
    errors.push(err("name", "required", "name: a name is required"));
  } else {
    const value = readText("name", input.name, false, errors);
    if (
      value !== null &&
      withinLength("name", value, SCAN_CONTACT_LIMITS.name.min, SCAN_CONTACT_LIMITS.name.max, errors)
    ) {
      if (EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value)) {
        // An address or a number typed into the name box is not moved
        // to the field it belongs in — that would be the module
        // deciding what the visitor meant.
        errors.push(
          err("name", "looks_like_contact_detail", "name: this looks like an email address or phone number")
        );
      } else {
        name = value;
      }
    }
  }

  // ── email — one of the two contact methods ─────────────────────
  let email: string | null = null;
  const emailSupplied = !isAbsent(input.email);
  if (emailSupplied) {
    const value = readText("email", input.email, false, errors);
    if (value !== null && withinLength("email", value, 1, SCAN_CONTACT_LIMITS.email.max, errors)) {
      if (!EMAIL_PATTERN.test(value)) {
        errors.push(err("email", "invalid_email", "email: not a valid email address"));
      } else {
        // Casing is the visitor's. Nothing here lower-cases it.
        email = value;
      }
    }
  }

  // ── phone — the other contact method ───────────────────────────
  let phone: string | null = null;
  const phoneSupplied = !isAbsent(input.phone);
  if (phoneSupplied) {
    const value = readText("phone", input.phone, false, errors);
    if (value !== null && withinLength("phone", value, 1, SCAN_CONTACT_LIMITS.phone.max, errors)) {
      const digits = value.replace(/\D/g, "").length;
      if (!PHONE_PATTERN.test(value) || digits < SCAN_CONTACT_LIMITS.phone.min_digits) {
        errors.push(err("phone", "invalid_phone", "phone: not a valid phone number"));
      } else {
        // Stored as typed. No country code is assumed and no format is
        // imposed — a reformatted number is a transformed one.
        phone = value;
      }
    }
  }

  // ── exactly one contact method, the visitor's choice ───────────
  // Judged on what was SUPPLIED, not on what validated, so a visitor
  // who filled both boxes is told about the conflict even when one of
  // them is also malformed, and a visitor who filled neither is told
  // that rather than shown two "invalid" errors.
  if (emailSupplied && phoneSupplied) {
    errors.push(
      err(null, "contact_method_conflict", "choose either an email address or a phone number, not both")
    );
  } else if (!emailSupplied && !phoneSupplied) {
    errors.push(
      err(null, "contact_method_required", "an email address or a phone number is required")
    );
  }

  // ── business_name — optional ───────────────────────────────────
  let business_name: string | null = null;
  if (!isAbsent(input.business_name)) {
    const value = readText("business_name", input.business_name, false, errors);
    if (
      value !== null &&
      withinLength(
        "business_name",
        value,
        SCAN_CONTACT_LIMITS.business_name.min,
        SCAN_CONTACT_LIMITS.business_name.max,
        errors
      )
    ) {
      business_name = value;
    }
  }

  // ── message — optional, multi-line ─────────────────────────────
  let message: string | null = null;
  if (!isAbsent(input.message)) {
    const value = readText("message", input.message, true, errors);
    if (
      value !== null &&
      withinLength("message", value, SCAN_CONTACT_LIMITS.message.min, SCAN_CONTACT_LIMITS.message.max, errors)
    ) {
      message = value;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, contact: null };
  }

  // Every branch above that leaves an error has returned; from here
  // `name` is a string and exactly one of `email` / `phone` is.
  const contact: ScanContact =
    email !== null
      ? { name: name as string, email, phone: null, business_name, message }
      : { name: name as string, email: null, phone: phone as string, business_name, message };

  return { valid: true, errors: [], contact };
}
