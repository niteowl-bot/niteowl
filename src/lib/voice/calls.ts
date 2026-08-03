import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACTIONABLE_INTENTS,
  capturePartialLead,
  getOrgOwnerEmail,
  isServiceConfirmedByKnowledge,
  type ExtractedLead,
  type LeadIntent,
} from "@/lib/leadCapture";
import { sendCallSummaryEmail } from "@/lib/email";
import { extractVoiceLeadFromTranscript } from "@/lib/voice/extraction";
import { isSameNumber, normaliseSpokenNumber } from "@/lib/voice/callerId";
import { normaliseSpokenEmail } from "@/lib/voice/spokenEmail";
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

export async function markVoiceEventProcessed(
  admin: AdminClient,
  eventRowId: string,
  processingError: string | null = null
): Promise<void> {
  const { error } = await admin
    .from("voice_events")
    .update({
      processed_at: processingError ? null : new Date().toISOString(),
      processing_error: processingError,
    })
    .eq("id", eventRowId);

  if (error) {
    console.error("[voice] failed to mark event processed:", error.message);
  }
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
  callerPhone: string | null
): ExtractedLead | null {
  if (!details) return null;

  const intent: LeadIntent = VALID_INTENTS.includes(details.intent as LeadIntent)
    ? (details.intent as LeadIntent)
    : "unknown";

  return {
    intent,
    name: details.name,
    // Spoken aloud, so the same treatment the phone field gets: convert
    // "michael ryan at hotmail dot com", and store nothing at all rather
    // than a spoken form that would bounce a confirmation email.
    email: normaliseSpokenEmail(details.email),
    // Caller ID first, exactly as before. The spoken number only ever
    // reaches this field when caller ID is withheld — and then only if
    // it survives normalisation, because an unusable number here would
    // become the lead's primary phone and its merge key.
    phone: callerPhone ?? normaliseSpokenNumber(details.phone),
    service: details.service,
    preferred_datetime: details.preferred_datetime,
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
 * the caller asked to be reached on, and the on-site service address
 * (ExtractedLead carries no address field, and the shared lead schema
 * is deliberately left alone). Written to the existing leads.metadata
 * JSONB (the same column the needs-review notification flag uses) —
 * read-merged so it can never clobber a flag another writer set.
 * Voice-only and non-fatal: a failure here must not fail the call's
 * processing.
 */
async function recordLeadCallDetails(
  admin: AdminClient,
  leadId: string,
  callerPhone: string | null,
  alternatePhone: string | null,
  serviceAddress: string | null
): Promise<void> {
  if (!callerPhone && !alternatePhone && !serviceAddress) return;

  try {
    const { data } = await admin
      .from("leads")
      .select("metadata")
      .eq("id", leadId)
      .maybeSingle();

    const metadata = {
      ...((data?.metadata as Record<string, unknown>) ?? {}),
      ...(callerPhone ? { caller_id: callerPhone } : {}),
      ...(alternatePhone ? { alternate_phone: alternatePhone } : {}),
      ...(serviceAddress ? { service_address: serviceAddress } : {}),
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

  const extracted = toExtractedLead(details, event.callerPhone);
  const alternatePhone = resolveAlternatePhone(details, event.callerPhone);
  let leadId: string | null = null;
  let serviceConfirmed = true;

  if (alternatePhone) {
    console.log(
      "[voice] caller gave an additional number — kept as alternate, caller ID retained:",
      event.providerCallId
    );
  }

  if (extracted) {
    // Unconfirmed-service guard — new_booking only, and only when a
    // specific service was actually named. Downgrading the intent BEFORE
    // it reaches the shared lead-capture engine is what stops
    // isBookingConfirmed() there from ever marking this "booked" or
    // sending the booking-confirmation email; a confirmed-service
    // booking never hits this branch, so that path is unchanged.
    if (extracted.intent === "new_booking" && extracted.service) {
      serviceConfirmed = await isServiceConfirmedByKnowledge(
        admin,
        orgId,
        extracted.service
      );
      if (!serviceConfirmed) {
        extracted.intent = "question";
      }
    }

    const actionable = ACTIONABLE_INTENTS.includes(extracted.intent);
    const hasSubstance = Boolean(
      extracted.name || extracted.service || extracted.preferred_datetime
    );
    const needsReview = !actionable && (details?.urgent === true || hasSubstance);

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
        needsReview
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
          details?.service_address ?? null
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
  const ownerInfo = await getOrgOwnerEmail(orgId);
  await sendCallSummaryEmail({
    businessOwnerEmail: ownerInfo?.email ?? null,
    businessName: ownerInfo?.businessName ?? "the business",
    callerPhone: event.callerPhone,
    alternatePhone,
    callerName: details?.name ?? null,
    startedAt: event.startedAt,
    durationSeconds: event.durationSeconds,
    summary: event.summary,
    transcript: event.transcript,
    leadCreated: Boolean(leadId),
  });
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
