export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Calls our internal /api/chat route and streams the response,
 * calling onToken for each chunk and onDone when complete.
 */
export async function streamChat({
  messages,
  conversationId,
  orgId,
  source,
  includeDrafts,
  onToken,
  onDone,
  onError,
}: {
  messages: ChatMessage[];
  conversationId: string;
  orgId: string;
  source?: string;
  // Dashboard-preview-only: lets an owner test AI-imported Knowledge Base
  // drafts before publishing them. The public widget never sets this and
  // the API route ignores it unless source is "dashboard_preview".
  includeDrafts?: boolean;
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: string) => void;
}) {
  // Guarantees exactly one of onDone/onError fires — never lets a
  // dropped connection or timeout escape as an unhandled rejection,
  // which previously left the caller's "streaming" state stuck true
  // forever (mirrors the try/catch pattern already used by widget.js).
  try {
    // The server's own worst case is sequential: up to 15s lead
    // extraction + up to 15s datetime parsing, then up to 30s of
    // streaming — ~60s. This must stay comfortably above that so it
    // only fires on a genuine full-stack hang, not a slow-but-healthy
    // request the server was always going to finish and report on.
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, conversationId, orgId, source, includeDrafts }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok || !res.body) {
      onError(`Request failed: ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      if (chunk.includes("__DONE__")) {
        const before = chunk.split("__DONE__")[0];
        if (before) {
          fullText += before;
          onToken(before);
        }
        onDone(fullText);
        return;
      }

      if (chunk.includes("__ERROR__:")) {
        const msg = chunk.split("__ERROR__:")[1]?.trim() ?? "Unknown error";
        onError(msg);
        return;
      }

      fullText += chunk;
      onToken(chunk);
    }

    onDone(fullText);
  } catch (err) {
    onError(
      err instanceof Error ? err.message : "Something went wrong. Please try again."
    );
  }
}
