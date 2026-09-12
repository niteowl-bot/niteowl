"use client";

// ── The Business Opportunity Scan surface ─────────────────────────
//
// EPHEMERAL BY CONSTRUCTION. Answers live in one `useState` and nowhere
// else. No localStorage, no sessionStorage, no cookie, no query string,
// no anonymous id, no fetch, no API route, no analytics. Refreshing or
// leaving the page discards everything, and the visitor is told so
// before they start (docs/ARCHITECTURE.md §26, §89.2).
//
// IT RENDERS, IT DOES NOT DECIDE. The questions come from
// SCAN_QUESTIONS, the refusals from validateScanAnswers, the findings,
// sizing and recommendations from buildScanReport — all shipped pure
// modules. This file holds no rule about what a finding is, what it is
// worth, how confident it is, or which product addresses it. Every
// finding is shown exactly as delivered, in the order delivered, with
// the product and the handoff it carries (§84.2, §84.3, §87.3).
//
// Q1 AND Q2 ARE ANSWERS, NOT SWITCHES. They are asked, and they are
// shown back under "What you told us". Nothing here reads them to show
// or hide a product, a handoff or a finding — that question (Q1/Q2-
// aware routing, §87.2) is deferred and is not answered by a component.
// This file therefore contains no question id at all: every question
// is handled by its KIND.
//
// THE ONE NON-DETERMINISTIC INPUT is the pair of timestamps the report
// records as-of. They are read here, at the moment the visitor asks for
// the report, and passed in — the scan modules read no clock.
//
// SAVING USES THE BROWSER'S OWN PRINT PIPELINE — window.print() and the
// free-tools print stylesheet already loaded by the layout. No PDF
// library, no hosted service: the answers never leave the tab.
//
// The report is a separate exported component so a test can render the
// thing that actually reaches the screen and the page — the same reason
// the Setup Kit exports SetupDocument.

import { useState } from "react";
import Link from "next/link";
import { SCAN_QUESTIONS, scanQuestion } from "@/lib/freetools/scanQuestions";
import type { ScanQuestion } from "@/lib/freetools/scanQuestions";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";
import type { ScanValidationError } from "@/lib/freetools/scanValidation";
import { buildScanReport } from "@/lib/freetools/scanFindings";
import type {
  ScanAnswers,
  ScanQuestionId,
  ScanReport,
  ScanReportFinding,
} from "@/lib/freetools/scanTypes";
import {
  CAP_REASON_LABELS,
  CONFIDENCE_LABELS,
  CURRENCY_CHOICES,
  ERROR_LABELS,
  NO_FINDINGS_WORDING,
  OTHER_CURRENCY,
  PRODUCT_ATTRIBUTION,
  UNKNOWN_REASON_LABELS,
  answerLabel,
  draftToPayload,
  emptyDraft,
  formatImpactRange,
  valueLabel,
} from "@/app/free-tools/business-opportunity-scan/scanPresentation";
import type { CountDraft, DraftValue, MoneyDraft, ScanDraft } from "@/app/free-tools/business-opportunity-scan/scanPresentation";

/**
 * The nine questions in three screens, by POSITION in the canonical
 * order — never by id. The split is layout: the two sizing operands
 * sit last in the contract, and they get a screen that says so.
 */
const STEPS = [
  { title: "How enquiries reach you", from: 0, to: 2 },
  { title: "What happens to them", from: 2, to: 7 },
  { title: "Sizing it (optional)", from: 7, to: 9 },
] as const;

const inputClass =
  "w-full rounded-lg bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-[15px] text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent";
const optionClass =
  "flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3.5 py-3 text-[15px] text-slate-200 cursor-pointer hover:border-slate-700";
const hintClass = "text-[13px] text-slate-500 mb-2";
const errorClass = "text-[13px] text-rose-300 mt-2";

// ── The report ────────────────────────────────────────────────────

function FindingCard({ entry, index }: { entry: ScanReportFinding; index: number }) {
  const { finding, impact, recommendation } = entry;
  const capReason = finding.confidence_cap_reason;
  return (
    <article
      data-condition={finding.condition}
      className="ft-doc-section border-t border-slate-800 pt-6"
    >
      <p className="text-indigo-400 text-sm font-medium mb-1">Finding {index + 1}</p>
      <h2 className="text-white font-semibold text-xl mb-3">{recommendation.headline}</h2>
      <p className="text-slate-300 text-[15px] leading-relaxed">
        {recommendation.why_it_matters}
      </p>

      <h3 className="text-slate-200 font-medium mt-6 mb-2">What you told us that supports this</h3>
      <dl className="space-y-2">
        {finding.evidence.map((ref) => (
          <div key={ref.question_id} className="flex flex-col sm:flex-row sm:gap-4">
            <dt className="text-slate-500 text-sm sm:w-72 shrink-0">
              {scanQuestion(ref.question_id)?.wording}
            </dt>
            <dd className="text-slate-200 text-[15px]">
              <span data-evidence={ref.question_id}>{answerLabel(ref.raw_answer)}</span>{" "}
              <span className="text-slate-500 text-sm">(your answer)</span>
            </dd>
          </div>
        ))}
      </dl>

      <h3 className="text-slate-200 font-medium mt-6 mb-2">How confident we are</h3>
      <p className="text-slate-300 text-[15px]" data-finding-confidence={finding.finding_confidence}>
        In the finding: {CONFIDENCE_LABELS[finding.finding_confidence]}.
        {capReason && <> {CAP_REASON_LABELS[capReason]}</>}
      </p>

      <h3 className="text-slate-200 font-medium mt-6 mb-2">What it may be worth</h3>
      {impact.kind === "estimate" ? (
        <div data-impact="estimate">
          <p className="text-white text-lg font-semibold">
            {formatImpactRange(impact.basis.result)}
          </p>
          <p className="text-slate-400 text-sm mt-1">
            An estimate worked out from your own numbers — a range, not a measurement.
          </p>
          <p
            className="text-slate-300 text-[15px] mt-3"
            data-size-confidence={impact.basis.size_confidence}
          >
            In the size: {CONFIDENCE_LABELS[impact.basis.size_confidence]}.
            {impact.basis.size_confidence_cap_reason && (
              <> {CAP_REASON_LABELS[impact.basis.size_confidence_cap_reason]}</>
            )}
          </p>
          <ul className="mt-3 space-y-1.5" data-assumptions>
            {impact.basis.assumptions.map((a) => (
              <li key={a.code} className="text-slate-400 text-sm leading-relaxed">
                {a.display_text}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-slate-300 text-[15px]" data-impact="unknown">
          We cannot size this. {UNKNOWN_REASON_LABELS[impact.reason]}
        </p>
      )}

      <h3 className="text-slate-200 font-medium mt-6 mb-2">Next step</h3>
      <p className="text-slate-300 text-[15px] leading-relaxed" data-next-step>
        {recommendation.next_step}
      </p>

      <h3 className="text-slate-200 font-medium mt-6 mb-2">How you will know it worked</h3>
      <p className="text-slate-300 text-[15px] leading-relaxed" data-success-criterion>
        {recommendation.success_criterion.wording} Look again in{" "}
        {recommendation.review_window_days} days.
      </p>

      {recommendation.free_tool_handoff && (
        <p className="mt-4" data-handoff>
          <Link
            href={recommendation.free_tool_handoff.href}
            className="text-indigo-400 hover:text-indigo-300 text-[15px] font-medium"
          >
            {recommendation.free_tool_handoff.label} →
          </Link>
        </p>
      )}

      {recommendation.recommended_product && (
        <p
          className="text-slate-500 text-sm leading-relaxed mt-4"
          data-product={recommendation.recommended_product}
        >
          {PRODUCT_ATTRIBUTION[recommendation.recommended_product]}
        </p>
      )}
    </article>
  );
}

/**
 * The scan report, exactly as it appears on screen AND on paper.
 *
 * ONE RENDERING, TWO MEDIA. The saved copy is this component with the
 * print stylesheet over it. It adds nothing: every statement about the
 * business is the engine's own output or the visitor's own answer.
 */
export function ScanReportDocument({
  report,
  answers,
}: {
  report: ScanReport;
  answers: ScanAnswers;
}) {
  return (
    <>
      <header className="ft-print-only ft-print-header">
        <div className="ft-print-brand">
          niteowl<span>.</span>
        </div>
        <p className="ft-print-doctitle">Business Opportunity Scan</p>
      </header>

      <p className="ft-no-print text-indigo-400 text-sm font-medium mb-3">Your report</p>
      <h1 className="ft-doc-title text-2xl sm:text-3xl font-bold text-white tracking-tight mb-3">
        Business Opportunity Scan
      </h1>
      <p className="ft-doc-notice text-slate-400 text-sm leading-relaxed mb-8">
        Based only on the answers you gave. Nothing here has been checked against your
        systems or records, and any figure is an estimate worked out from your own numbers.
        It is our reading of what you told us, not something we have looked at ourselves.
      </p>

      {report.inconsistencies.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 mb-8">
          {report.inconsistencies.map((inc) => (
            <p key={inc.code} className="text-amber-200 text-sm leading-relaxed" data-inconsistency={inc.code}>
              {inc.message}
            </p>
          ))}
        </div>
      )}

      <div className="ft-doc-sections space-y-8">
        {report.findings.length === 0 ? (
          <section className="ft-doc-section border-t border-slate-800 pt-6" data-no-findings>
            <h2 className="text-white font-semibold text-xl mb-3">No clear opportunity found</h2>
            <p className="text-slate-300 text-[15px] leading-relaxed">{NO_FINDINGS_WORDING}</p>
          </section>
        ) : (
          report.findings.map((entry, i) => (
            <FindingCard key={entry.finding.condition} entry={entry} index={i} />
          ))
        )}

        <section className="ft-doc-section border-t border-slate-800 pt-6" data-what-you-told-us>
          <h2 className="text-white font-semibold mb-3">What you told us</h2>
          <dl className="space-y-2">
            {SCAN_QUESTIONS.map((q) => {
              const value = answers[q.id];
              return (
                <div key={q.id} className="flex flex-col sm:flex-row sm:gap-4 border-b border-slate-800 pb-2">
                  <dt className="text-slate-500 text-sm sm:w-72 shrink-0">{q.wording}</dt>
                  <dd className="text-slate-200 text-[15px] break-words" data-answer={q.id}>
                    {value === undefined || value === null ? "Not answered" : answerLabel(value)}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="ft-doc-note text-slate-500 text-[13px] leading-relaxed mt-3">
            Your own answers, exactly as given. Question set {report.question_set_version}, rules{" "}
            {report.rule_set_version}.
          </p>
        </section>
      </div>

      <footer className="ft-print-only ft-print-footer">
        <p>Prepared with NiteOwl AI Free Tools · niteowlhq.com/free-tools</p>
      </footer>
    </>
  );
}

// ── Question controls, by KIND ────────────────────────────────────

type SetDraft = (id: ScanQuestionId, value: DraftValue) => void;

function QuestionField({
  question,
  value,
  errors,
  set,
}: {
  question: ScanQuestion;
  value: DraftValue;
  errors: readonly ScanValidationError[];
  set: SetDraft;
}) {
  const error = errors[0];
  const errorId = `${question.id}-error`;
  const describedBy = error ? errorId : undefined;

  let control: React.ReactNode;

  switch (question.kind) {
    case "multi_select": {
      const chosen = value as readonly string[];
      control = (
        <div className="space-y-2">
          {question.allowedValues?.map((v) => (
            <label key={v} className={optionClass}>
              <input
                type="checkbox"
                className="mt-1"
                checked={chosen.includes(v)}
                aria-describedby={describedBy}
                onChange={() =>
                  set(
                    question.id,
                    chosen.includes(v) ? chosen.filter((c) => c !== v) : [...chosen, v]
                  )
                }
              />
              <span>{valueLabel(v)}</span>
            </label>
          ))}
        </div>
      );
      break;
    }
    case "single_select": {
      control = (
        <div className="space-y-2">
          {question.allowedValues?.map((v) => (
            <label key={v} className={optionClass}>
              <input
                type="radio"
                name={question.id}
                className="mt-1"
                checked={value === v}
                aria-describedby={describedBy}
                onChange={() => set(question.id, v)}
              />
              <span>{valueLabel(v)}</span>
            </label>
          ))}
        </div>
      );
      break;
    }
    case "count_or_not_sure": {
      const c = value as CountDraft;
      const inputId = `${question.id}-count`;
      control = (
        <div className="space-y-2">
          <label className={optionClass}>
            <input
              type="radio"
              name={question.id}
              className="mt-1"
              checked={c.mode === "count"}
              onChange={() => set(question.id, { ...c, mode: "count" })}
            />
            <span className="flex-1">
              <span className="block mb-2">A number</span>
              {c.mode === "count" && (
                <input
                  id={inputId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={`${question.wording} — number`}
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy}
                  value={c.value}
                  onChange={(e) => set(question.id, { ...c, value: e.target.value })}
                  className={`${inputClass} max-w-[10rem]`}
                  placeholder={`${question.min ?? 0}–${question.max ?? ""}`}
                />
              )}
            </span>
          </label>
          <label className={optionClass}>
            <input
              type="radio"
              name={question.id}
              className="mt-1"
              checked={c.mode === "not_sure"}
              onChange={() => set(question.id, { ...c, mode: "not_sure" })}
            />
            <span>{valueLabel("not_sure")}</span>
          </label>
        </div>
      );
      break;
    }
    case "money_or_not_sure": {
      const m = value as MoneyDraft;
      const currencyId = `${question.id}-currency`;
      const currencyPicker = (
        <div className="mt-3">
          <label htmlFor={currencyId} className="block text-sm text-slate-400 mb-1.5">
            Currency
          </label>
          <select
            id={currencyId}
            value={m.currency}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(e) => set(question.id, { ...m, currency: e.target.value })}
            className={`${inputClass} max-w-[14rem]`}
          >
            <option value="">Choose a currency…</option>
            {CURRENCY_CHOICES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
            <option value={OTHER_CURRENCY}>Other (enter a code)</option>
          </select>
          {m.currency === OTHER_CURRENCY && (
            <input
              type="text"
              maxLength={3}
              autoComplete="off"
              aria-label="Three-letter currency code"
              value={m.otherCurrency}
              onChange={(e) => set(question.id, { ...m, otherCurrency: e.target.value })}
              className={`${inputClass} max-w-[8rem] mt-2`}
              placeholder="e.g. CHF"
            />
          )}
        </div>
      );
      control = (
        <div className="space-y-2">
          <label className={optionClass}>
            <input
              type="radio"
              name={question.id}
              className="mt-1"
              checked={m.mode === "amount"}
              onChange={() => set(question.id, { ...m, mode: "amount" })}
            />
            <span className="flex-1">
              <span className="block mb-2">A typical amount</span>
              {m.mode === "amount" && (
                <>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`${question.wording} — amount`}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                    value={m.amount}
                    onChange={(e) => set(question.id, { ...m, amount: e.target.value })}
                    className={`${inputClass} max-w-[10rem]`}
                  />
                  {currencyPicker}
                </>
              )}
            </span>
          </label>
          <label className={optionClass}>
            <input
              type="radio"
              name={question.id}
              className="mt-1"
              checked={m.mode === "range"}
              onChange={() => set(question.id, { ...m, mode: "range" })}
            />
            <span className="flex-1">
              <span className="block mb-2">A range</span>
              {m.mode === "range" && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`${question.wording} — from`}
                      aria-invalid={Boolean(error)}
                      aria-describedby={describedBy}
                      value={m.low}
                      onChange={(e) => set(question.id, { ...m, low: e.target.value })}
                      className={`${inputClass} max-w-[8rem]`}
                      placeholder="from"
                    />
                    <span className="text-slate-500">to</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`${question.wording} — to`}
                      aria-invalid={Boolean(error)}
                      aria-describedby={describedBy}
                      value={m.high}
                      onChange={(e) => set(question.id, { ...m, high: e.target.value })}
                      className={`${inputClass} max-w-[8rem]`}
                      placeholder="to"
                    />
                  </div>
                  {currencyPicker}
                </>
              )}
            </span>
          </label>
          <label className={optionClass}>
            <input
              type="radio"
              name={question.id}
              className="mt-1"
              checked={m.mode === "not_sure"}
              onChange={() => set(question.id, { ...m, mode: "not_sure" })}
            />
            <span>{valueLabel("not_sure")}</span>
          </label>
        </div>
      );
      break;
    }
  }

  return (
    <fieldset className="space-y-1" data-question={question.id} aria-required={question.required}>
      <legend className="text-white font-semibold text-[17px] leading-snug mb-1">
        {question.wording}
        {!question.required && (
          <span className="text-slate-500 font-normal text-sm"> (optional)</span>
        )}
      </legend>
      {question.kind === "multi_select" && <p className={hintClass}>Choose all that apply.</p>}
      {control}
      {error && (
        <p id={errorId} className={errorClass} role="alert" data-error={error.code}>
          {ERROR_LABELS[error.code]}
        </p>
      )}
    </fieldset>
  );
}

// ── The page ──────────────────────────────────────────────────────

type Phase = "intro" | "questions" | "report";

export default function ScanClient() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ScanDraft>(emptyDraft);
  const [errors, setErrors] = useState<readonly ScanValidationError[]>([]);
  const [result, setResult] = useState<{ report: ScanReport; answers: ScanAnswers } | null>(
    null
  );

  const set: SetDraft = (id, value) => setDraft((d) => ({ ...d, [id]: value }));

  const stepQuestions = (s: number) => SCAN_QUESTIONS.slice(STEPS[s].from, STEPS[s].to);
  const errorsFor = (id: ScanQuestionId) => errors.filter((e) => e.question_id === id);

  /** Refusals on the current screen only — the validator is the sole authority. */
  function refusalsOnStep(s: number): ScanValidationError[] {
    const ids = new Set<ScanQuestionId | null>(stepQuestions(s).map((q) => q.id));
    return validateScanAnswers(draftToPayload(draft)).errors.filter((e) => ids.has(e.question_id));
  }

  function next() {
    const refused = refusalsOnStep(step);
    setErrors(refused);
    if (refused.length > 0) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setErrors([]);
    setStep((s) => Math.max(s - 1, 0));
  }

  function finish() {
    const validation = validateScanAnswers(draftToPayload(draft));
    if (!validation.valid || !validation.answers) {
      setErrors(validation.errors);
      const firstBad = STEPS.findIndex((_, i) =>
        stepQuestions(i).some((q) => validation.errors.some((e) => e.question_id === q.id))
      );
      if (firstBad >= 0) setStep(firstBad);
      return;
    }
    // The as-of instants, read once, here, and passed in.
    const now = new Date().toISOString();
    const report = buildScanReport(
      validation.answers,
      { answered_at: now, computed_at: now },
      validation.inconsistencies
    );
    setErrors([]);
    setResult({ report, answers: validation.answers });
    setPhase("report");
  }

  function startAgain() {
    setDraft(emptyDraft());
    setErrors([]);
    setResult(null);
    setStep(0);
    setPhase("intro");
  }

  // ── Intro ────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 sm:py-16">
        <p className="text-indigo-400 text-sm font-medium mb-3">Free tool</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
          Business Opportunity Scan
        </h1>
        <p className="text-slate-400 text-[15px] leading-relaxed mb-4">
          Nine short questions about how enquiries reach your business and what happens to
          them. You get a plain report on where you may be missing work, what you could do
          about it, and how you would know it worked — in a few minutes, and you keep it.
        </p>
        <ul className="text-slate-400 text-[15px] leading-relaxed space-y-2 mb-8 list-disc pl-5">
          <li>Nothing is stored, and nothing is sent to NiteOwl. Your answers stay in this browser tab.</li>
          <li>Refreshing or closing the page clears the scan. Save a copy at the end if you want to keep it.</li>
          <li>No account, no card, no sales call. The report is complete either way.</li>
          <li>“Not sure” is always a fine answer. It will never count against you.</li>
        </ul>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setPhase("questions")}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 transition-colors"
          >
            Start the scan
          </button>
          <Link
            href="/free-tools"
            className="rounded-lg text-slate-400 hover:text-white text-sm font-medium px-4 py-2.5 transition-colors"
          >
            All free tools
          </Link>
        </div>
      </div>
    );
  }

  // ── Report ───────────────────────────────────────────────────────
  if (phase === "report" && result) {
    return (
      <div className="ft-doc max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <ScanReportDocument report={result.report} answers={result.answers} />

        <div className="ft-no-print border-t border-slate-800 mt-10 pt-6">
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 mb-6">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 transition-colors"
            >
              Save a copy
            </button>
            <p className="text-slate-400 text-[13px] leading-relaxed mt-3">
              This opens your browser&rsquo;s print window. Choose{" "}
              <strong className="text-slate-200 font-medium">Save as PDF</strong> as the
              destination to keep a copy. It is prepared in this browser and sent nowhere.
            </p>
          </div>
          <p className="text-slate-500 text-[13px] leading-relaxed mb-5">
            This report is not saved anywhere — closing or refreshing this page will clear it.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setPhase("questions");
                setStep(STEPS.length - 1);
              }}
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

  // ── Questions ────────────────────────────────────────────────────
  const current = STEPS[step];
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
          aria-label="Scan progress"
        >
          <div
            className="h-full bg-indigo-500 transition-all"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        {step === 0 && (
          <p className={`${hintClass} mt-3`}>
            Your answers stay in this browser tab only — nothing is saved or sent anywhere,
            so refreshing the page will clear them.
          </p>
        )}
        {step === STEPS.length - 1 && (
          <p className={`${hintClass} mt-3`}>
            These two are optional. They are only used to put a rough figure on a finding,
            and leaving them or choosing “Not sure” never counts against you.
          </p>
        )}
      </div>

      <div className="space-y-8">
        {stepQuestions(step).map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            value={draft[q.id]}
            errors={errorsFor(q.id)}
            set={set}
          />
        ))}
      </div>

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
            onClick={finish}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 transition-colors"
          >
            Get my report
          </button>
        )}
      </div>
    </div>
  );
}
