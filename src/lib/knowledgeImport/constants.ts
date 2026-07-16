// Constants for the "Import with AI" feature only — deliberately not
// imported by KnowledgeClient.tsx, OnboardingKnowledgeStep.tsx, or
// api/chat/route.ts, which each keep their own independent copy of the
// category list. That per-consumer duplication is this repo's existing
// convention (see the comment in src/lib/voice/extraction.ts) — this file
// follows it rather than refactoring those working files to share it.

export const KNOWLEDGE_CATEGORIES = [
  { value: "faq", label: "FAQ" },
  { value: "service", label: "Service" },
  { value: "pricing", label: "Pricing" },
  { value: "opening_hours", label: "Opening Hours" },
  { value: "policy", label: "Policy" },
  { value: "custom_instruction", label: "Custom Instruction" },
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number]["value"];

export const KNOWLEDGE_CATEGORY_VALUES: readonly string[] = KNOWLEDGE_CATEGORIES.map(
  (c) => c.value
);

// Batch limits — matches the confirmed cost/abuse cap: 5 batches/hour/user,
// enforced separately via checkRateLimit at the route level.
export const MAX_FILES_PER_BATCH = 5;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 12;

export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

// Prompt-elicited confidence is a soft signal, not a calibrated
// probability (this codebase never uses logprobs/structured outputs) —
// this threshold is a tuning heuristic for flagging an item for extra
// reviewer attention, never surfaced to the client as "% accuracy."
export const LOW_CONFIDENCE_THRESHOLD = 0.55;

// Similarity ratio above which two knowledge items are treated as a
// likely duplicate during import review (see duplicateDetection.ts).
export const DUPLICATE_MATCH_THRESHOLD = 0.6;
