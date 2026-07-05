import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  PaymentProvider,
  CheckoutSessionParams,
  PortalSessionParams,
} from "./provider";

// ── Stripe implementation of PaymentProvider ─────────────────────
// Everything Stripe-specific (the SDK client, customer/session
// creation, webhook signature verification, mapping Stripe's
// subscription statuses onto our own) is isolated to this file.

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  return new Stripe(secretKey);
}

async function getOrCreateStripeCustomer(
  orgId: string,
  ownerEmail: string
): Promise<string> {
  const admin = createAdminClient();
  const stripe = getStripeClient();

  const { data: org, error } = await admin
    .from("organisations")
    .select("stripe_customer_id, business_name")
    .eq("id", orgId)
    .single();

  if (error || !org) {
    throw new Error(`Could not load organisation ${orgId}: ${error?.message}`);
  }

  if (org.stripe_customer_id) return org.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: ownerEmail,
    name: org.business_name ?? undefined,
    metadata: { org_id: orgId },
  });

  const { error: updateError } = await admin
    .from("organisations")
    .update({ stripe_customer_id: customer.id, payment_provider: "stripe" })
    .eq("id", orgId);

  if (updateError) {
    console.error("[stripe] Failed to save stripe_customer_id:", updateError.message);
  }

  return customer.id;
}

async function createCheckoutSession(
  params: CheckoutSessionParams
): Promise<{ url: string }> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error("STRIPE_PRICE_ID is not configured.");
  }

  const stripe = getStripeClient();
  const customerId = await getOrCreateStripeCustomer(params.orgId, params.ownerEmail);

  // payment_method_types is intentionally left unset — Stripe shows
  // whichever methods (cards, Apple Pay, Google Pay, etc.) are
  // enabled in the account's Dashboard, so new methods can be turned
  // on there without a code change.
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.orgId,
    subscription_data: {
      metadata: { org_id: params.orgId },
    },
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { url: session.url };
}

async function createPortalSession(
  params: PortalSessionParams
): Promise<{ url: string }> {
  const admin = createAdminClient();
  const stripe = getStripeClient();

  const { data: org, error } = await admin
    .from("organisations")
    .select("stripe_customer_id")
    .eq("id", params.orgId)
    .single();

  if (error || !org?.stripe_customer_id) {
    throw new Error("No Stripe customer on file for this organisation yet.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: params.returnUrl,
  });

  return { url: session.url };
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",
  createCheckoutSession,
  createPortalSession,
};

// ── Webhook handling ─────────────────────────────────────────────
// Stripe-specific event verification and parsing live here; the org
// row updates only ever touch the provider-agnostic columns that
// hasActiveAccess() reads.

export function constructStripeEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }
  return getStripeClient().webhooks.constructEvent(payload, signature, webhookSecret);
}

function mapStripeStatus(
  status: Stripe.Subscription.Status
): "active" | "past_due" | "canceled" {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      return "past_due";
  }
}

async function findOrgIdForSubscription(
  sub: Stripe.Subscription,
  admin: ReturnType<typeof createAdminClient>
): Promise<string | null> {
  if (sub.metadata?.org_id) return sub.metadata.org_id;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data } = await admin
    .from("organisations")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  return data?.id ?? null;
}

export async function handleStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  const admin = createAdminClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.client_reference_id;
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;

    if (!orgId || !subscriptionId) {
      console.error(
        "[stripe webhook] checkout.session.completed missing org id or subscription id"
      );
      return;
    }

    const { error } = await admin
      .from("organisations")
      .update({
        stripe_subscription_id: subscriptionId,
        subscription_status: "active",
        payment_provider: "stripe",
      })
      .eq("id", orgId);

    if (error) {
      console.error("[stripe webhook] checkout.session.completed update failed:", error.message);
    }
    return;
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const orgId = await findOrgIdForSubscription(sub, admin);

    if (!orgId) {
      console.error("[stripe webhook] could not resolve org for subscription:", sub.id);
      return;
    }

    const periodEndSeconds = sub.items?.data?.[0]?.current_period_end ?? null;
    const currentPeriodEnd = periodEndSeconds
      ? new Date(periodEndSeconds * 1000).toISOString()
      : null;

    const { error } = await admin
      .from("organisations")
      .update({
        stripe_subscription_id: sub.id,
        subscription_status: mapStripeStatus(sub.status),
        current_period_end: currentPeriodEnd,
      })
      .eq("id", orgId);

    if (error) {
      console.error("[stripe webhook] subscription update failed:", error.message);
    }
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const orgId = await findOrgIdForSubscription(sub, admin);

    if (!orgId) {
      console.error("[stripe webhook] could not resolve org for deleted subscription:", sub.id);
      return;
    }

    const { error } = await admin
      .from("organisations")
      .update({ subscription_status: "canceled" })
      .eq("id", orgId);

    if (error) {
      console.error("[stripe webhook] subscription cancellation update failed:", error.message);
    }
    return;
  }

  // Other event types are not currently acted on.
}
