"use client";

import { useState } from "react";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledgeImport/constants";

// Deliberately not importing RecordForm from KnowledgeClient.tsx — new
// review-only UI follows this repo's existing per-consumer duplication
// convention rather than sharing a component with the (untouched)
// existing Knowledge Base list.

export interface StagedItem {
  id: string;
  item_type: "knowledge" | "faq";
  category: string | null;
  title: string;
  content: string | null;
  price: number | null;
  currency: string | null;
  duration_minutes: number | null;
  notes: string | null;
  quote_required: boolean;
  starting_from: boolean;
  confidence: number | null;
  low_confidence: boolean;
  duplicate_of: string | null;
  duplicate_action: "merge" | "replace" | "keep_both" | null;
  review_status: "pending" | "approved" | "rejected";
}

export default function StagedItemForm({
  item,
  duplicateTitle,
  onSave,
  onDelete,
  onApprove,
  onReject,
  onDuplicateActionChange,
}: {
  item: StagedItem;
  duplicateTitle: string | null;
  onSave: (id: string, values: Partial<StagedItem>) => Promise<string | null>;
  onDelete: (id: string) => void;
  onApprove: (id: string) => Promise<string | null>;
  onReject: (id: string) => void;
  onDuplicateActionChange: (id: string, action: "merge" | "replace" | "keep_both") => Promise<void>;
}) {
  const [resolvingDuplicate, setResolvingDuplicate] = useState(false);

  async function handleDuplicateActionClick(action: "merge" | "replace" | "keep_both") {
    if (resolvingDuplicate) return;
    setResolvingDuplicate(true);
    await onDuplicateActionChange(item.id, action);
    setResolvingDuplicate(false);
  }

  const [form, setForm] = useState({
    category: item.category ?? "service",
    title: item.title,
    content: item.content ?? "",
    price: item.price !== null ? String(item.price) : "",
    currency: item.currency ?? "",
    duration_minutes: item.duration_minutes !== null ? String(item.duration_minutes) : "",
    notes: item.notes ?? "",
    quote_required: item.quote_required,
    starting_from: item.starting_from,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputBase =
    "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
  const labelBase = "mb-1 block text-xs font-medium uppercase tracking-wide text-white/40";

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const priceValue = form.price.trim() ? Number(form.price) : null;
    const durationValue = form.duration_minutes.trim() ? Number(form.duration_minutes) : null;

    const err = await onSave(item.id, {
      category: item.item_type === "knowledge" ? form.category : "faq",
      title: form.title.trim(),
      content: form.content.trim() || null,
      price: priceValue !== null && !Number.isNaN(priceValue) ? priceValue : null,
      currency: form.currency.trim() || null,
      duration_minutes: durationValue !== null && !Number.isNaN(durationValue) ? durationValue : null,
      notes: form.notes.trim() || null,
      quote_required: form.quote_required,
      starting_from: form.starting_from,
    });

    setSaving(false);
    if (err) {
      setError(err);
    } else {
      setDirty(false);
    }
  }

  async function handleApprove() {
    setError(null);
    if (dirty) await handleSave();
    const err = await onApprove(item.id);
    if (err) setError(err);
  }

  const missingCurrency = form.price.trim().length > 0 && !form.currency.trim();
  const needsDuplicateResolution = Boolean(item.duplicate_of) && !item.duplicate_action;
  const approveDisabled = saving || missingCurrency || needsDuplicateResolution;

  return (
    <div
      className={`rounded-2xl border p-5 ${
        item.review_status === "approved"
          ? "border-green-500/30 bg-green-500/[0.03]"
          : item.review_status === "rejected"
          ? "border-white/[0.05] bg-white/[0.01] opacity-50"
          : "border-white/[0.07] bg-[#13151c]"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
            {item.review_status}
          </span>
          {item.low_confidence && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">
              Low confidence — please review
            </span>
          )}
          {item.confidence !== null && (
            <span className="text-[10px] text-white/25">
              {Math.round(item.confidence * 100)}% confidence
            </span>
          )}
        </div>
        <button
          onClick={() => onDelete(item.id)}
          className="text-xs text-white/25 transition hover:text-red-400"
        >
          Delete
        </button>
      </div>

      {item.duplicate_of && (
        <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5">
          <p className="text-xs text-amber-300">
            Possible duplicate of &ldquo;{duplicateTitle ?? "an existing entry"}&rdquo;.{" "}
            {item.duplicate_action
              ? "Resolution:"
              : "Choose how to resolve it before approving:"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {(["merge", "replace", "keep_both"] as const).map((action) => (
              <button
                key={action}
                onClick={() => handleDuplicateActionClick(action)}
                disabled={resolvingDuplicate}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                  item.duplicate_action === action
                    ? "bg-amber-500/40 text-amber-100 ring-1 ring-amber-400"
                    : "bg-white/5 text-white/50 hover:bg-white/10"
                }`}
              >
                {item.duplicate_action === action ? "✓ " : ""}
                {action === "merge" ? "Merge" : action === "replace" ? "Replace" : "Keep both"}
              </button>
            ))}
            {resolvingDuplicate && <span className="text-xs text-amber-300/70">Saving…</span>}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {item.item_type === "knowledge" && (
          <div>
            <label className={labelBase}>Category</label>
            <select
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
              className={inputBase}
            >
              {KNOWLEDGE_CATEGORIES.filter((c) => c.value !== "faq").map((c) => (
                <option key={c.value} value={c.value} className="bg-[#13151c]">
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className={labelBase}>{item.item_type === "faq" ? "Question" : "Title"}</label>
          <input
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            className={inputBase}
          />
        </div>

        <div>
          <label className={labelBase}>{item.item_type === "faq" ? "Answer" : "Description"}</label>
          <textarea
            rows={3}
            value={form.content}
            onChange={(e) => update("content", e.target.value)}
            className={`${inputBase} resize-none leading-relaxed`}
          />
        </div>

        {item.item_type === "knowledge" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelBase}>Price</label>
                <input
                  value={form.price}
                  onChange={(e) => update("price", e.target.value)}
                  placeholder="e.g. 89.00"
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Currency</label>
                <input
                  value={form.currency}
                  onChange={(e) => update("currency", e.target.value.toUpperCase())}
                  placeholder="e.g. GBP"
                  maxLength={3}
                  className={inputBase}
                />
              </div>
            </div>
            {missingCurrency && (
              <p className="text-xs text-red-400">Add a currency before this item can be approved.</p>
            )}

            <div>
              <label className={labelBase}>Duration (minutes)</label>
              <input
                value={form.duration_minutes}
                onChange={(e) => update("duration_minutes", e.target.value)}
                placeholder="e.g. 60"
                className={inputBase}
              />
            </div>

            <div>
              <label className={labelBase}>Notes</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                className={`${inputBase} resize-none`}
              />
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs text-white/50">
                <input
                  type="checkbox"
                  checked={form.quote_required}
                  onChange={(e) => update("quote_required", e.target.checked)}
                />
                Quote required
              </label>
              <label className="flex items-center gap-2 text-xs text-white/50">
                <input
                  type="checkbox"
                  checked={form.starting_from}
                  onChange={(e) => update("starting_from", e.target.checked)}
                />
                &ldquo;Starting from&rdquo; price
              </label>
            </div>
          </>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      <div className="mt-4 flex items-center justify-end gap-2">
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg px-3 py-1.5 text-xs text-white/50 transition hover:text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        )}
        <button
          onClick={() => onReject(item.id)}
          disabled={item.review_status === "rejected"}
          className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-white/50 transition hover:bg-white/10 disabled:opacity-40"
        >
          Reject
        </button>
        <button
          onClick={handleApprove}
          disabled={approveDisabled || item.review_status === "approved"}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
