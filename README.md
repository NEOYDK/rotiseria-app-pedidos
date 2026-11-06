# Rotisería: app de pedidos y panel de cocina

App con el nombre del local que el cliente instala desde el navegador: pide, paga y sigue su pedido en vivo. Al local le suena en el panel de la cocina. Sin comisiones de apps de delivery.

**Probala en vivo:** https://rotiseria-demo-ydk.pages.dev

## Qué tiene

- App instalable (PWA)
- Pedidos en vivo
- Mercado Pago
- Panel de cocina

## Tecnologías

- HTML, CSS y JavaScript propios, sin plantillas ni frameworks
- Cloudflare Pages (servida desde la red de Cloudflare, con HTTPS)
- Cloudflare Workers y base de datos D1 (SQLite) para la parte del servidor
- Pensada primero para el celular y probada con pruebas automáticas (Playwright)

## Qué hay en este repositorio

La parte que ve el cliente, en `public/`. La lógica del servidor queda en un repositorio privado.

---

Hecho por Julian, de **Yardak**: webs, tiendas, apps y sistemas para negocios de Paraná, Entre Ríos.
https://yardak.pages.dev
