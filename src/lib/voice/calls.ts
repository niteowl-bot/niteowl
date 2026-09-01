import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACTIONABLE_INTENTS,
  capturePartialLead,
  getOrgOwnerEmail,
  isServiceConfirmedByKnowledge,
  type ExtractedLead,
  type LeadIntent,
} from "@/lib/leadCapture";
import {
  ownerBookingStatus,
  sendCallSummaryEmail,
  type OwnerBookingStatus,
} from "@/lib/email";
import { isVoiceCalendarBookingEnabled } from "@/lib/integrations/flags";
import { extractVoiceLeadFromTranscript } from "@/lib/voice/extraction";
import { isSameNumber, normaliseSpokenNumber } from "@/lib/voice/callerId";
import { normaliseSpokenEmail } from "@/lib/voice/spokenEmail";
import { resolveCallerName } from "@/lib/voice/nameIntegrity";
import { resolveServiceAddress } from "@/lib/voice/addressIntegrity";
import {
  resolveCallbackUrgency,
  sanitisePreferredDatetime,
} from "@/lib/voice/callbackTiming";
import type {
  VoiceCallEndedEvent,
  VoiceExtractedDetails,
  VoiceStatusEvent,
} from "@/lib/voice/types";

// ── Voice call processing engine ───────────────────────────────────
// Consumes internal VoiceEvents (never provider payloads) and drives
// the EXISTING platform engines: capturePartialLead for leads and
// bookings (which itself runs availability, capacity, double-booking
// checks, and confirmation emails — voice adds no second booking
// system) and sendCallSummaryEmail for owner notifications.
//
// All queries use the service-role client and scope by org_id in
// application code — the same trust model as the public widget route.

type AdminClient = ReturnType<typeof createAdminClient>;

// ── Raw event storage (durability + idempotency) ──────────────────

/**
 * Stores the raw provider payload BEFORE any processing, so a
 * processing failure never loses a call: the row keeps processed_at
 * NULL (plus processing_error) and can be replayed. A provider retry
 * of the same event hits the (provider, dedupe_key) unique constraint
 * and reports duplicate so the caller can ack without reprocessing.
 */
export async function storeVoiceEvent(
  admin: AdminClient,
  event: VoiceCallEndedEvent | VoiceStatusEvent,
  orgId: string | null,
  rawPayload: unknown
): Promise<{ id: string | null; duplicate: boolean }> {
  const { data, error } = await admin
    .from("voice_events")
    .insert({
      provider: event.provider,
      dedupe_key: event.dedupeKey,
      event_type: event.kind,
      provider_call_id: event.providerCallId,
      org_id: orgId,
      payload: rawPayload,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation on (provider, dedupe_key): the event
    // was already delivered and stored — a retry, not a failure.
    if (error.code === "23505") {
      console.log("[voice] duplicate event skipped:", event.dedupeKey);
      return { id: null, duplicate: true };
    }
    console.error("[voice] failed to store event:", error.message);
    return { id: null, duplicate: false };
  }

  return { id: data.id, duplicate: false };
}

export interface MarkProcessedOptions {
  /**
   * Only write the outcome if this claim is still the one on the row.
   *
   * For the replay worker, which can be beaten to the finish by the
   * original webhook or by another worker that reclaimed a stale claim.
   * Without it a late-waking worker overwrites an outcome it no longer
   * owns — and on its FAILURE path that writes processed_at back to
   * NULL, resurrecting an event somebody else already completed.
   *
   * Omitted by the webhook, which has no claim and is the first actor:
   * with no id supplied the update is exactly what it has always run.
   */
  onlyIfClaimedAt?: string;
}

/**
 * Records the outcome of processing an event.
 *
 * Returns whether the write actually applied — false means another
 * actor owns this event now, which is information the replay worker
 * acts on and the webhook ignores.
 */
export async function markVoiceEventProcessed(
  admin: AdminClient,
  eventRowId: string,
  processingError: string | null = null,
  options: MarkProcessedOptions = {}
): Promise<boolean> {
  let query = admin
    .from("voice_events")
    .update({
      processed_at: processingError ? null : new Date().toISOString(),
      processing_error: processingError,
    })
    .eq("id", eventRowId);

  if (options.onlyIfClaimedAt) {
    query = query.eq("processing_started_at", options.onlyIfClaimedAt);

    // A FAILURE must never un-process a completed event. Success has no
    // such guard: setting processed_at is the point, and doing it twice
    // is harmless.
    if (processingError) {
      query = query.is("processed_at", null);
    }
  }

  const { data, error } = await query.select("id");

  if (error) {
    console.error("[voice] failed to mark event processed:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

// ── Tenant resolution ──────────────────────────────────────────────

/**
 * Resolves which org a call belongs to by the E.164 number that was
 * dialled — THE voice tenant key. Deliberately does not require
 * enabled=true: answering new calls is gated at assistant-request
 * time, but events that trail in after an org is disabled mid-call
 * must still be recorded against it.
 */
export async function resolveVoiceOrgId(
  admin: AdminClient,
  businessPhone: string | null
): Promise<string | null> {
  if (!businessPhone) return null;

  const { data, error } = await admin
    .from("voice_settings")
    .select("org_id")
    .eq("phone_number", businessPhone)
    .maybeSingle();

  if (error) {
    console.error("[voice] org lookup failed:", error.message);
    return null;
  }
  return data?.org_id ?? null;
}

// ── Conversation linking ───────────────────────────────────────────
// Mirrors the widget route's conversation handling: leads.conversation_id
// has an FK to conversations, so the call must own a real conversations
// row before the lead can reference it. Vapi call ids are UUIDs; an id
// that exists but belongs to another org is discarded rather than linked.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensureVoiceConversation(
  admin: AdminClient,
  orgId: string,
  providerCallId: string,
  callerPhone: string | null
): Promise<string | null> {
  if (!UUID_PATTERN.test(providerCallId)) return null;

  try {
    const { data: existing } = await admin
      .from("conversations")
      .select("id, org_id")
      .eq("id", providerCallId)
      .maybeSingle();

    if (existing) {
      return existing.org_id === orgId ? providerCallId : null;
    }

    const title = `Phone: ${callerPhone ?? "unknown caller"}`;
    const { error: insertError } = await admin
      .from("conversations")
      .insert({ id: providerCallId, org_id: orgId, title });

    if (insertError) {
      console.error("[voice] conversation insert failed:", insertError.message);
      return null;
    }
    return providerCallId;
  } catch (err) {
    console.error("[voice] conversation linking error:", err);
    return null;
  }
}

// ── Lead mapping ───────────────────────────────────────────────────

const VALID_INTENTS: LeadIntent[] = [
  "new_booking",
  "reschedule",
  "contact_update",
  "question",
  "unknown",
];

/**
 * Maps the call's structured extraction onto the existing
 * ExtractedLead shape.
 *
 * Caller ID WINS the phone field. It is the one contact detail a call
 * supplies that no transcription step can mangle and no caller can
 * misstate; a number spoken during the call is transcribed speech and
 * may be a different line entirely. This used to be
 * `details.phone ?? callerPhone`, which let a spoken number replace
 * the real caller ID on the lead — the spoken number is now kept
 * separately (see resolveAlternatePhone). The spoken number is still
 * used when caller ID is withheld, which is exactly when the assistant
 * is told to ask for one.
 *
 * Confidence is a fixed banding (no numeric score exists for voice
 * extraction): actionable intents sit in the extractor's "details
 * incomplete" band, everything else low.
 */
function toExtractedLead(
  details: VoiceExtractedDetails | null,
  callerPhone: string | null,
  /**
   * The call transcript, read ONLY as evidence of what the caller
   * actually said — their name (nameIntegrity.ts) and their address
   * (addressIntegrity.ts). Nothing else is taken from it here, and it
   * is optional so every existing caller behaves exactly as before.
   */
  transcript: string | null = null
): ExtractedLead | null {
  if (!details) return null;

  const intent: LeadIntent = VALID_INTENTS.includes(details.intent as LeadIntent)
    ? (details.intent as LeadIntent)
    : "unknown";

  // Normalised first: the name guard below compares against the address
  // that will actually be stored, not the spoken wording.
  const email = normaliseSpokenEmail(details.email);

  return {
    intent,
    // An email must never manufacture a caller name. Extraction can
    // fabricate a plausible person from an email's local part when no
    // name was clearly given — the 2026-08-31 "Ernie Sephora" call. A
    // name the caller actually spoke outranks the model's candidate;
    // absent any spoken support, a candidate that looks built from the
    // address is dropped so the owner sees the caller's phone number
    // rather than someone who does not exist. See nameIntegrity.ts.
    name: resolveCallerName(details.name, email, transcript),
    // Spoken aloud, so the same treatment the phone field gets: convert
    // "michael ryan at hotmail dot com", and store nothing at all rather
    // than a spoken form that would bounce a confirmation email.
    email,
    // Caller ID first, exactly as before. The spoken number only ever
    // reaches this field when caller ID is withheld — and then only if
    // it survives normalisation, because an unusable number here would
    // become the lead's primary phone and its merge key.
    phone: callerPhone ?? normaliseSpokenNumber(details.phone),
    service: details.service,
    // "As soon as possible" is urgency, not a time (see callbackTiming.ts).
    // It must never become the lead's preferred_datetime: it is not a
    // slot anyone can be booked into and it is not a time anyone can be
    // rung at. The phrase itself is kept on the lead's metadata by
    // recordLeadCallDetails. From there it reaches the owner in the
    // call-summary email and the lead drawer as "Callback urgency" —
    // never in a field that means WHEN.
    preferred_datetime: sanitisePreferredDatetime(details.preferred_datetime)
      .preferredDatetime,
    // Speech-to-text mangles a house number into letter noise — the
    // 2026-09-01 "A c 1 Oakland Drive" call. Resolved HERE, at the one
    // convergence point, so the calendar event and the lead's stored
    // copy read the same decision instead of the raw model value twice.
    // Constrain-only: it may refuse a value or prefer the caller's own
    // later wording, never rewrite one. See addressIntegrity.ts.
    service_address: resolveServiceAddress(details.service_address, transcript),
    confidence: ACTIONABLE_INTENTS.includes(intent) ? 0.75 : 0.4,
  };
}

/**
 * The spoken number, when the caller genuinely gave a DIFFERENT one to
 * be reached on ("try the office line instead"). Returns null when
 * they spoke their own number back, when they spoke none, or when
 * there is no caller ID to be an alternative to — in that last case the
 * spoken number is already the lead's primary phone.
 *
 * A spoken number that cannot plausibly be a phone number is dropped
 * rather than recorded: half a number in the owner's inbox is worse
 * than none, because it looks dialable. The assistant is told to ask
 * the caller to repeat an unclear number (rule 5), so this only fires
 * when that still produced nothing usable.
 */
function resolveAlternatePhone(
  details: VoiceExtractedDetails | null,
  callerPhone: string | null
): string | null {
  const raw = details?.phone?.trim();
  const spoken = normaliseSpokenNumber(raw);
  if (!spoken) {
    if (raw) {
      // Digit count only — the number itself stays out of the logs.
      console.warn(
        "[voice] spoken callback number discarded as implausible; digits heard:",
        raw.replace(/\D/g, "").length
      );
    }
    return null;
  }
  if (!callerPhone) return null;
  return isSameNumber(spoken, callerPhone) ? null : spoken;
}

/**
 * Records call-derived detail on the lead that has no column of its
 * own: which number the call actually came from, any different number
 * the caller asked to be reached on, the on-site service address
 * (ExtractedLead carries no address field, and the shared lead schema
 * is deliberately left alone), and the caller's urgency when that was
 * all they gave in place of a time. Written to the existing
 * leads.metadata JSONB (the same column the needs-review notification
 * flag uses) — read-merged so it can never clobber a flag another
 * writer set. Voice-only and non-fatal: a failure here must not fail
 * the call's processing.
 */
async function recordLeadCallDetails(
  admin: AdminClient,
  leadId: string,
  callerPhone: string | null,
  alternatePhone: string | null,
  serviceAddress: string | null,
  callbackUrgency: string | null = null,
  /**
   * True when this call was an APPOINTMENT request, as opposed to a
   * callback, a question or a general enquiry. Only such a lead may
   * hold appointment capacity, and only once the shared engine actually
   * resolved a time — the marker is written below solely when the row
   * came back with an appointment_datetime, so a request whose time
   * never parsed can never block a slot.
   */
  isAppointmentRequest = false
): Promise<void> {
  if (
    !callerPhone &&
    !alternatePhone &&
    !serviceAddress &&
    !callbackUrgency &&
    !isAppointmentRequest
  ) {
    return;
  }

  try {
    const { data } = await admin
      .from("leads")
      .select("metadata, appointment_datetime")
      .eq("id", leadId)
      .maybeSingle();

    // The marker means "this row occupies an appointment slot", so it
    // is only ever true alongside a real resolved instant.
    const holdsAppointment =
      isAppointmentRequest && Boolean(data?.appointment_datetime);

    const metadata = {
      ...((data?.metadata as Record<string, unknown>) ?? {}),
      ...(callerPhone ? { caller_id: callerPhone } : {}),
      ...(alternatePhone ? { alternate_phone: alternatePhone } : {}),
      ...(serviceAddress ? { service_address: serviceAddress } : {}),
      ...(callbackUrgency ? { callback_urgency: callbackUrgency } : {}),
      ...(holdsAppointment ? { appointment_request: true } : {}),
    };

    const { error } = await admin
      .from("leads")
      .update({ metadata })
      .eq("id", leadId);

    if (error) {
      console.error("[voice] failed to record caller ID on lead:", error.message);
    }
  } catch (err) {
    console.error("[voice] failed to record caller ID on lead:", err);
  }
}

// ── Calls that never connected ─────────────────────────────────────

/**
 * Vapi prefixes an endedReason with the call state the call ended in,
 * so `call.ringing.*` means it never left ringing — nobody answered,
 * no audio path was established, no assistant was ever attached.
 *
 * From the 2026-08-06 incident: an inbound call ended as
 * `call.ringing.sip-inbound-caller-hungup-before-call-connect` (NULL
 * duration, NULL transcript), and the owner still received the normal
 * "Remy answered a phone call" email reporting no summary and no lead.
 * Remy did not answer that call. Nothing was missed and nothing was
 * lost — there was simply nothing there, and the email said otherwise.
 *
 * Deliberately narrow on both sides. Only the `call.ringing.` state
 * prefix counts, so every reason from a call that DID connect
 * (customer-ended-call, assistant-ended-call, silence-timed-out, the
 * pipeline errors) still emails exactly as before. And a call is only
 * treated as never-connected when it produced nothing whatsoever: any
 * transcript, any summary, or any lead means there was something to
 * tell the owner about, whatever the reason string says.
 */
const RINGING_STATE_PREFIX = "call.ringing.";

export function callNeverConnected(
  event: Pick<VoiceCallEndedEvent, "endedReason" | "transcript" | "summary">,
  leadCreated: boolean
): boolean {
  if (leadCreated) return false;
  if (event.transcript?.trim() || event.summary?.trim()) return false;
  return (event.endedReason ?? "")
    .toLowerCase()
    .startsWith(RINGING_STATE_PREFIX);
}

// ── End-of-call processing ─────────────────────────────────────────
// isBookingConfirmed() in the shared lead-capture engine (leadCapture.ts,
// used by chat/widget too) marks a lead "booked" and fires the
// booking-confirmation email from intent + contact + a confirmed time
// alone; it never checks whether the requested SERVICE is actually
// something the business's Knowledge Base confirms. A caller asking for
// a service the business doesn't offer (e.g. "cabinet making" on a
// plumbing org) must not come out the other end as a real booking.
// isServiceConfirmedByKnowledge (imported above, shared with chat/widget)
// checks the KB before the lead ever reaches that shared engine, so a
// confirmed-service request is completely unaffected.

// ── Owner-summary idempotency ──────────────────────────────────────
//
// Everything else in processCallEnded already survives a second run:
// the voice_calls upsert is keyed on (provider, provider_call_id),
// ensureVoiceConversation keys the conversation on the provider call id
// and returns the existing one, and capturePartialLead's first
// resolution layer matches this call's conversation_id against
// MERGEABLE_STATUSES — which includes both statuses a phone lead can
// hold — so a replay UPDATES that lead instead of inserting another.
//
// The summary email is the exception: nothing about sending it is
// repeatable, and a replay would put a second copy of the same call in
// the owner's inbox. The marker lives in the existing
// voice_calls.metadata JSONB, mirroring how leads.metadata already
// carries needs_review_notification_sent — read-merged, so it cannot
// clobber a key another writer set.

async function hasCallSummaryBeenSent(
  admin: AdminClient,
  callRowId: string
): Promise<boolean> {
  try {
    const { data } = await admin
      .from("voice_calls")
      .select("metadata")
      .eq("id", callRowId)
      .maybeSingle();

    const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
    return metadata.summary_email_sent === true;
  } catch (err) {
    // Fall back to SENDING rather than skipping: a duplicate summary is
    // an annoyance, a missing one loses the enquiry.
    console.error("[voice] could not read call summary flag:", err);
    return false;
  }
}

async function markCallSummarySent(
  admin: AdminClient,
  callRowId: string
): Promise<void> {
  try {
    const { data } = await admin
      .from("voice_calls")
      .select("metadata")
      .eq("id", callRowId)
      .maybeSingle();

    const metadata = {
      ...((data?.metadata as Record<string, unknown>) ?? {}),
      summary_email_sent: true,
      summary_email_sent_at: new Date().toISOString(),
    };

    const { error } = await admin
      .from("voice_calls")
      .update({ metadata })
      .eq("id", callRowId);

    if (error) {
      console.error("[voice] failed to set call summary flag:", error.message);
    }
  } catch (err) {
    console.error("[voice] failed to set call summary flag:", err);
  }
}

export async function processCallEnded(
  admin: AdminClient,
  orgId: string,
  event: VoiceCallEndedEvent
): Promise<void> {
  // 1) Record the call itself — even when no lead follows, the call
  // history and its cost must exist.
  const { data: callRow, error: callError } = await admin
    .from("voice_calls")
    .upsert(
      {
        org_id: orgId,
        provider: event.provider,
        provider_call_id: event.providerCallId,
        direction: event.direction,
        status: "completed",
        ended_reason: event.endedReason,
        caller_phone: event.callerPhone,
        business_phone: event.businessPhone,
        started_at: event.startedAt,
        ended_at: event.endedAt,
        duration_seconds: event.durationSeconds,
        summary: event.summary,
        transcript: event.transcript,
        recording_url: event.recordingUrl,
        cost_usd: event.costUsd,
        cost_breakdown: event.costBreakdown,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,provider_call_id" }
    )
    .select("id")
    .single();

  if (callError) {
    // Without a call row there is nothing to attach a lead to and the
    // event stays unprocessed for replay — surface and stop.
    throw new Error(`voice_calls upsert failed: ${callError.message}`);
  }

  // 2) Feed the existing lead engine. Actionable intents go through
  // exactly like chat/widget leads (booking checks, confirmation
  // emails, phone-based merging for repeat callers). Non-actionable
  // calls with real substance (urgent, or a name/service/time was
  // collected) become needs_review leads — Remy promised the caller a
  // follow-up, so the enquiry must not vanish. Pure question calls
  // create no lead: the summary email below already tells the owner.
  // Provider analysis is primary; when it returned nothing (Vapi
  // leaves structuredData empty on its extraction timeout) fall back
  // to extracting from the transcript we already hold, so a
  // provider-side analysis failure never costs the lead.
  let details = event.extracted;
  if (!details) {
    details = await extractVoiceLeadFromTranscript(
      event.transcript,
      event.summary
    );
    if (details) {
      console.log(
        "[voice] provider returned no structured data — used fallback transcript extraction:",
        event.providerCallId
      );
    }
  }

  const extracted = toExtractedLead(details, event.callerPhone, event.transcript);
  const alternatePhone = resolveAlternatePhone(details, event.callerPhone);
  // Kept separately from preferred_datetime, which toExtractedLead has
  // already cleared of it: the caller told us how urgent they are, not
  // when to ring them.
  //
  // Read from BOTH signals, because they are produced by opposite model
  // behaviours. A model that disobeys the extraction schema puts the
  // phrase in preferred_datetime and the sanitiser recovers it; a model
  // that OBEYS leaves that null and sets `urgent` instead. Reading only
  // the first is what lost the urgency on the 2026-08-31 call.
  const callbackTiming = sanitisePreferredDatetime(details?.preferred_datetime);
  const callbackUrgency = resolveCallbackUrgency(
    callbackTiming,
    details?.urgent === true
  );
  let leadId: string | null = null;
  let serviceConfirmed = true;

  if (callbackUrgency) {
    console.log(
      "[voice] urgency recorded instead of a callback time (no day or time was given):",
      event.providerCallId
    );
  }

  if (alternatePhone) {
    console.log(
      "[voice] caller gave an additional number — kept as alternate, caller ID retained:",
      event.providerCallId
    );
  }

  // Was this call an APPOINTMENT request? Decided from the extracted
  // intent BEFORE the downgrade below rewrites it, because that answer
  // is what the capacity marker depends on.
  const isAppointmentRequest =
    extracted?.intent === "new_booking" || extracted?.intent === "reschedule";

  if (extracted) {
    // The Knowledge Base check still decides the CLOSING WORDING (rule
    // 9): a service the business does not list is never implied to be
    // on offer. It no longer decides the lead's status.
    if (extracted.intent === "new_booking" && extracted.service) {
      serviceConfirmed = await isServiceConfirmedByKnowledge(
        admin,
        orgId,
        extracted.service
      );
    }

    // A phone appointment is a REQUEST, never a confirmed booking.
    //
    // Remy tells every caller the team will confirm (rule 9 forbids
    // "booked", "confirmed" and "reserved"), so the lead must not
    // silently disagree with what the caller was told. Downgrading the
    // intent BEFORE it reaches the shared engine is the only lever that
    // does this from here: isBookingConfirmed() there returns false for
    // anything that is not new_booking/reschedule, which is what stops
    // BOTH the "booked" status and the booking-confirmation email that
    // status fires (leadCapture sends it inside capturePartialLead via
    // after(), so demoting the status afterwards would not stop it).
    //
    // This used to happen only when the service failed the Knowledge
    // Base check — which is exactly why a KB-matched request DID become
    // a confirmed booking, and why a second caller was told the same
    // slot was free (the capacity check counts status='booked' only).
    // The lead is still created: hasSubstance holds for any real
    // appointment request, so needsReview below carries it through on
    // the same path unconfirmed-service calls already take.
    //
    // ── The one exception: a calendar-backed phone booking ──────────
    //
    // When the gate below is open, the intent is LEFT ALONE so the call
    // takes the same route chat does — and "booked" is then settled from
    // Google's answer by settleCalendarBacking, never assigned here.
    // isVoiceCalendarBookingEnabled requires the org write allowlist, so
    // requiresCalendarBacking() downstream cannot be false: there is no
    // path where lifting the downgrade produces a "booked" lead with no
    // event behind it.
    //
    // Nothing is claimed to the caller either way. This runs AFTER the
    // call has ended, and Remy has already said the team will confirm —
    // so a successful write over-delivers on that, and every failure
    // leaves exactly the request the caller was promised.
    //
    // Three narrowings, all deliberate:
    //   - new_booking ONLY. Voice skips merge-layer 2, so every call
    //     creates an isolated lead; a phone "reschedule" has nothing to
    //     move and would book a SECOND appointment.
    //   - the service must be named AND matched in the Knowledge Base.
    //     serviceConfirmed DEFAULTS to true and the KB check only runs
    //     for new_booking with a service, so testing it alone would let
    //     a serviceless call through on the default. Rule 9 preserved:
    //     an unlisted service is never implied to be on offer.
    //   - the org must be allowlisted for writes AND the channel switch
    //     must be on. Unset means off (see flags.ts).
    const mayBookOnCalendar =
      extracted.intent === "new_booking" &&
      Boolean(extracted.service) &&
      serviceConfirmed &&
      isVoiceCalendarBookingEnabled(orgId);

    if (isAppointmentRequest && !mayBookOnCalendar) {
      extracted.intent = "question";
      console.log(
        "[voice] appointment recorded as a request awaiting confirmation:",
        event.providerCallId
      );
    } else if (mayBookOnCalendar) {
      console.log(
        "[voice] attempting a calendar-backed booking for call:",
        event.providerCallId
      );
    }

    const actionable = ACTIONABLE_INTENTS.includes(extracted.intent);
    const hasSubstance = Boolean(
      extracted.name || extracted.service || extracted.preferred_datetime
    );
    // A caller whose only answer about timing was "as soon as possible"
    // still rang with something real — the urgency counts as substance
    // in place of the preferred_datetime it was cleared out of, so the
    // enquiry cannot fall through to "no lead".
    const needsReview =
      !actionable &&
      (details?.urgent === true || Boolean(callbackUrgency) || hasSubstance);

    if (actionable || needsReview) {
      const conversationId = await ensureVoiceConversation(
        admin,
        orgId,
        event.providerCallId,
        event.callerPhone
      );

      const userMessage =
        event.summary?.trim() ||
        event.transcript?.trim().slice(0, 500) ||
        "Phone call";

      const captureResult = await capturePartialLead(
        admin,
        orgId,
        conversationId,
        userMessage,
        extracted,
        "voice",
        needsReview,
        null,
        // Where the work happens, for the calendar event ONLY. The lead's
        // own copy is written by recordLeadCallDetails below, which runs
        // after this returns — too late for the event payload, which is
        // built inside. Passing it here changes no write and adds no
        // query; without it a phone booking reaches the engineer's diary
        // with no address on it.
        //
        // The RESOLVED address, not the raw extraction: this and the
        // lead's copy below are the two consumers that used to read
        // details.service_address independently, and an engineer's diary
        // must never carry an address the lead does not have.
        extracted?.service_address ?? null
      );
      leadId = captureResult.leadId;

      if (leadId) {
        // The unconfirmed-service intent downgrade above already stops the
        // shared engine from ever marking this "booked"; this only makes
        // the resulting status explicit ("awaiting_confirmation" already
        // exists in the schema for exactly this "not yet confirmed" case)
        // rather than leaving it at whatever the downgraded intent
        // produced (typically "needs_review").
        if (!serviceConfirmed) {
          const { error: statusError } = await admin
            .from("leads")
            .update({ status: "awaiting_confirmation" })
            .eq("id", leadId);
          if (statusError) {
            console.error(
              "[voice] failed to set awaiting_confirmation status:",
              statusError.message
            );
          }
        }

        await recordLeadCallDetails(
          admin,
          leadId,
          event.callerPhone,
          alternatePhone,
          // The RESOLVED address — the same value the calendar event
          // above was given (addressIntegrity.ts).
          extracted?.service_address ?? null,
          callbackUrgency,
          isAppointmentRequest
        );

        const { error: linkError } = await admin
          .from("voice_calls")
          .update({ lead_id: leadId, updated_at: new Date().toISOString() })
          .eq("id", callRow.id);
        if (linkError) {
          console.error("[voice] lead link failed:", linkError.message);
        }
      }
    }
  }

  // 3) Owner summary email — every completed call, lead or not
  // ("never miss an enquiry"). No separate needs-review email for
  // voice: this summary already notifies the owner of every call, so
  // a second email per call would be noise.
  //
  // The one exception: a call that never connected (see
  // callNeverConnected). The voice_calls row above is written either
  // way, so the call, its endedReason and its cost stay in the
  // dashboard and in the event log — only the email claiming Remy
  // answered it is withheld.
  if (callNeverConnected(event, Boolean(leadId))) {
    console.log(
      "[voice] call ended while ringing and produced nothing — owner email skipped:",
      event.providerCallId,
      "| endedReason:",
      event.endedReason
    );
    return;
  }

  // Already sent on an earlier attempt that failed later, or by the
  // original webhook before a replay picked this up. The lead work
  // above has run again harmlessly; this must not.
  if (await hasCallSummaryBeenSent(admin, callRow.id)) {
    console.log(
      "[voice] call summary already sent — not sending again:",
      event.providerCallId
    );
    return;
  }

  const ownerInfo = await getOrgOwnerEmail(orgId);

  // No recipient is a CONFIGURATION problem, not a transient one:
  // retrying cannot fix it, and retrying forever would keep the event
  // unprocessed indefinitely. Reported loudly and left processed — the
  // enquiry itself is safe, because the lead was written above and the
  // call is in the dashboard either way.
  if (!ownerInfo?.email) {
    console.error(
      "[voice] no owner email configured — call summary cannot be sent for:",
      event.providerCallId,
      "| org:",
      orgId
    );
    return;
  }

  // ── What the owner is told about the appointment ────────────────
  //
  // The SETTLED status, read back from the lead itself. Voice writes the
  // calendar AFTER the call ends: settleCalendarBacking (inside
  // capturePartialLead above) promotes the row to "booked" only once
  // Google has actually accepted the event, and settles it to
  // "needs_review" on a conflict, an unreadable calendar or a failed
  // create. The unconfirmed-service branch above may then overwrite the
  // status again. The row is therefore the ONLY thing that knows the
  // final answer — which is why this reads it rather than reusing
  // captureResult, the requested time, or whether an appointment date
  // exists.
  //
  // Only for calls that actually asked for an appointment: a callback or
  // a general question has no booking to report, and null omits the
  // block entirely rather than inventing a status for it.
  //
  // ── …and only when a TIME was actually asked for ────────────────
  //
  // From the 2026-08-31 live burst-pipe call. The caller wanted a visit
  // and gave no day or time at all, so nothing was ever submitted to a
  // calendar — yet the owner was told "REQUIRES REVIEW: the requested
  // appointment was not confirmed in the calendar", which describes a
  // booking that was attempted and failed. Nothing was attempted.
  //
  // `isAppointmentRequest` only says the caller wanted a visit. It says
  // nothing about whether they named a time, and with no time there is
  // no booking to report — exactly as for the callback case above.
  //
  // Gated on the SANITISED requested timing, not the resolved instant:
  //   - the raw phrase, so a time the caller DID give but that failed to
  //     parse, or that the calendar refused, still reports the outcome.
  //     Using the resolved ISO here would silently drop the block on
  //     precisely the failures it exists to surface. FAIL-CLOSED.
  //   - sanitised, so "as soon as possible" written into
  //     preferred_datetime by a model ignoring its schema counts as the
  //     urgency it is and not as a requested time (callbackTiming.ts).
  //     The raw field alone would re-admit the confusion PR #35 removed.
  //
  // FAILS CLOSED. A failed read leaves `status` undefined, which
  // ownerBookingStatus maps to "requires review" — never to "booked".
  const appointmentTimeWasRequested = Boolean(callbackTiming.preferredDatetime);
  let bookingStatus: OwnerBookingStatus | null = null;
  if (leadId && isAppointmentRequest && appointmentTimeWasRequested) {
    const { data: settledLead, error: settledError } = await admin
      .from("leads")
      .select("status")
      .eq("id", leadId)
      .maybeSingle();

    if (settledError) {
      console.error(
        "[voice] could not read settled lead status for the owner summary:",
        settledError.message
      );
    }

    bookingStatus = ownerBookingStatus(settledLead?.status);
  }

  const sent = await sendCallSummaryEmail({
    businessOwnerEmail: ownerInfo.email,
    businessName: ownerInfo.businessName ?? "the business",
    callerPhone: event.callerPhone,
    alternatePhone,
    // Already computed above and already kept off preferred_datetime.
    // Passed through so the owner actually sees the urgency the caller
    // gave; it is null whenever a real callback time was given.
    callbackUrgency,
    // The GUARDED name, not the raw extraction. toExtractedLead is where
    // an email is stopped from manufacturing a caller (nameIntegrity.ts).
    // Reading details.name here would route the owner email around that
    // guard — and the owner email is the surface the 2026-08-31 defect
    // was actually seen on, so the two must not be able to disagree.
    callerName: extracted?.name ?? null,
    // The RESOLVED address, the same value the lead and the calendar
    // event carry. The summary paragraph keeps its own independently
    // generated "Address:" line; this row is the definitive one
    // (addressIntegrity.ts).
    serviceAddress: extracted?.service_address ?? null,
    startedAt: event.startedAt,
    durationSeconds: event.durationSeconds,
    summary: event.summary,
    transcript: event.transcript,
    leadCreated: Boolean(leadId),
    bookingStatus,
    timezone: ownerInfo.timezone,
  });

  // A send failure used to be swallowed: sendCallSummaryEmail returns
  // false rather than throwing, so the event was marked processed and
  // the owner was never told about the call. Throwing leaves the event
  // unprocessed and therefore replayable — the whole point of this work.
  if (!sent) {
    throw new Error(
      `call summary email failed for ${event.providerCallId} — event left for replay`
    );
  }

  await markCallSummarySent(admin, callRow.id);
}

// ── Status update processing ───────────────────────────────────────

export async function processStatusUpdate(
  admin: AdminClient,
  orgId: string,
  event: VoiceStatusEvent
): Promise<void> {
  // Never let a late/out-of-order status update downgrade a call the
  // end-of-call report already completed.
  const { data: existing } = await admin
    .from("voice_calls")
    .select("id, status")
    .eq("provider", event.provider)
    .eq("provider_call_id", event.providerCallId)
    .maybeSingle();

  if (existing?.status === "completed") return;

  const { error } = await admin.from("voice_calls").upsert(
    {
      org_id: orgId,
      provider: event.provider,
      provider_call_id: event.providerCallId,
      caller_phone: event.callerPhone,
      business_phone: event.businessPhone,
      status: event.status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider,provider_call_id" }
  );

  if (error) {
    throw new Error(`voice_calls status upsert failed: ${error.message}`);
  }
}
