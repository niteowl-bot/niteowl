"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import OnboardingHoursStep from "./OnboardingHoursStep";
import OnboardingKnowledgeStep from "./OnboardingKnowledgeStep";
import OnboardingWidgetStep from "./OnboardingWidgetStep";

const TOTAL_STEPS = 4;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [form, setForm] = useState({
    businessName: "",
    businessType: "",
    website: "",
    description: "",
    primaryGoal: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmitStep1 = async () => {
    if (!form.businessName || !form.businessType || !form.primaryGoal) return;
    setSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("Not authenticated.");

      const { data, error: insertError } = await supabase
        .from("organisations")
        .insert({
          owner_id: user.id,
          business_name: form.businessName.trim(),
          business_type: form.businessType,
          website: form.website.trim() || null,
          description: form.description.trim() || null,
          primary_goal: form.primaryGoal,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      setOrgId(data.id);
      setSubmitting(false);
      setStep(2);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setSubmitting(false);
    }
  };

  const isStep1Valid =
    form.businessName.trim() && form.businessType && form.primaryGoal;

  const inputBase =
    "w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 hover:border-white/20";

  const labelBase =
    "mb-1.5 block text-xs font-medium tracking-wide text-white/50 uppercase";

  return (
    <div className="min-h-screen bg-[#0d0f14] flex items-center justify-center px-4 py-12">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        <div className="mb-8 flex items-center gap-2.5">
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

        <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-8 shadow-2xl shadow-black/40">
          <div className="mb-6 flex items-center gap-2">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
              <div
                key={s}
                className={`h-1 rounded-full transition-all ${
                  s === step ? "w-8 bg-blue-500" : s < step ? "w-4 bg-blue-500/40" : "w-4 bg-white/10"
                }`}
              />
            ))}
            <span className="ml-auto text-xs text-white/30">
              Step {step} of {TOTAL_STEPS}
            </span>
          </div>

          {step === 1 && (
            <>
              <h1 className="text-xl font-semibold text-white">
                Tell us about your business
              </h1>
              <p className="mt-1.5 text-sm text-white/40">
                This helps Remy personalise your AI assistant.
              </p>

              <div className="mt-7 space-y-5">
                <div>
                  <label htmlFor="businessName" className={labelBase}>
                    Business name <span className="text-blue-400">*</span>
                  </label>
                  <input
                    id="businessName"
                    name="businessName"
                    type="text"
                    autoComplete="organization"
                    placeholder="e.g. Bright Plumbing Co."
                    value={form.businessName}
                    onChange={handleChange}
                    className={inputBase}
                  />
                </div>

                <div>
                  <label htmlFor="businessType" className={labelBase}>
                    Business type <span className="text-blue-400">*</span>
                  </label>
                  <div className="relative">
                    <select
                      id="businessType"
                      name="businessType"
                      value={form.businessType}
                      onChange={handleChange}
                      className={`${inputBase} appearance-none pr-10 ${
                        !form.businessType ? "text-white/30" : "text-white"
                      }`}
                    >
                      <option value="" disabled hidden>Select a type</option>
                      {["E-commerce", "Real Estate", "Consulting", "SaaS", "Finance", "Other"].map((t) => (
                        <option key={t} value={t} className="bg-[#13151c] text-white">{t}</option>
                      ))}
                    </select>
                    <ChevronIcon />
                  </div>
                </div>

                <div>
                  <label htmlFor="website" className={labelBase}>
                    Website{" "}
                    <span className="normal-case font-normal text-white/25">(optional)</span>
                  </label>
                  <input
                    id="website"
                    name="website"
                    type="url"
                    autoComplete="url"
                    placeholder="https://yourwebsite.com"
                    value={form.website}
                    onChange={handleChange}
                    className={inputBase}
                  />
                </div>

                <div>
                  <label htmlFor="description" className={labelBase}>
                    Describe your business
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    rows={3}
                    placeholder="What do you do, who do you serve, and what makes you different?"
                    value={form.description}
                    onChange={handleChange}
                    className={`${inputBase} resize-none leading-relaxed`}
                  />
                </div>

                <div>
                  <label htmlFor="primaryGoal" className={labelBase}>
                    Primary goal <span className="text-blue-400">*</span>
                  </label>
                  <div className="relative">
                    <select
                      id="primaryGoal"
                      name="primaryGoal"
                      value={form.primaryGoal}
                      onChange={handleChange}
                      className={`${inputBase} appearance-none pr-10 ${
                        !form.primaryGoal ? "text-white/30" : "text-white"
                      }`}
                    >
                      <option value="" disabled hidden>What should Remy focus on?</option>
                      {["Generate leads", "Customer support", "Book appointments", "Sales", "Other"].map((g) => (
                        <option key={g} value={g} className="bg-[#13151c] text-white">{g}</option>
                      ))}
                    </select>
                    <ChevronIcon />
                  </div>
                </div>
              </div>

              {error && (
                <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmitStep1}
                disabled={!isStep1Valid || submitting}
                className="mt-8 flex w-full items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#13151c]"
              >
                {submitting ? (
                  <>
                    <Spinner />
                    Setting up…
                  </>
                ) : (
                  <>
                    Continue
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </>
                )}
              </button>
            </>
          )}

          {step === 2 && orgId && (
  <OnboardingHoursStep
    orgId={orgId}
    onNext={() => setStep(3)}
  />
)}

{step === 3 && orgId && (
  <OnboardingKnowledgeStep
    orgId={orgId}
    onNext={() => setStep(4)}
  />
)}
{step === 4 && orgId && (
  <OnboardingWidgetStep orgId={orgId} />
)}

        </div>
      </div>
    </div>
  );
}

function ChevronIcon() {
  return (
    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M3.5 5.5 7 9l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5" />
      <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

