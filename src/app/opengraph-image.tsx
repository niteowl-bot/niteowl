import { ImageResponse } from "next/og";

// Branded social-share image (Open Graph + Twitter). Generated at build
// time from markup — no external asset, no binary in the repo. Next.js
// automatically wires this into the page's og:image / twitter:image tags.

export const alt =
  "Remy — the AI receptionist that never misses a customer enquiry";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #020617 0%, #0f172a 55%, #1e1b4b 100%)",
          padding: "72px",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 700 }}>
          niteowl<span style={{ color: "#818cf8" }}>.</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              alignSelf: "flex-start",
              gap: 12,
              background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(129,140,248,0.4)",
              color: "#c7d2fe",
              borderRadius: 999,
              padding: "10px 22px",
              fontSize: 24,
            }}
          >
            AI receptionist · always on
          </div>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, maxWidth: 960 }}>
            Never miss another customer enquiry
          </div>
          <div style={{ fontSize: 32, color: "#94a3b8", maxWidth: 900, lineHeight: 1.3 }}>
            Remy answers questions, captures every lead, and books appointments — day or night.
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 26, color: "#64748b" }}>
          niteowlhq.com · Start your free 14-day trial
        </div>
      </div>
    ),
    { ...size }
  );
}
