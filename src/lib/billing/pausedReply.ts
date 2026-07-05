// Shared "Remy is paused" streamed reply, used by both /api/chat and
// /api/widget/chat when hasActiveAccess() is false. Matches the same
// chunked-plus-"\n__DONE__" wire format both routes' real OpenAI
// streaming already produces, so existing client-side parsing
// (src/lib/chat.ts, public/widget.js) needs no changes.

const PAUSED_MESSAGE =
  "Thanks for reaching out — this business's Remy assistant is temporarily paused. Please contact them directly for now.";

export function buildPausedChatResponse(extraHeaders: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(PAUSED_MESSAGE));
      controller.enqueue(encoder.encode("\n__DONE__"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
