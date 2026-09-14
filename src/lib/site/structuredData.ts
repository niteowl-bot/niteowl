// ── Structured data for the free-product pages — A-1 ─────────────────
//
// TRUTHFUL BY CONSTRUCTION. The builders below can express exactly one
// thing about a free tool: that it is a web application, that it is
// free, who publishes it, and what it does in the words its own page
// already uses. The shape has no place for a rating, a review, a
// customer count, a saving, a benchmark or a location, so none can be
// added by filling in a field — adding one means changing this file, in
// a diff a test reads (docs/ARCHITECTURE.md §26, §76, §77;
// docs/AGENT_ACCESS_LAYER.md §25.2).
//
// NO NUMBERS THAT DESCRIBE A BUSINESS. `price: "0"` is the only numeral
// here, and it describes the tool, not a customer.

import { SITE_URL, publicUrl } from "@/lib/site/publicRoutes";

// THE BRAND, NOT A LEGAL ENTITY. The public brand name the free-tools
// footer already uses. Company/legal identity lives in the Privacy and
// Terms pages and is not restated here — structured data for a free
// tool needs a publisher, not a registration.
export const PUBLISHER = {
  "@type": "Organization",
  name: "NiteOwl AI",
  url: SITE_URL,
} as const;

export interface FreeToolDescriptor {
  readonly name: string;
  readonly path: string;
  readonly description: string;
}

/** A free web tool, as schema.org understands it. */
export function freeToolApplicationJsonLd(tool: FreeToolDescriptor) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: tool.name,
    url: publicUrl(tool.path),
    description: tool.description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "GBP",
    },
    publisher: PUBLISHER,
  } as const;
}

/** The hub: a collection page listing the tools by reference. */
export function freeToolsHubJsonLd(tools: readonly FreeToolDescriptor[]) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Free Business Tools — NiteOwl AI",
    url: publicUrl("/free-tools"),
    isAccessibleForFree: true,
    publisher: PUBLISHER,
    hasPart: tools.map((tool) => ({
      "@type": "WebApplication",
      name: tool.name,
      url: publicUrl(tool.path),
    })),
  } as const;
}
