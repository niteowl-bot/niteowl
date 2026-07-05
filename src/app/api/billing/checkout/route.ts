import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPaymentProvider } from "@/lib/billing/provider";

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user || !user.email) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id, payment_provider")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orgError || !org) {
    return NextResponse.json({ error: "No organisation found." }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  try {
    const provider = getPaymentProvider(org.payment_provider ?? "stripe");
    const { url } = await provider.createCheckoutSession({
      orgId: org.id,
      ownerEmail: user.email,
      successUrl: `${appUrl}/settings/billing?checkout=success`,
      cancelUrl: `${appUrl}/settings/billing?checkout=cancelled`,
    });

    return NextResponse.json({ url });
  } catch (err) {
    console.error("[billing] Failed to create checkout session:", err);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 }
    );
  }
}
