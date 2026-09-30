# Cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen [SemVer](https://semver.org/lang/es/). Cualquier cambio en la lógica de atribución genera una versión nueva; una versión publicada no se modifica.

## [2.0.1] — 2026-09-30

**Reemplace el snippet** si ya instaló la 2.0.0: la corrección de la moneda afecta a las tiendas VTEX IO. El collector se actualiza aparte: pegue el código, despliéguelo como versión nueva del despliegue actual (la URL no cambia) y ejecute `migrar` y después `setup`.

### Píxel

- **VTEX IO envía la moneda.** Su evento `orderPlaced` trae el pedido en `ecommerce.purchase` sin `ecommerce.currencyCode`, y la moneda aparte, en `transactionCurrency`. La 2.0.0 leía el pedido de `ecommerce.purchase` y enviaba `currency` vacío. Ahora, si el formato elegido no trae la moneda, el píxel la toma de otro formato de la misma entrada, nunca de otra entrada.

### Collector

- **`eventos` ya no guarda `v` ni `pixel_version`.** Los dos se siguen validando.
- **`landed_at` y `sent_at` se guardan como fechas**, que la hoja muestra en hora de Colombia. Antes se guardaban como texto en UTC. Se rechaza un `sent_at` que no sea una fecha.
- **Los envíos del perfil de prueba (`2.0.0-prueba`) se guardan con `is_test = true`**, así que quedan fuera de los reportes de Hot Sale.
- **`rechazados` guarda un campo por columna** (`store_domain`, `event`, `pixel_version`, `order_id`, `order_value`, `landed_at` y tres UTM, máx. 100 caracteres cada uno), en lugar del cuerpo completo. Solo cuando el cuerpo no es JSON guarda sus primeros 200 caracteres, en `extracto`.
- Nueva función `migrar`: convierte al formato nuevo una hoja creada antes y reconstruye `toques` y `pedidos`.
- Nueva función `archivar`: antes del evento, mueve las filas a una hoja nueva y deja la principal vacía.
- **Más capacidad.** `setup` borra las columnas sin uso, que también cuentan para el límite de celdas de la hoja. `procesar` lee solo las columnas que necesita. La lista de aliados se lee como máximo una vez por minuto, en lugar de en cada envío.

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
- **Se envía la moneda del pedido.** La versión 1 la enviaba a GA4 y a Meta, pero no a la hoja de Google, que era la fuente de los reportes. Por eso los pedidos en USD se leían como COP. Si la moneda falta, el campo va vacío: el píxel ya no asume COP.
- **Los pedidos sin número o sin valor se marcan `incomplete`**, en lugar de enviarse como `order_id: 'unknown'` y `order_value: 0`.
- **Los toques caducan.** Cada toque guarda `landed_at`. El píxel no reporta compras con un toque de más de 30 días y borra esos toques. En la versión 1 los datos no caducaban: la siguiente compra en ese navegador se atribuía a Hot Sale aunque ocurriera meses después.
- **Un toque, un pedido.** Después de reportar un pedido con número, el toque se borra. El mismo enlace repetido antes de 30 minutos (recarga o dos pestañas) cuenta como una sola llegada.
- **Cada venta indica por qué se atribuyó.** Se mantienen las reglas de las ediciones anteriores: referrer de Hot Sale, `utm_source=hotsale` y las 26 palabras clave dentro de cualquier UTM. El campo `signal` indica cuál se cumplió. `keyword_only` marca las visitas que solo coincidieron por palabra clave, como las campañas del aliado para el evento, para mostrarlas aparte en el reporte.
- **Se toma el pedido más reciente del `dataLayer`**, no el primero. Además, se reconocen más formatos (GA4, gtag.js, Universal Analytics estándar y enhanced ecommerce, VTEX), y se puede usar `window.hotsaleOrder` si la plataforma no tiene `dataLayer`.
- Los valores como `"250.000"`, que pueden ser 250 o 250000, ya no se interpretan a ciegas. Se marcan `incomplete` y se envía el texto original para resolverlo en el reporte.
- Cada envío incluye `signal`, `pixel_version` e `is_test`. Las compras incluyen además `order_status` y `value_source`. `hs_test=1` permite probar la instalación sin afectar los reportes.

### Documentación

- El README se reescribió para que coincida con el código. Se eliminaron la lista de exclusión, la "ventana por sesión" y los porcentajes de confiabilidad y cobertura, que el código no implementaba ni medía.
- Hay guías de instalación por plataforma, una guía de pruebas y el contrato del collector.

### Seguridad

- **Nueva dirección del collector.** La de marzo aceptaba cualquier envío y quedó publicada; se desactiva.
- **El collector valida cada envío.** Solo acepta el formato de esta versión y dominios de aliados registrados, y limita los envíos por minuto por tienda. Los rechazos quedan registrados con el motivo.
- **Los datos no se pueden convertir en fórmulas.** Todo texto que llega, como los UTM, se guarda como texto literal en la hoja.
- **Los pedidos sospechosos se marcan** para revisión: sin llegada registrada, con una llegada ya usada por otro pedido o con un valor fuera de lo normal.
- **Es el mismo archivo para todos los aliados**, versionado y con SHA-256 (`dist/SHA256SUMS.txt`), así que cada aliado puede comprobar que el suyo no fue modificado.
- Se agregó [SECURITY.md](SECURITY.md).

### Para quien tenía la versión 1

- La clave de almacenamiento nueva es `hotsale_touch_v2`. La clave anterior, `hotsale_data`, se borra automáticamente y nunca se lee.

## [1.0.0-marzo2026] — 2026-03

Versión usada en Hot Sale marzo de 2026, disponible en la etiqueta `v1.0.0-marzo2026`. Enviaba cada compra a una hoja de Google (Apps Script), a GA4 y a Meta. Fue reemplazada por la 2.0.0. **No la instale.**
