(function () {
  "use strict";

  // Página de pago: /pagar?pedido=2mila.1gaseosa[&nombre=…&entrega=…&dir=…&notas=…&medio=transferencia]
  // La arma el carrito de la web o la manda el bot de WhatsApp. Los precios los calcula el servidor.
  const data = window.__BRAND__ || {};
  const $ = (s, sc) => (sc || document).querySelector(s);
  const $$ = (s, sc) => Array.from((sc || document).querySelectorAll(s));
  const money = n => "$ " + Math.round(n).toLocaleString("es-AR");
  const wa = (num, text) => "https://wa.me/" + num + "?text=" + encodeURIComponent(text);
  const alias = data.alias || "yardakdev";
  const GUARDADO = "ldt-pagar"; // los datos del pedido mientras se paga en Mercado Pago

  let info = new URLSearchParams(location.search);
  let pedido = null; // { lines, total, pedido }

  function show(sel, on) { $(sel).hidden = !on; }

  function orderText(intro, extra) {
    let t = intro + "\n\n" + pedido.lines.map(l => "• " + l.qty + " × " + l.name + " (" + money(l.subtotal) + ")").join("\n");
    t += "\n\nTotal: " + money(pedido.total);
    if (info.get("nombre")) t += "\nNombre: " + info.get("nombre");
    if (info.get("entrega")) t += "\nEntrega: " + info.get("entrega");
    if (info.get("dir")) t += "\nDirección: " + info.get("dir");
    if (info.get("notas")) t += "\nNotas: " + info.get("notas");
    return t + (extra ? "\n" + extra : "");
  }

  function render() {
    $$("[data-total]").forEach(el => { el.textContent = money(pedido.total); });
    $("[data-lines]").innerHTML = pedido.lines.map(l =>
      "<li><span>" + l.qty + " × " + l.name.replace(/[<>&]/g, "") + "</span><span>" + money(l.subtotal) + "</span></li>").join("");
    const who = [info.get("nombre"), info.get("entrega"), info.get("dir")].filter(Boolean).join(" · ");
    $("[data-who]").textContent = who;
    $("[data-who]").hidden = !who;
    $("[data-alias]").textContent = alias;
    $("[data-mp]").textContent = "Pagar " + money(pedido.total) + " con Mercado Pago";
    // "Cambiar pedido" vuelve al menú con el carrito y los datos ya cargados
    const vuelta = new URLSearchParams(info);
    vuelta.delete("pago");
    vuelta.set("pedido", pedido.pedido);
    $("[data-edit]").href = "./?" + vuelta.toString() + "#menu";

    const t = $("[data-transfer-wa]");
    t.href = wa(data.whatsapp, orderText("¡Hola! Te transferí " + money(pedido.total) + " al alias " + alias + " por mi pedido.", "Te mando el comprobante."));
    t.target = "_blank"; t.rel = "noopener";
  }

  function initMedios() {
    const radios = $$("[name=medio]");
    const sync = () => {
      const medio = (radios.find(r => r.checked) || radios[0]).value;
      $$("[data-panel]").forEach(p => { p.hidden = p.dataset.panel !== medio; });
    };
    radios.forEach(r => r.addEventListener("change", sync));
    if (info.get("medio") === "transferencia") radios.forEach(r => { r.checked = r.value === "transferencia"; });
    $("[data-to-transfer]").addEventListener("click", () => {
      radios.forEach(r => { r.checked = r.value === "transferencia"; });
      sync();
      $("[data-copy=alias]").focus();
    });
    sync();
  }

  function initCopy() {
    $$("[data-copy]").forEach(b => b.addEventListener("click", async () => {
      const text = b.dataset.copy === "alias" ? alias : String(pedido.total);
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
        try { // navegadores viejos
          const ta = document.createElement("textarea");
          ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove();
        } catch (_) { /* sin portapapeles */ }
      }
      b.textContent = ok ? "¡Copiado!" : "Copialo a mano";
      setTimeout(() => { b.textContent = "Copiar"; }, 2200);
    }));
  }

  function initMercadoPago() {
    const btn = $("[data-mp]"), err = $("[data-mp-error]");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Abriendo Mercado Pago…";
      err.hidden = true;
      let res = {};
      try {
        const r = await fetch("/api/pago", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pedido: pedido.pedido, nombre: info.get("nombre") || "", entrega: info.get("entrega") || "", dir: info.get("dir") || "" })
        });
        res = await r.json().catch(() => ({}));
      } catch (_) { /* sin conexión: cae al mensaje genérico */ }
      if (res.url) {
        const sinPago = new URLSearchParams(info);
        sinPago.delete("pago");
        try { localStorage.setItem(GUARDADO, sinPago.toString()); } catch (_) { /* sin almacenamiento: igual se puede pagar */ }
        window.open(res.url, "_self");
        return;
      }
      err.textContent = res.error || "No pudimos abrir Mercado Pago. Probá de nuevo o pagá por transferencia.";
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = "Pagar " + money(pedido.total) + " con Mercado Pago";
    });
  }

  // Al volver de Mercado Pago la dirección trae payment_id y status: la cambiamos por la del pedido + pago=<id>
  function readReturn() {
    const q = new URLSearchParams(location.search);
    const id = q.get("payment_id") || q.get("collection_id");
    const status = q.get("status") || q.get("collection_status");
    if (!id && !status) return;
    let saved = "";
    try { saved = localStorage.getItem(GUARDADO) || ""; } catch (_) { /* sin almacenamiento */ }
    info = new URLSearchParams(saved);
    info.set("pago", /^\d+$/.test(id || "") ? id : "no");
    history.replaceState(null, "", location.pathname + "?" + info.toString());
  }

  async function checkPayment() {
    const id = info.get("pago");
    if (!id) return null;
    if (id === "no") return "rejected";
    try {
      const v = await (await fetch("/api/verificar?id=" + id)).json();
      if (!info.get("pedido") && v.pedido) {
        info.set("pedido", v.pedido);
        history.replaceState(null, "", location.pathname + "?" + info.toString());
      }
      return v.status || "desconocido";
    } catch (_) { return "desconocido"; }
  }

  function showResult(status) {
    const set = (icon, title, text) => { $("[data-result-icon]").textContent = icon; $("[data-result-title]").textContent = title; $("[data-result-text]").textContent = text; };
    show("[data-result]", true);
    if (status === "approved") {
      set("✅", "¡Pago aprobado!", "Último paso: avisanos el pedido por WhatsApp así lo empezamos a preparar.");
      const a = $("[data-result-wa]");
      a.href = wa(data.whatsapp, pedido
        ? orderText("¡Hola! Ya pagué mi pedido por Mercado Pago ✅", "Pago: Mercado Pago — PAGADO (operación " + info.get("pago") + ")")
        : "¡Hola! Ya pagué mi pedido por Mercado Pago ✅ (operación " + info.get("pago") + ")");
      a.target = "_blank"; a.rel = "noopener"; a.hidden = false;
      try { localStorage.removeItem(GUARDADO); } catch (_) { /* nada */ }
      return false; // ya pagó: no mostramos de nuevo las formas de pago
    }
    if (status === "pending" || status === "in_process") {
      set("⏳", "Pago pendiente", "Mercado Pago todavía está procesando el pago. Cuando se acredite, avisanos por WhatsApp.");
      return false;
    }
    if (status === "rejected" || status === "cancelled") {
      set("❌", "El pago no se completó", "No se cobró nada. Podés intentar de nuevo o pagar por transferencia.");
      if (info.get("pago") === "no") { info.delete("pago"); history.replaceState(null, "", location.pathname + "?" + info.toString()); }
    } else {
      set("❓", "No pudimos confirmar el pago", "Revisá en tu app de Mercado Pago si se cobró. Si se cobró, avisanos por WhatsApp con el comprobante.");
    }
    return true; // puede volver a intentar
  }

  async function boot() {
    document.documentElement.classList.remove("no-js");
    readReturn();
    const status = await checkPayment();

    const codigo = info.get("pedido");
    if (codigo) {
      try {
        const j = await (await fetch("/api/pago?pedido=" + encodeURIComponent(codigo))).json();
        if (j && Array.isArray(j.lines) && j.lines.length) pedido = j;
      } catch (_) { /* sin conexión: queda sin pedido */ }
    }
    show("[data-loading]", false);

    const retry = status ? showResult(status) : true;
    if (!pedido) {
      if (!status) show("[data-empty]", true);
      else show("[data-result-back]", true); // sin pedido para reintentar: al menos volver al menú
      return;
    }
    render();
    initMedios();
    initCopy();
    initMercadoPago();
    show("[data-checkout]", retry);
    show("[data-result-back]", Boolean(status) && !retry);
  }

  function start() { boot().catch(e => { console.warn("[pagar]", e); show("[data-loading]", false); show("[data-empty]", true); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
