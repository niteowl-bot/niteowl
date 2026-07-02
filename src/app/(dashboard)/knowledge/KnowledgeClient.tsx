"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Types ────────────────────────────────────────────────────────

export interface KnowledgeRecord {
  id: string;
  category: string;
  title: string;
  content: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

const CATEGORIES = [
  { value: "faq", label: "FAQ" },
  { value: "service", label: "Service" },
  { value: "pricing", label: "Pricing" },
  { value: "opening_hours", label: "Opening Hours" },
  { value: "policy", label: "Policy" },
  { value: "custom_instruction", label: "Custom Instruction" },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  faq: "Frequently Asked Questions",
  service: "Services Offered",
  pricing: "Pricing",
  opening_hours: "Opening Hours",
  policy: "Policies",
  custom_instruction: "Custom Instructions",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  faq: "Common questions and answers Remy will use to respond to customers.",
  service: "Services your business offers.",
  pricing: "Pricing information Remy can share with customers.",
  opening_hours: "When your business is open.",
  policy: "Cancellation, refund, or other business policies.",
  custom_instruction: "Direct behavioural rules for Remy to follow at all times.",
};

const CATEGORY_ORDER = [
  "faq",
  "service",
  "pricing",
  "opening_hours",
  "policy",
  "custom_instruction",
];

// ── Reusable form (used for both Add and Edit) ─────────────────────

interface RecordFormValues {
  category: string;
  title: string;
  content: string;
}

function RecordForm({
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
  isPending,
}: {
  initialValues: RecordFormValues;
  submitLabel: string;
  onSubmit: (values: RecordFormValues) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<RecordFormValues>(initialValues);
  const [formError, setFormError] = useState<string | null>(null);

  const inputBase =
    "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 hover:border-white/20";

  const labelBase =
    "mb-1.5 block text-xs font-medium uppercase tracking-wide text-white/40";

  function handleFormChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setFormError(null);
  }

  function handleSubmit() {
    if (!form.title.trim() || !form.content.trim()) {
      setFormError("Title and content are both required.");
      return;
    }
    onSubmit({
      category: form.category,
      title: form.title.trim(),
      content: form.content.trim(),
    });
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-6">
      <div className="space-y-4">
        <div>
          <label htmlFor="category" className={labelBase}>
            Category
          </label>
          <div className="relative">
            <select
              id="category"
              name="category"
              value={form.category}
              onChange={handleFormChange}
              className={`${inputBase} appearance-none pr-9`}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value} className="bg-[#13151c] text-white">
                  {c.label}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </div>
          <p className="mt-1.5 text-xs text-white/25">
            {CATEGORY_DESCRIPTIONS[form.category]}
          </p>
        </div>

        <div>
          <label htmlFor="title" className={labelBase}>
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            placeholder={
              form.category === "faq"
                ? "e.g. What are your call-out fees?"
                : form.category === "opening_hours"
                ? "e.g. Monday to Friday"
                : "e.g. Emergency Plumbing"
            }
            value={form.title}
            onChange={handleFormChange}
            className={inputBase}
          />
        </div>

        <div>
          <label htmlFor="content" className={labelBase}>
            Content
          </label>
          <textarea
            id="content"
            name="content"
            rows={4}
            placeholder={
              form.category === "faq"
                ? "e.g. Our call-out fee is £75 within a 10-mile radius."
                : form.category === "opening_hours"
                ? "e.g. 8am – 6pm"
                : form.category === "custom_instruction"
                ? "e.g. Always end responses by asking if there is anything else you can help with."
                : "Describe this in detail…"
            }
            value={form.content}
            onChange={handleFormChange}
            className={`${inputBase} resize-none leading-relaxed`}
          />
        </div>
      </div>

      {formError && <p className="mt-3 text-xs text-red-400">{formError}</p>}

      <div className="mt-5 flex items-center justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-white/40 transition hover:text-white/70"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {isPending ? (
            <>
              <SpinnerIcon />
              Saving…
            </>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export default function KnowledgeClient({
  orgId,
  orgName,
  initialRecords,
}: {
  orgId: string;
  orgName: string;
  initialRecords: KnowledgeRecord[];
}) {
  const [records, setRecords] = useState<KnowledgeRecord[]>(initialRecords);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const grouped = CATEGORY_ORDER.reduce<Record<string, KnowledgeRecord[]>>(
    (acc, cat) => {
      acc[cat] = records.filter((r) => r.category === cat);
      return acc;
    },
    {}
  );

  const totalCount = records.length;

  async function handleCreate(values: RecordFormValues) {
    startTransition(async () => {
      const supabase = createClient();

      const { data, error } = await supabase
        .from("business_knowledge")
        .insert({
          org_id: orgId,
          category: values.category,
          title: values.title,
          content: values.content,
          display_order: grouped[values.category]?.length ?? 0,
        })
        .select("id, category, title, content, display_order, is_active, created_at")
        .single();

      if (error || !data) {
        console.error("SUPABASE INSERT ERROR:", error);
        return;
      }

      setRecords((prev) => [...prev, data as KnowledgeRecord]);
      setShowAddForm(false);
    });
  }

  async function handleUpdate(id: string, values: RecordFormValues) {
    startTransition(async () => {
      const supabase = createClient();

      const { data, error } = await supabase
        .from("business_knowledge")
        .update({
          category: values.category,
          title: values.title,
          content: values.content,
        })
        .eq("id", id)
        .eq("org_id", orgId)
        .select("id, category, title, content, display_order, is_active, created_at")
        .single();

      if (error || !data) {
        console.error("SUPABASE UPDATE ERROR:", error);
        return;
      }

      setRecords((prev) => prev.map((r) => (r.id === id ? (data as KnowledgeRecord) : r)));
      setEditingId(null);
    });
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    const supabase = createClient();

    const { error } = await supabase.from("business_knowledge").delete().eq("id", id);

    if (error) {
      setDeleteError("Failed to delete record. Please try again.");
      return;
    }

    setRecords((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="min-h-screen bg-[#0d0f14] px-4 py-10 md:px-8">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-blue-600/8 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <a href="/dashboard" className="text-xs text-white/30 transition hover:text-white/60">
                Dashboard
              </a>
              <span className="text-white/15">/</span>
              <span className="text-xs text-white/50">Knowledge Base</span>
            </div>
            <h1 className="text-xl font-semibold text-white">Knowledge Base</h1>
            <p className="mt-1 text-sm text-white/40">
              Everything Remy knows about <span className="text-white/60">{orgName}</span>.{" "}
              {totalCount > 0 && (
                <span>{totalCount} record{totalCount !== 1 ? "s" : ""} active.</span>
              )}
            </p>
          </div>

          <button
            onClick={() => {
              setShowAddForm((s) => !s);
              setEditingId(null);
            }}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <PlusIcon />
            {showAddForm ? "Cancel" : "Add record"}
          </button>
        </header>

        {deleteError && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {deleteError}
          </div>
        )}

        {showAddForm && (
          <div className="mb-8">
            <h2 className="mb-3 text-sm font-semibold text-white">New knowledge record</h2>
            <RecordForm
              initialValues={{ category: "faq", title: "", content: "" }}
              submitLabel="Save record"
              onSubmit={handleCreate}
              onCancel={() => setShowAddForm(false)}
              isPending={isPending}
            />
          </div>
        )}

        {totalCount === 0 && !showAddForm && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-white/20">
              <BookIcon />
            </div>
            <p className="text-sm font-medium text-white/40">No knowledge records yet</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-white/25">
              Add FAQs, services, pricing, and more so Remy can answer customer questions accurately.
            </p>
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-5 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              <PlusIcon />
              Add your first record
            </button>
          </div>
        )}

        {totalCount > 0 && (
          <div className="space-y-6">
            {CATEGORY_ORDER.map((cat) => {
              const items = grouped[cat];
              if (!items || items.length === 0) return null;

              return (
                <section key={cat}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-600/15 text-blue-400">
                      <CategoryIcon category={cat} />
                    </span>
                    <h2 className="text-sm font-semibold text-white">{CATEGORY_LABELS[cat]}</h2>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/30">
                      {items.length}
                    </span>
                  </div>

                  <ul className="space-y-2">
                    {items.map((record) =>
                      editingId === record.id ? (
                        <li key={record.id}>
                          <RecordForm
                            initialValues={{
                              category: record.category,
                              title: record.title,
                              content: record.content,
                            }}
                            submitLabel="Save changes"
                            onSubmit={(values) => handleUpdate(record.id, values)}
                            onCancel={() => setEditingId(null)}
                            isPending={isPending}
                          />
                        </li>
                      ) : (
                        <RecordRow
                          key={record.id}
                          record={record}
                          onDelete={handleDelete}
                          onEdit={() => {
                            setEditingId(record.id);
                            setShowAddForm(false);
                          }}
                        />
                      )
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── RecordRow ────────────────────────────────────────────────────

function RecordRow({
  record,
  onDelete,
  onEdit,
}: {
  record: KnowledgeRecord;
  onDelete: (id: string) => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onDelete(record.id);
    setDeleting(false);
    setConfirming(false);
  }

  return (
    <li className="rounded-xl border border-white/[0.07] bg-[#13151c] transition hover:border-white/10">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <button onClick={() => setExpanded((e) => !e)} className="w-full text-left">
            <p className="truncate text-sm font-medium text-white/80">{record.title}</p>
            {!expanded && (
              <p className="mt-0.5 truncate text-xs text-white/30">{record.content}</p>
            )}
          </button>
          {expanded && (
            <p className="mt-2 text-sm leading-relaxed text-white/50 whitespace-pre-wrap">
              {record.content}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/20 transition hover:bg-white/5 hover:text-white/50"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronDownIcon expanded={expanded} />
          </button>

          <button
            onClick={onEdit}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/20 transition hover:bg-white/5 hover:text-white/50"
            aria-label="Edit record"
          >
            <EditIcon />
          </button>

          {confirming ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/30">Delete?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-400 transition hover:bg-red-500/30 disabled:opacity-50"
              >
                {deleting ? "…" : "Yes"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-md px-2.5 py-1 text-xs text-white/30 transition hover:text-white/60"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/20 transition hover:bg-red-500/10 hover:text-red-400"
              aria-label="Delete record"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Icons ────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M2 3.5h9M5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M5.5 6v3.5M7.5 6v3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M3 3.5l.5 7a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5l.5-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M9.5 1.5l2 2-7 7H2.5v-2l7-7Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/30">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
        <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function ChevronDownIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      aria-hidden
      className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
    >
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M4 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7h6M8 11h6M8 15h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.4" />
      <path d="M6.5 1.5A5 5 0 0 1 11.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CategoryIcon({ category }: { category: string }) {
  switch (category) {
    case "faq":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 8.5V8c0-.8.4-1.3 1-1.8C7.6 5.8 8 5.3 8 4.6 8 3.7 7.1 3 6 3S4 3.7 4 4.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="6" cy="9.5" r=".5" fill="currentColor" />
        </svg>
      );
    case "service":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2 9.5 4.5 7l1.5 1.5L9 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "pricing":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 3v6M4.5 4.5h2a1 1 0 0 1 0 2h-1a1 1 0 0 0 0 2H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case "opening_hours":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 3.5V6l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "policy":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M6 1.5 2 3v3.5C2 8.9 3.8 10.7 6 11c2.2-.3 4-2.1 4-4.5V3L6 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case "custom_instruction":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2 4h8M2 6h5M2 8h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}
