"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const CATEGORIES = [
  { value: "faq", label: "FAQ" },
  { value: "service", label: "Service" },
  { value: "pricing", label: "Pricing" },
  { value: "opening_hours", label: "Opening Hours" },
  { value: "policy", label: "Policy" },
  { value: "custom_instruction", label: "Custom Instruction" },
] as const;

interface AddedRecord {
  id: string;
  category: string;
  title: string;
  content: string;
}

export default function OnboardingKnowledgeStep({
  orgId,
  onNext,
}: {
  orgId: string;
  onNext: () => void;
}) {
  const [category, setCategory] = useState("faq");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [added, setAdded] = useState<AddedRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputCls =
    "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  async function handleAdd() {
    if (!title.trim() || !content.trim()) {
      setError("Title and content are both required.");
      return;
    }

    setSaving(true);
    setError(null);

    const supabase = createClient();

    const { data, error: insertError } = await supabase
      .from("business_knowledge")
      .insert({
        org_id: orgId,
        category,
        title: title.trim(),
        content: content.trim(),
        display_order: added.filter((a) => a.category === category).length,
      })
      .select("id, category, title, content")
      .single();

    if (insertError || !data) {
      setError("Failed to save. Please try again.");
      setSaving(false);
      return;
    }

    setAdded((prev) => [...prev, data as AddedRecord]);
    setTitle("");
    setContent("");
    setSaving(false);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-white">
        Teach Remy about your business
      </h1>
      <p className="mb-8 text-sm text-white/40">
        Add a few FAQs, services, or policies so Remy can answer customers
        accurately. You can add more anytime from Settings — feel free to
        skip this for now.
      </p>

      <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-6">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-white/40">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value} className="bg-[#13151c]">
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-white/40">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. What are your call-out fees?"
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-white/40">
              Content
            </label>
            <textarea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Describe this in detail…"
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button
            onClick={handleAdd}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Adding…" : "+ Add record"}
          </button>
        </div>
      </div>

      {added.length > 0 && (
        <ul className="mt-4 space-y-2">
          {added.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-white/[0.07] bg-[#13151c] px-4 py-3 text-sm text-white/70"
            >
              {r.title}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={onNext}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition"
        >
          Continue
        </button>
        <button
          onClick={onNext}
          className="text-sm text-white/40 hover:text-white/70 transition"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
