# Píxel de Hot Sale para aliados

Este repositorio contiene el píxel que mide las ventas que las tiendas aliadas reciben desde [hotsale.com.co](https://hotsale.com.co), el evento de la Cámara Colombiana de Comercio Electrónico (CCCE). El píxel tiene dos partes. La **captura** reconoce en su tienda una visita que llega desde Hot Sale y la guarda en el navegador del visitante. La **conversión** reporta el número, el valor y la moneda del pedido en la página de confirmación de compra. Cada envío es una sola petición a un único servidor. Usted pega el código de [`Pixels/`](Pixels/), que se puede verificar con SHA-256.

**Versión actual: 2.0.1** (Hot Sale, 19 al 23 de octubre de 2026). La versión de marzo de 2026 quedó en la etiqueta [`v1.0.0-marzo2026`](https://github.com/bm-hub-sas/hotsale-tracking/tree/v1.0.0-marzo2026). Los cambios entre versiones están en [CHANGELOG.md](CHANGELOG.md).

---

## 1. Qué datos se envían

**No se envía ningún dato personal del comprador.** El píxel no lee nombre, correo, teléfono, dirección, documento ni el contenido del carrito. De la página de confirmación solo lee el número, el valor y la moneda del pedido.

El píxel hace dos tipos de envío:

- `touch`: un visitante llegó desde Hot Sale. Si el mismo enlace (mismos UTM) se repite antes de 30 minutos, en la misma pestaña o en otra, no se reenvía: recargar la página o abrir el enlace dos veces cuenta como una sola llegada.
- `purchase`: ese visitante completó una compra.

| Campo | Ejemplo | Qué es | En `touch` | En `purchase` |
|---|---|---|:-:|:-:|
| `v` | `2` | Versión del formato del envío | ✓ | ✓ |
| `pixel_version` | `"2.0.1"` | Versión del píxel instalado | ✓ | ✓ |
| `event` | `"purchase"` | `touch` o `purchase` | ✓ | ✓ |
| `store_domain` | `"tienda.com"` | Dominio de la página donde corre el píxel | ✓ | ✓ |
| `order_id` | `"12345"` | Identificador del pedido que expone su página. En Shopify es el ID interno del pedido, no el número `#1001`. Va vacío si su página no lo expone | | ✓ |
| `order_value` | `250000` | Valor del pedido. Es `0` si falta o si es ambiguo | | ✓ |
| `order_value_raw` | `"250000"` | El valor tal como lo expone su página, sin interpretar | | ✓ |
| `currency` | `"COP"` | Código de tres letras de la moneda del pedido. Va vacío si su página no la expone | | ✓ |
| `order_status` | `"complete"` | `complete` si hay número de pedido y valor mayor que 0; si no, `incomplete` | | ✓ |
| `value_source` | `"ecommerce.value"` | De dónde se leyó el valor | | ✓ |
| `signal` | `"referrer+utm"` | Por qué la visita cuenta como de Hot Sale (ver §3) | ✓ | ✓ |
| `landed_at` | `"2026-10-19T14:03:22.000Z"` | Hora de llegada desde Hot Sale, según el reloj del navegador, en UTC | ✓ | ✓ |
| `sent_at` | `"2026-10-19T14:21:05.000Z"` | Hora del envío | ✓ | ✓ |
| `is_test` | `false` | `true` si la URL tenía `hs_test=1` (ver [pruebas](docs/pruebas.md)) | ✓ | ✓ |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id` | `"hotsale"` | Parámetros UTM de la URL de llegada, de hasta 200 caracteres cada uno | ✓ | ✓ |

Este es un envío `purchase` completo:

```json
{
  "v": 2, "pixel_version": "2.0.1", "event": "purchase",
  "store_domain": "tienda.com", "order_id": "12345", "order_value": 250000, "order_value_raw": "250000",
  "currency": "COP", "order_status": "complete", "value_source": "ecommerce.value",
  "signal": "referrer+utm", "landed_at": "2026-10-19T14:03:22.000Z", "sent_at": "2026-10-19T14:21:05.000Z",
  "is_test": false, "utm_source": "hotsale", "utm_medium": "referral", "utm_campaign": "hs26oct",
  "utm_content": "", "utm_term": "", "utm_id": ""
}
```

### Qué se guarda en el navegador del visitante

El píxel no usa cookies. Solo usa estas claves:

| Clave | Dónde | Contenido | Cuándo se borra |
|---|---|---|---|
| `hotsale_touch_v2` | `localStorage` y `sessionStorage` | `v`, `landed_at`, `signal`, `store_domain`, `is_test` y los UTM | Después de reportar un pedido con número, esté completo o no. También en la siguiente visita a su tienda si tiene más de 30 días, si está dañada o si su fecha está más de un día en el futuro. La copia en `sessionStorage` se borra al cerrar la pestaña |
| `hotsale_sent_<número de pedido>` | `sessionStorage` | `complete` o `incomplete`. Evita enviar dos veces el mismo pedido. Si el pedido no tiene número, la clave es `hotsale_sent_` | Al cerrar la pestaña |

El píxel también borra la clave `hotsale_data` que dejaba la versión de marzo de 2026.

## 2. A dónde van

- **Destino único:** una aplicación web de Google Apps Script (`https://script.google.com/macros/s/…/exec`). Es el único servidor al que el píxel se conecta.
- **Dónde se guardan:** en una hoja de cálculo privada de Google de UpSell/BM-Hub, que opera la medición por encargo de la CCCE. La hoja no se comparte; los reportes se hacen en Looker Studio.
- **Retención:** `[DEFINIR con la CCCE]`.
- **Quién puede verlos:** usted (el reporte de su tienda), la CCCE y UpSell/BM-Hub.
- **IP y navegador:** Google recibe la conexión, como en cualquier servicio web, pero el script no tiene acceso a la IP ni a los encabezados de la petición. Solo recibe el contenido del envío.
- **Qué rechaza el collector:** envíos de dominios que no pertenecen a un aliado registrado, con un formato distinto al de esta versión, de más de 8 KB, o más de 120 por minuto de una misma tienda. Los pedidos sospechosos quedan marcados para revisión.
- **Formato:** la petición es un `POST` con cuerpo `text/plain` (JSON). No dispara preflight CORS.

## 3. Regla de atribución

Una visita a su tienda cuenta como **toque de Hot Sale** si se cumple al menos una de estas condiciones:

- **A — referrer:** la página anterior (`document.referrer`) es exactamente uno de estos dominios: `hotsale.com.co`, `www.hotsale.com.co`, `hotsale.co` o `www.hotsale.co`.
- **B — enlace de Hot Sale:** el parámetro `utm_source` de la URL es exactamente `hotsale`. No distingue mayúsculas y no tiene en cuenta los espacios al inicio o al final.
- **C — palabra clave:** algún parámetro UTM (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` o `utm_id`) contiene una de las palabras clave de las ediciones anteriores, sin distinguir mayúsculas. Por ejemplo, `utm_campaign=hotsale_newsletter` cuenta porque contiene `hotsale`. La lista es: `hotsale`, `hot_sale`, `hot-sale`, `hot.sale`, `hotsale2026`, `hotsale_2026`, `hotsale-2026`, `hs2026`, `hs_2026`, `hs-2026`, `hotsale_mar`, `hotsale_marzo`, `hotsalemarzo`, `hotsale_oct`, `hotsale_octubre`, `hotsaleoct`, `hotsaleco`, `hotsale_co`, `hotsalecolombia`, `ccce`, `ccceco`, `ccce2026`, `hotsael`, `hotslae`, `hotsalee` y `epsilon`.

Los dominios de A se comparan exactos: un subdominio como `blog.hotsale.com.co` no cuenta. Los UTM se guardan decodificados, sin espacios al inicio o al final y con un máximo de 200 caracteres. Si un parámetro se repite en la URL, cuenta el primero.

El campo `signal` indica qué condición se cumplió:

- `referrer+utm`: A, y además B o C;
- `referrer_only`: solo A;
- `utm_only`: B, sin A;
- `keyword_only`: solo C.

Así el reporte puede separar las ventas de las campañas del aliado para el evento (`keyword_only`, por ejemplo `utm_campaign=hotsale_oct` en su propio boletín) de las que llegan desde la plataforma de Hot Sale.

**Modelo: último toque de Hot Sale.**

- Un toque nuevo de Hot Sale reemplaza al anterior. El mismo enlace seguido de nuevo antes de 30 minutos no es un toque nuevo.
- Una visita que no es de Hot Sale (Google, sus propias campañas, tráfico directo) **no** borra el toque.
- Cada toque se asocia a un solo pedido. Después de reportar un pedido con número, esté completo o no, el toque se borra.
- El píxel no reporta compras cuyo toque tenga más de 30 días.
- **Ventana del evento:** el reporte cuenta las compras hasta `[N días después del cierre del evento — DEFINIR con la CCCE]`. El evento va del 19 al 23 de octubre de 2026, con extensión el 24 y 25 de octubre.
- Los envíos con `is_test: true` no cuentan en los reportes.

> **Para su equipo de marketing:** en sus propias campañas para el evento, incluya `hotsale` en algún UTM (por ejemplo, `utm_campaign=hotsale_oct`). Así esas ventas también cuentan como de Hot Sale.

**Lo que este modelo no reclama:**

- Compras hechas en otro dispositivo o navegador, porque el toque se guarda en el navegador.
- Visitas sin referrer de Hot Sale y sin UTM de Hot Sale. Por ejemplo, alguien que vio Hot Sale y luego escribió su URL o lo buscó en Google.
- Compras hechas después de la ventana del evento.
- Un segundo pedido del mismo visitante sin una nueva llegada desde Hot Sale.
- Compras en navegadores que bloquean o borran el almacenamiento, como el modo privado o Safari cuando borra el almacenamiento de un sitio tras 7 días sin visitas.

## 4. Qué NO hace el píxel

- No lee ni escribe cookies.
- No carga scripts de terceros: ni Google Analytics, ni Meta, ni ningún otro. El único código que corre es el que usted pega.
- No envía eventos a su GA4 ni a su píxel de Meta, no llama a sus funciones `gtag` o `fbq` y no agrega nada a su `dataLayer`.
- No modifica la página: no crea elementos ni inserta HTML.
- En GTM/HTML no crea variables globales, no registra listeners y no usa temporizadores. En Shopify solo usa la API de píxeles de Shopify (`analytics.subscribe`, `browser.localStorage`, `browser.sessionStorage`, `browser.sendBeacon`) y `fetch` como respaldo del envío.
- No lee datos del comprador ni del carrito.
- Hace una sola petición por envío, siempre a la misma URL.

Estas afirmaciones se comprueban de forma automática antes de publicar cada versión: la compilación falla si un snippet contiene llamadas a `fbq`, `gtag`, cookies, `dataLayer.push`, temporizadores, listeners, URLs distintas del collector o nombres de datos personales; y pruebas en Chromium sobre páginas con un píxel de Meta y un `gtag` falsos confirman que esas funciones no reciben llamadas, no aparecen variables globales, el `dataLayer` no cambia y no hay peticiones distintas a la del collector.

## 5. Instalación

El código es el mismo para todas las tiendas: son los archivos de [`Pixels/`](Pixels/). Si tiene instalada la versión de marzo de 2026 (etiquetas "Hotsale UTM Capture" y "Hotsale Conversion Pixel", o código en `theme.liquid`), **elimínela antes** de instalar esta.

| Plataforma | Qué se instala | Guía |
|---|---|---|
| Shopify | Un solo píxel personalizado en *Eventos de clientes*. Nada en `theme.liquid` | [docs/instalacion-shopify.md](docs/instalacion-shopify.md) |
| Google Tag Manager (cualquier plataforma) | Pixel 1 en todas las páginas y Pixel 2 en la página de confirmación | [docs/instalacion-gtm.md](docs/instalacion-gtm.md) |
| VTEX | Por medio de GTM | [docs/instalacion-vtex.md](docs/instalacion-vtex.md) |
| WooCommerce | Por medio de GTM o de `functions.php` | [docs/instalacion-woocommerce.md](docs/instalacion-woocommerce.md) |
| Otra plataforma, sin GTM | Pixel 1 en la plantilla principal y Pixel 2 en la página de confirmación | [docs/instalacion-gtm.md#sin-gtm](docs/instalacion-gtm.md#sin-gtm) |

**Si su sitio usa Content-Security-Policy**, agregue `https://script.google.com` y `https://script.googleusercontent.com` a `connect-src`. Si no lo hace, el navegador bloquea el envío.

## 6. Cómo verificar la instalación

Visite su tienda con `?utm_source=hotsale&hs_test=1`, haga una compra de prueba y revise en las herramientas de desarrollo del navegador las dos peticiones a `script.google.com`. Los envíos de prueba no cuentan en los reportes. El paso a paso está en [docs/pruebas.md](docs/pruebas.md).

## 7. Cómo desinstalar

- **GTM:** pause o elimine las dos etiquetas y publique el contenedor.
- **Shopify:** en *Configuración → Eventos de clientes*, desconecte o elimine el píxel "Hot Sale".
- **Otras plataformas:** quite los dos bloques de código.

Las claves que queden en los navegadores de sus visitantes (§1) ya no se leen ni se envían a ninguna parte.

## 8. Versiones y verificación

- Cada snippet indica su versión en la primera línea y en `CONFIG.pixelVersion`. Cada envío incluye `pixel_version`.
- El código vive en su sitio: no se descarga de ningún servidor, así que no cambia a menos que usted pegue una versión nueva.
- Todos los aliados reciben exactamente los mismos archivos. [`Pixels/SHA256SUMS.txt`](Pixels/SHA256SUMS.txt) tiene el SHA-256 de cada uno.

Para verificar el archivo que recibió, calcule su SHA-256 y compárelo con `Pixels/SHA256SUMS.txt`:

```sh
shasum -a 256 pixel2-gtm-confirmacion.html                          # macOS / Linux
cd Pixels && shasum -a 256 -c SHA256SUMS.txt                          # todas, en una copia del repositorio
```

```powershell
Get-FileHash .\pixel2-gtm-confirmacion.html -Algorithm SHA256        # Windows
```

## 9. Contacto

- Implementación y dudas: sergio@upsellmarketing.co
- Vulnerabilidades: ver [SECURITY.md](SECURITY.md)

---

Licencia: [MIT](LICENSE).
