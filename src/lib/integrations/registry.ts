import type {
  CalendarCapability,
  CapabilityId,
  Integration,
} from "@/lib/integrations/types";

// ── Integration registry ──────────────────────────────────────────
//
// The one place that knows which integrations exist. The domain layer
// asks for a CAPABILITY and gets something it can call; it never
// imports providers/google.ts, so adding an integration cannot require
// a change to the booking engine, lead capture or the job queue.
//
// Registration is explicit rather than by module side effect: an
// integration appears here only because a composition root asked for
// it, which keeps test doubles trivial and means importing a type never
// drags an HTTP client into the bundle.

const integrations = new Map<string, Integration>();

export class UnknownIntegrationError extends Error {
  readonly integrationId: string;

  constructor(integrationId: string) {
    const known = [...integrations.keys()].sort().join(", ") || "none registered";
    super(`Unknown integration "${integrationId}". Registered: ${known}.`);
    this.name = "UnknownIntegrationError";
    this.integrationId = integrationId;
  }
}

export class CapabilityNotSupportedError extends Error {
  readonly integrationId: string;
  readonly capability: CapabilityId;

  constructor(integrationId: string, capability: CapabilityId) {
    super(`Integration "${integrationId}" does not support the ${capability} capability.`);
    this.name = "CapabilityNotSupportedError";
    this.integrationId = integrationId;
    this.capability = capability;
  }
}

/**
 * Adds an integration. Re-registering the same id replaces the previous
 * entry, which is what lets a test swap in a fake and restore the real
 * one afterwards.
 */
export function registerIntegration(integration: Integration): void {
  const id = integration?.manifest?.id;
  if (!id) {
    throw new Error("An integration must declare a manifest id.");
  }
  if (!integration.auth?.id) {
    throw new Error(`Integration "${id}" must declare an auth strategy.`);
  }
  // A manifest claiming a capability it does not implement would fail
  // later, inside a job, against a real customer's calendar. Catch it at
  // registration instead.
  if (integration.manifest.capabilities.includes("calendar") && !integration.calendar) {
    throw new Error(
      `Integration "${id}" declares the calendar capability but does not implement it.`
    );
  }
  integrations.set(id, integration);
}

/** Removes an integration. Returns whether one was actually registered. */
export function unregisterIntegration(id: string): boolean {
  return integrations.delete(id);
}

/** The integration for an id, or null when none is registered. */
export function tryGetIntegration(id: string): Integration | null {
  return integrations.get(id) ?? null;
}

/**
 * The integration for an id, or a throw. Used where a missing
 * integration is a bug — a stored connection naming a provider this
 * build no longer ships — rather than a condition to handle.
 */
export function getIntegration(id: string): Integration {
  const integration = integrations.get(id);
  if (!integration) throw new UnknownIntegrationError(id);
  return integration;
}

/** Every registered integration, stable order, for rendering Settings. */
export function listIntegrations(): Integration[] {
  return [...integrations.values()].sort((a, b) =>
    a.manifest.id.localeCompare(b.manifest.id)
  );
}

/** Those offering a capability — e.g. everything that can hold a calendar. */
export function listIntegrationsWithCapability(
  capability: CapabilityId
): Integration[] {
  return listIntegrations().filter((integration) =>
    integration.manifest.capabilities.includes(capability)
  );
}

/** Whether an id names an integration this build can actually talk to. */
export function isRegisteredIntegration(id: string): boolean {
  return integrations.has(id);
}

export function supportsCapability(id: string, capability: CapabilityId): boolean {
  const integration = integrations.get(id);
  return Boolean(integration?.manifest.capabilities.includes(capability));
}

/**
 * The calendar capability of an integration, or a throw.
 *
 * This is the booking engine's only entry point into the framework. It
 * receives a CalendarCapability and has no way to discover whether
 * Google, Microsoft or something not yet written answered.
 */
export function getCalendarCapability(id: string): CalendarCapability {
  const integration = getIntegration(id);
  if (!integration.calendar) {
    throw new CapabilityNotSupportedError(id, "calendar");
  }
  return integration.calendar;
}

/** Test seam: empties the registry. Not used by application code. */
export function resetIntegrations(): void {
  integrations.clear();
}
