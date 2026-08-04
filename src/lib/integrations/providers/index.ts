import { registerIntegration, resetIntegrations } from "@/lib/integrations/registry";
import { createGoogleIntegration, loadGoogleConfig } from "@/lib/integrations/providers/google";

// ── Composition root ──────────────────────────────────────────────
//
// The single place integrations are wired up. Nothing else imports a
// provider file, so the set of supported integrations is visible here
// and adding one is a two-line change:
//
//   const microsoft = loadMicrosoftConfig(env);
//   if (microsoft) registerIntegration(createMicrosoftIntegration(microsoft));
//
// An integration whose credentials are absent from the environment is
// simply not registered, so a half-configured deployment offers the
// integrations it can actually complete rather than showing a Connect
// button that dead-ends at the provider.

let initialised = false;

export function initialiseIntegrations(
  env: Record<string, string | undefined> = process.env
): void {
  if (initialised) return;
  initialised = true;

  const google = loadGoogleConfig(env);
  if (google) {
    registerIntegration(createGoogleIntegration(google));
  }

  // Microsoft arrives in milestone 7 and needs no change to the
  // framework, the routes or the Settings page — only these two lines.
}

/**
 * Re-runs registration against a different environment. Used by tests;
 * application code calls initialiseIntegrations().
 */
export function reinitialiseIntegrations(
  env: Record<string, string | undefined>
): void {
  resetIntegrations();
  initialised = false;
  initialiseIntegrations(env);
}
