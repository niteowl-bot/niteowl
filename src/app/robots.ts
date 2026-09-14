import type { MetadataRoute } from "next";
import { PRIVATE_ROUTE_PREFIXES, SITE_URL } from "@/lib/site/publicRoutes";

// Next.js `robots.ts` file convention (node_modules/next/dist/docs/
// 01-app/03-api-reference/03-file-conventions/01-metadata/robots.md).
//
// Public by default, private by family. The disallow list is the same
// PRIVATE_ROUTE_PREFIXES the sitemap tests pin against the real route
// inventory, so the two files cannot disagree about what is private.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_ROUTE_PREFIXES],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
