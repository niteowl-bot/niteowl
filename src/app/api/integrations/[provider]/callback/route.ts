import { NextResponse, type NextRequest } from "next/server";

import { hasRequiredScopes, missingScopes } from "@/lib/integrations/auth";
import {
  saveOAuthConnection,
  setPrimaryResource,
} from "@/lib/integrations/connections";
import { isIntegrationsEnabled } from "@/lib/integrations/flags";
import { OAUTH_STATE_COOKIE, verifyStateCookie } from "@/lib/integrations/oauthState";
import { initialiseIntegrations } from "@/lib/integrations/providers";
import { GOOGLE_REQUIRED_SCOPES } from "@/lib/integrations/providers/google";
import { tryGetIntegration } from "@/lib/integrations/registry";
import { resolveIntegrationSession } from "@/lib/integrations/session";

// ── GET /api/integrations/[provider]/callback ─────────────────────
//
// Completes an OAuth connection for ANY integration. Every failure ends
// as a redirect back to Settings with a short reason code — an owner
// who denies consent should land on a page that explains itself, not on
// a JSON error.

const SETTINGS_PATH = "/settings/integrations";

/**
 * Required scopes per integration. Kept here rather than in the
 * manifest because it is the connect flow, not the provider, that
 * decides whether a partial grant is fatal.
 */
const REQUIRED_SCOPES: Record<string, string[]> = {
  google: GOOGLE_REQUIRED_SCOPES,
};

function settingsRedirect(req: NextRequest, params: Record<string, string>) {
  const url = new URL(SETTINGS_PATH, req.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  // The state cookie is single-use whatever the outcome.
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

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
  if (!integration || integration.auth.id !== "oauth2") {
    return settingsRedirect(req, { error: "unknown_integration" });
  }

  // The owner cancelled, or the provider refused.
  const providerError = req.nextUrl.searchParams.get("error");
  if (providerError) {
    return settingsRedirect(req, {
      error: providerError === "access_denied" ? "cancelled" : "provider_error",
      provider,
    });
  }

  // CSRF: the callback must come from the browser that started the flow.
  // The org is NOT taken from here — it comes from the session above —
  // so a forged state cannot land a connection in another tenant.
  const verification = verifyStateCookie(
    req.cookies.get(OAUTH_STATE_COOKIE)?.value,
    req.nextUrl.searchParams.get("state"),
    provider
  );
  if (!verification.valid) {
    console.error("[integrations] oauth state rejected:", verification.reason);
    return settingsRedirect(req, { error: "state_mismatch", provider });
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return settingsRedirect(req, { error: "missing_code", provider });
  }

  const redirectUri = new URL(
    `/api/integrations/${provider}/callback`,
    req.nextUrl.origin
  ).toString();

  try {
    const credentials = await integration.auth.exchangeCode(code, redirectUri);

    // A consent screen can grant a subset — Google lets the user untick
    // individual permissions. Catching it here turns a confusing 403
    // during a customer's booking into a clear message at connect time.
    const required = REQUIRED_SCOPES[provider] ?? [];
    if (credentials.strategy === "oauth2") {
      if (!hasRequiredScopes(credentials.scopes, required)) {
        console.error(
          "[integrations] partial scope grant:",
          missingScopes(credentials.scopes, required).join(", ")
        );
        return settingsRedirect(req, { error: "missing_scopes", provider });
      }
      // Without a refresh token the connection dies within the hour and
      // cannot be renewed. Better to refuse now and re-prompt.
      if (!credentials.refreshToken) {
        return settingsRedirect(req, { error: "no_refresh_token", provider });
      }
    }

    const account = await integration.getAccount(credentials);
    const connection = await saveOAuthConnection({
      orgId: session.orgId,
      integration,
      account,
      credentials,
      createdBy: session.userId,
    });

    // Pre-select the obvious resource so a connection is usable in one
    // step. The owner can change it in Settings; nothing syncs until a
    // resource is selected, so guessing here is safe.
    if (integration.manifest.resourceType) {
      try {
        const resources = await integration.listResources(credentials);
        const writable = resources.filter((resource) => resource.writable);
        const preferred = writable.find((resource) => resource.isDefault) ?? writable[0];
        if (preferred) {
          await setPrimaryResource(session.orgId, connection.id, preferred);
        }
      } catch (err) {
        // A failure here leaves a connected account with no calendar
        // chosen — recoverable in Settings, so it must not fail the
        // whole connection.
        console.error(
          "[integrations] could not pre-select a resource:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    return settingsRedirect(req, { connected: provider });
  } catch (err) {
    console.error(
      "[integrations] connect failed:",
      err instanceof Error ? err.message : String(err)
    );
    return settingsRedirect(req, { error: "connect_failed", provider });
  }
}
