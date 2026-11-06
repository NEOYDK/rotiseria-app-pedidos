// Ventanita de chat de un pedido, entre el cliente (app) y el local (panel). La usan las dos pantallas:
//   const c = Charla({ yo: "cliente" | "local", rapidas: [...], enviar: async texto => mensajes | { error }, alCambiar })
//   c.abrir("Título", "subtítulo", mensajes) · c.pintar(mensajes) · c.cerrar() · c.abierta()
// En el celular sale desde abajo; en la compu queda flotando abajo a la derecha. Se abre solo desde su botón.
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hora = iso => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });
  let n = 0;

  window.Charla = function ({ yo, rapidas = [], vacio = "", enviar, alCambiar }) {
    const id = "charla-" + (++n);
    const el = document.createElement("section");
    el.className = "charla";
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-labelledby", id + "-tit");
    el.innerHTML = `<header class="charla-cab">
        <span class="charla-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg></span>
        <div class="charla-tits"><h2 id="${id}-tit"></h2><p class="charla-sub"></p></div>
        <button class="charla-cerrar" type="button" aria-label="Cerrar el chat">×</button>
      </header>
      <ol class="charla-log" aria-live="polite"></ol>
      <div class="charla-rapidas">${rapidas.map(r => `<button type="button" data-rapida>${esc(r)}</button>`).join("")}</div>
      <form class="charla-form">
        <label class="sr-only" for="${id}-txt">Mensaje</label>
        <input id="${id}-txt" maxlength="300" autocomplete="off" enterkeyhint="send" placeholder="Escribí un mensaje…">
        <button class="charla-enviar" type="submit" aria-label="Enviar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-3-7z"/></svg></button>
      </form>`;
    document.body.appendChild(el);
    const log = el.querySelector(".charla-log"), input = el.querySelector("input"), form = el.querySelector("form");
    let lista = [], pendiente = null, mandando = false, antesFoco = null;

    function pintar(mensajes) {
      if (mensajes) lista = mensajes;
      const cerca = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      const items = lista.map(m => `<li class="m ${m.de === yo ? "m-yo" : "m-otro"}"><p>${esc(m.texto)}</p><time datetime="${esc(m.creado)}">${hora(m.creado)}</time></li>`);
      if (pendiente) items.push(`<li class="m m-yo m-enviando"><p>${esc(pendiente)}</p><time>Enviando…</time></li>`);
      log.innerHTML = items.join("") || `<li class="charla-vacia">${esc(vacio)}</li>`;
      if (cerca || pendiente) log.scrollTop = log.scrollHeight;
    }

    async function mandar(txt) {
      txt = String(txt || "").trim().slice(0, 300);
      if (!txt || mandando) return;
      mandando = true; pendiente = txt; input.value = ""; pintar();
      const r = await enviar(txt);
      mandando = false; pendiente = null;
      if (r && Array.isArray(r)) pintar(r);
      else { pintar(); input.value = txt; if (alCambiar) alCambiar({ error: (r && r.error) || "No se pudo mandar. Probá de nuevo." }); }
    }

    // Con el teclado abierto en el celular, la ventana sube para que se vea lo que escribís
    function teclado() {
      const vv = window.visualViewport;
      if (!vv || el.hidden) return;
      el.style.setProperty("--teclado", Math.max(0, innerHeight - vv.height - vv.offsetTop) + "px");
    }
    if (window.visualViewport) { visualViewport.addEventListener("resize", teclado); visualViewport.addEventListener("scroll", teclado); }

    form.addEventListener("submit", e => { e.preventDefault(); mandar(input.value); });
    el.querySelectorAll("[data-rapida]").forEach(b => b.addEventListener("click", () => mandar(b.textContent)));
    el.querySelector(".charla-cerrar").addEventListener("click", () => cerrar());
    el.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); cerrar(); } });

    function abrir(tit, sub, mensajes) {
      antesFoco = document.activeElement;
      el.querySelector("h2").textContent = tit;
      el.querySelector(".charla-sub").textContent = sub || "";
      el.hidden = false;
      document.documentElement.classList.add("con-charla");
      pintar(mensajes || []);
      log.scrollTop = log.scrollHeight;
      teclado();
      requestAnimationFrame(() => el.classList.add("on"));
      // En el celular no abro el teclado solo (taparía el chat); en la compu, directo a escribir
      if (matchMedia("(min-width: 720px)").matches) input.focus({ preventScroll: true });
      else el.querySelector(".charla-cerrar").focus({ preventScroll: true });
    }
    function cerrar() {
      if (el.hidden) return;
      el.classList.remove("on"); el.hidden = true;
      document.documentElement.classList.remove("con-charla");
      if (antesFoco && document.contains(antesFoco)) antesFoco.focus({ preventScroll: true });
      if (alCambiar) alCambiar({ cerrada: true });
    }
    return { abrir, cerrar, pintar, abierta: () => !el.hidden, el };
  };
})();
