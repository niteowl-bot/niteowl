"use client";

import { useEffect } from "react";

// Catches an error thrown by the root layout itself — rare, but when it
// happens Next.js requires this file to render its own <html>/<body>
// since it replaces the entire root layout, not just a page inside it.
// Kept deliberately simple (plain <a>, no shared components) since this
// is the last line of defence if something more foundational breaks.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "3rem 1rem",
          textAlign: "center",
          background: "#0d0f14",
          color: "#ffffff",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: 380 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#f87171",
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ marginTop: 8, fontSize: 22, fontWeight: 600 }}>
            NiteOwl AI hit a snag
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: 14,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            This has been reported to our team automatically. Please try
            again.
          </p>
          <div
            style={{
              marginTop: 28,
              display: "flex",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <button
              onClick={reset}
              style={{
                borderRadius: 12,
                background: "#2563eb",
                color: "#fff",
                border: "none",
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.7)",
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Go to homepage
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
