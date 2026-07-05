import { NextResponse } from "next/server";
import { constructStripeEvent, handleStripeWebhookEvent } from "@/lib/billing/stripe";

// Public endpoint — Stripe calls this directly, no user session.
// Authenticity is guaranteed by verifying the signature below, not by
// auth middleware (the same trust model as the public widget route).
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const payload = await request.text();

  let event;
  try {
    event = constructStripeEvent(payload, signature);
  } catch (err) {
    console.error("[stripe webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await handleStripeWebhookEvent(event);
  } catch (err) {
    console.error("[stripe webhook] Handler error:", err);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
