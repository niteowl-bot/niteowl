import Link from "next/link";

const SETTINGS_TABS = [
  { href: "/settings/hours", label: "Business Hours" },
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
  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      {/* Sidebar nav */}
      <aside className="w-56 shrink-0 border-r border-slate-800 p-4">
        <Link
          href="/dashboard"
          className="mb-6 block text-sm text-slate-400 hover:text-white transition"
        >
          ← Dashboard
        </Link>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Settings
        </h2>
        <nav className="space-y-1">
          {SETTINGS_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="block rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Active tab content */}
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
