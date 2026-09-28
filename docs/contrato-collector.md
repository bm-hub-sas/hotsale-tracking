# Contrato del collector (envío v2)

Este documento define lo que el píxel 2.0.0 envía y lo que el collector debe hacer con esos envíos. El collector **no** está en este repositorio: se construye en MarOS. En este repositorio hay un collector simulado para pruebas en [`test/e2e/mock-collector.js`](../test/e2e/mock-collector.js).

Principio: **el píxel reporta lo que vio y el collector decide.** El píxel envía los pedidos incompletos y la señal de detección. La ventana de atribución, la deduplicación y el filtro de pruebas se aplican en el collector.

## Petición

| | |
|---|---|
| URL | `https://px.hotsale.com.co/v1/collect` `[DEFINIR: DNS de la CCCE]`. Se configura en `COLLECTOR_URL` de [`scripts/build.js`](../scripts/build.js) |
| Método | `POST` |
| `Content-Type` | `text/plain;charset=UTF-8`. Es una petición CORS "simple": **no hay preflight** |
| Cuerpo | Un objeto JSON (ver campos). Suele pesar menos de 1 KB |
| Transporte GTM/HTML | `navigator.sendBeacon(url, cuerpo)`. Si no existe o devuelve `false`, `fetch(url, {method:'POST', body, keepalive:true, credentials:'omit'})` |
| Transporte Shopify | `browser.sendBeacon(url, cuerpo)` (Shopify lo ejecuta en la página de la tienda). Si falla, `fetch` desde el sandbox del píxel |

### Respuesta esperada

- `204 No Content`. El píxel no lee la respuesta.
- `Access-Control-Allow-Origin: *`. Sin este encabezado, el `fetch` de respaldo falla y deja un error en la consola del navegador del aliado. Como el píxel no envía credenciales, `*` es suficiente.
- Si llega un `OPTIONS`, responder `204` con `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST` y `Access-Control-Allow-Headers: Content-Type`. El píxel no debería provocarlo.
- El collector **no debe fijar cookies**. `sendBeacon` puede adjuntar las cookies que el navegador tenga para el dominio del collector; el collector debe ignorarlas. Conviene no fijar cookies `SameSite=None` sobre `.hotsale.com.co`.

### Encabezado `Origin`

| Caso | `Origin` |
|---|---|
| GTM/HTML, cualquier transporte | El origen de la tienda, p. ej. `https://tienda.com` |
| Shopify con `browser.sendBeacon` | El origen de la tienda. Shopify ejecuta el envío en la página principal. Esto se observó en el código actual de Shopify, pero no está documentado |
| Shopify con `fetch` de respaldo | **`null`**. Los píxeles personalizados corren en un iframe con `sandbox="allow-scripts allow-forms"`, sin `allow-same-origin` |

Shopify marca `browser.sendBeacon` como obsoleto y recomienda `fetch` con `keepalive`. Mientras exista, el píxel lo usa porque conserva el `Origin` real. Si Shopify lo retira, los envíos de tiendas Shopify llegarán con `Origin: null`.

## Campos

Los campos llegan siempre, en este orden. Ningún campo lleva datos personales.

| Campo | Tipo | `touch` | `purchase` | Reglas |
|---|---|:-:|:-:|---|
| `v` | número | ✓ | ✓ | Siempre `2` |
| `pixel_version` | texto | ✓ | ✓ | Semver del snippet, p. ej. `2.0.0` |
| `site_key` | texto | ✓ | ✓ | Emitido por Hot Sale (MarOS), uno por aliado. Es público. `REEMPLAZAR_SITE_KEY` indica un snippet sin configurar |
| `event` | texto | ✓ | ✓ | `touch` o `purchase` |
| `store_domain` | texto | ✓ | ✓ | `location.hostname` de la página que envía |
| `order_id` | texto | | ✓ | Máx. 100 caracteres. `""` si no hay. Nunca `unknown`. Shopify: el ID interno del pedido, el que aparece en la URL del pedido en el administrador, no el nombre `#1001`. Se quita el prefijo `gid://shopify/OrderIdentity/` |
| `order_value` | número | | ✓ | `0` si falta, no es numérico o es ambiguo (ver [Valor del pedido](#valor-del-pedido)) |
| `order_value_raw` | texto | | ✓ | El valor tal como lo expone la página (máx. 50 caracteres). `""` si no hay |
| `currency` | texto | | ✓ | Tres letras en mayúsculas o `""`. Se espera ISO 4217, pero el píxel no la valida contra la lista. **El píxel nunca asume COP** |
| `order_status` | texto | | ✓ | `complete` si `order_id` no es vacío **y** `order_value > 0`; si no, `incomplete` |
| `value_source` | texto | | ✓ | Ver tabla de fuentes |
| `signal` | texto | ✓ | ✓ | `referrer+utm`, `referrer_only` o `utm_only` |
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
| `ecommerce.purchase.revenue` | Universal Analytics enhanced ecommerce: `ecommerce.purchase.actionField.{id, revenue}` y `ecommerce.currencyCode` |
| `transactionTotal` | Universal Analytics estándar y VTEX `orderPlaced`: `transactionId`, `transactionTotal`, `transactionCurrency` |
| `purchase.value` | `{event:'purchase', transaction_id, value, currency}` en el nivel superior |
| `shopify.totalPrice` | Shopify `checkout.totalPrice`. **Incluye envío e impuestos** |
| `none` | No se encontró valor |

Así se elige el pedido en el `dataLayer`:

- Se ignoran las entradas `event: 'refund'` y las que no tienen ni número de pedido ni valor. Dentro de una entrada se prueban los formatos en el orden de la tabla.
- El pedido es el que nombra **la entrada más reciente que tiene número**.
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

Cuando el valor es ambiguo, `order_value_raw` lleva el texto original. El collector puede resolverlo con información que el píxel no tiene; por ejemplo, en COP `"250.000"` casi seguro significa 250000. Esa decisión le corresponde a MarOS.

## Eventos

- **`touch`**: lo envía la captura (Pixel 1, o `page_viewed` en Shopify) cuando registra un toque de Hot Sale. No se reenvía si repite el toque guardado (mismos UTM y mismo `is_test`) y ese toque llegó hace menos de 30 minutos, en la misma pestaña o en otra. En ese caso tampoco cambia `landed_at`, aunque cambie la señal (por ejemplo, si la tienda conserva los UTM en sus enlaces internos). Si el navegador bloquea el almacenamiento, cada llegada genera un `touch`. Sirve para la métrica de sesiones directas y para que el aliado verifique la instalación.
- **`purchase`**: lo envía la conversión (Pixel 2, o `checkout_completed` en Shopify) si hay un toque de hasta 30 días (`MAX_TOUCH_AGE_DAYS`) y con fecha no más de un día en el futuro. Se envía aunque el pedido esté incompleto.
  - Si el pedido tiene `order_id`, completo o no, el toque se borra después del envío: un toque, un pedido.
  - Si no tiene `order_id`, el toque se conserva para que una recarga con los datos completos pueda reportarlo.
  - En una misma pestaña, un pedido se envía como máximo una vez `incomplete` y una vez `complete`.

## Qué debe hacer el collector

1. **Validar**: `v === 2`; `event` ∈ {`touch`, `purchase`}; tipos correctos; cuerpo ≤ 8 KB; `site_key` existente y distinto de `REEMPLAZAR_SITE_KEY`.
2. **Comprobar el origen**: el host de `Origin` y `store_domain` deben corresponder al dominio registrado para el `site_key`. Para aliados Shopify, aceptar `Origin: null` y validar entonces solo `store_domain`.
3. **No confiar ciegamente**: el `site_key` es público, así que cualquiera puede enviar eventos falsos. Aplicar un límite de peticiones por IP y por `site_key`, y marcar anomalías (valores extremos, ráfagas, pedidos sin `touch` previo en toda la base).
4. **Deduplicar compras** por (`site_key`, `order_id`), y contar como máximo un pedido por toque (`site_key`, `landed_at`, UTM). Deduplicar los `touch` por las mismas claves. Un `complete` reemplaza a un `incomplete` del mismo pedido. Los `incomplete` sin `order_id` no se pueden deduplicar entre sesiones.
5. **Excluir pruebas**: `is_test: true` no cuenta en los reportes.
6. **Ventana**: contar compras recibidas hasta `[N días después del 23 de octubre de 2026 — DEFINIR con la CCCE]`. Para decidir si una compra entra en la ventana, usar la **hora de recepción del servidor**, no `sent_at`, porque el reloj del navegador puede estar mal. `landed_at` sirve solo de forma relativa (`sent_at − landed_at`).
7. **Monedas**: no convertir ni asumir. `currency: ""` es un dato faltante, no COP.
8. **Datos de red**: no guardar la IP ni el user-agent más allá de lo necesario para limitar abusos `[DEFINIR]`.
