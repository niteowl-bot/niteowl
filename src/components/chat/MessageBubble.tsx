import { Message } from "./ChatShell";

export default function MessageBubble({
  message,
  streaming = false,
}: {
  message: Pick<Message, "role" | "content">;
  streaming?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          isUser
            ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
            : "border border-white/10 bg-white/[0.06] text-white/50"
        }`}
      >
        {isUser ? "U" : "R"}
      </div>

      {/* Bubble */}
      <div
        className={`relative max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "rounded-tr-sm bg-blue-600 text-white"
            : "rounded-tl-sm border border-white/[0.07] bg-[#1c1f29] text-white/80"
        }`}
      >
        {/* Content */}
        <p className="whitespace-pre-wrap break-words">{message.content}</p>

        {/* Streaming indicator — three bouncing dots appended inline */}
        {streaming && (
          <span
            aria-label="Remy is typing"
            className="ml-1.5 inline-flex items-center gap-0.5 align-middle"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1 w-1 rounded-full bg-current opacity-40 animate-bounce"
                style={{ animationDelay: `${i * 140}ms` }}
              />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

