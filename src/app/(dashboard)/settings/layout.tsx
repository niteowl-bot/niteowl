"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SETTINGS_TABS = [
  { href: "/settings/hours", label: "Business Hours" },
  { href: "/settings/widget", label: "Website Widget" },
  { href: "/settings/billing", label: "Billing" },
  // Future tabs — add one line each, no other changes needed:
  // { href: "/settings/ai-behaviour", label: "AI Behaviour" },
  // { href: "/settings/services", label: "Services" },
  // { href: "/settings/staff", label: "Staff" },
  // { href: "/settings/booking-rules", label: "Booking Rules" },
  // { href: "/settings/holidays", label: "Holidays" },
  // { href: "/settings/notifications", label: "Notifications" },
  // { href: "/settings/integrations", label: "Integrations" },
  // { href: "/settings/branding", label: "Branding" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-full px-4 py-10 md:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-semibold text-white">Settings</h1>
        <nav className="mb-8 flex gap-1 border-b border-white/[0.07]">
          {SETTINGS_TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`border-b-2 px-4 py-2.5 text-sm transition ${
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
        {children}
      </div>
    </div>
  );
}
