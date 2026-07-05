import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasActiveAccess } from "@/lib/billing/access";
import { SubscribeButton, ManageBillingButton } from "./BillingActions";

function daysRemaining(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default async function BillingPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id, subscription_status, trial_ends_at, current_period_end")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orgError || !org) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-white">Billing</h1>
        <p className="mt-2 text-slate-400">No organisation found.</p>
      </div>
    );
  }

  const active = hasActiveAccess(org);
  const isTrialing = org.subscription_status === "trialing";
  const trialDaysLeft =
    isTrialing && org.trial_ends_at ? daysRemaining(org.trial_ends_at) : 0;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-white">Billing</h1>
      <p className="mt-2 text-slate-400">
        Manage your Remy subscription.
      </p>

      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        {org.subscription_status === "active" ? (
          <>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm font-medium text-white">Subscribed</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Your subscription is active. Manage your payment method,
              invoices, or cancel anytime from the billing portal.
            </p>
            <div className="mt-5">
              <ManageBillingButton />
            </div>
          </>
        ) : isTrialing && active ? (
          <>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-400" />
              <span className="text-sm font-medium text-white">
                Free trial — {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              No card required during your trial. Subscribe any time to
              keep Remy running after it ends.
            </p>
            <div className="mt-5">
              <SubscribeButton />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span className="text-sm font-medium text-white">
                {isTrialing ? "Trial ended" : "Subscription inactive"}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Remy has paused answering for your business. Subscribe to
              reactivate it immediately.
            </p>
            <div className="mt-5">
              <SubscribeButton />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
