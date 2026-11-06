// App de pedidos de Lo de Tito (se instala en el celular): menú, pedido, pago y seguimiento en vivo.
// El pedido le llega al panel del local (/panel/) al instante. Demo: cada visita tiene su propio "local de prueba"
// (un código guardado en el navegador), así lo que pide lo ve solo en su panel.
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
  const wa = (num, text) => "https://wa.me/" + num + "?text=" + encodeURIComponent(text);
  const hora = iso => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });
  const reducido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- El local de esta visita ----------
  const params = new URLSearchParams(location.search);
  let LOCAL = params.get("local");
  if (/^[a-z0-9]{6,16}$/.test(LOCAL || "")) guardar("tito-local", LOCAL);
  else {
    LOCAL = leer("tito-local", "");
    if (!/^[a-z0-9]{6,16}$/.test(LOCAL)) { LOCAL = [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join(""); guardar("tito-local", LOCAL); }
  }

  // ---------- Estado ----------
  let menu = leer("tito-menu", null);              // { categorias, productos, local }
  let carrito = leer("tito-carrito", []);          // [{ k, id, cant, opciones, nota }]
  const datos = leer("tito-datos", {});            // nombre, telefono, direccion, tipo, pago
  let misPedidos = leer("tito-pedidos", []);       // [{ id, c, numero, creado, total }]
  const productos = () => (menu ? menu.productos : []);
  const prod = id => productos().find(p => p.id === id);
  const local = () => (menu && menu.local) || { abierto: true, demora: 30, envio: 1500 };
  const tipo = () => (datos.tipo === "retiro" ? "retiro" : "delivery");
  const guardarCarrito = () => guardar("tito-carrito", carrito);

  async function api(ruta, opciones = {}) {
    try {
      const r = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, datos: d };
    } catch (_) {
      return { ok: false, status: 0, datos: { error: "Sin conexión. Revisá internet y probá de nuevo." } };
    }
  }

  let tToast = 0;
  function toast(t, ms = 2400) {
    const el = $("[data-toast]");
    el.textContent = t; el.hidden = false; el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
    clearTimeout(tToast); tToast = setTimeout(() => { el.classList.remove("on"); setTimeout(() => { el.hidden = true; }, 300); }, ms);
  }
  const vibrar = patron => { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(patron); };

  // Un "ding" corto (sin archivos de audio)
  let audio = null;
  function ding() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [880, 1320].forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.16;
        o.frequency.value = f; o.type = "sine"; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.start(t); o.stop(t + 0.32);
      });
    } catch (_) { /* sin sonido */ }
  }

  // ---------- Menú ----------
  async function cargarMenu() {
    const r = await api("/api/menu?local=" + LOCAL);
    if (r.ok && r.datos.productos) { menu = r.datos; guardar("tito-menu", menu); }
    pintarMenu();
  }

  function pintarEstadoLocal() {
    const l = local();
    $("[data-estado-local]").innerHTML = l.abierto ? `<i class="punto-ok"></i>Abierto · ${l.demora}-${l.demora + 10} min` : `<i class="punto-no"></i>Cerrado ahora`;
    $("[data-cerrado]").hidden = l.abierto;
    $("[data-modo-info=delivery]").textContent = plata(l.envio);
    $("[data-modo-info=retiro]").textContent = "sin cargo";
    $$("[data-tipo-info=delivery]").forEach(e => { e.textContent = `${plata(l.envio)} · ${l.demora}-${l.demora + 10} min`; });
    $$("[data-tipo-info=retiro]").forEach(e => { e.textContent = `Sin cargo · ${Math.max(15, l.demora - 10)} min`; });
    const env = $("[data-envio-local]"); if (env) env.textContent = Math.round(l.envio).toLocaleString("es-AR");
  }

  function fila(p) {
    return `<button type="button" class="plato${p.agotado ? " agotado" : ""}" data-plato="${p.id}" ${p.agotado ? 'aria-disabled="true"' : ""}>
      <span class="plato-txt"><span class="plato-nom">${esc(p.nombre)}</span><span class="plato-d">${esc(p.desc)}</span>
        <span class="plato-p">${p.agotado ? "Se terminó por hoy" : plata(p.precio)}</span></span>
      <span class="plato-img"><img src="${esc(p.foto)}" alt="" width="120" height="96" loading="lazy" decoding="async">${p.agotado ? "" : '<span class="mas" aria-hidden="true">+</span>'}<span class="en-pedido" data-en-pedido="${p.id}" hidden></span></span>
    </button>`;
  }

  function pintarMenu() {
    if (!menu) return;
    pintarEstadoLocal();
    $("[data-destacados]").innerHTML = productos().filter(p => p.estrella).map((p, i) => `
      <button type="button" class="dest${p.agotado ? " agotado" : ""}" data-plato="${p.id}">
        <img src="${esc(p.foto)}" alt="" width="260" height="170" ${i ? 'decoding="async"' : 'fetchpriority="high"'}>
        <span class="dest-nom">${esc(p.nombre)}</span><span class="dest-p">${p.agotado ? "Se terminó" : plata(p.precio)}</span>
      </button>`).join("");
    $("[data-cats]").innerHTML = menu.categorias.map((c, i) => `<a href="#cat-${c.id}" data-cat="${c.id}" ${i ? "" : 'aria-current="true"'}>${esc(c.nombre)}</a>`).join("");
    $("[data-menu]").innerHTML = menu.categorias.map(c => {
      const ps = productos().filter(p => p.cat === c.id);
      return ps.length ? `<section class="cat" id="cat-${c.id}" data-cat-sec="${c.id}"><h2 class="cat-tit">${esc(c.nombre)}</h2>${ps.map(fila).join("")}</section>` : "";
    }).join("");
    filtrar();
    pintarBarra();
    observarCats();
  }

  function filtrar() {
    const q = ($("[data-buscar]").value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    let visibles = 0;
    $$("[data-menu] .plato").forEach(b => {
      const p = prod(b.dataset.plato);
      const t = (p.nombre + " " + p.desc).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const ok = !q || q.split(/\s+/).every(w => t.includes(w));
      b.hidden = !ok; if (ok) visibles++;
    });
    $$("[data-cat-sec]").forEach(s => { s.hidden = !$$(".plato:not([hidden])", s).length; });
    $("[data-sin-resultados]").hidden = visibles > 0;
    $(".destacados-wrap").hidden = !!q;
  }

  // La categoría que se está viendo queda marcada arriba
  let obs = null;
  function observarCats() {
    if (!("IntersectionObserver" in window)) return;
    if (obs) obs.disconnect();
    obs = new IntersectionObserver(es => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        const id = e.target.dataset.catSec;
        $$("[data-cat]").forEach(a => a.setAttribute("aria-current", String(a.dataset.cat === id)));
        const a = $(`[data-cat="${id}"]`);
        if (a) a.parentElement.scrollTo({ left: a.offsetLeft - 16, behavior: reducido() ? "auto" : "smooth" });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    $$("[data-cat-sec]").forEach(s => obs.observe(s));
  }

  // ---------- Hojas (plato, carrito, iPhone) ----------
  let hojaAbierta = null, focoAntes = null;
  function abrirHoja(nombre) {
    cerrarHoja(true);
    const h = $(`[data-hoja="${nombre}"]`);
    focoAntes = document.activeElement;
    $("[data-velo]").hidden = false; h.hidden = false; hojaAbierta = h;
    document.documentElement.classList.add("con-hoja");
    requestAnimationFrame(() => { h.classList.add("on"); $("[data-velo]").classList.add("on"); });
    setTimeout(() => { const f = $(".hoja-cerrar, .hoja-cerrar-cab", h); if (f) f.focus({ preventScroll: true }); }, 60);
  }
  function cerrarHoja(rapido) {
    if (!hojaAbierta) return;
    const h = hojaAbierta; hojaAbierta = null;
    h.classList.remove("on"); $("[data-velo]").classList.remove("on");
    const fin = () => { h.hidden = true; if (!hojaAbierta) $("[data-velo]").hidden = true; };
    if (rapido === true || reducido()) fin(); else setTimeout(fin, 260);
    document.documentElement.classList.remove("con-hoja");
    if (focoAntes && document.contains(focoAntes) && rapido !== true) focoAntes.focus({ preventScroll: true });
  }

  // Plato: opciones, cantidad y nota
  let platoActual = null, platoCant = 1;
  function abrirPlato(id) {
    const p = prod(id);
    if (!p || p.agotado) { if (p) toast(p.nombre + " se terminó por hoy."); return; }
    platoActual = p; platoCant = 1;
    const h = $('[data-hoja="plato"]');
    $("[data-plato-foto]", h).src = p.foto; $("[data-plato-foto]", h).alt = p.nombre;
    $("[data-plato-tit]", h).textContent = p.nombre;
    $("[data-plato-desc]", h).textContent = p.desc;
    $("[data-plato-precio]", h).textContent = plata(p.precio);
    $("[data-plato-opciones]", h).innerHTML = p.opciones.map(o => `
      <fieldset class="bloque"><legend>${esc(o.nombre)}</legend><div class="chips-op">
        ${o.valores.map((v, i) => `<label><input type="radio" name="op-${o.id}" value="${esc(v)}" ${i ? "" : "checked"}><span>${esc(v)}</span></label>`).join("")}
      </div></fieldset>`).join("");
    $("#plato-nota").value = "";
    pintarPlato();
    abrirHoja("plato");
  }
  function pintarPlato() {
    $("[data-plato-cant]").textContent = platoCant;
    $("[data-plato-menos]").disabled = platoCant <= 1;
    $("[data-plato-agregar]").innerHTML = `Agregar ${platoCant} · <b>${plata(platoCant * platoActual.precio)}</b>`;
  }
  function agregarPlato() {
    const p = platoActual;
    const opciones = Object.fromEntries(p.opciones.map(o => [o.id, ($(`[name="op-${o.id}"]:checked`) || {}).value || o.valores[0]]));
    const nota = $("#plato-nota").value.trim().slice(0, 80);
    const k = p.id + "|" + JSON.stringify(opciones) + "|" + nota;
    const ya = carrito.find(c => c.k === k);
    if (ya) ya.cant = Math.min(20, ya.cant + platoCant); else carrito.push({ k, id: p.id, cant: platoCant, opciones, nota });
    guardarCarrito();
    cerrarHoja();
    pintarBarra(true);
    toast(`Agregaste ${platoCant} × ${p.nombre}`);
  }

  // ---------- Pedido (carrito) ----------
  const lineaDe = c => { const p = prod(c.id); return p ? { ...c, p, subtotal: p.precio * c.cant, detalle: p.opciones.map(o => c.opciones[o.id]).filter(Boolean).join(" · ") } : null; };
  const lineas = () => carrito.map(lineaDe).filter(Boolean);
  const subtotal = () => lineas().reduce((a, l) => a + (l.p.agotado ? 0 : l.subtotal), 0);
  const unidades = () => carrito.reduce((a, c) => a + c.cant, 0);

  function pintarBarra(saltar) {
    const n = unidades(), barra = $("[data-barra]");
    barra.hidden = n === 0;
    document.body.classList.toggle("con-barra", n > 0);
    $("[data-barra-cant]").textContent = n;
    $("[data-barra-total]").textContent = plata(subtotal());
    if (saltar && !reducido()) { barra.classList.remove("salta"); void barra.offsetWidth; barra.classList.add("salta"); }
    $$("[data-en-pedido]").forEach(e => {
      const q = carrito.filter(c => c.id === e.dataset.enPedido).reduce((a, c) => a + c.cant, 0);
      e.hidden = !q; e.textContent = q;
    });
  }

  function abrirCarrito() {
    if (!unidades()) return;
    const f = $("[data-form-pedido]");
    ["nombre", "telefono", "direccion"].forEach(k => { if (datos[k] && !f[k].value) f[k].value = datos[k]; });
    f.tipo.value = tipo();
    if (datos.pago) f.pago.value = datos.pago;
    $("[data-errores]").hidden = true;
    pintarCarrito();
    abrirHoja("carrito");
  }

  function pintarCarrito() {
    const f = $("[data-form-pedido]"), ls = lineas();
    $("[data-lineas]").innerHTML = ls.map((l, i) => `
      <li class="linea${l.p.agotado ? " agotado" : ""}">
        <div><b>${esc(l.p.nombre)}</b>${l.detalle ? `<small>${esc(l.detalle)}</small>` : ""}${l.nota ? `<small class="nota">"${esc(l.nota)}"</small>` : ""}${l.p.agotado ? "<small class=\"aviso\">Se terminó: sacalo para seguir</small>" : ""}</div>
        <div class="linea-der"><span>${plata(l.subtotal)}</span>
          <div class="paso paso-chico" role="group" aria-label="Cantidad de ${esc(l.p.nombre)}"><button type="button" data-linea-menos="${i}" aria-label="${l.cant === 1 ? "Sacar" : "Uno menos"}">${l.cant === 1 ? "×" : "−"}</button><output>${l.cant}</output><button type="button" data-linea-mas="${i}" aria-label="Uno más">+</button></div>
        </div>
      </li>`).join("");
    const t = f.tipo.value, envio = t === "delivery" ? local().envio : 0, total = subtotal() + envio;
    $("[data-campo-dir]").hidden = t !== "delivery";
    const efectivo = f.pago.value === "efectivo";
    $("[data-campo-vuelto]").hidden = !efectivo;
    if (efectivo) {
      const sel = $("[data-vuelto]"), antes = sel.value;
      const opciones = [...new Set([total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 10000) * 10000 + 10000, Math.ceil(total / 20000) * 20000 + 20000])].filter(n => n >= total);
      sel.innerHTML = opciones.map((n, i) => `<option value="${n}">${i ? plata(n) : "Justo, " + plata(n)}</option>`).join("");
      if (opciones.includes(+antes)) sel.value = antes;
    }
    $("[data-totales]").innerHTML = `<div><dt>Productos</dt><dd>${plata(subtotal())}</dd></div>
      <div><dt>Envío</dt><dd>${envio ? plata(envio) : "Sin cargo"}</dd></div>
      <div class="total"><dt>Total</dt><dd>${plata(total)}</dd></div>`;
    const btn = $("[data-confirmar]");
    btn.innerHTML = f.pago.value === "mercadopago" ? `Ir a pagar · <b>${plata(total)}</b>` : `Confirmar pedido · <b>${plata(total)}</b>`;
    btn.disabled = !ls.length || ls.some(l => l.p.agotado) || !local().abierto;
    if (!local().abierto) btn.textContent = "El local está cerrado ahora";
  }

  let enviando = false;
  async function confirmar(e) {
    e.preventDefault();
    if (enviando) return;
    const f = $("[data-form-pedido]"), errs = [];
    const t = f.tipo.value;
    const v = { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), direccion: f.direccion.value.trim(), notas: f.notas.value.trim(), pago: f.pago.value };
    if (v.nombre.length < 2) errs.push("Escribí tu nombre.");
    const dig = v.telefono.replace(/\D/g, "");
    if (dig.length < 8 || dig.length > 15) errs.push("Revisá el teléfono, con característica (ej.: 343 412 3456).");
    if (t === "delivery" && v.direccion.length < 5) errs.push("Escribí la dirección para el delivery.");
    const lista = $("[data-errores]");
    if (errs.length) {
      lista.innerHTML = errs.map(x => `<li>${esc(x)}</li>`).join(""); lista.hidden = false;
      lista.scrollIntoView({ block: "nearest", behavior: reducido() ? "auto" : "smooth" });
      return;
    }
    lista.hidden = true;
    Object.assign(datos, { nombre: v.nombre, telefono: v.telefono, direccion: v.direccion || datos.direccion || "", tipo: t, pago: v.pago });
    guardar("tito-datos", datos);
    enviando = true;
    const btn = $("[data-confirmar]"), antes = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Enviando…";
    const r = await api("/api/pedidos", { method: "POST", body: JSON.stringify({
      local: LOCAL, tipo: t, ...v, pagaCon: v.pago === "efectivo" ? +f.pagaCon.value : null,
      items: carrito.map(c => ({ id: c.id, cant: c.cant, opciones: c.opciones, nota: c.nota })),
    }) });
    enviando = false;
    if (!r.ok) {
      const lista2 = r.datos.errores || [r.datos.error || "No pudimos mandar el pedido. Probá de nuevo."];
      lista.innerHTML = lista2.map(x => `<li>${esc(x)}</li>`).join(""); lista.hidden = false;
      btn.disabled = false; btn.innerHTML = antes;
      if (r.status === 400) cargarMenu();   // quizás cambió el menú (algo se terminó)
      return;
    }
    const nuevo = { id: r.datos.id, c: r.datos.codigo, numero: r.datos.numero, creado: new Date().toISOString(), total: r.datos.total };
    misPedidos = [nuevo, ...misPedidos.filter(x => x.id !== nuevo.id)].slice(0, 20);
    guardar("tito-pedidos", misPedidos);
    carrito = []; guardarCarrito(); pintarBarra();
    btn.innerHTML = antes;
    cerrarHoja(true);
    if (v.pago === "mercadopago") { await irAMercadoPago(nuevo); return; }
    abrirSeguimiento(nuevo);
  }

  async function irAMercadoPago(p) {
    toast("Abriendo Mercado Pago…");
    const r = await api("/api/mp", { method: "POST", body: JSON.stringify({ id: p.id, c: p.c }) });
    if (r.ok && r.datos.url) { location.href = r.datos.url; return; }
    abrirSeguimiento(p);
    toast(r.datos.error || "No pudimos abrir Mercado Pago. Podés pagar de otra forma.");
  }

  // ---------- Seguimiento en vivo ----------
  let siguiendo = null, ultimo = null, tSeguir = 0;
  const ICONOS = {
    nuevo: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/></svg>',
    cocina: '<svg viewBox="0 0 24 24"><path d="M12 3c3 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.5 2 1.5 3 3 3-1-3 0-6 0-8.5z"/></svg>',
    listo: '<svg viewBox="0 0 24 24"><path d="M4 11h16a8 8 0 0 1-16 0zM2 11h20M9 7c0-1.5 1-2 1-3.5M13 7c0-1.5 1-2 1-3.5"/></svg>',
    camino: '<svg viewBox="0 0 24 24"><path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM7 17H3v-5l3-4h6l3 4h4l2 3v2h-2M12 8V5h4"/></svg>',
    entregado: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    cancelado: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  function abrirSeguimiento(p, conChat) {
    siguiendo = p; ultimo = null; msjs = []; chatAlCargar = !!conChat;
    $("[data-aviso-app]").hidden = true;
    const s = $("[data-seguir]");
    $("[data-s-numero]").textContent = "#" + p.numero;
    $("[data-s-estado]").className = "estado-grande";
    $("[data-s-tit]").textContent = "Buscando tu pedido…"; $("[data-s-txt]").textContent = "";
    s.hidden = false;
    document.documentElement.classList.add("con-hoja");
    $(".seguir-scroll", s).scrollTop = 0;
    $("[data-s-avisos]").hidden = !("Notification" in window) || Notification.permission !== "default";
    setTimeout(() => $("[data-cerrar-seguir]").focus({ preventScroll: true }), 50);
    consultar(true);
  }
  function cerrarSeguimiento() {
    if (charla) charla.cerrar();
    siguiendo = null; clearTimeout(tSeguir);
    $("[data-seguir]").hidden = true;
    document.documentElement.classList.remove("con-hoja");
    if (history.replaceState && /seguir=/.test(location.search)) history.replaceState(null, "", location.pathname);
    pintarMisPedidos();
  }

  async function consultar(primera, pagoId) {
    clearTimeout(tSeguir);
    if (!siguiendo) return;
    const p = siguiendo;
    const r = await api(`/api/pedidos?id=${p.id}&c=${p.c}${pagoId ? "&pago=" + encodeURIComponent(pagoId) : ""}`);
    if (siguiendo !== p) return;
    if (r.ok && r.datos.pedido) {
      const d = r.datos.pedido;
      if (ultimo && (ultimo.estado !== d.estado || ultimo.pagado !== d.pagado)) {
        ding(); vibrar([120, 60, 120]);
        avisar(d);
      }
      const primera = !ultimo;
      ultimo = d;
      pintarSeguimiento(d);
      revisarChat(p, r.datos.mensajes || [], primera);
      if (chatAlCargar) { chatAlCargar = false; abrirChat(); }
    } else if (r.status === 404) {
      $("[data-s-tit]").textContent = "No encontramos este pedido";
      $("[data-s-txt]").textContent = "Puede que se haya borrado (los pedidos de prueba duran 24 horas).";
      return;
    }
    const fin = ultimo && (ultimo.estado === "entregado" || ultimo.estado === "cancelado");
    if (!fin) tSeguir = setTimeout(() => consultar(false), document.hidden ? 15000 : 5000);
  }

  function textoEstado(d) {
    const delivery = d.tipo === "delivery";
    switch (d.estado) {
      case "nuevo": return ["Le llegó al local", "Lo están mirando para aceptarlo. Suele tardar menos de 2 minutos."];
      // Con demora avisada (+15 min desde el panel), la hora nueva
      case "cocina": return ["Lo están cocinando", d.listoPara ? `${d.retraso ? "Se demora un poco: " + (delivery ? "sale" : "va a estar listo") : delivery ? "Sale" : "Va a estar listo"} cerca de las ${hora(d.listoPara)}.` : "Ya está en la cocina."];
      case "listo": return delivery ? ["¡Ya está listo!", d.retraso && d.listoPara ? `Se demora un poco: sale cerca de las ${hora(d.listoPara)}.` : "Lo está por buscar el repartidor."] : ["¡Listo para retirar!", "Te esperamos en Calle de ejemplo 123. Decí tu nombre en el mostrador."];
      case "camino": return [`En camino${d.repartidor && d.repartidor !== "Retira un cadete" ? " con " + d.repartidor : ""}`, d.retraso && d.listoPara ? `Se demora un poco: llega cerca de las ${hora(d.listoPara)}.` : d.salio ? `Salió a las ${hora(d.salio)}. Llega en unos minutos.` : "Llega en unos minutos."];
      case "entregado": return ["¡Entregado! Que lo disfrutes", d.entregado ? `A las ${hora(d.entregado)}. ¡Gracias por pedir!` : "¡Gracias por pedir!"];
      case "cancelado": return ["El local canceló el pedido", (d.motivo ? d.motivo + ". " : "") + (d.pagado ? "Te devolvemos la plata." : "No se cobró nada.")];
      default: return [d.estadoNombre || d.estado, ""];
    }
  }

  function pintarSeguimiento(d) {
    const [tit, txt] = textoEstado(d);
    $("[data-s-estado]").className = "estado-grande e-" + d.estado;
    $("[data-s-ico]").innerHTML = ICONOS[d.estado] || "";
    $("[data-s-tit]").textContent = tit; $("[data-s-txt]").textContent = txt;
    const delivery = d.tipo === "delivery";
    const pasos = [["nuevo", "Recibido", d.creado], ["cocina", "En la cocina", d.aceptado], delivery ? ["camino", "En camino", d.salio] : ["listo", "Listo para retirar", d.listo], ["entregado", "Entregado", d.entregado]];
    const orden = ["nuevo", "cocina", "listo", "camino", "entregado"];
    const actual = orden.indexOf(d.estado);
    $("[data-s-pasos]").innerHTML = d.estado === "cancelado" ? "" : pasos.map(([e, n, cuando]) => {
      const i = orden.indexOf(e), hecho = actual >= i, ahora = d.estado === e;
      return `<li class="${hecho ? "hecho" : ""}${ahora ? " ahora" : ""}"><span class="paso-punto"></span><span>${n}</span><small>${cuando && hecho ? hora(cuando) : ""}</small></li>`;
    }).join("");
    // Pago
    const caja = $("[data-s-pago]");
    if (d.estado === "cancelado") caja.innerHTML = "";
    else if (d.pago === "efectivo") caja.innerHTML = `<p class="caja-tit">Pagás en efectivo</p><p>${plata(d.total)} ${delivery ? "al recibir" : "al retirar"}${d.pagaCon && d.pagaCon > d.total ? `. Pagás con ${plata(d.pagaCon)}: te llevamos ${plata(d.pagaCon - d.total)} de vuelto.` : "."}</p>`;
    else if (d.pago === "transferencia") caja.innerHTML = d.pagado
      ? `<p class="caja-tit ok">Transferencia recibida ✓</p><p>El local ya confirmó tu pago de ${plata(d.total)}.</p>`
      : `<p class="caja-tit">Transferí ${plata(d.total)}</p><p>Al alias <b class="alias">${esc(data.alias || "yardakdev")}</b> y mandá el comprobante. <span class="demo-txt">Demo: no hagas transferencias reales.</span></p>
         <div class="fila-botones"><button class="btn btn-borde" type="button" data-copiar-alias>Copiar alias</button><a class="btn btn-wa" target="_blank" rel="noopener" href="${wa(data.whatsapp, `¡Hola! Te transferí ${plata(d.total)} por mi pedido #${d.numero}. Te mando el comprobante.`)}">Mandar comprobante</a></div>
         <button class="link" type="button" data-pagar-mp>Prefiero pagar con Mercado Pago</button>`;
    else caja.innerHTML = d.pagado
      ? `<p class="caja-tit ok">Pagado con Mercado Pago ✓</p><p>${plata(d.total)}. No tenés que pagar nada al recibir.</p>`
      : `<p class="caja-tit">Falta pagar ${plata(d.total)}</p><p>Con tarjeta, débito o dinero en cuenta de Mercado Pago.</p><button class="btn btn-ambar btn-ancho" type="button" data-pagar-mp>Pagar con Mercado Pago</button>`;
    $("[data-s-items]").innerHTML = d.items.map(i => `<li class="linea"><div><b>${i.cant} × ${esc(i.nombre)}</b>${i.detalle ? `<small>${esc(i.detalle)}</small>` : ""}${i.nota ? `<small class="nota">"${esc(i.nota)}"</small>` : ""}</div><span>${plata(i.subtotal)}</span></li>`).join("");
    $("[data-s-totales]").innerHTML = `<div><dt>Productos</dt><dd>${plata(d.subtotal)}</dd></div><div><dt>Envío</dt><dd>${d.envio ? plata(d.envio) : "Sin cargo"}</dd></div><div class="total"><dt>Total</dt><dd>${plata(d.total)}</dd></div>`;
    $("[data-s-entrega]").textContent = delivery ? `Delivery a ${d.direccion}` : "Retirás en el local: Calle de ejemplo 123";
    $("[data-s-wa]").href = wa(data.whatsapp, `¡Hola! Te escribo por mi pedido #${d.numero} a nombre de ${d.nombre}.`);
    $("[data-s-wa]").target = "_blank"; $("[data-s-wa]").rel = "noopener";
    $("[data-s-repetir]").hidden = d.estado !== "entregado" && d.estado !== "cancelado";
    // Lo guardado en "Mis pedidos" queda al día (y si vino de otro celular, por ejemplo al volver de Mercado Pago, se suma)
    $("[data-s-numero]").textContent = "#" + d.numero;
    let m = misPedidos.find(x => x.id === d.id);
    if (!m && siguiendo && siguiendo.id === d.id) {
      m = { id: d.id, c: siguiendo.c, numero: d.numero, creado: d.creado, total: d.total, estado: d.estado };
      misPedidos = [m, ...misPedidos].slice(0, 20);
      guardar("tito-pedidos", misPedidos);
    } else if (m && (m.estado !== d.estado || !m.numero)) { m.estado = d.estado; m.numero = d.numero; m.total = d.total; guardar("tito-pedidos", misPedidos); }
    pintarPunto();
  }

  function avisar(d) {
    const [tit, txt] = textoEstado(d);
    if (!notificar("Lo de Tito · " + tit, txt, "pedido-" + d.id)) toast(tit);
  }
  // Con la app en segundo plano y permiso, aviso del sistema; si no, devuelve false y se avisa adentro
  function notificar(tit, txt, tag) {
    if (!(document.hidden && "Notification" in window && Notification.permission === "granted" && navigator.serviceWorker)) return false;
    navigator.serviceWorker.ready.then(r => r.showNotification(tit, { body: txt, icon: "/assets/icons/tito-192.png", tag })).catch(() => {});
    return true;
  }

  // ---------- Chat con el local (se abre solo desde su botón, en el seguimiento del pedido) ----------
  let charla = null, msjs = [], chatAlCargar = false;
  const vistos = leer("tito-charla-vista", {});     // { idPedido: hora del último mensaje del local que se leyó }
  const delLocal = lista => lista.filter(m => m.de === "local");
  const sinLeer = (id, lista) => delLocal(lista).filter(m => m.creado > (vistos[id] || "")).length;
  function marcarVisto(id, lista) {
    const u = delLocal(lista).pop();
    if (u && u.creado > (vistos[id] || "")) { vistos[id] = u.creado; guardar("tito-charla-vista", vistos); }
  }
  function pintarBotonChat() {
    const n = siguiendo ? sinLeer(siguiendo.id, msjs) : 0, b = $("[data-s-charla-n]");
    b.textContent = n; b.hidden = !n;
    $("[data-s-charla]").setAttribute("aria-label", n ? `Chat con el local, ${n} mensaje${n === 1 ? "" : "s"} sin leer` : "Chat con el local");
  }
  function recordarUltimo(id, lista) {
    const m = misPedidos.find(x => x.id === id), u = delLocal(lista).pop();
    if (m && m.ultLocal !== (u ? u.creado : "")) { m.ultLocal = u ? u.creado : ""; guardar("tito-pedidos", misPedidos); }
  }
  function revisarChat(p, lista, primera) {
    const antes = new Set(msjs.map(m => m.id));
    msjs = lista;
    const nuevos = primera ? [] : delLocal(lista).filter(m => !antes.has(m.id));
    if (charla && charla.abierta()) { charla.pintar(lista); marcarVisto(p.id, lista); }
    if (nuevos.length) {
      const u = nuevos[nuevos.length - 1];
      ding(); vibrar([80, 50, 80]);
      const corto = u.texto.length > 70 ? u.texto.slice(0, 68).trim() + "…" : u.texto;
      if (!notificar("Lo de Tito te escribió", u.texto, "chat-" + p.id) && !(charla && charla.abierta())) toast("Lo de Tito: " + corto, 5000);
    }
    recordarUltimo(p.id, lista);
    pintarBotonChat();
  }
  function abrirChat() {
    if (!siguiendo || !charla) return;
    $("[data-toast]").hidden = true;    // el aviso ya no hace falta: está el chat abierto
    charla.abrir("Chat con Lo de Tito", `Pedido #${siguiendo.numero || ""}`, msjs);
    marcarVisto(siguiendo.id, msjs);
    pintarBotonChat();
  }
  function initChat() {
    if (!window.Charla) { $("[data-s-charla]").hidden = true; return; }
    charla = window.Charla({
      yo: "cliente",
      rapidas: ["¿Cuánto falta?", "¡Gracias!"],
      vacio: "¿Querés avisar o preguntar algo de tu pedido? Escribile al local por acá.",
      enviar: async texto => {
        const p = siguiendo;
        if (!p) return { error: "Abrí tu pedido para escribirle al local." };
        const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ id: p.id, c: p.c, texto }) });
        if (!r.ok) return { error: r.datos.error };
        if (siguiendo === p) { msjs = r.datos.mensajes; marcarVisto(p.id, msjs); pintarBotonChat(); }
        return r.datos.mensajes;
      },
      alCambiar: e => { if (e.error) toast(e.error); },
    });
    $("[data-s-charla]").addEventListener("click", abrirChat);
  }

  // Con la app abierta en otra pantalla (el menú, por ejemplo), el pedido en curso se sigue mirando:
  // si el local escribe o el pedido cambia, avisa arriba y con un toque se abre.
  let tVigia = 0, vigiaPedido = null;
  async function vigilar() {
    clearTimeout(tVigia);
    const m = !siguiendo && misPedidos.find(x => x.c && !["entregado", "cancelado"].includes(x.estado));
    if (m) {
      const r = await api(`/api/pedidos?id=${m.id}&c=${m.c}`);
      if (r.ok && !siguiendo) {
        const d = r.datos.pedido, lista = r.datos.mensajes || [], u = delLocal(lista).pop();
        const escribio = u && m.ultLocal !== undefined && u.creado > (m.ultLocal || "");
        const cambio = m.estado && m.estado !== d.estado;
        if (escribio || cambio) {
          ding(); vibrar([120, 60, 120]);
          const tit = escribio ? "Lo de Tito te escribió" : "Pedido #" + d.numero + ": " + textoEstado(d)[0];
          const txt = escribio ? u.texto : textoEstado(d)[1];
          if (!notificar(tit, txt, "pedido-" + d.id)) {
            const av = $("[data-aviso-app]");
            $("[data-aviso-tit]").textContent = tit; $("[data-aviso-txt]").textContent = txt;
            av.hidden = false; av.classList.remove("on"); void av.offsetWidth; av.classList.add("on");
            vigiaPedido = { m, chat: escribio };
          }
        }
        m.estado = d.estado; m.numero = d.numero;
        recordarUltimo(m.id, lista);
        guardar("tito-pedidos", misPedidos);
        pintarPunto();
      } else if (r.status === 404) { misPedidos = misPedidos.filter(x => x !== m); guardar("tito-pedidos", misPedidos); }
    }
    tVigia = setTimeout(vigilar, document.hidden ? 30000 : 10000);
  }

  function repetir() {
    if (!ultimo) return;
    let sumados = 0;
    ultimo.items.forEach(i => {
      const p = prod(i.id);
      if (!p || p.agotado) return;
      const k = i.id + "|" + JSON.stringify(i.opciones || {}) + "|" + (i.nota || "");
      const ya = carrito.find(c => c.k === k);
      if (ya) ya.cant = Math.min(20, ya.cant + i.cant); else carrito.push({ k, id: i.id, cant: i.cant, opciones: i.opciones || {}, nota: i.nota || "" });
      sumados++;
    });
    guardarCarrito();
    cerrarSeguimiento(); irA("menu"); pintarBarra(true);
    if (sumados) abrirCarrito(); else toast("Esos platos se terminaron por hoy.");
  }

  // ---------- Mis pedidos ----------
  const ESTADOS = { nuevo: "Recibido", cocina: "En la cocina", listo: "Listo", camino: "En camino", entregado: "Entregado", cancelado: "Cancelado" };
  function pintarPunto() { $("[data-tab-punto]").hidden = !misPedidos.some(p => p.estado && !["entregado", "cancelado"].includes(p.estado)) && !misPedidos.some(p => !p.estado); }
  async function pintarMisPedidos(actualizar) {
    const cont = $("[data-mis-pedidos]");
    if (!misPedidos.length) {
      cont.innerHTML = `<div class="vacio"><p>Todavía no pediste nada desde esta app.</p><button class="btn btn-ambar" type="button" data-tab-ir="menu">Ver el menú</button></div>`;
      return;
    }
    cont.innerHTML = misPedidos.map(p => `<button type="button" class="mi-pedido" data-ver-pedido="${p.id}">
      <span><b>Pedido #${p.numero}</b><small>${new Date(p.creado).toLocaleDateString("es-AR", { day: "numeric", month: "short" })} · ${hora(p.creado)} · ${plata(p.total)}</small></span>
      <span class="chip-estado e-${p.estado || "nuevo"}">${ESTADOS[p.estado] || "Ver"}</span></button>`).join("");
    if (!actualizar) return;
    // Estados al día (los 5 más nuevos)
    for (const p of misPedidos.slice(0, 5)) {
      const r = await api(`/api/pedidos?id=${p.id}&c=${p.c}`);
      if (r.ok) p.estado = r.datos.pedido.estado;
      else if (r.status === 404) p.borrado = true;
    }
    misPedidos = misPedidos.filter(p => !p.borrado);
    guardar("tito-pedidos", misPedidos);
    pintarPunto();
    pintarMisPedidos(false);
  }

  // ---------- Pestañas ----------
  function irA(tab) {
    $$("[data-pantalla]").forEach(s => { s.hidden = s.dataset.pantalla !== tab; });
    $$("[data-tab]").forEach(b => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    document.body.dataset.tab = tab;
    scrollTo({ top: 0, behavior: "auto" });
    if (tab === "pedidos") pintarMisPedidos(true);
  }

  // ---------- Instalar la app ----------
  let promptInstalar = null;
  const instalada = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  function initInstalar() {
    const botones = $$("[data-instalar], [data-instalar-2]");
    const mostrar = on => { $("[data-instalar]").hidden = !on; $("[data-tarjeta-instalar]").hidden = !on; };
    mostrar(!instalada() && esIOS());
    addEventListener("beforeinstallprompt", e => { e.preventDefault(); promptInstalar = e; mostrar(!instalada()); });
    addEventListener("appinstalled", () => { mostrar(false); toast("¡Listo! Ya tenés Lo de Tito en tu celular."); });
    botones.forEach(b => b.addEventListener("click", async () => {
      if (promptInstalar) { promptInstalar.prompt(); try { await promptInstalar.userChoice; } catch (_) { /* nada */ } promptInstalar = null; mostrar(false); }
      else if (esIOS()) abrirHoja("ios");
    }));
    if (instalada()) $("[data-cinta]").classList.add("en-app");
  }

  // ---------- Arranque ----------
  function initEventos() {
    document.addEventListener("click", e => {
      const p = e.target.closest("[data-plato]"); if (p) { abrirPlato(p.dataset.plato); return; }
      const t = e.target.closest("[data-tab]"); if (t) { irA(t.dataset.tab); return; }
      const ti = e.target.closest("[data-tab-ir]"); if (ti) { e.preventDefault(); irA(ti.dataset.tabIr); return; }
      const vp = e.target.closest("[data-ver-pedido]"); if (vp) { const m = misPedidos.find(x => x.id === +vp.dataset.verPedido); if (m) abrirSeguimiento(m); return; }
      const lm = e.target.closest("[data-linea-menos]"), lM = e.target.closest("[data-linea-mas]");
      if (lm || lM) {
        const ls = lineas(), l = ls[+(lm || lM).dataset[lm ? "lineaMenos" : "lineaMas"]];
        const c = l && carrito.find(x => x.k === l.k);
        if (c) { c.cant += lm ? -1 : 1; c.cant = Math.min(20, c.cant); if (c.cant <= 0) carrito = carrito.filter(x => x !== c); }
        guardarCarrito(); pintarBarra();
        if (!unidades()) { cerrarHoja(); return; }
        pintarCarrito(); return;
      }
      if (e.target.closest("[data-copiar-alias]")) {
        const alias = data.alias || "yardakdev";
        (navigator.clipboard ? navigator.clipboard.writeText(alias) : Promise.reject()).then(() => toast("Alias copiado: " + alias), () => toast("El alias es " + alias));
        return;
      }
      if (e.target.closest("[data-pagar-mp]") && siguiendo) { irAMercadoPago(siguiendo); return; }
    });
    $("[data-velo]").addEventListener("click", () => cerrarHoja());
    $$("[data-cerrar-hoja]").forEach(b => b.addEventListener("click", () => cerrarHoja()));
    addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (charla && charla.abierta()) charla.cerrar(); else if (hojaAbierta) cerrarHoja(); else if (!$("[data-seguir]").hidden) cerrarSeguimiento();
    });
    $("[data-plato-menos]").addEventListener("click", () => { platoCant = Math.max(1, platoCant - 1); pintarPlato(); });
    $("[data-plato-mas]").addEventListener("click", () => { platoCant = Math.min(20, platoCant + 1); pintarPlato(); });
    $("[data-plato-agregar]").addEventListener("click", agregarPlato);
    $("[data-abrir-carrito]").addEventListener("click", abrirCarrito);
    $("[data-seguir-pidiendo]").addEventListener("click", () => cerrarHoja());
    const f = $("[data-form-pedido]");
    f.addEventListener("change", e => { if (e.target.name === "tipo") { datos.tipo = f.tipo.value; guardar("tito-datos", datos); sincronizarModo(); } pintarCarrito(); });
    f.addEventListener("submit", confirmar);
    $$("[name=modo]").forEach(r => r.addEventListener("change", () => { datos.tipo = r.value; guardar("tito-datos", datos); }));
    $("[data-buscar]").addEventListener("input", filtrar);
    $("[data-cerrar-seguir]").addEventListener("click", cerrarSeguimiento);
    $("[data-aviso-app]").addEventListener("click", () => {
      $("[data-aviso-app]").hidden = true;
      if (vigiaPedido) { hojaAbierta && cerrarHoja(true); abrirSeguimiento(vigiaPedido.m, vigiaPedido.chat); vigiaPedido = null; }
    });
    $("[data-s-repetir]").addEventListener("click", repetir);
    $("[data-s-avisos]").addEventListener("click", async () => {
      try { const r = await Notification.requestPermission(); toast(r === "granted" ? "Listo: te avisamos cuando cambie." : "Sin permiso: te avisamos acá adentro."); } catch (_) { /* nada */ }
      $("[data-s-avisos]").hidden = true;
    });
    $$("[data-maker]").forEach(a => { a.href = wa(data.makerWhatsapp, "¡Hola Julian! Vi la app de pedidos de la rotisería y quiero una para mi local."); a.target = "_blank"; a.rel = "noopener"; });
    $$("[data-wa-local]").forEach(a => { a.href = wa(data.whatsapp, "¡Hola! Quiero hacer una consulta."); a.target = "_blank"; a.rel = "noopener"; });
    $$("[data-ir-panel]").forEach(a => { a.href = "/panel/?local=" + LOCAL; });
    // Al volver a la app, el menú se actualiza (por si el local cambió precios o algo se terminó)
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { cargarMenu(); if (siguiendo) consultar(false); else vigilar(); } });
  }
  function sincronizarModo() { $$("[name=modo]").forEach(r => { r.checked = r.value === tipo(); }); }

  // Compatibilidad: "Cambiar pedido" desde /pagar (?pedido=2mila.1gaseosa) arma el carrito
  function desdeLink() {
    const cod = params.get("pedido");
    if (cod && menu) {
      cod.toLowerCase().split(".").slice(0, 20).forEach(parte => {
        const m = parte.match(/^(\d{0,2})([a-z0-9]+)$/);   // sin número cuenta 1 ("papas" = "1papas")
        const p = m && prod(m[2]);
        const cant = m ? Math.min(20, m[1] === "" ? 1 : +m[1]) : 0;
        if (!p || !cant) return;
        const opciones = Object.fromEntries(p.opciones.map(o => [o.id, o.valores[0]]));
        const k = p.id + "|" + JSON.stringify(opciones) + "|";
        const ya = carrito.find(c => c.k === k);
        if (ya) ya.cant = Math.min(20, ya.cant + cant); else carrito.push({ k, id: p.id, cant, opciones, nota: "" });
      });
      guardarCarrito();
    }
    if (["pedidos", "local"].includes(params.get("tab"))) irA(params.get("tab"));   // atajo del ícono instalado
    const seguir = params.get("seguir");
    if (seguir) {
      const [id, c] = seguir.split(".");
      if (+id && /^[0-9a-f]{12,16}$/.test(c || "")) {
        let p = misPedidos.find(x => x.id === +id);
        if (!p) { p = { id: +id, c, numero: "", creado: new Date().toISOString(), total: 0 }; }
        const pagoId = params.get("payment_id") || params.get("collection_id");
        abrirSeguimiento(p);
        if (pagoId && pagoId !== "null") consultar(false, pagoId);
        if (params.get("status") === "rejected" || params.get("collection_status") === "rejected") toast("Mercado Pago rechazó el pago. Probá con otra tarjeta o pagá de otra forma.");
      }
    }
    if ((cod || params.get("local") || params.get("tab")) && history.replaceState && !seguir) history.replaceState(null, "", location.pathname);
  }

  // Las categorías quedan pegadas justo debajo de la barra de arriba (mida lo que mida)
  function medirArriba() {
    const top = $("[data-top]");
    const poner = () => document.documentElement.style.setProperty("--top-h", top.offsetHeight + "px");
    poner();
    if ("ResizeObserver" in window) new ResizeObserver(poner).observe(top);
  }

  async function boot() {
    document.documentElement.classList.remove("no-js");
    safe(medirArriba, "arriba");
    safe(initEventos, "eventos");
    safe(initInstalar, "instalar");
    safe(initChat, "chat");
    sincronizarModo();
    if (menu) safe(pintarMenu, "menu-guardado");     // al instante, con lo último que se vio
    await cargarMenu();
    safe(desdeLink, "link");
    pintarBarra();
    pintarPunto();
    tVigia = setTimeout(vigilar, 4000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
