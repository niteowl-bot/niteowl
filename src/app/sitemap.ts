import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, publicUrl } from "@/lib/site/publicRoutes";

// Next.js `sitemap.ts` file convention (node_modules/next/dist/docs/
// 01-app/03-api-reference/03-file-conventions/01-metadata/sitemap.md).
//
// A PURE FUNCTION OF ONE STATIC LIST. Every URL comes from
// PUBLIC_ROUTES; nothing is discovered from the filesystem, a request or
// a store, so a private route can never appear here by accident. There
// is no lastModified: no reliable per-route date exists and none is
// invented, so the output is identical for every call and every visitor.
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: publicUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
