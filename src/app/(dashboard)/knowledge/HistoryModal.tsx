"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Reads business_knowledge_revisions, populated entirely by the
// security-definer trigger added in
// docs/sql/2026-07-16_knowledge_import_extend_business_knowledge.sql —
// no app code writes to this table directly. "Last modified by" is
// shown only when it's the viewing owner (the common single-owner case);
// resolving an arbitrary auth.users email client-side isn't possible
// without the service-role key, so anything else is left unlabeled
// rather than guessed, per "if available."

interface Revision {
  id: string;
  snapshot: Record<string, unknown>;
  changed_by: string | null;
  change_type: "update" | "delete";
  created_at: string;
}

export default function HistoryModal({
  knowledgeId,
  onClose,
  onRestore,
}: {
  knowledgeId: string;
  onClose: () => void;
  onRestore: (snapshot: Record<string, unknown>) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const [{ data: userData }, { data: revisionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("business_knowledge_revisions")
          .select("id, snapshot, changed_by, change_type, created_at")
          .eq("knowledge_id", knowledgeId)
          .order("created_at", { ascending: false }),
      ]);

      if (!cancelled) {
        setCurrentUserId(userData?.user?.id ?? null);
        setRevisions((revisionData as Revision[]) ?? []);
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [knowledgeId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/[0.07] bg-[#13151c] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Revision history</h2>
          <button onClick={onClose} className="text-xs text-white/40 hover:text-white/70">
            Close
          </button>
        </div>

        {loading && <p className="text-xs text-white/40">Loading…</p>}
        {!loading && revisions.length === 0 && (
          <p className="text-xs text-white/40">No previous versions yet.</p>
        )}

        <ul className="space-y-2">
          {revisions.map((rev) => (
            <li key={rev.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/60">
                  {new Date(rev.created_at).toLocaleString()}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-white/30">
                  {rev.change_type}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-white/40">
                {String(rev.snapshot.title ?? "")}
              </p>
              {rev.changed_by && rev.changed_by === currentUserId && (
                <p className="mt-0.5 text-[10px] text-white/25">Modified by you</p>
              )}
              <button
                onClick={() => onRestore(rev.snapshot)}
                className="mt-2 text-xs text-blue-400 transition hover:text-blue-300"
              >
                Restore this version
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
