# Instalación en Shopify

En Shopify se instala **un solo píxel personalizado**, que registra la llegada desde Hot Sale y la compra. **No se pega nada en `theme.liquid`.**

Necesita el archivo `pixel2-shopify-customer-events.js` que le envió Hot Sale, ya con su `site_key`.

> **Estado de verificación:** `[PENDIENTE]` Falta la prueba con una compra real en una tienda de desarrollo de Shopify. La lógica está probada contra la API documentada de Shopify (ver [Notas técnicas](#notas-técnicas)). Mientras tanto, haga la [prueba](pruebas.md) en su tienda antes del evento.

## Antes de empezar: quite la versión de marzo de 2026

1. **Tienda online → Temas → ⋯ → Editar código → `theme.liquid`.** Borre el bloque que va de `<!-- Hotsale UTM Capture -->` a `<!-- End Hotsale UTM Capture -->` y guarde.
2. **Configuración → Eventos de clientes.** Si hay un píxel personalizado de Hot Sale anterior (el que contiene `GA4_ID`, `META_PIXEL_ID` y `APPS_SCRIPT_URL`), desconéctelo y elimínelo.

## Instalar

1. **Configuración → Eventos de clientes → Agregar píxel personalizado.**
2. Nombre: `Hot Sale`.
3. **Privacidad del cliente:**
   - *Permiso:* **Requerido**, con el propósito **Análisis** (Analytics). Es un píxel de medición.
   - *Venta de datos:* elija la opción que indica que los datos **no** califican como venta de datos. El píxel no envía datos a plataformas publicitarias. La decisión final es de su equipo legal.
4. Borre el código de ejemplo y pegue el contenido completo de `pixel2-shopify-customer-events.js`.
5. **Guardar → Conectar.**

## Verificar

Siga [docs/pruebas.md](pruebas.md). Si su tienda pide consentimiento de cookies, acepte las cookies de análisis durante la prueba. Sin ese permiso, Shopify no carga el píxel, y así debe ser.

## Qué hace, en Shopify

- En cada página que ve el visitante (evento `page_viewed`), el píxel lee la URL y el referrer reales. Si la visita es un toque de Hot Sale, lo guarda en el almacenamiento de su tienda y envía un `touch`.
- Cuando se completa una compra (evento `checkout_completed`), lee el toque y envía un `purchase` con:
  - el ID del pedido (el número largo de la URL del pedido en el administrador, no el nombre `#1001`),
  - `totalPrice.amount` (el total, que **incluye envío e impuestos**),
  - `totalPrice.currencyCode` (o `checkout.currencyCode` si falta).

  Del pedido no lee nada más.
- Usa solo la API de píxeles de Shopify: `analytics.subscribe`, `browser.localStorage`, `browser.sessionStorage` y `browser.sendBeacon` (con `fetch` como respaldo). No usa cookies.

## Límites conocidos

- **Mismo dominio.** El toque se guarda en el almacenamiento del dominio donde el visitante llega, y la compra se lee en el dominio del checkout. Shopify procesa el checkout en el dominio de la tienda. Si la tienda responde en `www.` y sin `www.`, o en varios dominios de mercado, configure la redirección al dominio principal para que todo ocurra en un solo dominio.
- **Shop Pay o la app Shop.** Si la compra termina dentro de la app Shop, es posible que no comparta el almacenamiento de su tienda. No está verificado.
- **Tiendas headless** (checkout en otro subdominio): use la [guía de GTM](instalacion-gtm.md) y avísenos.
- **Consentimiento.** En los mercados configurados para pedir consentimiento, el píxel solo corre si el visitante acepta la analítica. Si acepta después de cargar la página de llegada, Shopify no documenta si el píxel recibe el `page_viewed` de esa página; esa llegada podría perderse.

## Alternativa, solo si la verificación falla

Si en la prueba no aparece el envío `touch` al llegar con `?utm_source=hotsale&hs_test=1`, pegue además el contenido de `pixel1-todas-las-paginas.html` en `theme.liquid`, antes de `</body>`, y deje el píxel personalizado como está. El píxel personalizado lee el toque que guarda el Pixel 1 (usan la misma clave) y no reenvía un toque que ya está registrado en la sesión.

## Notas técnicas

Esta es la evaluación de si la captura puede vivir dentro del píxel personalizado en lugar de `theme.liquid`. La documentación de Shopify se consultó el 28 de septiembre de 2026.

| Necesidad | Qué ofrece Shopify | Fuente |
|---|---|---|
| URL y referrer reales de cada página | `page_viewed` se emite en la tienda online y en el checkout. `event.context.document` es una copia del documento de la página principal, con `location.search`, `location.hostname` y `referrer` | [page_viewed](https://shopify.dev/docs/api/web-pixels-api/standard-events/page_viewed) |
| Leer y escribir el almacenamiento de la tienda | `browser.localStorage` y `browser.sessionStorage`: `getItem`, `setItem` y `removeItem` asíncronos que "se ejecutan en la página principal" | [browser](https://shopify.dev/docs/api/web-pixels-api/standard-api/browser) |
| Datos del pedido | `checkout_completed`: `data.checkout.order.id`, `data.checkout.totalPrice.{amount, currencyCode}`. Se emite una vez por checkout, en la página de gracias o en la primera oferta *upsell* | [checkout_completed](https://shopify.dev/docs/api/web-pixels-api/standard-events/checkout_completed) |
| Enviar la petición | `browser.sendBeacon(url, body)` (marcado como obsoleto; Shopify recomienda `fetch` con `keepalive`) | [browser](https://shopify.dev/docs/api/web-pixels-api/standard-api/browser) |

Diferencia con la versión de marzo: los píxeles personalizados corren en un iframe aislado ([`sandbox="allow-scripts allow-forms"`](https://shopify.dev/docs/apps/build/marketing/pixels)). La versión de marzo leía `window.localStorage` dentro de ese iframe. Ahí, `window.localStorage` no es el almacenamiento de la tienda: Shopify lo reemplaza por una copia tomada al cargar el iframe. Ese reemplazo no está documentado, y Shopify recomienda usar los métodos asíncronos de `browser`. Por eso la lectura de marzo pudo funcionar en unas tiendas y no en otras. La versión 2 usa solo `browser.localStorage` y `browser.sessionStorage`.

Otros detalles:

- En algunas tiendas, `order.id` llega como `gid://shopify/OrderIdentity/5210499102` y en otras como `5210499102`. El píxel envía siempre el número. Es el ID interno del pedido; el evento no trae el nombre `#1001`.
- Si `browser.sendBeacon` deja de existir, el píxel usa `fetch`. Ese `fetch` sale del iframe aislado con `Origin: null` (ver [contrato del collector](contrato-collector.md#encabezado-origin)).
