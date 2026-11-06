// Panel del local de Lo de Tito: los pedidos de la app llegan acá al instante (suena), se aceptan, se cocinan,
// salen con el repartidor y se cobran. Cada pedido tiene su chat con el cliente y el botón de +15 min de demora
// (le avisa por ese chat). También: precios y agotados del menú, números del día y ajustes.
// Demo: es el panel del "local de prueba" de esta visita (el mismo código que usa la app en este navegador).
(function () {
  "use strict";

  const data = window.__BRAND__ || {};
  const $ = (s, sc) => (sc || document).querySelector(s);
  const $$ = (s, sc) => Array.from((sc || document).querySelectorAll(s));
  function safe(fn, name) { try { fn(); } catch (e) { console.warn("[" + name + "]", e); } }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plata = n => "$ " + Math.round(n).toLocaleString("es-AR");
  const leer = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* modo privado */ } };
  const hora = iso => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });
  const minDesde = iso => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60e3));
  const hace = iso => { const m = minDesde(iso); return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`; };

  // El mismo local de prueba que la app de este navegador (o el que viene en el link)
  const params = new URLSearchParams(location.search);
  let LOCAL = params.get("local");
  if (/^[a-z0-9]{6,16}$/.test(LOCAL || "")) { guardar("tito-local", LOCAL); if (history.replaceState) history.replaceState(null, "", location.pathname); }
  else {
    LOCAL = leer("tito-local", "");
    if (!/^[a-z0-9]{6,16}$/.test(LOCAL)) { LOCAL = [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join(""); guardar("tito-local", LOCAL); }
  }
  const linkApp = () => location.origin + "/?local=" + LOCAL;

  let est = null;                  // última respuesta del servidor
  let conocidos = null;            // ids de pedidos ya vistos (para saber cuáles son nuevos)
  let conocidosMsj = null;         // ids de mensajes ya vistos (para que suene cuando escribe un cliente)
  let filtro = "activos";
  let sonido = leer("tito-panel-sonido", true);
  let tPoll = 0, tTimbre = 0;

  async function api(opciones) {
    try {
      const r = opciones
        ? await fetch("/api/panel", { method: "POST", headers: { "Content-Type": "application/json", "X-Panel": "1" }, body: JSON.stringify({ local: LOCAL, ...opciones }) })
        : await fetch("/api/panel?local=" + LOCAL);
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, datos: d };
    } catch (_) { return { ok: false, status: 0, datos: { error: "Sin conexión. Revisá internet." } }; }
  }

  let tToast = 0;
  function toast(t) {
    const el = $("[data-toast]");
    el.textContent = t; el.hidden = false; el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
    clearTimeout(tToast); tToast = setTimeout(() => { el.classList.remove("on"); setTimeout(() => { el.hidden = true; }, 300); }, 2600);
  }

  // ---------- Sonido: suena hasta que se acepta ----------
  let audio = null;
  function desbloquear() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch (_) { /* sin sonido */ } }
  function timbre() {
    if (!sonido || !audio) return;
    try {
      [0, .22, .44].forEach((d, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + d;
        o.type = "triangle"; o.frequency.value = i === 2 ? 1175 : 988; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.start(t); o.stop(t + 0.22);
      });
    } catch (_) { /* nada */ }
  }
  // Más suave que el timbre: escribió un cliente
  function campanita() {
    if (!sonido || !audio) return;
    try {
      [1320, 1760].forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * .14;
        o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.start(t); o.stop(t + 0.27);
      });
    } catch (_) { /* nada */ }
  }
  const TITULO = document.title;
  function sonarMientrasHayaNuevos() {
    clearInterval(tTimbre);
    const n = est ? est.pedidos.filter(p => p.estado === "nuevo").length : 0;
    const sl = est ? est.pedidos.reduce((a, p) => a + sinLeer(p), 0) : 0;
    document.title = n ? `(${n}) ¡Pedido nuevo! · Lo de Tito` : sl ? `(${sl}) Mensaje nuevo · Lo de Tito` : TITULO;
    if (!n) return;
    tTimbre = setInterval(() => {
      if (!est.pedidos.some(p => p.estado === "nuevo")) { clearInterval(tTimbre); return; }
      timbre();
    }, 9000);
  }
  function pintarSonido() {
    const b = $("[data-sonido]");
    b.setAttribute("aria-pressed", String(!!sonido));
    b.title = sonido ? "Sonido activado" : "Sonido apagado";
  }

  // ---------- Cargar y redibujar ----------
  async function cargar() {
    clearTimeout(tPoll);
    const r = await api();
    if (r.ok) aplicar(r.datos);
    else if (r.status !== 0) toast(r.datos.error || "No pudimos actualizar el panel.");
    tPoll = setTimeout(cargar, document.hidden ? 15000 : 4000);
  }

  function aplicar(d) {
    const antes = conocidos;
    est = d;
    const ids = new Set(d.pedidos.map(p => p.id));
    if (antes) {
      const nuevos = d.pedidos.filter(p => !antes.has(p.id) && p.estado === "nuevo");
      if (nuevos.length) {
        timbre(); if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate([200, 80, 200]);
        const av = $("[data-aviso-nuevo]");
        av.textContent = nuevos.length === 1 ? `¡Pedido nuevo! #${nuevos[0].numero} de ${nuevos[0].nombre} · ${plata(nuevos[0].total)}` : `¡${nuevos.length} pedidos nuevos!`;
        av.hidden = false; av.classList.remove("on"); void av.offsetWidth; av.classList.add("on");
        setTimeout(() => { av.hidden = true; }, 5000);
      }
    }
    conocidos = ids;
    revisarMensajes(d);
    pintarTodo();
    sonarMientrasHayaNuevos();
  }

  function pintarTodo() {
    if (!est) return;
    const l = est.local;
    $("[data-abierto]").checked = l.abierto;
    $("[data-abierto-txt]").textContent = l.abierto ? "Abierto" : "Cerrado";
    document.body.classList.toggle("cerrado", !l.abierto);
    pintarPedidos();
    pintarMenu();
    pintarResumen();
    pintarAjustes();
  }

  // ---------- Pedidos ----------
  const ETQ_PAGO = { efectivo: "Efectivo", transferencia: "Transferencia", mercadopago: "Mercado Pago" };
  function chipPago(p) {
    if (p.pagado) return `<span class="chip chip-ok">${ETQ_PAGO[p.pago]} · cobrado</span>`;
    if (p.pago === "efectivo") return `<span class="chip">Efectivo al ${p.tipo === "delivery" ? "recibir" : "retirar"}${p.pagaCon && p.pagaCon > p.total ? ` · paga con ${plata(p.pagaCon)}` : ""}</span>`;
    return `<span class="chip chip-falta">${ETQ_PAGO[p.pago]} · falta el pago</span>`;
  }
  function telWa(t) {
    let d = String(t || "").replace(/\D/g, "");
    if (d.startsWith("0")) d = d.slice(1);
    if (d.startsWith("54")) return d;
    if (d.length === 10) return "549" + d;
    return d;
  }
  function msjCliente(p) {
    const n = p.nombre.split(" ")[0];
    switch (p.estado) {
      case "nuevo": return `¡Hola ${n}! Recibimos tu pedido #${p.numero} en Lo de Tito. En un ratito te confirmamos.`;
      case "cocina": return `¡Hola ${n}! Tu pedido #${p.numero} ya está en la cocina. ${p.tipo === "delivery" ? "Sale" : "Va a estar listo"} cerca de las ${hora(p.listoPara)}.`;
      case "listo": return p.tipo === "delivery" ? `¡Hola ${n}! Tu pedido #${p.numero} está listo y sale en minutos.` : `¡Hola ${n}! Tu pedido #${p.numero} está listo para retirar. Te esperamos.`;
      case "camino": return `¡Hola ${n}! Tu pedido #${p.numero} ya salió con ${p.repartidor || "el repartidor"}. ${p.retraso && p.listoPara ? `Llega cerca de las ${hora(p.listoPara)}.` : "Llega en unos minutos."}`;
      default: return `¡Hola ${n}! Te escribimos de Lo de Tito por tu pedido #${p.numero}.`;
    }
  }

  function tarjeta(p) {
    const delivery = p.tipo === "delivery";
    const min = minDesde(p.creado);
    let estadoTxt = "", acciones = "";
    if (p.estado === "nuevo") {
      estadoTxt = `<span class="espera${min >= 5 ? " tarde" : ""}">Esperando · ${hace(p.creado)}</span>`;
      acciones = `<button class="btn btn-ambar" type="button" data-acc="aceptar" data-id="${p.id}">Aceptar · ${est.local.demora} min</button>
        <button class="btn btn-borde" type="button" data-acc="tiempo" data-id="${p.id}">Otro tiempo</button>
        <button class="btn btn-borde btn-no" type="button" data-acc="rechazar" data-id="${p.id}">Rechazar</button>`;
    } else if (p.estado === "cocina") {
      const falta = Math.round((Date.parse(p.listoPara) - Date.now()) / 60e3);
      estadoTxt = `<span class="espera${falta < 0 ? " tarde" : ""}">${falta >= 0 ? `Listo a las ${hora(p.listoPara)} · faltan ${falta} min` : `Atrasado ${-falta} min (era a las ${hora(p.listoPara)})`}</span>`;
      acciones = `<button class="btn btn-ambar" type="button" data-acc="listo" data-id="${p.id}">Está listo</button>`;
    } else if (p.estado === "listo") {
      estadoTxt = `<span class="espera">Listo ${hace(p.listo)}</span>`;
      acciones = delivery
        ? `<button class="btn btn-ambar" type="button" data-acc="salio" data-id="${p.id}">Salió con el repartidor</button>`
        : `<button class="btn btn-ambar" type="button" data-acc="entregado" data-id="${p.id}">Lo retiraron</button>`;
    } else if (p.estado === "camino") {
      estadoTxt = `<span class="espera">Salió con ${esc(p.repartidor || "el repartidor")} ${hace(p.salio)}${p.retraso && p.listoPara ? ` · llega ${hora(p.listoPara)}` : ""}</span>`;
      acciones = `<button class="btn btn-ambar" type="button" data-acc="entregado" data-id="${p.id}">Entregado</button>`;
    } else {
      estadoTxt = p.estado === "entregado" ? `<span class="espera ok">Entregado a las ${hora(p.entregado)}</span>` : `<span class="espera tarde">Cancelado${p.motivo ? " · " + esc(p.motivo) : ""}</span>`;
    }
    // +15 min: mientras se cocina o (si es delivery) hasta que llega. Le avisa al cliente por el chat.
    if (puedeDemorar(p)) acciones += `<button class="btn btn-borde" type="button" data-acc="demorar" data-id="${p.id}">+15 min de demora</button>`;
    if (p.retraso && !["entregado", "cancelado"].includes(p.estado)) estadoTxt += ` <span class="chip chip-demora">+${p.retraso} min avisado</span>`;
    const activo = !["entregado", "cancelado"].includes(p.estado);
    const cobrable = p.pago !== "mercadopago" && p.estado !== "cancelado";
    const sl = sinLeer(p), primer = p.nombre.split(" ")[0];
    return `<article class="pedido e-${p.estado}${p.ejemplo ? " ejemplo" : ""}" data-pedido="${p.id}">
      <header class="pedido-cab">
        <b class="pedido-num">#${p.numero}</b>
        <span class="chip ${delivery ? "chip-del" : "chip-ret"}">${delivery ? "Delivery" : "Retira"}</span>
        <span class="pedido-hora">${hora(p.creado)}</span>
        <button class="pedido-chat${sl ? " con-nuevos" : ""}" type="button" data-acc="chat" data-id="${p.id}" aria-label="Chat con ${esc(primer)}${sl ? `: ${sl} mensaje${sl === 1 ? "" : "s"} sin leer` : ""}"><svg class="ico-charla" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>Chat${sl ? `<span class="charla-n">${sl}</span>` : ""}</button>
      </header>
      <p class="pedido-cliente"><b>${esc(p.nombre)}</b>${delivery ? `<span>${esc(p.direccion)}</span>` : ""}</p>
      <ul class="pedido-items">${p.items.map(i => `<li><b>${i.cant}×</b> ${esc(i.nombre)}${i.detalle ? ` <small>${esc(i.detalle)}</small>` : ""}${i.nota ? ` <em>"${esc(i.nota)}"</em>` : ""}</li>`).join("")}</ul>
      ${p.notas ? `<p class="pedido-nota">Nota: ${esc(p.notas)}</p>` : ""}
      <p class="pedido-total"><b>${plata(p.total)}</b>${chipPago(p)}</p>
      <p class="pedido-estado">${estadoTxt}</p>
      ${acciones ? `<div class="pedido-acciones">${acciones}</div>` : ""}
      <div class="pedido-mas">
        <a href="https://wa.me/${telWa(p.telefono)}?text=${encodeURIComponent(msjCliente(p))}" target="_blank" rel="noopener">WhatsApp</a>
        <button type="button" data-acc="imprimir" data-id="${p.id}">Imprimir</button>
        ${cobrable ? `<button type="button" data-acc="pagado" data-id="${p.id}">${p.pagado ? "Marcar sin cobrar" : "Marcar cobrado"}</button>` : ""}
        ${activo && p.estado !== "nuevo" ? `<button type="button" class="no" data-acc="cancelar" data-id="${p.id}">Cancelar</button>` : ""}
      </div>
      ${p.ejemplo ? '<p class="pedido-ej">Pedido de ejemplo</p>' : ""}
    </article>`;
  }

  function pintarPedidos() {
    const ps = est.pedidos;
    const grupos = {
      nuevo: ps.filter(p => p.estado === "nuevo").sort((a, b) => a.id - b.id),
      cocina: ps.filter(p => p.estado === "cocina").sort((a, b) => Date.parse(a.listoPara) - Date.parse(b.listoPara)),
      salida: ps.filter(p => p.estado === "listo" || p.estado === "camino").sort((a, b) => a.id - b.id),
    };
    const hist = ps.filter(p => p.estado === "entregado" || p.estado === "cancelado");
    for (const [k, lista] of Object.entries(grupos)) {
      $(`[data-lista="${k}"]`).innerHTML = lista.map(tarjeta).join("") || `<p class="col-vacia">${k === "nuevo" ? "Cuando un cliente pida, aparece acá y suena." : "Nada por ahora."}</p>`;
      $(`[data-cuenta="${k}"]`).textContent = lista.length;
    }
    const activos = grupos.nuevo.length + grupos.cocina.length + grupos.salida.length;
    $("[data-cuenta=activos]").textContent = activos;
    $("[data-cuenta=historial]").textContent = hist.length;
    $("[data-historial]").innerHTML = hist.map(tarjeta).join("") || '<p class="col-vacia">Todavía no hay pedidos entregados.</p>';
    $("[data-columnas]").hidden = filtro !== "activos";
    $("[data-historial]").hidden = filtro !== "historial";
    const badge = $("[data-badge]");
    badge.textContent = grupos.nuevo.length; badge.hidden = !grupos.nuevo.length;
  }

  // ---------- Acciones ----------
  // Los cambios van en fila (uno detrás del otro): si tocás dos cosas seguidas, se guardan las dos.
  // El mismo cambio tocado dos veces mientras se guarda (doble toque) se hace una sola vez.
  let fila = Promise.resolve();
  const enCurso = new Set();
  function hacer(cambio, okTxt) {
    const clave = JSON.stringify(cambio);
    if (enCurso.has(clave)) return fila;
    enCurso.add(clave);
    fila = fila.then(async () => {
      const r = await api(cambio);
      enCurso.delete(clave);
      if (r.ok) { aplicar(r.datos); if (okTxt) toast(okTxt); }
      else { toast(r.datos.error || "No se pudo. Probá de nuevo."); cargar(); }
    });
    return fila;
  }
  const pedidoPorId = id => est.pedidos.find(p => p.id === +id);
  const puedeDemorar = p => (p.retraso || 0) < 60 && (p.estado === "cocina" || (p.tipo === "delivery" && (p.estado === "listo" || p.estado === "camino")));

  // ---------- Chat con el cliente de cada pedido (se abre desde el botón "Chat" del recuadro) ----------
  let charla = null, chatDe = null, tAvisoMsj = 0;
  const vistosChat = leer("tito-panel-charla-vista", {});   // { idPedido: hora del último mensaje del cliente que se leyó }
  // Sin leer: lo que escribió el cliente después de la última vez que se abrió el chat (o que le contestaron)
  function sinLeer(p) {
    const ms = p.mensajes || [], ult = ms.filter(m => m.de === "local").pop();
    const desde = [vistosChat[p.id] || "", ult ? ult.creado : ""].sort().pop();
    return ms.filter(m => m.de === "cliente" && m.creado > desde).length;
  }
  function marcarVisto(p) {
    const u = (p.mensajes || []).filter(m => m.de === "cliente").pop();
    if (u && u.creado > (vistosChat[p.id] || "")) { vistosChat[p.id] = u.creado; guardar("tito-panel-charla-vista", vistosChat); }
  }
  function abrirChat(p) {
    if (!charla) return;
    chatDe = p.id;
    $("[data-aviso-msj]").hidden = true;
    charla.abrir(`${p.nombre} · #${p.numero}`, p.tipo === "delivery" ? `Delivery a ${p.direccion}` : "Retira en el local", p.mensajes || []);
    marcarVisto(p);
    pintarPedidos(); sonarMientrasHayaNuevos();
  }
  function revisarMensajes(d) {
    const ids = new Set(), nuevos = [];
    d.pedidos.forEach(p => (p.mensajes || []).forEach(m => {
      ids.add(m.id);
      if (conocidosMsj && m.de === "cliente" && !conocidosMsj.has(m.id)) nuevos.push({ p, m });
    }));
    conocidosMsj = ids;
    const abierto = charla && charla.abierta() ? d.pedidos.find(p => p.id === chatDe) : null;
    if (abierto) { charla.pintar(abierto.mensajes || []); marcarVisto(abierto); }
    else if (charla && charla.abierta()) charla.cerrar();     // ese pedido ya no está (empezó de cero)
    if (!nuevos.length) return;
    campanita(); if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate([90, 50, 90]);
    const otro = nuevos.filter(x => !abierto || x.p.id !== abierto.id).pop();
    if (!otro) return;
    const av = $("[data-aviso-msj]");
    av.dataset.id = otro.p.id;
    $("[data-aviso-msj-tit]").textContent = `${otro.p.nombre.split(" ")[0]} (#${otro.p.numero}) te escribió`;
    $("[data-aviso-msj-txt]").textContent = otro.m.texto;
    av.hidden = false; av.classList.remove("on"); void av.offsetWidth; av.classList.add("on");
    clearTimeout(tAvisoMsj); tAvisoMsj = setTimeout(() => { av.hidden = true; }, 9000);
  }
  function initChat() {
    $("[data-aviso-msj]").addEventListener("click", e => { const p = pedidoPorId(e.currentTarget.dataset.id); if (p) abrirChat(p); });
    if (!window.Charla) return;
    charla = window.Charla({
      yo: "local",
      rapidas: ["¡Ya sale!", "Hay demora, ya te lo mandamos.", "¿Nos confirmás la dirección?", "¿Tenés cambio?"],
      vacio: "Escribile al cliente si tenés que avisarle o preguntarle algo de su pedido. Lo ve en su app al instante.",
      enviar: async texto => {
        const id = chatDe;
        const r = await api({ accion: "mensaje", id, texto });
        if (!r.ok) return { error: r.datos.error };
        aplicar(r.datos);
        const p = pedidoPorId(id);
        return p ? p.mensajes : [];
      },
      alCambiar: e => { if (e.error) toast(e.error); if (e.cerrada) { chatDe = null; pintarPedidos(); } },
    });
  }

  function elegir(tit, txt, opciones, alElegir) {
    $("[data-elegir-tit]").textContent = tit;
    $("[data-elegir-txt]").textContent = txt;
    $("[data-elegir-opciones]").innerHTML = opciones.map((o, i) => `<button class="btn ${i ? "btn-borde" : "btn-ambar"}" type="button" data-opcion="${esc(o.valor)}">${esc(o.texto)}</button>`).join("");
    $$("[data-opcion]").forEach(b => b.addEventListener("click", () => { cerrarHoja(); alElegir(b.dataset.opcion); }));
    abrirHoja();
  }
  function abrirHoja() {
    const h = $('[data-hoja="elegir"]');
    $("[data-velo]").hidden = false; h.hidden = false;
    requestAnimationFrame(() => { h.classList.add("on"); $("[data-velo]").classList.add("on"); });
    setTimeout(() => { const b = $("[data-opcion]"); if (b) b.focus(); }, 60);
  }
  function cerrarHoja() {
    const h = $('[data-hoja="elegir"]');
    h.classList.remove("on"); $("[data-velo]").classList.remove("on");
    setTimeout(() => { h.hidden = true; $("[data-velo]").hidden = true; }, 220);
  }

  function imprimir(p) {
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) { toast("Permití las ventanas emergentes para imprimir."); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comanda #${p.numero}</title><style>
      body{font:14px/1.35 monospace;width:72mm;margin:4mm auto;color:#000} h1{font-size:22px;margin:0 0 4px;text-align:center}
      .c{text-align:center} hr{border:0;border-top:1px dashed #000;margin:6px 0} li{margin:3px 0} ul{padding-left:16px;margin:4px 0}
      b{font-size:15px} .tot{font-size:18px;text-align:right}</style></head><body>
      <h1>LO DE TITO</h1><p class="c">Pedido <b>#${p.numero}</b> · ${hora(p.creado)}</p><hr>
      <p><b>${p.tipo === "delivery" ? "DELIVERY" : "RETIRA EN EL LOCAL"}</b><br>${esc(p.nombre)} · ${esc(p.telefono)}${p.tipo === "delivery" ? "<br>" + esc(p.direccion) : ""}</p><hr>
      <ul>${p.items.map(i => `<li><b>${i.cant} x ${esc(i.nombre)}</b>${i.detalle ? "<br>" + esc(i.detalle) : ""}${i.nota ? "<br>* " + esc(i.nota) : ""}</li>`).join("")}</ul>
      ${p.notas ? `<hr><p>NOTA: ${esc(p.notas)}</p>` : ""}<hr>
      <p class="tot">TOTAL ${plata(p.total)}</p><p>${ETQ_PAGO[p.pago]}${p.pagado ? " (COBRADO)" : ""}${p.pagaCon && p.pagaCon > p.total ? ` · paga con ${plata(p.pagaCon)}` : ""}</p>
      <script>window.onload = () => { window.print(); };<\/script></body></html>`);
    w.document.close();
  }

  function initAcciones() {
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-acc]");
      if (!b) return;
      const p = pedidoPorId(b.dataset.id);
      if (!p) return;
      const acc = b.dataset.acc;
      if (acc === "aceptar") hacer({ accion: "aceptar", id: p.id, demora: est.local.demora }, `Pedido #${p.numero} aceptado: el cliente ya lo ve.`);
      else if (acc === "tiempo") elegir(`¿Cuánto tarda el #${p.numero}?`, "El cliente ve la hora estimada en su app.", [15, 20, 25, 30, 40, 45, 60].map(m => ({ valor: m, texto: m === 60 ? "1 hora" : m + " minutos" })),
        v => hacer({ accion: "aceptar", id: p.id, demora: +v }, `Pedido #${p.numero} aceptado: ${v} minutos.`));
      else if (acc === "rechazar" || acc === "cancelar") elegir(acc === "rechazar" ? `¿Por qué no podés tomar el #${p.numero}?` : `¿Cancelar el pedido #${p.numero}?`,
        "El cliente lo ve en su app. Si ya pagó, devolvele la plata.", est.motivos.map(m => ({ valor: m, texto: m })),
        v => hacer({ accion: acc, id: p.id, motivo: v }, `Pedido #${p.numero} cancelado.`));
      else if (acc === "listo") hacer({ accion: "listo", id: p.id }, p.tipo === "delivery" ? "Listo: ahora asignale el repartidor." : "Listo: el cliente ya sabe que lo puede buscar.");
      else if (acc === "salio") elegir(`¿Con quién sale el #${p.numero}?`, "", est.repartidores.map(r => ({ valor: r, texto: r })),
        v => hacer({ accion: "salio", id: p.id, repartidor: v }, `Salió con ${v}.`));
      else if (acc === "entregado") hacer({ accion: "entregado", id: p.id }, `Pedido #${p.numero} entregado.`);
      else if (acc === "pagado") hacer({ accion: "pagado", id: p.id, valor: !p.pagado }, p.pagado ? "Marcado sin cobrar." : "Marcado como cobrado.");
      else if (acc === "imprimir") imprimir(p);
      else if (acc === "chat") abrirChat(p);
      else if (acc === "demorar") {
        const nueva = Math.max(Date.parse(p.listoPara) || 0, Date.now()) + 15 * 60e3;
        const cuando = p.estado === "camino" ? "llega" : p.tipo === "delivery" ? "sale" : "va a estar listo";
        const primer = p.nombre.split(" ")[0];
        elegir(`¿Se demora el #${p.numero}?`, `Le avisamos a ${primer} por el chat de su pedido: "Perdón, tu pedido se demora 15 minutos más: ${cuando} cerca de las ${hora(new Date(nueva).toISOString())}."`,
          [{ valor: "15", texto: "Sí, avisarle: +15 min" }],
          () => hacer({ accion: "demorar", id: p.id }, `Listo: ${primer} ya sabe que se demora 15 minutos más.`));
      }
    });
    $("[data-velo]").addEventListener("click", cerrarHoja);
    $$("[data-cerrar-hoja]").forEach(b => b.addEventListener("click", cerrarHoja));
    addEventListener("keydown", e => { if (e.key === "Escape") { if (charla && charla.abierta()) charla.cerrar(); else { cerrarHoja(); cerrarModal(); } } });
  }

  // ---------- Menú ----------
  function pintarMenu() {
    const cont = $("[data-pmenu]");
    if (cont.contains(document.activeElement)) return;   // no le borro lo que está escribiendo
    cont.innerHTML = est.productos.map(p => `<div class="p-prod${p.agotado ? " agotado" : ""}">
      <img src="${esc(p.foto)}" alt="" width="64" height="52" loading="lazy">
      <div class="p-prod-txt"><b>${esc(p.nombre)}</b>
        <label class="p-precio"><span class="sr-only">Precio de ${esc(p.nombre)}</span>$ <input type="number" inputmode="numeric" min="100" step="100" value="${p.precio}" data-precio="${p.id}"></label></div>
      <label class="interruptor interruptor-chico"><input type="checkbox" data-hay="${p.id}" ${p.agotado ? "" : "checked"}><span class="int-pista"></span><span class="int-txt">${p.agotado ? "Agotado" : "Hay"}</span></label>
    </div>`).join("");
  }
  function initMenu() {
    const cont = $("[data-pmenu]");
    cont.addEventListener("change", e => {
      const hay = e.target.closest("[data-hay]");
      if (hay) { hacer({ accion: "producto", pid: hay.dataset.hay, agotado: !hay.checked }, hay.checked ? "Vuelve a estar en la app." : "Marcado agotado: la app ya no lo deja pedir."); return; }
      const pr = e.target.closest("[data-precio]");
      if (pr) { pr.blur(); hacer({ accion: "producto", pid: pr.dataset.precio, precio: +pr.value }, `Precio guardado: ${plata(+pr.value)}. La app ya lo muestra.`); }
    });
    cont.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("[data-precio]")) e.target.dispatchEvent(new Event("change", { bubbles: true })); });
  }

  // ---------- Resumen ----------
  function pintarResumen() {
    const r = est.resumen;
    $("[data-kpis]").innerHTML = [
      ["Pedidos", r.pedidos, `${r.delivery} delivery · ${r.retiro} retiro`],
      ["Vendido", plata(r.vendido), r.cancelados ? `${r.cancelados} cancelado${r.cancelados === 1 ? "" : "s"}` : "sin cancelados"],
      ["Ticket promedio", plata(r.ticket), "por pedido"],
      ["Tiempo de cocina", r.cocinaMin == null ? "—" : r.cocinaMin + " min", "en promedio"],
    ].map(([t, v, s]) => `<div class="kpi"><span>${t}</span><b>${v}</b><small>${s}</small></div>`).join("");
    const max = Math.max(1, ...Object.values(r.porPago));
    $("[data-pagos]").innerHTML = Object.entries(r.porPago).map(([k, v]) => `<p class="barra-pago"><span>${ETQ_PAGO[k]}</span><i style="--w:${Math.round(v / max * 100)}%"></i><b>${plata(v)}</b></p>`).join("");
    $("[data-top]").innerHTML = r.top.map(t => `<li><span>${esc(t.nombre)}</span><b>${t.cant}</b></li>`).join("") || "<li><span>Todavía no hay pedidos hoy.</span></li>";
  }

  // ---------- Ajustes ----------
  function pintarAjustes() {
    const f = $("[data-form-local]");
    if (f.contains(document.activeElement)) return;
    f.demora.value = String(est.local.demora);
    if (!f.demora.value) f.demora.value = "30";
    f.envio.value = est.local.envio;
  }
  let promptInstalar = null;
  function initAjustes() {
    $("[data-form-local]").addEventListener("submit", e => {
      e.preventDefault();
      const f = e.target;
      hacer({ accion: "local", demora: +f.demora.value, envio: +f.envio.value }, "Guardado: la app ya muestra la demora y el envío nuevos.");
    });
    $("[data-abierto]").addEventListener("change", e => hacer({ accion: "local", abierto: e.target.checked }, e.target.checked ? "Abierto: la app toma pedidos." : "Cerrado: la app no toma pedidos."));
    $("[data-reiniciar]").addEventListener("click", () => { if (confirm("¿Borrar los pedidos de esta prueba y volver el menú a como estaba?")) { conocidos = null; conocidosMsj = null; hacer({ accion: "reiniciar" }, "Listo: empezaste de cero."); } });
    $("[data-compartir]").innerHTML = `<p class="qr-link">${esc(linkApp())}</p><div class="fila-botones"><button class="btn btn-borde" type="button" data-copiar-link>Copiar link</button><a class="btn btn-wa" href="https://wa.me/?text=${encodeURIComponent("Pedí en Lo de Tito desde la app: " + linkApp())}" target="_blank" rel="noopener">Compartir por WhatsApp</a></div>`;
    addEventListener("beforeinstallprompt", e => { e.preventDefault(); promptInstalar = e; });
    $("[data-instalar-panel]").addEventListener("click", async () => {
      if (promptInstalar) { promptInstalar.prompt(); try { await promptInstalar.userChoice; } catch (_) { /* nada */ } promptInstalar = null; }
      else $("[data-instalar-ayuda]").hidden = false;
    });
    document.addEventListener("click", async e => {
      if (!e.target.closest("[data-copiar-link]")) return;
      try { await navigator.clipboard.writeText(linkApp()); toast("Link copiado."); } catch (_) { toast(linkApp()); }
    });
    $$("[data-ir-app]").forEach(a => { a.href = linkApp(); });
  }

  // ---------- Probar con el celular (QR) ----------
  function cargarQR() {
    return new Promise((ok, mal) => {
      if (window.qrcode) return ok();
      const s = document.createElement("script"); s.src = "/lib/qrcode.js?v=20261026"; s.onload = ok; s.onerror = mal; document.head.appendChild(s);
    });
  }
  async function abrirQR() {
    const m = $("[data-qr]");
    $("[data-qr-link]").textContent = linkApp();
    $("[data-mandar-link]").href = "https://wa.me/?text=" + encodeURIComponent("App de Lo de Tito (demo): " + linkApp());
    $('[data-fondo="qr"]').hidden = false;
    setTimeout(() => $("[data-cerrar-modal]", m).focus(), 50);
    try {
      await cargarQR();
      const q = window.qrcode(0, "M"); q.addData(linkApp()); q.make();
      $("[data-qr-img]").innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true, alt: "Código QR para abrir la app" });
    } catch (_) { $("[data-qr-img]").textContent = "Abrí el link de abajo en tu celular."; }
  }
  function cerrarModal() {
    $$("[data-fondo]").forEach(f => { f.hidden = true; });
  }

  // ---------- Arranque ----------
  function initTabs() {
    $$("[data-ptab]").forEach(b => b.addEventListener("click", () => {
      $$("[data-ptab]").forEach(x => { if (x === b) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current"); });
      $$("[data-pvista]").forEach(v => { v.hidden = v.dataset.pvista !== b.dataset.ptab; });
      scrollTo({ top: 0 });
    }));
    $$("[data-filtro]").forEach(b => b.addEventListener("click", () => {
      filtro = b.dataset.filtro;
      $$("[data-filtro]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      pintarPedidos();
    }));
    $("[data-simular]").addEventListener("click", () => { desbloquear(); hacer({ accion: "simular" }); });
    $("[data-probar-celu]").addEventListener("click", abrirQR);
    $$("[data-cerrar-modal]").forEach(b => b.addEventListener("click", cerrarModal));
    $('[data-fondo="qr"]').addEventListener("click", e => { if (e.target === e.currentTarget) cerrarModal(); });   // tocar afuera cierra
    $("[data-sonido]").addEventListener("click", () => { sonido = !sonido; guardar("tito-panel-sonido", sonido); desbloquear(); pintarSonido(); if (sonido) timbre(); toast(sonido ? "Sonido activado." : "Sonido apagado."); });
    $("[data-empezar]").addEventListener("click", () => { desbloquear(); sonido = true; guardar("tito-panel-sonido", true); guardar("tito-panel-visto", true); pintarSonido(); timbre(); cerrarModal(); });
    // El navegador deja sonar recién después de que la persona toca algo
    ["pointerdown", "keydown"].forEach(ev => addEventListener(ev, desbloquear, { once: true, passive: true }));
    if (!leer("tito-panel-visto", false)) $('[data-fondo="bienvenida"]').hidden = false;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(); });
    setInterval(() => { if (est && !document.hidden) pintarPedidos(); }, 30000);   // los "hace X min" al día
  }

  function boot() {
    document.documentElement.classList.remove("no-js");
    safe(initTabs, "tabs");
    safe(initAcciones, "acciones");
    safe(initMenu, "menu");
    safe(initAjustes, "ajustes");
    safe(initChat, "chat");
    pintarSonido();
    cargar();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
