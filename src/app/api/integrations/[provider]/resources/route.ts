import { NextResponse, type NextRequest } from "next/server";

import {
  getConnection,
  getValidCredentials,
  setPrimaryResource,
} from "@/lib/integrations/connections";
import { isIntegrationError } from "@/lib/integrations/errors";
import { isIntegrationsEnabled } from "@/lib/integrations/flags";
import { initialiseIntegrations } from "@/lib/integrations/providers";
import { tryGetIntegration } from "@/lib/integrations/registry";
import { resolveIntegrationSession } from "@/lib/integrations/session";

// ── /api/integrations/[provider]/resources ────────────────────────
//
// GET  — the remote objects this connection can use (calendars today,
//        phone numbers or pages for a future integration).
// POST — choose the primary one.
//
// Generic: the resource kind comes from the integration's manifest, so
// this route serves every integration without knowing what a calendar
// is.

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  if (!isIntegrationsEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { provider } = await context.params;

  const session = await resolveIntegrationSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  initialiseIntegrations();
  const integration = tryGetIntegration(provider);
  const connection = await getConnection(session.orgId, provider);

  if (!integration || !connection) {
    return NextResponse.json({ error: "Not connected." }, { status: 404 });
  }

  try {
    const credentials = await getValidCredentials(session.orgId, connection.id);
    const resources = await integration.listResources(credentials);
    return NextResponse.json({ resources });
  } catch (err) {
    const needsReauth = isIntegrationError(err) && err.kind === "auth_expired";
    console.error(
      "[integrations] failed to list resources:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      {
        error: needsReauth
          ? "This connection needs to be reconnected."
          : "Could not load from the provider.",
        needsReauth,
      },
      { status: needsReauth ? 409 : 502 }
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  if (!isIntegrationsEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { provider } = await context.params;

  const session = await resolveIntegrationSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: { externalId?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const externalId =
    typeof payload.externalId === "string" ? payload.externalId.trim() : "";
  if (!externalId) {
    return NextResponse.json({ error: "externalId is required." }, { status: 400 });
  }

  initialiseIntegrations();
  const integration = tryGetIntegration(provider);
  const connection = await getConnection(session.orgId, provider);

  if (!integration || !connection) {
    return NextResponse.json({ error: "Not connected." }, { status: 404 });
  }

  try {
    // The chosen id is checked against what the provider actually
    // offers, so a crafted request cannot point the org at a resource
    // this account cannot write to.
    const credentials = await getValidCredentials(session.orgId, connection.id);
    const resources = await integration.listResources(credentials);
    const chosen = resources.find((resource) => resource.externalId === externalId);

    if (!chosen) {
      return NextResponse.json({ error: "Unknown resource." }, { status: 404 });
    }
    if (!chosen.writable) {
      return NextResponse.json(
        { error: "That calendar is read-only for this account." },
        { status: 400 }
      );
    }

    await setPrimaryResource(session.orgId, connection.id, chosen);
    return NextResponse.json({ ok: true, resource: chosen });
  } catch (err) {
    console.error(
      "[integrations] failed to select resource:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "Could not save your selection." },
      { status: 502 }
    );
  }
}
