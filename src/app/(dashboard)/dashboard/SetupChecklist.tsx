"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface ChecklistState {
  hoursConfigured: boolean;
  knowledgeAdded: boolean;
  widgetSeen: boolean;
}

export default function SetupChecklist({ orgId }: { orgId: string }) {
  const [state, setState] = useState<ChecklistState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();

      const [hoursRes, knowledgeRes, orgRes] = await Promise.all([
        supabase
          .from("business_hours")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("is_closed", false),
        supabase
          .from("business_knowledge")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId),
        supabase
          .from("organisations")
          .select("onboarding_widget_step_seen")
          .eq("id", orgId)
          .single(),
      ]);

      if (cancelled) return;

      setState({
        hoursConfigured: (hoursRes.count ?? 0) > 0,
        knowledgeAdded: (knowledgeRes.count ?? 0) > 0,
        widgetSeen: orgRes.data?.onboarding_widget_step_seen ?? false,
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!state) return null;

  const items = [
    {
      label: "Business hours configured",
      done: state.hoursConfigured,
      href: "/settings/hours",
    },
    {
      label: "Knowledge records added",
      done: state.knowledgeAdded,
      href: "/knowledge",
    },
    {
      label: "Website widget set up",
      done: state.widgetSeen,
      href: "/settings/widget",
    },
  ];

  const allComplete = items.every((i) => i.done);
  if (allComplete) return null;

  const completedCount = items.filter((i) => i.done).length;

  return (
    <div className="mb-8 rounded-2xl border border-white/[0.07] bg-[#13151c] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">
          Finish setting up NiteOwl
        </h2>
        <span className="text-xs text-white/40">
          {completedCount} of {items.length} complete
        </span>
      </div>

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-white/5"
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  item.done
                    ? "border-blue-500 bg-blue-500"
                    : "border-white/20"
                }`}
              >
                {item.done && (
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path
                      d="M2 5.5l2.2 2.2L9 3"
                      stroke="white"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span
                className={`text-sm ${
                  item.done ? "text-white/40 line-through" : "text-white/80"
                }`}
              >
                {item.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
