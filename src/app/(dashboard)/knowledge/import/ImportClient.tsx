"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import StagedItemForm, { type StagedItem } from "./StagedItemForm";
import {
  ACCEPTED_MIME_TYPES,
  MAX_FILES_PER_BATCH,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/knowledgeImport/constants";

type Step = "upload" | "processing" | "review" | "done";

interface ImportFile {
  id: string;
  original_filename?: string;
  filename?: string;
  status: string;
  error_message?: string | null;
  error?: string;
}

export default function ImportClient({
  orgId,
  orgName,
  initialImportId = null,
  initialImportStatus = null,
}: {
  orgId: string;
  orgName: string;
  initialImportId?: string | null;
  initialImportStatus?: string | null;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [processError, setProcessError] = useState<string | null>(null);
  const [items, setItems] = useState<StagedItem[]>([]);
  const [duplicateTitles, setDuplicateTitles] = useState<Record<string, string>>({});
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ inserted: number; updated: number } | null>(
    null
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Resume a batch that was still processing or awaiting review from a
  // previous visit (e.g. the tab was reloaded while a multi-page PDF was
  // still being read) instead of silently dropping back to "upload".
  useEffect(() => {
    if (!initialImportId) return;

    if (initialImportStatus === "ready_for_review") {
      (async () => {
        const res = await fetch(`/api/knowledge/import/${initialImportId}`);
        if (!res.ok) return;
        const json = await res.json();
        setImportId(initialImportId);
        setFiles(json.files ?? []);
        await loadDuplicateTitles(json.items ?? []);
        setItems(json.items ?? []);
        setStep("review");
      })();
    } else if (initialImportStatus === "uploaded" || initialImportStatus === "processing") {
      (async () => {
        const res = await fetch(`/api/knowledge/import/${initialImportId}`);
        if (!res.ok) return;
        const json = await res.json();
        setImportId(initialImportId);
        setFiles(json.files ?? []);
        setStep("processing");
        startPolling(initialImportId);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImportId, initialImportStatus]);

  function handleFileSelect(fileList: FileList | null) {
    if (!fileList) return;
    const picked = Array.from(fileList);
    setUploadError(null);

    if (picked.length > MAX_FILES_PER_BATCH) {
      setUploadError(`You can upload at most ${MAX_FILES_PER_BATCH} files at once.`);
      return;
    }
    for (const f of picked) {
      if (!ACCEPTED_MIME_TYPES.includes(f.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
        setUploadError(`${f.name} is not a supported file type (JPG, PNG, WEBP, PDF only).`);
        return;
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        setUploadError(`${f.name} exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit.`);
        return;
      }
    }
    setSelectedFiles(picked);
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.set("org_id", orgId);
      selectedFiles.forEach((f) => formData.append("files", f));

      const uploadRes = await fetch("/api/knowledge/import", { method: "POST", body: formData });
      const uploadJson = await uploadRes.json();

      if (!uploadRes.ok) {
        setUploadError(uploadJson.error ?? "Upload failed.");
        setUploading(false);
        return;
      }

      setImportId(uploadJson.importId);
      setFiles(uploadJson.files ?? []);

      const acceptedCount = (uploadJson.files ?? []).filter(
        (f: ImportFile) => f.status === "pending"
      ).length;

      if (acceptedCount === 0) {
        setUploadError("All files were rejected. Check the errors below and try again.");
        setUploading(false);
        return;
      }

      setStep("processing");
      const processRes = await fetch(`/api/knowledge/import/${uploadJson.importId}/process`, {
        method: "POST",
      });

      if (!processRes.ok) {
        const processJson = await processRes.json().catch(() => ({}));
        setProcessError(processJson.error ?? "Processing failed.");
      }

      startPolling(uploadJson.importId);
    } catch {
      setUploadError("Something went wrong uploading your files. Please try again.");
      setUploading(false);
    }
  }

  function startPolling(id: string) {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/knowledge/import/${id}`);
      if (!res.ok) return;
      const json = await res.json();

      setFiles(json.files ?? []);

      if (json.import?.status === "ready_for_review") {
        if (pollRef.current) clearInterval(pollRef.current);
        await loadDuplicateTitles(json.items ?? []);
        setItems(json.items ?? []);
        setStep("review");
      } else if (json.import?.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setProcessError(json.import.error_message ?? "Processing failed — no information could be extracted.");
      }
    }, 2000);
  }

  async function loadDuplicateTitles(staged: StagedItem[]) {
    const ids = Array.from(new Set(staged.map((i) => i.duplicate_of).filter(Boolean))) as string[];
    if (ids.length === 0) return;

    const supabase = createClient();
    const { data } = await supabase.from("business_knowledge").select("id, title").in("id", ids);
    if (data) {
      const map: Record<string, string> = {};
      for (const row of data) map[row.id] = row.title;
      setDuplicateTitles(map);
    }
  }

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

  async function approveItem(id: string): Promise<string | null> {
    const res = await fetch(`/api/knowledge/import/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_status: "approved" }),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Failed to approve.";
    setItems((prev) => prev.map((i) => (i.id === id ? json.item : i)));
    return null;
  }

  async function rejectItem(id: string) {
    const res = await fetch(`/api/knowledge/import/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_status: "rejected" }),
    });
    const json = await res.json();
    if (res.ok) setItems((prev) => prev.map((i) => (i.id === id ? json.item : i)));
  }

  async function deleteItem(id: string) {
    const res = await fetch(`/api/knowledge/import/items/${id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function setDuplicateAction(id: string, action: "merge" | "replace" | "keep_both") {
    await saveItem(id, { duplicate_action: action });
  }

  async function addItem(itemType: "knowledge" | "faq") {
    if (!importId) return;
    const res = await fetch("/api/knowledge/import/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org_id: orgId,
        import_id: importId,
        item_type: itemType,
        category: itemType === "faq" ? "faq" : "service",
        title: itemType === "faq" ? "New question" : "New entry",
      }),
    });
    const json = await res.json();
    if (res.ok) setItems((prev) => [...prev, json.item]);
  }

  async function handleCommit() {
    if (!importId) return;
    setCommitting(true);
    const res = await fetch(`/api/knowledge/import/${importId}/commit`, { method: "POST" });
    const json = await res.json();
    setCommitting(false);
    if (res.ok) {
      setCommitResult({ inserted: json.inserted, updated: json.updated });
      setStep("done");
    }
  }

  const knowledgeItems = items.filter((i) => i.item_type === "knowledge");
  const faqItems = items.filter((i) => i.item_type === "faq");
  const approvedCount = items.filter((i) => i.review_status === "approved").length;

  return (
    <div className="min-h-screen bg-[#0d0f14] px-4 py-10 md:px-8">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-blue-600/8 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl">
        <header className="mb-8">
          <div className="mb-1 flex items-center gap-2">
            <a href="/knowledge" className="text-xs text-white/30 transition hover:text-white/60">
              Knowledge Base
            </a>
            <span className="text-white/15">/</span>
            <span className="text-xs text-white/50">Import with AI</span>
          </div>
          <h1 className="text-xl font-semibold text-white">Import with AI</h1>
          <p className="mt-1 text-sm text-white/40">
            Upload documents and let Remy draft Knowledge Base entries for{" "}
            <span className="text-white/60">{orgName}</span>. Nothing is saved until you review and approve it.
          </p>
        </header>

        {step === "upload" && (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
            <p className="mb-4 text-sm text-white/50">
              JPG, PNG, WEBP, or PDF — up to {MAX_FILES_PER_BATCH} files, {MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB each.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_MIME_TYPES.join(",")}
              onChange={(e) => handleFileSelect(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              Choose files
            </button>

            {selectedFiles.length > 0 && (
              <ul className="mt-4 space-y-1 text-left text-xs text-white/50">
                {selectedFiles.map((f) => (
                  <li key={f.name}>{f.name}</li>
                ))}
              </ul>
            )}

            {uploadError && <p className="mt-3 text-xs text-red-400">{uploadError}</p>}

            <button
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || uploading}
              className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Upload and extract"}
            </button>
          </div>
        )}

        {step === "processing" && (
          <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-8 text-center">
            <p className="text-sm font-medium text-white/70">Reading your documents…</p>
            <p className="mt-1 text-xs text-white/40">This can take a minute for multi-page PDFs.</p>

            <ul className="mt-5 space-y-1.5 text-left text-xs">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between text-white/50">
                  <span>{f.original_filename ?? f.filename}</span>
                  <span
                    className={
                      f.status === "failed"
                        ? "text-red-400"
                        : f.status === "extracted"
                        ? "text-green-400"
                        : "text-white/30"
                    }
                  >
                    {f.status}
                  </span>
                </li>
              ))}
            </ul>

            {processError && <p className="mt-4 text-xs text-red-400">{processError}</p>}
          </div>
        )}

        {step === "review" && (
          <div className="space-y-8">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  Knowledge Base Entries <span className="text-white/30">({knowledgeItems.length})</span>
                </h2>
                <button
                  onClick={() => addItem("knowledge")}
                  className="text-xs text-blue-400 transition hover:text-blue-300"
                >
                  + Add entry
                </button>
              </div>
              <div className="space-y-3">
                {knowledgeItems.map((item) => (
                  <StagedItemForm
                    key={item.id}
                    item={item}
                    duplicateTitle={item.duplicate_of ? duplicateTitles[item.duplicate_of] ?? null : null}
                    onSave={saveItem}
                    onDelete={deleteItem}
                    onApprove={approveItem}
                    onReject={rejectItem}
                    onDuplicateActionChange={setDuplicateAction}
                  />
                ))}
                {knowledgeItems.length === 0 && (
                  <p className="text-xs text-white/30">No knowledge entries extracted.</p>
                )}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  Suggested FAQs <span className="text-white/30">({faqItems.length})</span>
                </h2>
                <button
                  onClick={() => addItem("faq")}
                  className="text-xs text-blue-400 transition hover:text-blue-300"
                >
                  + Add FAQ
                </button>
              </div>
              <div className="space-y-3">
                {faqItems.map((item) => (
                  <StagedItemForm
                    key={item.id}
                    item={item}
                    duplicateTitle={item.duplicate_of ? duplicateTitles[item.duplicate_of] ?? null : null}
                    onSave={saveItem}
                    onDelete={deleteItem}
                    onApprove={approveItem}
                    onReject={rejectItem}
                    onDuplicateActionChange={setDuplicateAction}
                  />
                ))}
                {faqItems.length === 0 && (
                  <p className="text-xs text-white/30">No FAQs suggested.</p>
                )}
              </div>
            </section>

            <div className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-[#13151c] p-5">
              <p className="text-xs text-white/40">
                {approvedCount} of {items.length} items approved. Only approved items will be saved.
              </p>
              <button
                onClick={handleCommit}
                disabled={approvedCount === 0 || committing}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
              >
                {committing ? "Saving…" : `Commit ${approvedCount} approved item${approvedCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        )}

        {step === "done" && commitResult && (
          <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-8 text-center">
            <p className="text-sm font-medium text-white/70">
              {commitResult.inserted} new entr{commitResult.inserted !== 1 ? "ies" : "y"} saved as Draft
              {commitResult.updated > 0
                ? `, ${commitResult.updated} existing entr${commitResult.updated !== 1 ? "ies" : "y"} updated`
                : ""}
              .
            </p>
            <p className="mt-1 text-xs text-white/40">
              New entries won&rsquo;t appear to customers until you publish them from the Knowledge Base page.
            </p>
            <a
              href="/knowledge"
              className="mt-6 inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              Go to Knowledge Base
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
