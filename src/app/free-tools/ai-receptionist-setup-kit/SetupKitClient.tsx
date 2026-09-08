"use client";

// ── The Setup Kit wizard ───────────────────────────────────────────
//
// EPHEMERAL BY CONSTRUCTION. Answers live in one `useState` and nowhere
// else. No localStorage, no sessionStorage, no cookie, no anonymous id,
// no fetch, no API route, no analytics. Refreshing the page discards
// everything, and that is the intended Phase 2 behaviour rather than a
// limitation to work around later — a tool that quietly starts
// remembering visitors has changed what it is.
//
// The one visible consequence is warned about before the visitor starts
// typing, because losing ten minutes of answers to a stray refresh is
// the kind of thing a tool should say up front rather than apologise for
// afterwards.
//
// NOTHING HERE REACHES REMY. The only import that is not React is the
// pure derivation in @/lib/freetools — no lead capture, no booking, no
// knowledge base, no organisation lookup, no provider.

import { useState } from "react";
import Link from "next/link";
import {
  COLLECT_FIELD_LABELS,
  buildReceptionistSetup,
  emptyProfile,
} from "@/lib/freetools/setupKit";
import type { BusinessSetupProfile } from "@/lib/freetools/types";

const STEPS = [
  { id: "business", title: "Your business" },
  { id: "hours", title: "Opening hours" },
  { id: "services", title: "Services" },
  { id: "questions", title: "Common questions" },
  { id: "collect", title: "What to collect" },
  { id: "appointments", title: "Appointments" },
  { id: "escalation", title: "Out of hours" },
  { id: "review", title: "Review" },
] as const;

const COLLECT_ORDER = [
  "name",
  "phone",
  "email",
  "address",
  "reason",
  "preferred_time",
];

/** Shared input styling — labels are always real <label> elements. */
const inputClass =
  "w-full rounded-lg bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-[15px] text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent";
const labelClass = "block text-sm font-medium text-slate-300 mb-1.5";
const hintClass = "text-[13px] text-slate-500 mb-2";

export default function SetupKitClient() {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<BusinessSetupProfile>(emptyProfile);
  const [showResult, setShowResult] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const set = <K extends keyof BusinessSetupProfile>(
    key: K,
    value: BusinessSetupProfile[K]
  ) => setProfile((p) => ({ ...p, [key]: value }));

  // Only the business name is required. Everything else is optional on
  // purpose: a half-filled setup is still useful, and a wall of required
  // fields is how a free tool loses the person it was meant to help.
  const nameMissing = profile.businessName.trim().length === 0;
  const blocked = step === 0 && nameMissing;

  function next() {
    if (blocked) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setAttempted(false);
    setStep((s) => Math.max(s - 1, 0));
  }

  function startAgain() {
    setProfile(emptyProfile());
    setStep(0);
    setShowResult(false);
    setAttempted(false);
  }

  const toggleCollect = (field: string) =>
    set(
      "collectFields",
      profile.collectFields.includes(field)
        ? profile.collectFields.filter((f) => f !== field)
        : [...profile.collectFields, field]
    );

  const setService = (i: number, value: string) =>
    set(
      "services",
      profile.services.map((s, idx) => (idx === i ? value : s))
    );

  const setQuestion = (i: number, key: "question" | "answer", value: string) =>
    set(
      "commonQuestions",
      profile.commonQuestions.map((q, idx) =>
        idx === i ? { ...q, [key]: value } : q
      )
    );

  // ── Result ───────────────────────────────────────────────────────
  if (showResult) {
    const setup = buildReceptionistSetup(profile);
    return (
      <div className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <p className="text-indigo-400 text-sm font-medium mb-3">
          Your receptionist setup
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-3">
          {setup.businessName || "Your business"}
        </h1>
        <p className="text-slate-400 text-sm leading-relaxed mb-10">
          Based on the information you provided. Nothing here has been
          verified — it is a written-up version of your own answers, so
          check it reads the way you want before you rely on it.
        </p>

        <div className="space-y-8">
          {setup.sections.map((section) => (
            <section
              key={section.id}
              className="border-t border-slate-800 pt-6"
            >
              <h2 className="text-white font-semibold mb-3">{section.title}</h2>
              <ul className="space-y-2">
                {section.lines.map((line, i) => (
                  <li
                    key={i}
                    className="text-slate-300 text-[15px] leading-relaxed"
                  >
                    {line}
                  </li>
                ))}
              </ul>
              {section.note && (
                <p className="text-slate-500 text-[13px] leading-relaxed mt-3">
                  {section.note}
                </p>
              )}
            </section>
          ))}
        </div>

        <div className="border-t border-slate-800 mt-10 pt-6">
          <p className="text-slate-500 text-[13px] leading-relaxed mb-5">
            You completed {setup.completedSections} of {setup.totalSections}{" "}
            sections. This setup is not saved anywhere — closing or
            refreshing this page will clear it.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowResult(false)}
              className="rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 text-sm font-medium px-4 py-2.5 transition-colors"
            >
              Back to answers
            </button>
            <button
              type="button"
              onClick={startAgain}
              className="rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 text-sm font-medium px-4 py-2.5 transition-colors"
            >
              Start again
            </button>
            <Link
              href="/free-tools"
              className="rounded-lg text-slate-400 hover:text-white text-sm font-medium px-4 py-2.5 transition-colors"
            >
              All free tools
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const current = STEPS[step];

  // ── Wizard ───────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 sm:py-16">
      <div className="mb-8">
        <div className="flex items-center justify-between text-sm mb-2">
          <p className="text-indigo-400 font-medium">
            Step {step + 1} of {STEPS.length}
          </p>
          <p className="text-slate-500">{current.title}</p>
        </div>
        <div
          className="h-1.5 rounded-full bg-slate-800 overflow-hidden"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-label="Setup progress"
        >
          <div
            className="h-full bg-indigo-500 transition-all"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {step === 0 && (
        <fieldset className="space-y-5">
          <legend className="text-xl font-bold text-white mb-1">
            Your business
          </legend>
          <p className={hintClass}>
            Your answers stay in this browser tab only — nothing is saved or
            sent anywhere, so refreshing the page will clear them.
          </p>
          <div>
            <label htmlFor="businessName" className={labelClass}>
              Business name <span className="text-indigo-400">*</span>
            </label>
            <input
              id="businessName"
              type="text"
              value={profile.businessName}
              onChange={(e) => set("businessName", e.target.value)}
              className={inputClass}
              aria-required="true"
              aria-invalid={attempted && nameMissing}
              aria-describedby={
                attempted && nameMissing ? "businessName-error" : undefined
              }
            />
            {attempted && nameMissing && (
              <p
                id="businessName-error"
                className="text-rose-400 text-[13px] mt-1.5"
              >
                Please enter your business name to continue.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="businessType" className={labelClass}>
              Type of business
            </label>
            <input
              id="businessType"
              type="text"
              value={profile.businessType}
              onChange={(e) => set("businessType", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="description" className={labelClass}>
              What you do, in a sentence
            </label>
            <textarea
              id="description"
              rows={3}
              value={profile.description}
              onChange={(e) => set("description", e.target.value)}
              className={inputClass}
            />
          </div>
        </fieldset>
      )}

      {step === 1 && (
        <fieldset className="space-y-4">
          <legend className="text-xl font-bold text-white mb-1">
            Opening hours
          </legend>
          <div>
            <label htmlFor="openingHours" className={labelClass}>
              When are you normally open or available?
            </label>
            <p className={hintClass}>
              Write it however you would tell a customer, for example
              &ldquo;Monday to Friday 9am&ndash;5pm, Saturday mornings by
              arrangement&rdquo;.
            </p>
            <textarea
              id="openingHours"
              rows={4}
              value={profile.openingHours}
              onChange={(e) => set("openingHours", e.target.value)}
              className={inputClass}
            />
          </div>
        </fieldset>
      )}

      {step === 2 && (
        <fieldset className="space-y-4">
          <legend className="text-xl font-bold text-white mb-1">
            Services and enquiries
          </legend>
          <p className={hintClass}>
            The main things customers contact you about. Add as many as are
            useful.
          </p>
          {profile.services.map((service, i) => (
            <div key={i}>
              <label htmlFor={`service-${i}`} className={labelClass}>
                Service or enquiry {i + 1}
              </label>
              <div className="flex gap-2">
                <input
                  id={`service-${i}`}
                  type="text"
                  value={service}
                  onChange={(e) => setService(i, e.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() =>
                    set(
                      "services",
                      profile.services.filter((_, idx) => idx !== i)
                    )
                  }
                  className="shrink-0 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 text-sm px-3 transition-colors"
                  aria-label={`Remove service ${i + 1}`}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set("services", [...profile.services, ""])}
            className="rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 text-sm font-medium px-4 py-2.5 transition-colors"
          >
            + Add a service
          </button>
        </fieldset>
      )}

      {step === 3 && (
        <fieldset className="space-y-5">
          <legend className="text-xl font-bold text-white mb-1">
            Common questions
          </legend>
          <p className={hintClass}>
            Questions you are asked often, and the answer you want given. A
            handful of good ones beats a long list.
          </p>
          {profile.commonQuestions.map((q, i) => (
            <div
              key={i}
              className="rounded-lg border border-slate-800 p-4 space-y-3"
            >
              <div>
                <label htmlFor={`question-${i}`} className={labelClass}>
                  Question {i + 1}
                </label>
                <input
                  id={`question-${i}`}
                  type="text"
                  value={q.question}
                  onChange={(e) => setQuestion(i, "question", e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={`answer-${i}`} className={labelClass}>
                  Answer
                </label>
                <textarea
                  id={`answer-${i}`}
                  rows={2}
                  value={q.answer}
                  onChange={(e) => setQuestion(i, "answer", e.target.value)}
                  className={inputClass}
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  set(
                    "commonQuestions",
                    profile.commonQuestions.filter((_, idx) => idx !== i)
                  )
                }
                className="text-slate-400 hover:text-white text-sm transition-colors"
              >
                Remove this question
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set("commonQuestions", [
                ...profile.commonQuestions,
                { question: "", answer: "" },
              ])
            }
            className="rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 text-sm font-medium px-4 py-2.5 transition-colors"
          >
            + Add a question
          </button>
        </fieldset>
      )}

      {step === 4 && (
        <fieldset className="space-y-3">
          <legend className="text-xl font-bold text-white mb-1">
            What to collect
          </legend>
          <p className={hintClass}>
            What should always be taken from someone getting in touch?
          </p>
          {COLLECT_ORDER.map((field) => (
            <label
              key={field}
              htmlFor={`collect-${field}`}
              className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-3 cursor-pointer hover:border-slate-700 transition-colors"
            >
              <input
                id={`collect-${field}`}
                type="checkbox"
                checked={profile.collectFields.includes(field)}
                onChange={() => toggleCollect(field)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-[15px] text-slate-200">
                {COLLECT_FIELD_LABELS[field]}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {step === 5 && (
        <fieldset className="space-y-5">
          <legend className="text-xl font-bold text-white mb-1">
            Appointments
          </legend>
          <label
            htmlFor="acceptsAppointments"
            className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-3 cursor-pointer hover:border-slate-700 transition-colors"
          >
            <input
              id="acceptsAppointments"
              type="checkbox"
              checked={profile.acceptsAppointments}
              onChange={(e) => set("acceptsAppointments", e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-[15px] text-slate-200">
              We take appointment or booking enquiries
            </span>
          </label>
          {profile.acceptsAppointments && (
            <div>
              <label htmlFor="appointmentRules" className={labelClass}>
                Any booking rules worth knowing
              </label>
              <p className={hintClass}>
                For example how much notice you need, or anything you never
                book without checking first.
              </p>
              <textarea
                id="appointmentRules"
                rows={3}
                value={profile.appointmentRules}
                onChange={(e) => set("appointmentRules", e.target.value)}
                className={inputClass}
              />
            </div>
          )}
        </fieldset>
      )}

      {step === 6 && (
        <fieldset className="space-y-5">
          <legend className="text-xl font-bold text-white mb-1">
            Out of hours and urgent enquiries
          </legend>
          <div>
            <label htmlFor="outOfHours" className={labelClass}>
              What should happen outside your normal hours?
            </label>
            <textarea
              id="outOfHours"
              rows={3}
              value={profile.outOfHours}
              onChange={(e) => set("outOfHours", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="urgentCriteria" className={labelClass}>
              What counts as urgent for your business?
            </label>
            <textarea
              id="urgentCriteria"
              rows={3}
              value={profile.urgentCriteria}
              onChange={(e) => set("urgentCriteria", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="escalation" className={labelClass}>
              When should someone get you involved?
            </label>
            <textarea
              id="escalation"
              rows={3}
              value={profile.escalation}
              onChange={(e) => set("escalation", e.target.value)}
              className={inputClass}
            />
          </div>
        </fieldset>
      )}

      {step === 7 && (
        <div className="space-y-5">
          <h2 className="text-xl font-bold text-white mb-1">
            Review your answers
          </h2>
          <p className={hintClass}>
            Go back to change anything before generating your setup.
          </p>
          <dl className="space-y-3">
            {[
              ["Business name", profile.businessName],
              ["Type of business", profile.businessType],
              ["Opening hours", profile.openingHours],
              [
                "Services",
                profile.services.filter((s) => s.trim()).join(", "),
              ],
              [
                "Common questions",
                `${
                  profile.commonQuestions.filter(
                    (q) => q.question.trim() && q.answer.trim()
                  ).length
                } added`,
              ],
              [
                "Information to collect",
                profile.collectFields
                  .map((f) => COLLECT_FIELD_LABELS[f])
                  .join(", "),
              ],
              [
                "Appointments",
                profile.acceptsAppointments ? "Accepted" : "Not accepted",
              ],
              ["Out of hours", profile.outOfHours],
              ["Urgent", profile.urgentCriteria],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex flex-col sm:flex-row sm:gap-4 border-b border-slate-800 pb-3"
              >
                <dt className="text-slate-500 text-sm sm:w-52 shrink-0">
                  {label}
                </dt>
                <dd className="text-slate-200 text-[15px] break-words">
                  {value?.trim() ? value : "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mt-10">
        <button
          type="button"
          onClick={back}
          disabled={step === 0}
          className="rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium px-4 py-2.5 transition-colors"
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={next}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 transition-colors"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowResult(true)}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 transition-colors"
          >
            Generate my setup
          </button>
        )}
      </div>
    </div>
  );
}
