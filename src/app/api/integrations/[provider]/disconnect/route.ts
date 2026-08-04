import { NextResponse, type NextRequest } from "next/server";

import {
  disconnectConnection,
  getConnection,
} from "@/lib/integrations/connections";
import { isIntegrationsEnabled } from "@/lib/integrations/flags";
import { initialiseIntegrations } from "@/lib/integrations/providers";
import { resolveIntegrationSession } from "@/lib/integrations/session";

// ── POST /api/integrations/[provider]/disconnect ──────────────────
//
// Generic for every integration. The connection is located by org +
// provider from the session, so a caller cannot disconnect another
// business's integration by guessing an id.

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

  const connection = await getConnection(session.orgId, provider);
  if (!connection) {
    // Already gone is the outcome the caller wanted.
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  // Needed so the provider's revoke endpoint is reachable.
  initialiseIntegrations();

  try {
    await disconnectConnection(session.orgId, connection.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[integrations] disconnect failed:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "Could not disconnect. Please try again." },
      { status: 500 }
    );
  }
}
