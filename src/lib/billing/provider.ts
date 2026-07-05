import { stripeProvider } from "./stripe";

// ── Payment provider abstraction ──────────────────────────────────
// Phase 1 only registers Stripe. Adding PayPal (or any other
// processor) later means writing a paypal.ts that implements this
// same interface and adding one line to PROVIDERS below — nothing
// else in the codebase (checkout/portal routes, webhook plumbing,
// gating logic) needs to change.

export interface CheckoutSessionParams {
  orgId: string;
  ownerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PortalSessionParams {
  orgId: string;
  returnUrl: string;
}

export interface PaymentProvider {
  name: string;
  createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string }>;
  createPortalSession(params: PortalSessionParams): Promise<{ url: string }>;
}

const PROVIDERS: Record<string, PaymentProvider> = {
  stripe: stripeProvider,
};

export function getPaymentProvider(name: string = "stripe"): PaymentProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown payment provider: ${name}`);
  return provider;
}
