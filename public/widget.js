(function () {
  "use strict";

  const currentScript = document.currentScript;
  const widgetKey = currentScript?.getAttribute("data-widget-key");

  if (!widgetKey) {
    console.error("[Remy Widget] Missing data-widget-key attribute on script tag.");
    return;
  }

  const scriptSrc = currentScript.src;
  const API_ORIGIN = new URL(scriptSrc).origin;

  const STORAGE_KEY = `remy_widget_conversation_${widgetKey}`;

  function getConversationId() {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }

  const conversationId = getConversationId();

  const styles = `
    .remy-widget-bubble {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #2563eb;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      border: none;
      transition: transform 0.15s ease;
    }
    .remy-widget-bubble:hover {
      transform: scale(1.05);
    }
    .remy-widget-window {
      position: fixed;
      bottom: 90px;
      right: 20px;
      width: 360px;
      max-width: calc(100vw - 40px);
      height: 500px;
      max-height: calc(100vh - 120px);
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .remy-widget-window.open {
      display: flex;
    }
    .remy-widget-header {
      background: #2563eb;
      color: white;
      padding: 16px;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .remy-widget-close {
      cursor: pointer;
      background: none;
      border: none;
      color: white;
      font-size: 18px;
      line-height: 1;
      padding: 4px;
    }
  `;

  const styleTag = document.createElement("style");
  styleTag.textContent = styles;
  document.head.appendChild(styleTag);

  const bubble = document.createElement("button");
  bubble.className = "remy-widget-bubble";
  bubble.setAttribute("aria-label", "Open chat");
  bubble.innerHTML = `
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 11.5C21 16.75 16.75 21 11.5 21C10.06 21 8.7 20.68 7.48 20.1L3 21L4.14 16.9C3.42 15.6 3 14.1 3 12.5C3 7.25 7.25 3 12.5 3C17.75 3 21 6.75 21 11.5Z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  const chatWindow = document.createElement("div");
  chatWindow.className = "remy-widget-window";
  chatWindow.innerHTML = `
    <div class="remy-widget-header">
      <span>Chat with us</span>
      <button class="remy-widget-close" aria-label="Close chat">&times;</button>
    </div>
    <div class="remy-widget-messages" style="flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px;"></div>
    <div class="remy-widget-input-row" style="display:flex; gap:8px; padding:12px; border-top:1px solid #e5e7eb;">
      <input
        type="text"
        class="remy-widget-input"
        placeholder="Type a message…"
        style="flex:1; border:1px solid #d1d5db; border-radius:8px; padding:10px 12px; font-size:14px; outline:none; font-family:inherit;"
      />
      <button
        class="remy-widget-send"
        style="background:#2563eb; color:white; border:none; border-radius:8px; padding:0 16px; font-size:14px; font-weight:600; cursor:pointer;"
      >Send</button>
    </div>
    <p style="margin:0; padding:0 12px 10px; font-size:11px; color:#9ca3af; text-align:center;">
      Powered by NiteOwl AI ·
      <a href="${API_ORIGIN}/privacy" target="_blank" rel="noopener noreferrer" style="color:#9ca3af; text-decoration:underline;">Privacy Policy</a>
    </p>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(chatWindow);

  const messagesEl = chatWindow.querySelector(".remy-widget-messages");
  const inputEl = chatWindow.querySelector(".remy-widget-input");
  const sendBtn = chatWindow.querySelector(".remy-widget-send");

  let messages = [];

  function renderMessage(role, content) {
    const msgBubble = document.createElement("div");
    const isUser = role === "user";
    msgBubble.textContent = content;
    msgBubble.style.cssText = `
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.4;
      white-space: pre-wrap;
      align-self: ${isUser ? "flex-end" : "flex-start"};
      background: ${isUser ? "#2563eb" : "#f3f4f6"};
      color: ${isUser ? "#ffffff" : "#111827"};
    `;
    messagesEl.appendChild(msgBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msgBubble;
  }

  let isStreaming = false;

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;

    messages.push({ role: "user", content: text });
    renderMessage("user", text);
    inputEl.value = "";
    inputEl.disabled = true;
    sendBtn.disabled = true;
    isStreaming = true;

    const assistantBubble = renderMessage("assistant", "");
    let fullText = "";

    try {
      const res = await fetch(`${API_ORIGIN}/api/widget/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          conversationId,
          widgetKey,
        }),
      });

      if (!res.ok || !res.body) {
        assistantBubble.textContent = "Sorry, something went wrong. Please try again.";
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        if (chunk.includes("__DONE__")) {
          fullText += chunk.split("__DONE__")[0];
          break;
        }

        if (chunk.includes("__ERROR__:")) {
          assistantBubble.textContent = "Sorry, something went wrong. Please try again.";
          return;
        }

        fullText += chunk;
        assistantBubble.textContent = fullText;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      assistantBubble.textContent = fullText;
      messages.push({ role: "assistant", content: fullText });
    } catch (err) {
      assistantBubble.textContent = "Sorry, something went wrong. Please try again.";
      console.error("[Remy Widget] fetch error:", err);
    } finally {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      isStreaming = false;
      inputEl.focus();
    }
  }


  sendBtn.addEventListener("click", handleSend);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSend();
  });

  bubble.addEventListener("click", () => {
    chatWindow.classList.toggle("open");
  });

  chatWindow.querySelector(".remy-widget-close").addEventListener("click", () => {
    chatWindow.classList.remove("open");
  });

  window.__remyWidget = { widgetKey, conversationId, API_ORIGIN };
})();
