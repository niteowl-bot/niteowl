"use client";

// ── Business Opportunity Scan, Phase B: the contact card (BC-3) ─────
//
// The OPTIONAL way to ask NiteOwl to get in touch, shown beneath a
// complete Scan report (docs/ARCHITECTURE.md §26.1). The report above
// it is finished, printable and unconditional whether this card is
// used or ignored; the card sits in the screen-only action area and
// never prints.
//
// IT TAKES NO PROPS, AND THAT IS THE ARCHITECTURE. §26's rule is that
// no free-tool output travels with a contact and none is ever joined
// to one. A card that is handed nothing cannot be prefilled from an
// answer and cannot forward a finding, a report or a version stamp.
// Its only import beyond React is the BC-1 contract, which itself
// imports nothing.
//
// WHAT IS SENT IS `validation.contact` AND NOTHING ELSE — the five
// fields the visitor typed, after validateScanContact has judged them.
// Never the raw form state: under BC-1 a blank optional string is
// malformed, and only an empty box counts as "not supplied".
//
// ONE SUBMIT, ONE REQUEST. No retry, no storage, no cookie, no query
// string, no identifier. Start again / Back to answers unmount the card
// and whatever was typed goes with it.

import { useEffect, useRef, useState } from "react";
import {
  SCAN_CONTACT_LIMITS,
  validateScanContact,
} from "@/lib/freetools/scanContact";
import type {
  ScanContact,
  ScanContactErrorCode,
  ScanContactField,
  ScanContactValidationError,
} from "@/lib/freetools/scanContact";

/** The BC-2 intake. The literal path, never built from input. */
export const SCAN_CONTACT_ENDPOINT = "/api/free-tools/scan-contact";

export const SCAN_CONTACT_WORDING = {
  heading: "Want to talk it through?",
  body: "Optional. If you'd like someone from NiteOwl to get in touch about this, leave your details. Your report stays exactly as it is either way — we receive only what you type below, not your answers or your report.",
  submit: "Send my details",
  submitting: "Sending…",
  success_email: "Thanks — we've got your details and will reply by email.",
  success_phone: "Thanks — we've got your details and will reply by phone.",
  rate_limited: "Too many attempts from this connection — please try again later.",
  failed: "We couldn't send your details — please try again in a little while.",
} as const;

/** Visitor wording for every BC-1 refusal code. Exhaustive by type. */
export const SCAN_CONTACT_ERROR_LABELS: Record<ScanContactErrorCode, string> = {
  not_an_object: "Something went wrong reading the form. Please try again.",
  unexpected_field: "Something went wrong reading the form. Please try again.",
  required: "Please enter your name.",
  malformed: "Please fill this in, or leave it empty.",
  too_short: "This is too short.",
  too_long: "This is too long.",
  invalid_email: "That doesn't look like an email address.",
  invalid_phone: "That doesn't look like a phone number.",
  looks_like_contact_detail:
    "This looks like an email address or phone number — please put your name here.",
  contact_method_required: "Choose email or phone, and fill it in.",
  contact_method_conflict: "Choose either email or phone, not both.",
};

/** The visitor-facing sentence for one refusal, with the limit where there is one. */
export function scanContactErrorMessage(error: ScanContactValidationError): string {
  const base = SCAN_CONTACT_ERROR_LABELS[error.code];
  if (error.field === null) return base;
  const limits = SCAN_CONTACT_LIMITS[error.field] as { min?: number; max?: number };
  if (error.code === "too_short" && limits.min !== undefined) {
    return `${base} Use at least ${limits.min} characters.`;
  }
  if (error.code === "too_long" && limits.max !== undefined) {
    return `${base} Use at most ${limits.max} characters.`;
  }
  return base;
}

export type ScanContactMethod = "email" | "phone";

export interface ScanContactForm {
  name: string;
  method: ScanContactMethod | null;
  email: string;
  phone: string;
  business_name: string;
  message: string;
}

/** A blank form. Nothing prefilled, no method chosen. */
export const blankScanContactForm = (): ScanContactForm => ({
  name: "",
  method: null,
  email: "",
  phone: "",
  business_name: "",
  message: "",
});

/**
 * The form as the validator's input. An EMPTY box is "not supplied";
 * anything else — whitespace included — goes through as typed for
 * BC-1 to judge. Only the chosen contact method's box is included, so
 * a number typed and then abandoned for email is never sent.
 */
export function scanContactInput(form: ScanContactForm): Record<string, string> {
  const input: Record<string, string> = {};
  if (form.name !== "") input.name = form.name;
  if (form.method === "email" && form.email !== "") input.email = form.email;
  if (form.method === "phone" && form.phone !== "") input.phone = form.phone;
  if (form.business_name !== "") input.business_name = form.business_name;
  if (form.message !== "") input.message = form.message;
  return input;
}

export type ScanContactOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "invalid"; readonly errors: readonly ScanContactValidationError[] }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "failed" };

/**
 * What a response means for the visitor. Only 201 is success; a 400
 * carries BC-1 errors; 429 is its own sentence; everything else —
 * 413, 500, a body that is not what BC-2 sends — is the generic
 * failure, with no server detail shown.
 */
export function scanContactOutcome(status: number, body: unknown): ScanContactOutcome {
  if (status === 201) return { kind: "sent" };
  if (status === 429) return { kind: "rate_limited" };
  if (
    status === 400 &&
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { errors?: unknown }).errors) &&
    (body as { errors: unknown[] }).errors.length > 0
  ) {
    const errors = (body as { errors: unknown[] }).errors.filter(
      (e): e is ScanContactValidationError =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as { code?: unknown }).code === "string" &&
        (e as { code: string }).code in SCAN_CONTACT_ERROR_LABELS
    );
    if (errors.length > 0) return { kind: "invalid", errors };
  }
  return { kind: "failed" };
}

/**
 * The one request. Takes a VALIDATED contact — the type can only come
 * from validateScanContact — and sends exactly that. Never retries.
 */
export async function submitScanContact(contact: ScanContact): Promise<ScanContactOutcome> {
  try {
    const res = await fetch(SCAN_CONTACT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contact),
    });
    // 429 and 413 are plain text; only a 400 body is ever read.
    let body: unknown = null;
    if (res.status === 400) {
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    }
    return scanContactOutcome(res.status, body);
  } catch {
    return { kind: "failed" };
  }
}

// The Scan surface's own control styles, so the card reads as part of it.
const inputClass =
  "w-full rounded-lg bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-[15px] text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent";
const optionClass =
  "flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3.5 py-3 text-[15px] text-slate-200 cursor-pointer hover:border-slate-700";
const errorClass = "text-[13px] text-rose-300 mt-2";
const labelClass = "block text-slate-200 text-[15px] font-medium mb-1.5";

export default function ScanContactCard() {
  const [form, setForm] = useState<ScanContactForm>(blankScanContactForm);
  const [errors, setErrors] = useState<readonly ScanContactValidationError[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentBy, setSentBy] = useState<ScanContactMethod | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (sentBy !== null) statusRef.current?.focus();
  }, [sentBy]);

  function update(patch: Partial<ScanContactForm>) {
    const next = { ...form, ...patch };
    setForm(next);
    // After a refused submit, errors follow the visitor's edits.
    if (attempted) setErrors(validateScanContact(scanContactInput(next)).errors);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setAttempted(true);
    setNotice(null);
    const validation = validateScanContact(scanContactInput(form));
    if (!validation.valid || validation.contact === null) {
      setErrors(validation.errors);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    const outcome = await submitScanContact(validation.contact);
    setSubmitting(false);
    if (outcome.kind === "sent") {
      setSentBy(validation.contact.email !== null ? "email" : "phone");
    } else if (outcome.kind === "invalid") {
      setErrors(outcome.errors);
    } else if (outcome.kind === "rate_limited") {
      setNotice(SCAN_CONTACT_WORDING.rate_limited);
    } else {
      setNotice(SCAN_CONTACT_WORDING.failed);
    }
  }

  const errorFor = (field: ScanContactField) => errors.find((e) => e.field === field);
  const methodError = errors.find(
    (e) => e.code === "contact_method_required" || e.code === "contact_method_conflict"
  );
  const formError = errors.find(
    (e) => e.field === null && e.code !== "contact_method_required" && e.code !== "contact_method_conflict"
  );

  if (sentBy !== null) {
    return (
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 mb-6" data-scan-contact>
        <h2 className="text-white font-semibold text-lg mb-2">{SCAN_CONTACT_WORDING.heading}</h2>
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          className="text-slate-200 text-[15px] leading-relaxed focus:outline-none"
          data-scan-contact-sent={sentBy}
        >
          {sentBy === "email" ? SCAN_CONTACT_WORDING.success_email : SCAN_CONTACT_WORDING.success_phone}
        </p>
      </section>
    );
  }

  /** One text field with its label and its error, wired for assistive tech. */
  const field = (
    id: ScanContactField,
    label: string,
    control: (props: {
      id: string;
      "aria-invalid": boolean;
      "aria-describedby": string | undefined;
    }) => React.ReactNode
  ) => {
    const error = errorFor(id);
    const inputId = `scan-contact-${id}`;
    const errorId = `${inputId}-error`;
    return (
      <div>
        <label htmlFor={inputId} className={labelClass}>
          {label}
        </label>
        {control({
          id: inputId,
          "aria-invalid": Boolean(error),
          "aria-describedby": error ? errorId : undefined,
        })}
        {error && (
          <p id={errorId} className={errorClass} role="alert" data-scan-contact-error={error.code}>
            {scanContactErrorMessage(error)}
          </p>
        )}
      </div>
    );
  };

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 mb-6" data-scan-contact>
      <h2 className="text-white font-semibold text-lg mb-2">{SCAN_CONTACT_WORDING.heading}</h2>
      <p className="text-slate-400 text-[15px] leading-relaxed mb-5">{SCAN_CONTACT_WORDING.body}</p>

      <form onSubmit={onSubmit} noValidate aria-busy={submitting} className="space-y-5">
        {field("name", "Name", (p) => (
          <input
            {...p}
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            className={inputClass}
          />
        ))}

        <fieldset>
          <legend id="scan-contact-method-legend" className={labelClass}>
            How should we reach you?
          </legend>
          <div
            role="radiogroup"
            aria-labelledby="scan-contact-method-legend"
            aria-invalid={Boolean(methodError)}
            aria-describedby={methodError ? "scan-contact-method-error" : undefined}
            className="space-y-2"
          >
            {(["email", "phone"] as const).map((m) => (
              <label key={m} className={optionClass}>
                <input
                  type="radio"
                  name="scan-contact-method"
                  className="mt-1"
                  checked={form.method === m}
                  onChange={() => update({ method: m })}
                />
                <span>{m === "email" ? "Email" : "Phone"}</span>
              </label>
            ))}
          </div>
          {methodError && (
            <p
              id="scan-contact-method-error"
              className={errorClass}
              role="alert"
              data-scan-contact-error={methodError.code}
            >
              {scanContactErrorMessage(methodError)}
            </p>
          )}
        </fieldset>

        {form.method === "email" &&
          field("email", "Email address", (p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => update({ email: e.target.value })}
              className={inputClass}
            />
          ))}

        {form.method === "phone" &&
          field("phone", "Phone number", (p) => (
            <input
              {...p}
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => update({ phone: e.target.value })}
              className={inputClass}
            />
          ))}

        {field("business_name", "Business name (optional)", (p) => (
          <input
            {...p}
            type="text"
            autoComplete="organization"
            value={form.business_name}
            onChange={(e) => update({ business_name: e.target.value })}
            className={inputClass}
          />
        ))}

        {field("message", "Message (optional)", (p) => (
          <textarea
            {...p}
            rows={4}
            value={form.message}
            onChange={(e) => update({ message: e.target.value })}
            className={inputClass}
          />
        ))}

        {formError && (
          <p className={errorClass} role="alert" data-scan-contact-error={formError.code}>
            {scanContactErrorMessage(formError)}
          </p>
        )}
        {notice && (
          <p className={errorClass} role="alert" data-scan-contact-notice>
            {notice}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 transition-colors"
          >
            {submitting ? SCAN_CONTACT_WORDING.submitting : SCAN_CONTACT_WORDING.submit}
          </button>
        </div>
      </form>
    </section>
  );
}
