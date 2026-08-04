"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Split out of layout.tsx so the layout can be a server component and
// decide, from the server-side feature flag, whether the Integrations
// tab exists. Everything below is exactly the previous nav behaviour.

const SETTINGS_TABS = [
  { href: "/settings/business", label: "Business" },
  { href: "/settings/hours", label: "Business Hours" },
  { href: "/settings/widget", label: "Website Widget" },
  { href: "/settings/billing", label: "Billing" },
  // Future tabs — add one line each, no other changes needed:
  // { href: "/settings/ai-behaviour", label: "AI Behaviour" },
  // { href: "/settings/services", label: "Services" },
  // { href: "/settings/staff", label: "Staff" },
  // { href: "/settings/booking-rules", label: "Booking Rules" },
  // { href: "/settings/holidays", label: "Holidays" },
  // { href: "/settings/branding", label: "Branding" },
];

const INTEGRATIONS_TAB = {
  href: "/settings/integrations",
  label: "Integrations",
};

export default function SettingsNav({
  showIntegrations,
}: {
  showIntegrations: boolean;
}) {
  const pathname = usePathname();
  const tabs = showIntegrations
    ? [...SETTINGS_TABS, INTEGRATIONS_TAB]
    : SETTINGS_TABS;

  return (
    <nav className="mb-8 flex gap-1 overflow-x-auto border-b border-white/[0.07]">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition ${
              active
                ? "border-blue-500 text-white"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
