import { redirect } from "next/navigation";
import { connection } from "next/server";

import { listConnections, listResources } from "@/lib/integrations/connections";
import { isIntegrationsEnabled } from "@/lib/integrations/flags";
import { initialiseIntegrations } from "@/lib/integrations/providers";
import { listIntegrations } from "@/lib/integrations/registry";
import { resolveIntegrationSession } from "@/lib/integrations/session";
import IntegrationsClient, {
  type IntegrationCardData,
} from "./IntegrationsClient";

// ── Settings → Integrations ───────────────────────────────────────
//
// The permanent home for every external service Remy connects to. The
// page renders itself from the registry: an integration appears here
// because it was registered, not because this file mentions it. Adding
// WhatsApp or a CRM later touches neither this page nor its client.
//
// Connection rows are read with the service-role client because
// integration_connections is deny-all under RLS. The org comes from the
// session, and only non-secret fields are passed to the browser — the
// encrypted credentials never leave this module.

export default async function IntegrationsSettingsPage() {
  // The feature flag is read per request, not baked into a prerender.
  // Without this the page is statically rendered at build time with the
  // flag off, and the resulting redirect would still be served after the
  // flag is switched on. `connection()` is this version's API for it —
  // `export const dynamic` is the pre-v16 spelling and is gone once
  // Cache Components is enabled.
  await connection();

  if (!isIntegrationsEnabled()) {
    // Feature off: behave as though the page does not exist, matching
    // the nav, which also hides it.
    redirect("/settings");
  }

  const session = await resolveIntegrationSession();
  if (!session) redirect("/login");

  initialiseIntegrations();

  const [integrations, connections] = await Promise.all([
    Promise.resolve(listIntegrations()),
    listConnections(session.orgId),
  ]);

  const cards: IntegrationCardData[] = await Promise.all(
    integrations.map(async (integration) => {
      const connection =
        connections.find((row) => row.provider === integration.manifest.id) ?? null;

      const resources = connection
        ? await listResources(session.orgId, connection.id)
        : [];
      const primary = resources.find((resource) => resource.isPrimary) ?? null;

      return {
        id: integration.manifest.id,
        label: integration.manifest.label,
        description: integration.manifest.description,
        capabilities: integration.manifest.capabilities,
        resourceLabel: integration.manifest.resourceLabel,
        connection: connection
          ? {
              status: connection.status,
              accountEmail: connection.accountEmail,
              accountName: connection.accountName,
              lastError: connection.lastError,
              connectedAt: connection.createdAt,
            }
          : null,
        selectedResource: primary
          ? { externalId: primary.externalId, name: primary.name }
          : null,
      };
    })
  );

  return <IntegrationsClient integrations={cards} />;
}
