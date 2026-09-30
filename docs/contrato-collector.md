# Collector (Google Apps Script)

El píxel envía cada evento a una aplicación web de Google Apps Script. El script valida el envío y lo guarda en una hoja de cálculo privada de Google, que es la fuente de los reportes en Looker Studio. El código está en [`collector/apps-script.gs`](../collector/apps-script.gs) y se prueba en [`test/apps-script.test.js`](../test/apps-script.test.js).

Principio: **el píxel reporta lo que vio y el collector decide.** El píxel envía también los pedidos incompletos y la señal de detección. La deduplicación, las alertas y el filtro de pruebas se aplican en el collector y en el reporte.

## Petición

| | |
|---|---|
| URL | La del despliegue actual, `https://script.google.com/macros/s/…/exec`. Es la misma en todos los snippets y se configura en `COLLECTOR_URL` de [`scripts/build.js`](../scripts/build.js) |
| Método | `POST` |
| `Content-Type` | `text/plain;charset=UTF-8`. Es una petición CORS "simple": **no hay preflight** |
| Cuerpo | Un objeto JSON (ver campos). Suele pesar menos de 1 KB |
| Transporte GTM/HTML | `navigator.sendBeacon(url, cuerpo)`. Si no existe o devuelve `false`, `fetch(url, {method:'POST', body, keepalive:true, credentials:'omit'})` |
| Transporte Shopify | `browser.sendBeacon(url, cuerpo)`, que Shopify ejecuta en la página de la tienda. Si falla, `fetch` desde el sandbox del píxel |
| Respuesta | Siempre `ok`, también cuando rechaza un envío. El motivo del rechazo queda en la hoja, nunca en la respuesta |

Detalles de Google Apps Script:

- La respuesta llega como una redirección a `script.googleusercontent.com`. Una Content-Security-Policy debe permitir en `connect-src` tanto `https://script.google.com` como `https://script.googleusercontent.com`.
- El script no tiene acceso a los encabezados de la petición (`Origin`, cookies) ni a la IP del visitante. Solo recibe el cuerpo.
- Como con cualquier servicio de Google, el navegador puede adjuntar las cookies de Google del visitante a la petición. Las recibe Google; el script no puede leerlas.

## Campos

Los campos llegan siempre, en este orden. Ningún campo lleva datos personales, ni tampoco un identificador por tienda: el collector reconoce la tienda por `store_domain`.

| Campo | Tipo | `touch` | `purchase` | Reglas |
|---|---|:-:|:-:|---|
| `v` | número | ✓ | ✓ | Siempre `2` |
| `pixel_version` | texto | ✓ | ✓ | Semver del snippet, p. ej. `2.0.1` |
| `event` | texto | ✓ | ✓ | `touch` o `purchase` |
| `store_domain` | texto | ✓ | ✓ | `location.hostname` de la página que envía |
| `order_id` | texto | | ✓ | Máx. 100 caracteres. `""` si no hay. Nunca `unknown`. Shopify: el ID interno del pedido, el que aparece en la URL del pedido en el administrador, no el nombre `#1001`. Se quita el prefijo `gid://shopify/OrderIdentity/` |
| `order_value` | número | | ✓ | `0` si falta, no es numérico o es ambiguo (ver [Valor del pedido](#valor-del-pedido)) |
| `order_value_raw` | texto | | ✓ | El valor tal como lo expone la página (máx. 50 caracteres). `""` si no hay |
| `currency` | texto | | ✓ | Tres letras en mayúsculas o `""`. Se espera ISO 4217, pero el píxel no la valida contra la lista. **El píxel nunca asume COP** |
| `order_status` | texto | | ✓ | `complete` si `order_id` no es vacío **y** `order_value > 0`; si no, `incomplete` |
| `value_source` | texto | | ✓ | Ver tabla de fuentes |
| `signal` | texto | ✓ | ✓ | `referrer+utm`, `referrer_only`, `utm_only` o `keyword_only` (solo coincidió una palabra clave dentro de los UTM; ver README §3) |
| `landed_at` | texto ISO 8601 | ✓ | ✓ | Llegada desde Hot Sale, según el **reloj del navegador** |
| `sent_at` | texto ISO 8601 | ✓ | ✓ | Momento del envío, según el reloj del navegador |
| `is_test` | booleano | ✓ | ✓ | `true` si `hs_test=1` estaba en la URL de llegada o en la de confirmación |
| `utm_source` … `utm_id` | texto | ✓ | ✓ | Seis campos, máx. 200 caracteres cada uno, sin espacios al inicio o al final. `""` si no hay |

### Fuentes del valor (`value_source`)

| Valor | De dónde sale |
|---|---|
| `hotsaleOrder.value` | `window.hotsaleOrder = {id, value, currency}`, definido por el aliado. Tiene prioridad sobre el `dataLayer` |
| `ecommerce.value` | GA4: entradas con `ecommerce.transaction_id` o con `event:'purchase'` y un objeto `ecommerce` |
| `gtag.value` | Llamada de gtag.js `('event', 'purchase', {transaction_id, value, currency})` que queda en el `dataLayer` |
| `ecommerce.purchase.revenue` | Universal Analytics enhanced ecommerce: `ecommerce.purchase.actionField.{id, revenue}` y `ecommerce.currencyCode`. También VTEX IO, que no envía `currencyCode`: la moneda sale de `transactionCurrency`, en la misma entrada |
| `transactionTotal` | Universal Analytics estándar y VTEX `orderPlaced`: `transactionId`, `transactionTotal`, `transactionCurrency` |
| `purchase.value` | `{event:'purchase', transaction_id, value, currency}` en el nivel superior |
| `shopify.totalPrice` | Shopify `checkout.totalPrice`. **Incluye envío e impuestos** |
| `none` | No se encontró valor |

Así se elige el pedido en el `dataLayer`:

- Se ignoran las entradas `event: 'refund'` y las que no tienen ni número de pedido ni valor. Dentro de una entrada se prueban los formatos en el orden de la tabla.
- El pedido es el que nombra **la entrada más reciente que tiene número**.
- Si el formato elegido no trae la moneda, se toma de otro formato de la misma entrada, nunca de otra entrada.
- El valor sale de la entrada más reciente de ese mismo pedido que tenga un valor utilizable. Así, una etiqueta posterior que repite el número sin el valor (por ejemplo, de afiliados) no borra el valor, y una compra anterior nunca reemplaza al pedido más reciente.

Lo que cada aliado pone en `value` (con o sin envío o impuestos) depende de su implementación.

### Valor del pedido

Los números mayores que 0 se usan tal cual; 0, negativos, `NaN` o infinitos dan 0. Los textos siguen esta regla estricta, sin adivinar separadores de miles:

| Texto | Resultado | Por qué |
|---|---|---|
| `"250000"`, `"$ 250000"` | 250000 | Sin separadores (se quitan espacios y `$`) |
| `"250000.00"`, `"19.99"`, `"250000,5"` | 250000 · 19.99 · 250000.5 | Un separador seguido de 1–2 dígitos (o 4 o más): es decimal |
| `"1.250.000"`, `"1,250,000"` | 1250000 | El separador se repite: son miles, en grupos de 3 |
| `"1.250.000,00"`, `"1,250,000.00"` | 1250000 | Hay dos separadores: el último es el decimal |
| `"250.000"`, `"1,250"` | **0, `incomplete`** | **Ambiguo:** un solo separador seguido de exactamente 3 dígitos |
| `"abc"`, `"-5"`, `""` | 0, `incomplete` | No es un valor válido |

Cuando el valor es ambiguo, `order_value_raw` lleva el texto original. Se puede resolver en el reporte con la moneda: en COP, `"250.000"` casi seguro significa 250000.

## Eventos

- **`touch`**: lo envía la captura (Pixel 1, o `page_viewed` en Shopify) cuando registra un toque de Hot Sale. No se reenvía si repite el toque guardado (mismos UTM y mismo `is_test`) y ese toque llegó hace menos de 30 minutos, en la misma pestaña o en otra. En ese caso tampoco cambia `landed_at`, aunque cambie la señal (por ejemplo, si la tienda conserva los UTM en sus enlaces internos). Si el navegador bloquea el almacenamiento, cada llegada genera un `touch`.
- **`purchase`**: lo envía la conversión (Pixel 2, o `checkout_completed` en Shopify) si hay un toque de hasta 30 días y con fecha no más de un día en el futuro. Se envía aunque el pedido esté incompleto.
  - Si el pedido tiene `order_id`, completo o no, el toque se borra después del envío: un toque, un pedido.
  - Si no tiene `order_id`, el toque se conserva para que una recarga con los datos completos pueda reportarlo.
  - En una misma pestaña, un pedido se envía como máximo una vez `incomplete` y una vez `complete`.

## Qué hace el collector

Con cada envío (`doPost`):

1. **Valida el formato.** Rechaza:
   - envíos de más de 8 KB o con JSON inválido;
   - `v` distinto de 2, o versiones del píxel que no sean 2.x;
   - valores de `event`, `signal`, `order_status` o `currency` fuera de la lista;
   - tipos incorrectos o textos de más de 500 caracteres;
   - un `landed_at` de hace más de 31 días o más de un día en el futuro, o un `sent_at` que no sea una fecha.
2. **Solo acepta tiendas registradas.** `store_domain` debe ser un dominio de la pestaña `aliados` o un subdominio suyo: `tienda.com` acepta `www.tienda.com` y `checkout.tienda.com`, pero no `tienda.com.evil.com`. La lista se lee como máximo una vez por minuto: una tienda recién agregada se acepta en menos de un minuto.
3. **Limita el volumen.** Se rechazan los envíos de una tienda por encima de 120 por minuto. Se registran como máximo 30 rechazos por minuto, para que una avalancha no llene la hoja.
4. **Guarda el texto como texto.** Todo lo que llega se escribe como texto literal: un UTM como `=IMPORTXML(...)` nunca se convierte en fórmula. Las excepciones son los números, `is_test` y las fechas `landed_at` y `sent_at`. Estas se guardan como fechas y la hoja las muestra en hora de Colombia, su zona horaria.
5. **Registra todo en `eventos`** (o en `rechazados`, con el motivo) y responde `ok`. `v` y `pixel_version` se validan, pero no se guardan. Los envíos del perfil de prueba (`pixel_version` terminada en `-prueba`) se guardan con `is_test = true`.

Cada 10 minutos (`procesar`):

6. **Llegadas (`toques`)**: una fila por llegada, sin duplicados por (aliado, `landed_at`, UTM).
7. **Pedidos (`pedidos`)**: una fila por (aliado, `order_id`). Un `complete` reemplaza a un `incomplete` del mismo pedido; los pedidos sin `order_id` se guardan todos.
8. **Alertas** en la columna `alerta` de `pedidos`, para revisar antes de reportar:
   - `sin llegada registrada`: no hay un `touch` que coincida.
   - `llegada ya usada por otro pedido`: la misma llegada ya se asoció a otro pedido.
   - `valor alto`: más de COP 20.000.000 o USD 5.000.

`reprocesar` reconstruye `toques` y `pedidos` desde `eventos`, por ejemplo después de cambiar una regla.

`migrar` convierte una hoja creada antes del 30 de septiembre de 2026 al formato actual. Quita `v` y `pixel_version`, convierte las fechas, marca `is_test` en las filas del perfil de prueba y reparte `cuerpo` en columnas. Después reconstruye `toques` y `pedidos`. Se ejecuta una vez, justo después de desplegar la versión nueva, y después se ejecuta `setup` para borrar las columnas que quedan vacías. Si se ejecuta de nuevo, solo convierte las filas que sigan en el formato anterior.

`archivar` copia `eventos`, `rechazados`, `toques` y `pedidos` a una hoja nueva en el Drive del propietario y borra sus filas en la hoja principal. El registro de la ejecución muestra el enlace a la hoja nueva. Úselo solo antes del evento: un pedido cuya llegada se archivó queda con la alerta `sin llegada registrada`. No borre filas de `eventos` a mano: `procesar` dejaría de procesar los eventos nuevos hasta que la pestaña volviera a tener las filas borradas.

| Pestaña | Contenido | La escribe |
|---|---|---|
| `aliados` | aliado, dominio | Usted, a mano |
| `eventos` | todos los envíos aceptados, en orden de llegada | `doPost` |
| `rechazados` | fecha y motivo. Si el cuerpo es JSON: `store_domain`, `event`, `pixel_version`, `order_id`, `order_value`, `landed_at`, `utm_source`, `utm_medium` y `utm_campaign`, cada uno de máx. 100 caracteres. Si no lo es: `extracto`, los primeros 200 caracteres | `doPost` |
| `toques` | una fila por llegada | `procesar` |
| `pedidos` | una fila por pedido, con `clave_llegada` y `alerta` | `procesar` |

## Para el reporte

- Ventas atribuidas: `pedidos` con `order_status = complete` e `is_test = false`. Revise primero los que tienen `alerta`. `is_test = false` también deja fuera el perfil de prueba.
- La ventana del evento es `[N días después del 23 de octubre de 2026 — DEFINIR con la CCCE]`. Aplíquela con la columna `recibido`, que es la hora del servidor, no con `sent_at`.
- No convierta monedas: `currency: ""` es un dato faltante, no COP.

## Límites conocidos

- **Sin verificación de origen.** Apps Script no puede leer el encabezado `Origin`. Alguien que lea el snippet puede enviar eventos falsos a nombre de una tienda registrada. Las validaciones, el límite por minuto y las alertas hacen detectables esos envíos, no imposibles. El control final es conciliar los `order_id` con cada aliado antes de reportar cifras.
- **Capacidad.** Apps Script admite un número limitado de ejecuciones simultáneas por cuenta (30, según las cuotas de Google). En picos por encima de ese límite se pueden perder envíos.
- **Tamaño de la hoja.** Google Sheets admite 10 millones de celdas por archivo; el límite está pasando a 20 millones desde septiembre de 2026. Cada evento ocupa una fila en `eventos` y otra en `toques` o `pedidos`, unas 41 celdas en total. Eso da unos 240.000 eventos con 10 millones de celdas. Las celdas vacías también cuentan, por eso `setup` borra las columnas sin uso. Cuando la hoja se llena, los envíos se pierden sin aviso.
