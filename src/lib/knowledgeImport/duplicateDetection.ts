import type { createClient } from "@/lib/supabase/server";
import { DUPLICATE_MATCH_THRESHOLD } from "@/lib/knowledgeImport/constants";

type DatabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface DuplicateMatch {
  knowledgeId: string;
  title: string;
  matchedWordRatio: number;
}

// Same stop-words/word-overlap approach as isServiceConfirmedByKnowledge
// in src/lib/leadCapture.ts, adapted to score every candidate row and
// return the best match instead of a single boolean. Checks against
// draft AND published rows — an import that would duplicate an
// already-staged-but-unpublished draft still needs flagging. Biased
// toward false positives (the reviewer clicks "Keep both" once) over
// false negatives (a duplicate silently entering the Knowledge Base
// twice), matching the fail-safe posture of the function it's adapted
// from.
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "of", "to", "in", "on", "with",
  "my", "i", "need", "want", "please", "some", "service", "services",
  "emergency", "repair", "repairs", "installation", "install", "fix",
  "fixing", "check", "checkup", "appointment", "booking", "book",
  "call", "callout", "job", "work",
]);

// Lightweight suffix stripping — not real stemming, just enough to stop
// an obvious same-word variant (cleaning/cleaner/clean, hours/hour) from
// scoring as a non-match purely because AI-reworded text rarely repeats
// a source document's exact word forms. Found via testing: "Standard
// Cleaning Service / one cleaner, 2 hour visit" scored only 0.5 against
// an existing "Standard Clean / 2 hours, one cleaner" entry — under
// threshold — purely from "cleaning" vs "clean" and "hour" vs "hours"
// not matching as strings, despite being obviously the same words.
function normalizeWord(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ers")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("er")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function meaningfulWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .map(normalizeWord);
}

interface ScorableCandidate {
  id: string;
  title: string;
  content: string | null;
}

// Shared scorer, used both against real business_knowledge rows
// (findLikelyDuplicate) and against an in-memory list of items already
// staged earlier in the SAME import batch (findLikelyDuplicateAmong) —
// see the comment on that function for why the batch-local check exists.
//
// needleTitle gets one extra check ahead of the word-overlap score: an
// exact (case/whitespace-insensitive) title match against a candidate is
// treated as a duplicate outright, regardless of how much the content
// differs. Found via real testing: re-importing an updated version of a
// document (e.g. new opening hours) naturally repeats the old entry's
// exact title with substantially different content — different enough
// that title+content word overlap fell well under the threshold, so two
// same-titled "Opening hours" entries silently coexisted with no
// duplicate banner. Two org entries sharing one literal title are always
// meant to represent the same fact, so this can't introduce a false
// negative anywhere the threshold check already wouldn't; it only adds
// coverage, matching this function's existing bias toward false
// positives (a reviewer clicks "Keep both" once) over silently letting a
// real duplicate/conflict through.
function scoreCandidates(
  needleTitle: string,
  needleWords: string[],
  candidates: ScorableCandidate[]
): DuplicateMatch | null {
  const normalizedNeedleTitle = needleTitle.trim().toLowerCase();
  if (normalizedNeedleTitle) {
    const exactTitleMatch = candidates.find(
      (record) => record.title.trim().toLowerCase() === normalizedNeedleTitle
    );
    if (exactTitleMatch) {
      return { knowledgeId: exactTitleMatch.id, title: exactTitleMatch.title, matchedWordRatio: 1 };
    }
  }

  let best: DuplicateMatch | null = null;
  const uniqueNeedleWords = [...new Set(needleWords)];

  for (const record of candidates) {
    const haystackWords = meaningfulWords(`${record.title} ${record.content ?? ""}`);
    if (haystackWords.length === 0) continue;

    const haystackSet = new Set(haystackWords);
    const uniqueHaystackWords = [...new Set(haystackWords)];
    const needleSet = new Set(uniqueNeedleWords);

    // Checked in BOTH directions and the better one kept — a short KB
    // entry ("Call-out fee: £10, waived...") fully contained inside a
    // longer, conversational paraphrase (an AI-generated FAQ answering
    // "Do you charge a call-out fee? Yes, we charge a call-out fee of
    // £10, but it is waived if you proceed...") scores low if only
    // measured as "how much of the FAQ's wording is in the KB entry"
    // (0.5, under threshold — the FAQ's own filler words dilute it) but
    // scores a perfect 1.0 as "how much of the terser KB entry is
    // covered by the FAQ." Found via real testing: this exact pair was
    // missed when only the needle-normalized direction was checked.
    // Deduplicated so a repeated word (e.g. "boiler" appearing twice)
    // can't inflate either ratio past what distinct-word overlap
    // justifies.
    const needleCoveredByHaystack =
      uniqueNeedleWords.filter((w) => haystackSet.has(w)).length / uniqueNeedleWords.length;
    const haystackCoveredByNeedle =
      uniqueHaystackWords.length > 0
        ? uniqueHaystackWords.filter((w) => needleSet.has(w)).length / uniqueHaystackWords.length
        : 0;
    const ratio = Math.max(needleCoveredByHaystack, haystackCoveredByNeedle);

    if (ratio >= DUPLICATE_MATCH_THRESHOLD && (!best || ratio > best.matchedWordRatio)) {
      best = { knowledgeId: record.id, title: record.title, matchedWordRatio: ratio };
    }
  }

  return best;
}

export async function findLikelyDuplicate(
  supabase: DatabaseClient,
  orgId: string,
  title: string,
  content: string | null
): Promise<DuplicateMatch | null> {
  const needleWords = meaningfulWords(`${title} ${content ?? ""}`);
  if (needleWords.length === 0) return null;

  const { data, error } = await supabase
    .from("business_knowledge")
    .select("id, title, content")
    .eq("org_id", orgId);

  if (error || !data || data.length === 0) {
    if (error) console.error("[knowledgeImport] duplicate lookup failed:", error.message);
    return null;
  }

  return scoreCandidates(title, needleWords, data);
}

// Checks a candidate against items already extracted/staged EARLIER IN
// THE SAME import batch — not the existing Knowledge Base. Without this,
// a document that yields both a structured KB entry ("Call-out fee",
// price/currency set) and an AI-generated FAQ restating the same fact
// ("Do you charge a call-out fee? Yes, £10...") stage side by side with
// no relationship between them, since findLikelyDuplicate only ever
// checked against ALREADY-COMMITTED business_knowledge rows — a batch's
// own items were invisible to each other. Found via real testing: a
// reviewer edited the FAQ's wording (£→€) without knowing the sibling KB
// entry existed, and Remy kept answering from the untouched one. Callers
// use a match here to skip staging the redundant item entirely, rather
// than surfacing a Merge/Replace/Keep-both banner — there's no
// business_knowledge id to resolve against yet, both are just drafts of
// the same fact, so keeping the more structured one is enough.
export function findLikelyDuplicateAmong(
  title: string,
  content: string | null,
  candidates: ScorableCandidate[]
): DuplicateMatch | null {
  const needleWords = meaningfulWords(`${title} ${content ?? ""}`);
  if (needleWords.length === 0 || candidates.length === 0) return null;

  return scoreCandidates(title, needleWords, candidates);
}
