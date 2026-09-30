# Cómo verificar la instalación

Con esta prueba se confirma que el píxel registra la llegada desde Hot Sale y la compra, y que no hace nada más. Toma unos 10 minutos. Los envíos con `hs_test=1` llegan marcados como `is_test: true` y no cuentan en los reportes.

## 1. Llegada desde Hot Sale

1. Abra una **ventana privada**, para empezar sin datos anteriores.
2. Abra las herramientas de desarrollo (F12) y vaya a la pestaña **Red** (Network). Escriba `exec` en el filtro.
3. Visite su tienda con esta URL, cambiando el dominio:

   ```
   https://SU-TIENDA.com/?utm_source=hotsale&utm_medium=referral&utm_campaign=prueba&hs_test=1
   ```

4. Debe aparecer **una** petición `POST` a `script.google.com/macros/s/…/exec`. Puede aparecer como tipo `ping` o `beacon`, seguida de una redirección a `script.googleusercontent.com`, que es la respuesta normal de Google. En la pestaña *Payload* (Carga útil) debe ver:
   - `"event": "touch"`
   - `"signal": "utm_only"`
   - `"is_test": true`

   Si la petición aparece bloqueada, revise su Content-Security-Policy: `https://script.google.com` y `https://script.googleusercontent.com` deben estar en `connect-src`.
5. En **Aplicación → Almacenamiento local** (Application → Local storage), dentro de su dominio, debe estar la clave `hotsale_touch_v2`.
6. Recargue la página. No debe aparecer una segunda petición.

## 2. Compra

1. En la misma ventana, haga una compra de prueba. Puede usar el modo de prueba de su pasarela o un pedido que luego cancele.
2. En la página de confirmación debe aparecer **una** petición a `script.google.com` con:
   - `"event": "purchase"`
   - `"order_id"`: el identificador de su pedido. En Shopify es el ID interno que aparece en la URL del pedido en el administrador, no el número `#1001`
   - `"order_value"`: el valor, como número
   - `"currency"`: la moneda del pedido, p. ej. `"COP"`
   - `"order_status": "complete"`
   - `"is_test": true`
3. La clave `hotsale_touch_v2` ya no debe estar en el almacenamiento local.
4. Recargue la página de confirmación. No debe aparecer otra petición.

**Si `order_status` es `"incomplete"`**, su página de confirmación no expone el pedido en un formato que el píxel reconozca. Revise `order_id`, `order_value` y `currency` para ver qué falta. Si `order_value` es 0 y `order_value_raw` trae un texto como `"250.000"`, el valor es ambiguo (¿250 o 250000?) y debe exponerse como número. En GTM o sin GTM, siga [Si el pedido llega incompleto](instalacion-gtm.md#si-el-pedido-llega-incompleto); en WooCommerce, [Datos del pedido](instalacion-woocommerce.md#datos-del-pedido); en Shopify o VTEX, escríbanos.

## 3. Que no haga nada más

- En la pestaña **Red**, filtre por `exec`. Solo debe haber peticiones a `script.google.com`, y ninguna otra relacionada con Hot Sale.
- Filtre por `facebook`, `fbevents`, `gtag` y `google-analytics`. Si aparecen, deben ser de sus propias etiquetas; el píxel de Hot Sale no carga ninguna.
- Si usa el Meta Pixel Helper o Google Tag Assistant, no debe aparecer ningún evento de Hot Sale.

## 4. Avísenos

Escriba a `[correo compartido del proyecto — DEFINIR]` con la hora de la prueba y el número del pedido. Le confirmaremos que el envío llegó.

## Notas por plataforma

- **Shopify:** las peticiones se ven en la pestaña Red de la página de la tienda. Shopify también tiene una herramienta para probar píxeles personalizados ([ayuda de Shopify](https://help.shopify.com/es/manual/promoting-marketing/pixels/custom-pixels/testing)). Si su tienda pide consentimiento de cookies, acepte las cookies de análisis en la ventana privada; sin consentimiento, Shopify no carga el píxel.
- **Checkout en otro dominio:** si la página de confirmación está en un dominio distinto al de la tienda (por ejemplo, `www.` en la tienda y sin `www.` en el checkout), el navegador no comparte el almacenamiento y la compra no se reporta. Avísenos si es su caso.
