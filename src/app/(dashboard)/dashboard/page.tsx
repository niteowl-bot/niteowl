import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetupChecklist from "./SetupChecklist";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id, business_name, business_type, primary_goal, website, description")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
.limit(1)
.single();


  if (orgError || !org) redirect("/onboarding");

  return (
    <div className="min-h-screen bg-[#0d0f14] px-4 py-10 md:px-8">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-blue-600/8 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl">
        {/* Header */}
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-600/30">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8c0 1.74.65 3.33 1.72 4.54L1.5 14.5l2.04-1.69A6.48 6.48 0 0 0 8 14.5c3.59 0 6.5-2.91 6.5-6.5S11.59 1.5 8 1.5Z"
                  fill="currentColor"
                  opacity=".3"
                />
                <circle cx="5.5" cy="8.5" r="1" fill="currentColor" />
                <circle cx="8" cy="8.5" r="1" fill="currentColor" />
                <circle cx="10.5" cy="8.5" r="1" fill="currentColor" />
              </svg>
            </span>
            <span className="text-sm font-semibold tracking-tight text-white">
              Niteowl <span className="text-white/40">AI</span>
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
            <span className="text-xs text-white/50">Active</span>
          </div>
        </header>

        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-white">
            Welcome back,{" "}
            <span className="text-blue-400">{org.business_name}</span>
          </h1>
          <p className="mt-1 text-sm text-white/40">
            Here&apos;s what Remy knows about your business.
          </p>
        </div>
{/* Setup checklist */}
<SetupChecklist orgId={org.id} />

        {/* Detail cards grid */}
        <div className="grid gap-4 sm:grid-cols-2">
          <InfoCard
            label="Business name"
            value={org.business_name}
            icon={<BuildingIcon />}
          />
          <InfoCard
            label="Business type"
            value={org.business_type}
            icon={<TagIcon />}
          />
          <InfoCard
            label="Primary goal"
            value={org.primary_goal}
            icon={<TargetIcon />}
          />
          <InfoCard
            label="Website"
            value={org.website ?? null}
            icon={<GlobeIcon />}
            isLink
            empty="Not provided"
          />
        </div>
{/* Add to the grid of InfoCards, or below the existing cards */}
<div className="col-span-full mt-2 grid gap-3 sm:grid-cols-2">
  <a
    href="/chat"
    className="flex items-center gap-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 transition hover:border-blue-500/40 hover:bg-blue-500/8 group"
  >
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 group-hover:bg-blue-600/30 transition">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M10 2C5.58 2 2 5.58 2 10c0 1.96.71 3.76 1.88 5.17L2 18l2.9-1.96A7.96 7.96 0 0 0 10 18c4.42 0 8-3.58 8-8s-3.58-8-8-8Z"
          fill="currentColor"
          opacity=".25"
        />
        <circle cx="7" cy="10" r="1.2" fill="currentColor" />
        <circle cx="10" cy="10" r="1.2" fill="currentColor" />
        <circle cx="13" cy="10" r="1.2" fill="currentColor" />
      </svg>
    </span>
    <div>
      <p className="text-sm font-medium text-white">Chat with Remy</p>
      <p className="mt-0.5 text-xs text-white/40">
        Ask your AI assistant anything about your business
      </p>
    </div>
    <svg className="ml-auto text-white/20 group-hover:text-white/40 transition" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 8h8M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </a>

  <a
    href="/knowledge"
    className="flex items-center gap-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 transition hover:border-blue-500/40 hover:bg-blue-500/8 group"
  >
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 group-hover:bg-blue-600/30 transition">
      <DocumentIcon />
    </span>
    <div>
      <p className="text-sm font-medium text-white">Knowledge Base</p>
      <p className="mt-0.5 text-xs text-white/40">
        Add, edit, or remove FAQ, pricing, and policy entries
      </p>
    </div>
    <svg className="ml-auto text-white/20 group-hover:text-white/40 transition" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 8h8M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </a>
</div>


        {/* Description — full width */}
        <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#13151c] p-6">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="text-white/30">
              <DocumentIcon />
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-white/40">
              Business description
            </span>
          </div>
          {org.description ? (
            <p className="text-sm leading-relaxed text-white/70">{org.description}</p>
          ) : (
            <p className="text-sm text-white/25 italic">No description provided.</p>
          )}
        </div>

        {/* Next step prompt */}
        <div className="mt-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
          <div className="flex items-start gap-4">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400">
              <SparkleIcon />
            </span>
            <div>
              <p className="text-sm font-medium text-white">
                Remy is ready to be configured
              </p>
              <p className="mt-0.5 text-sm text-white/40">
                Connect a phone number so Remy can start replying to your
                missed calls and messages.
              </p>
              <button className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                Connect a number →
              </button>
            </div>
          </div>
        </div>

        {/* Edit link */}
        <p className="mt-6 text-center text-xs text-white/25">
          Need to update these details?{" "}
          <a
            href="/settings"
            className="text-white/40 underline underline-offset-2 hover:text-white/60 transition"
          >
            Go to Settings
          </a>
        </p>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function InfoCard({
  label,
  value,
  icon,
  isLink = false,
  empty = "—",
}: {
  label: string;
  value: string | null;
  icon: React.ReactNode;
  isLink?: boolean;
  empty?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#13151c] p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-white/30">{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-white/40">
          {label}
        </span>
      </div>
      {value ? (
        isLink ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-400 underline-offset-2 hover:underline"
          >
            {value}
          </a>
        ) : (
          <p className="text-sm font-medium text-white">{value}</p>
        )
      ) : (
        <p className="text-sm text-white/25 italic">{empty}</p>
      )}
    </div>
  );
}

// ── Icons (inline SVGs, no extra dependency) ──────────────────────

function BuildingIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M2 13V5.5L7.5 2l5.5 3.5V13H9.5v-3h-4v3H2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 10h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M1.5 1.5h5l6.5 6.5-5 5L1.5 6.5v-5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="4.5" cy="4.5" r="1" fill="currentColor" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7.5" cy="7.5" r=".8" fill="currentColor" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 7.5h11M7.5 2C6 4 5 5.7 5 7.5S6 11 7.5 13C9 11 10 9.3 10 7.5S9 4 7.5 2Z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M4 1.5h4.5L11 4v9.5H4V1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8.5 1.5V4H11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 7h3M6 9.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M7.5 1.5v3M7.5 10.5v3M1.5 7.5h3M10.5 7.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.5 5.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" fill="currentColor" opacity=".4" />
    </svg>
  );
}

