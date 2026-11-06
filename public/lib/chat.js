// Chat del asistente (común a todas las webs). Necesita en el HTML:
// [data-chat] panel · [data-chat-log] · [data-chat-form] con #chat-input · [data-chat-suggest] (opcional)
// [data-open-chat] botones que abren · [data-close-chat] · .chat-fab
// Lee window.__BRAND__.assistantUrl y window.__BRAND__.chatFallback.
(function () {
  "use strict";
  function initChat() {
    const data = window.__BRAND__ || {};
    const $ = (s, sc) => (sc || document).querySelector(s);
    const $$ = (s, sc) => Array.from((sc || document).querySelectorAll(s));
    const panel = $("[data-chat]"), fab = $(".chat-fab"), log = $("[data-chat-log]");
    const form = $("[data-chat-form]"), input = $("#chat-input"), suggest = $("[data-chat-suggest]");
    if (!panel || !log || !form || !input) return;

    const history = [];
    let busy = false;
    const open = () => { panel.hidden = false; if (fab) fab.hidden = true; setTimeout(() => input.focus(), 50); };
    const close = () => { panel.hidden = true; if (fab) fab.hidden = false; };
    $$("[data-open-chat]").forEach(b => b.addEventListener("click", open));
    $$("[data-close-chat]").forEach(b => b.addEventListener("click", close));
    $$("[data-chat] a[href^='#']").forEach(a => a.addEventListener("click", close));
    addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) close(); });

    function add(text, who) {
      const p = document.createElement("p");
      p.className = "msg msg-" + who;
      p.textContent = text;
      log.appendChild(p);
      log.scrollTop = log.scrollHeight;
      return p;
    }
    const FALLBACK = data.chatFallback || "Ahora no puedo responder. Escribinos por WhatsApp y te contestamos enseguida.";

    async function send(text) {
      text = text.trim();
      if (!text || busy) return;
      busy = true;
      if (suggest) suggest.hidden = true;
      add(text, "user");
      const typing = add("Escribiendo…", "bot");
      typing.classList.add("msg-typing");
      let reply = FALLBACK;
      try {
        const r = await fetch(data.assistantUrl || "/api/asistente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history: history.slice(-8) })
        });
        const json = await r.json().catch(() => ({}));
        if (json && json.reply) reply = json.reply;
      } catch (_) { /* sin conexión: mensaje de respaldo */ }
      typing.remove();
      add(reply, "bot");
      history.push({ role: "user", text: text }, { role: "model", text: reply });
      busy = false;
    }
    form.addEventListener("submit", e => { e.preventDefault(); const t = input.value; input.value = ""; send(t); });
    if (suggest) $$("button", suggest).forEach(b => b.addEventListener("click", () => send(b.textContent)));
  }
  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initChat);
    else initChat();
  } catch (e) { console.warn("[chat]", e); }
})();
