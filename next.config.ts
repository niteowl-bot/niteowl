import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // pdf-to-img (via pdfjs-dist) fails to bundle under Turbopack — it uses
  // Node-specific dynamic module resolution for its worker/canvas factory
  // that static analysis can't follow. Marking it external makes Next.js
  // require() it normally at runtime in the process route instead of
  // trying to bundle it, which is the documented fix for this class of
  // package.
  serverExternalPackages: ["pdf-to-img", "pdfjs-dist"],
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.niteowlhq.com" }],
        destination: "https://niteowlhq.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
