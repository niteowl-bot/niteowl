import type { Metadata } from "next";
import SetupKitClient from "./SetupKitClient";

// ── AI Receptionist Business Setup Kit ─────────────────────────────
//
// A server component whose only job is metadata and mounting the
// wizard. Everything interactive is in SetupKitClient, and everything
// the wizard produces is derived by the pure function in
// @/lib/freetools/setupKit.
//
// NO PERSISTENCE, NO AUTH, NO NETWORK. There is no API route behind this
// page, no database table, no cookie and no stored identifier. The
// answers live in client memory for one page view.
//
// NO REMY, NO PROVIDER. Nothing imports leadCapture, lib/voice,
// availability, calendarSync or integrations, and nothing may. The
// appointment questions here are CONFIGURATION GUIDANCE the visitor
// writes for themselves — they do not reach Google Calendar, Remy's
// booking engine or any availability code.

export const metadata: Metadata = {
  title: "AI Receptionist Business Setup Kit — Free Tool | NiteOwl AI",
  description:
    "Answer a few questions and get a clear, structured receptionist setup for your business — opening hours, services, common questions, and what to do out of hours. Free, no account needed.",
  alternates: { canonical: "/free-tools/ai-receptionist-setup-kit" },
};

export default function SetupKitPage() {
  return <SetupKitClient />;
}
