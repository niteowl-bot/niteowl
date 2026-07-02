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
  onToken,
  onDone,
  onError,
}: {
  messages: ChatMessage[];
  conversationId: string;
  orgId: string;
  source?: string;
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: string) => void;
}) {

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, conversationId, orgId, source }),
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
}
