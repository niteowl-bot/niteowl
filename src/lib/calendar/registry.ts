import type { CalendarProvider, CalendarProviderId } from "@/lib/calendar/types";

// ── Provider registry ─────────────────────────────────────────────
//
// The one place that knows which calendar providers exist. The booking
// engine asks for a provider by id and receives something satisfying
// CalendarProvider; it never imports an implementation, so adding a
// provider cannot require a change to availability checking, lead
// capture or the sync queue.
//
// Registration is explicit rather than by module side effect: a
// provider appears here only because a composition root asked for it,
// which keeps test doubles trivial to install and means importing a
// type never drags an HTTP client into the bundle.

const providers = new Map<string, CalendarProvider>();

export class UnknownCalendarProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    const known = [...providers.keys()].sort().join(", ") || "none registered";
    super(`Unknown calendar provider "${providerId}". Registered: ${known}.`);
    this.name = "UnknownCalendarProviderError";
    this.providerId = providerId;
  }
}

/**
 * Adds a provider. Re-registering the same id replaces the previous
 * entry, which is what lets a test swap in a fake for one case and
 * restore the real one afterwards.
 */
export function registerCalendarProvider(provider: CalendarProvider): void {
  if (!provider?.id) {
    throw new Error("A calendar provider must declare an id.");
  }
  providers.set(provider.id, provider);
}

/** Removes a provider. Returns whether one was actually registered. */
export function unregisterCalendarProvider(id: string): boolean {
  return providers.delete(id);
}

/** The provider for an id, or null when none is registered. */
export function tryGetCalendarProvider(id: string): CalendarProvider | null {
  return providers.get(id) ?? null;
}

/**
 * The provider for an id, or a throw. Used on paths where a missing
 * provider is a bug (a stored connection naming a provider the build no
 * longer ships) rather than a condition to handle.
 */
export function getCalendarProvider(id: string): CalendarProvider {
  const provider = providers.get(id);
  if (!provider) throw new UnknownCalendarProviderError(id);
  return provider;
}

/** Every registered provider, stable order, for rendering Settings. */
export function listCalendarProviders(): CalendarProvider[] {
  return [...providers.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Whether an id names a provider this build can actually talk to. */
export function isRegisteredProvider(id: string): id is CalendarProviderId {
  return providers.has(id);
}

/** Test seam: empties the registry. Not used by application code. */
export function resetCalendarProviders(): void {
  providers.clear();
}
