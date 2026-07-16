"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import StagedItemForm, { type StagedItem } from "./import/StagedItemForm";
import type { KnowledgeRecord } from "./KnowledgeClient";

// Regenerating FAQs for one existing entry reuses the same staging
// table and review card as an import batch (knowledge_staged_items /
// StagedItemForm), just without an import_id — see
// src/app/api/knowledge/regenerate-faqs/route.ts. Never touches
// existing published FAQ rows; approving here commits directly via a
// client-side insert (same direct-Supabase-write pattern
// KnowledgeClient.tsx already uses for its own CRUD), since there's no
// import batch to run the commit route against.

export default function RegenerateFaqsModal({
  orgId,
  knowledgeId,
  onClose,
  onCommitted,
}: {
  orgId: string;
  knowledgeId: string;
  onClose: () => void;
  onCommitted: (record: KnowledgeRecord) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<StagedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/knowledge/regenerate-faqs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, knowledgeId }),
        });
        const json = await res.json();
        if (!cancelled) {
          if (!res.ok) {
            setError(json.error ?? "Failed to generate FAQ suggestions.");
          } else {
            setItems(json.staged ?? []);
          }
        }
      } catch {
        if (!cancelled) setError("Failed to generate FAQ suggestions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [orgId, knowledgeId]);

  async function saveItem(id: string, values: Partial<StagedItem>): Promise<string | null> {
    const res = await fetch(`/api/knowledge/import/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Failed to save.";
    setItems((prev) => prev.map((i) => (i.id === id ? json.item : i)));
    return null;
  }

  async function approveAndCommit(id: string): Promise<string | null> {
    const item = items.find((i) => i.id === id);
    if (!item) return "Item not found.";

    const supabase = createClient();

    const { count } = await supabase
      .from("business_knowledge")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("category", "faq");

    const { data, error } = await supabase
      .from("business_knowledge")
      .insert({
        org_id: orgId,
        category: "faq",
        title: item.title,
        content: item.content,
        display_order: count ?? 0,
        status: "draft",
        source: "ai_import",
      })
      .select(
        "id, category, title, content, display_order, is_active, created_at, status, price, currency, duration_minutes, notes, quote_required, starting_from, source, updated_at, updated_by"
      )
      .single();

    if (error || !data) {
      console.error("[RegenerateFaqsModal] commit failed:", error);
      return "Failed to save this FAQ.";
    }

    await fetch(`/api/knowledge/import/items/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onCommitted(data as KnowledgeRecord);
    return null;
  }

  async function rejectItem(id: string) {
    await fetch(`/api/knowledge/import/items/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function deleteItem(id: string) {
    await rejectItem(id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/[0.07] bg-[#13151c] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Regenerate FAQs</h2>
          <button onClick={onClose} className="text-xs text-white/40 hover:text-white/70">
            Close
          </button>
        </div>

        {loading && <p className="text-xs text-white/40">Generating suggestions…</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="text-xs text-white/40">No new suggestions — try again after adding more detail to this entry.</p>
        )}

        <div className="space-y-3">
          {items.map((item) => (
            <StagedItemForm
              key={item.id}
              item={item}
              duplicateTitle={null}
              onSave={saveItem}
              onDelete={deleteItem}
              onApprove={approveAndCommit}
              onReject={rejectItem}
              onDuplicateActionChange={async () => {}}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
