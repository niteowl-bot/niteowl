// ── Provider-agnostic subscription gate ──────────────────────────
// Every place that needs to know "can this business use Remy right
// now" (chat routes, widget route, dashboard middleware) calls only
// hasActiveAccess(). It never needs to know whether a subscription is
// backed by Stripe, PayPal, or anything else — that detail lives
// entirely behind src/lib/billing/provider.ts.

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface SubscriptionState {
  subscription_status: string | null;
  trial_ends_at: string | null;
}

export function hasActiveAccess(org: SubscriptionState): boolean {
  if (org.subscription_status === "active") return true;

  if (org.subscription_status === "trialing") {
    if (!org.trial_ends_at) return false;
    return new Date(org.trial_ends_at) > new Date();
  }

  return false;
}
