# Cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen [SemVer](https://semver.org/lang/es/). Cualquier cambio en la lógica de atribución genera una versión nueva; una versión publicada no se modifica.

## [2.0.0] — 2026-09-28

Versión para Hot Sale octubre de 2026. **Requiere reinstalar:** elimine la versión de marzo e instale los archivos nuevos de `dist/` (ver las guías en `docs/`).

### Su sitio

- **Ya no se envía una compra duplicada a su píxel de Meta.** La versión 1 ejecutaba `fbq('init')` y `fbq('track', 'Purchase')`. Eso enviaba el evento Purchase a todos los píxeles de Meta de la página, incluido el suyo, sin `eventID`. Además, después de ese `init`, sus propios eventos de compra también llegaban al píxel de Hot Sale.
- **Ya no se modifica su configuración de Google Analytics.** La versión 1 ejecutaba `gtag('config')` con el GA4 de Hot Sale, que quedaba como destino por defecto de su `gtag`. Si `gtag` no existía, lo creaba empujando comandos a su `dataLayer`.
- **Ya no se cargan scripts de terceros** (`gtag.js`, `fbevents.js`) en su página de confirmación.
- El píxel hace una sola petición, a un solo dominio, y no toca cookies, el DOM, el `dataLayer` ni variables globales. La compilación y las pruebas lo verifican (ver README, §4).

### Números

- **Se cuentan las visitas que llegan desde hotsale.com.co sin UTM.** En la versión 1 la captura las registraba, pero la conversión las descartaba si no traían UTM.
- **Shopify lee el almacenamiento con la API documentada** (`browser.localStorage` y `browser.sessionStorage`). Además, un solo píxel personalizado hace la captura y la conversión, y ya no hace falta código en `theme.liquid`.
- **Se envía la moneda del pedido.** La versión 1 la calculaba pero no la enviaba, así que los pedidos en USD se leían como COP. Si la moneda falta, el campo va vacío: el píxel ya no asume COP.
- **Los pedidos sin número o sin valor se marcan `incomplete`**, en lugar de enviarse como `order_id: 'unknown'` y `order_value: 0`.
- **Los toques caducan.** Cada toque guarda `landed_at`. El píxel no reporta compras con un toque de más de 30 días y borra esos toques. En la versión 1, cualquier compra posterior se atribuía a Hot Sale sin límite de tiempo.
- **La regla de atribución es exacta:** el referrer es un dominio de Hot Sale o `utm_source` es exactamente `hotsale`. Se eliminó la búsqueda de 26 palabras clave dentro de cualquier UTM (`ccce`, `epsilon`, errores de escritura, etc.), que atribuía a Hot Sale los boletines y campañas propios del aliado.
- **Se toma el pedido más reciente del `dataLayer`**, no el primero. Además, se reconocen más formatos (GA4, gtag.js, Universal Analytics estándar y enhanced ecommerce, VTEX), y se puede usar `window.hotsaleOrder` si la plataforma no tiene `dataLayer`.
- Los valores como `"250.000"`, que pueden ser 250 o 250000, ya no se interpretan a ciegas. Se marcan `incomplete` y se envía el texto original para que lo resuelva el collector.
- Cada envío incluye `signal`, `value_source`, `pixel_version` e `is_test`. `hs_test=1` permite probar la instalación sin afectar los reportes.

### Documentación

- El README se reescribió para que coincida con el código. Se eliminaron la lista de exclusión, la "ventana por sesión" y los porcentajes de confiabilidad y cobertura, que el código no implementaba ni medía.
- Hay guías de instalación por plataforma, una guía de pruebas y el contrato del collector.

### Seguridad

- Los snippets ya no apuntan al endpoint de Google Apps Script, que aceptaba envíos sin autenticación para cualquier tienda. El collector nuevo valida un `site_key` por aliado contra el `Origin` y el dominio registrado.
- Los snippets están versionados y se publican con SHA-256 (`dist/SHA256SUMS.txt`).
- Se agregó [SECURITY.md](SECURITY.md).

### Para quien tenía la versión 1

- La clave de almacenamiento nueva es `hotsale_touch_v2`. La clave anterior, `hotsale_data`, se borra automáticamente y nunca se lee.

## [1.0.0-marzo2026] — 2026-03

Versión usada en Hot Sale marzo de 2026, disponible en la etiqueta `v1.0.0-marzo2026`. Enviaba cada compra a una hoja de Google (Apps Script), a GA4 y a Meta. Fue reemplazada por la 2.0.0. **No la instale.**
