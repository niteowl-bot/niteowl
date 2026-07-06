"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function OnboardingWidgetStep({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [widgetKey, setWidgetKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    async function fetchWidgetKey() {
      const supabase = createClient();
      const { data } = await supabase
        .from("organisations")
        .select("widget_key")
        .eq("id", orgId)
        .single();

      setWidgetKey(data?.widget_key ?? null);
      setLoading(false);
    }
    fetchWidgetKey();
  }, [orgId]);

  const snippet = widgetKey
    ? `<script src="${APP_URL}/widget.js" data-widget-key="${widgetKey}"></script>`
    : "";

  function handleCopy() {
    if (!snippet) return;
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function finishOnboarding() {
    setFinishing(true);
    const supabase = createClient();
    await supabase
      .from("organisations")
      .update({ onboarding_widget_step_seen: true })
      .eq("id", orgId);
    router.push("/dashboard");
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-white">
        Add Remy to your website
      </h1>
      <p className="mb-8 text-sm text-white/40">
        Paste this snippet before the closing {"</body>"} tag on your site
        to add the chat widget. You can always do this later from Settings.
      </p>

      <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-6">
        {loading ? (
          <p className="text-sm text-white/40">Loading your embed code…</p>
        ) : (
          <>
            <pre className="overflow-x-auto rounded-lg bg-black/40 p-4 text-xs text-white/70">
              {snippet}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleCopy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                {copied ? "Copied!" : "Copy snippet"}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={finishOnboarding}
          disabled={finishing}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {finishing ? "Finishing…" : "Finish"}
        </button>
        <button
          onClick={finishOnboarding}
          disabled={finishing}
          className="text-sm text-white/40 hover:text-white/70 transition disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
