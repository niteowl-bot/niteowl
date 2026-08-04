import { NextResponse, type NextRequest } from "next/server";

import { generateOAuthState } from "@/lib/integrations/auth";
import { isIntegrationsEnabled } from "@/lib/integrations/flags";
import {
  OAUTH_STATE_COOKIE,
  encodeStateCookie,
  stateCookieOptions,
} from "@/lib/integrations/oauthState";
import { initialiseIntegrations } from "@/lib/integrations/providers";
import { tryGetIntegration } from "@/lib/integrations/registry";
import { resolveIntegrationSession } from "@/lib/integrations/session";

// ── GET /api/integrations/[provider]/connect ──────────────────────
//
// Starts an OAuth connection for ANY integration. There is deliberately
// no per-provider route: the provider is a path segment resolved
// through the registry, so Microsoft, HubSpot or Meta need no new
// endpoint — only a registered integration.

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
    return NextResponse.redirect(new URL("/login", req.url));
  }

  initialiseIntegrations();
  const integration = tryGetIntegration(provider);
  if (!integration) {
    return NextResponse.json({ error: "Unknown integration." }, { status: 404 });
  }

  if (integration.auth.id !== "oauth2") {
    // API-key and basic-auth integrations are configured with a form
    // rather than a redirect. That flow is added with the first such
    // integration; refusing here is better than a broken redirect.
    return NextResponse.json(
      { error: "This integration does not use OAuth." },
      { status: 400 }
    );
  }

  const redirectUri = new URL(
    `/api/integrations/${provider}/callback`,
    req.nextUrl.origin
  ).toString();

  const nonce = generateOAuthState();
  const authUrl = integration.auth.buildAuthUrl({
    redirectUri,
    state: nonce,
    forceConsent: true,
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(
    OAUTH_STATE_COOKIE,
    encodeStateCookie(provider, nonce),
    stateCookieOptions(process.env.NODE_ENV === "production")
  );
  return response;
}
