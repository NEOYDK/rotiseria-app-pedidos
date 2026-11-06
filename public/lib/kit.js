// Kit Yardak para las demos (se copia en public/lib/kit.js de cada una). Ver kit.css.
// Barra de progreso (.k-progreso), apariciones ([data-k]), números que cuentan ([data-k-cuenta]),
// preguntas animadas (.k-faq details) y globo del asistente que habla (.k-fab con data-k-tip="texto").
(function () {
  "use strict";
  const $ = (s, sc) => (sc || document).querySelector(s);
  const $$ = (s, sc) => Array.from((sc || document).querySelectorAll(s));
  function safe(fn, n) { try { fn(); } catch (e) { console.warn("[kit " + n + "]", e); } }
  const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function progreso() {
    const bar = $(".k-progreso");
    if (!bar) return;
    let pendiente = false;
    const pintar = () => {
      pendiente = false;
      const alto = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = "scaleX(" + (alto > 0 ? Math.min(1, scrollY / alto) : 0).toFixed(4) + ")";
    };
    addEventListener("scroll", () => { if (!pendiente) { pendiente = true; requestAnimationFrame(pintar); } }, { passive: true });
    pintar();
  }

  function contar(el) {
    const fin = +el.dataset.kCuenta, pre = el.dataset.kPre || "", suf = el.dataset.kSuf || "";
    if (quieto || !fin) { el.textContent = pre + fin + suf; return; }
    const t0 = performance.now(), dur = 1100;
    const paso = t => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = pre + Math.round(fin * (1 - Math.pow(1 - k, 3))) + suf;
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  function apariciones() {
    const items = $$("[data-k]");
    const mostrar = el => { el.classList.add("k-visible"); $$("[data-k-cuenta]", el).forEach(contar); if (el.matches("[data-k-cuenta]")) contar(el); };
    if (!("IntersectionObserver" in window)) { items.forEach(mostrar); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      const hermanos = $$(":scope > [data-k]", e.target.parentElement);
      e.target.style.transitionDelay = Math.min(6, Math.max(0, hermanos.indexOf(e.target))) * 70 + "ms";
      mostrar(e.target);
      io.unobserve(e.target);
    }), { threshold: 0.01, rootMargin: "0px 0px -2% 0px" });
    items.forEach(el => io.observe(el));
    setTimeout(() => items.forEach(el => { if (!el.classList.contains("k-visible")) mostrar(el); }), 6000);  // nada queda escondido
  }

  // <details> que se abren y cierran con una animación suave (sin animación si el equipo pide menos movimiento)
  function preguntas() {
    $$(".k-faq details").forEach(d => {
      const s = $("summary", d);
      if (!s || d.dataset.kListo) return;
      d.dataset.kListo = "1";
      const cuerpo = document.createElement("div");
      cuerpo.className = "k-faq-cuerpo";
      while (s.nextSibling) cuerpo.appendChild(s.nextSibling);
      d.appendChild(cuerpo);
      s.addEventListener("click", e => {
        if (quieto || !cuerpo.animate) return;
        e.preventDefault();
        if (!d.open) {
          d.open = true;
          cuerpo.animate([{ height: "0px", opacity: 0 }, { height: cuerpo.scrollHeight + "px", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" });
        } else {
          const a = cuerpo.animate([{ height: cuerpo.scrollHeight + "px", opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 260, easing: "ease-in" });
          a.onfinish = () => { d.open = false; };
        }
      });
    });
  }

  // Globo del asistente: el texto aparece al pasar el mouse; en el celu, una vez por visita, unos segundos
  function globo() {
    const fab = $(".k-fab[data-k-tip]");
    if (!fab) return;
    const tip = document.createElement("span");
    tip.className = "k-tip";
    tip.setAttribute("aria-hidden", "true");
    tip.textContent = fab.dataset.kTip;
    fab.appendChild(tip);
    if (matchMedia("(hover: hover)").matches) return;
    let visto = false;
    try { visto = sessionStorage.getItem("k-tip") === "1"; } catch (_) { /* sin almacenamiento */ }
    if (visto) return;
    setTimeout(() => {
      if (fab.hidden) return;
      fab.classList.add("k-tip-on");
      setTimeout(() => fab.classList.remove("k-tip-on"), 4500);
      try { sessionStorage.setItem("k-tip", "1"); } catch (_) { /* nada */ }
    }, 3500);
    fab.addEventListener("click", () => fab.classList.remove("k-tip-on"));
  }

  function boot() {
    safe(progreso, "progreso");
    safe(apariciones, "apariciones");
    safe(preguntas, "preguntas");
    safe(globo, "globo");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
