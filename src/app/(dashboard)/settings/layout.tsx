import { isIntegrationsEnabled } from "@/lib/integrations/flags";
import SettingsNav from "./SettingsNav";

// Server component so the Integrations tab can be gated on the same
// server-side flag the page and routes use — one flag, no NEXT_PUBLIC_
// mirror that could drift out of step. The nav itself is a client
// component (it needs usePathname) and is otherwise unchanged.

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full px-4 py-10 md:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-semibold text-white">Settings</h1>
        <SettingsNav showIntegrations={isIntegrationsEnabled()} />
        {children}
      </div>
    </div>
  );
}
