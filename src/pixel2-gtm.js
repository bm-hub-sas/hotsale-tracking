// Pixel 2 — conversión para GTM o HTML simple. ES5. Se ejecuta solo en la
// página de confirmación del pedido ("gracias por su compra").
// Fuente: scripts/build.js incluye las librerías y la configuración y escribe
// dist/pixel2-gtm-confirmacion.html, que es lo que pegan los aliados.
//
// Qué hace, y nada más:
//   1. Lee el toque de Hot Sale guardado por el Pixel 1. Si no hay, o tiene más
//      de CONFIG.maxTouchAgeDays días, se detiene (un toque vencido se borra).
//   2. Lee el número, el valor y la moneda del pedido en window.hotsaleOrder o
//      en el dataLayer (lib/extract-order.js). No lee nada del comprador.
//   3. Envía una petición "purchase" al collector, completa o no; el collector
//      aplica las reglas de atribución.
//   4. Pedido con número (completo o no) -> borra el toque: un toque, un
//      pedido. Sin número de pedido -> lo conserva, para que una recarga con
//      los datos completos pueda reportarlo.
// No agrega nada al dataLayer y no llama ni carga ninguna otra etiqueta.
(function () {
  'use strict';

  /* @config */

  /* @inline lib/classify.js */
  /* @inline lib/extract-order.js */
  /* @inline lib/touch.js */
  /* @inline lib/browser.js */

  function forgetTouch() {
    storageRemove('sessionStorage', TOUCH_KEY);
    storageRemove('localStorage', TOUCH_KEY);
  }

  try {
    var now = new Date().getTime();
    var touch = latestTouch(
      parseTouch(storageGet('sessionStorage', TOUCH_KEY)),
      parseTouch(storageGet('localStorage', TOUCH_KEY))
    );
    if (!touch) return;
    if (isExpired(touch, now, CONFIG.maxTouchAgeDays)) {
      forgetTouch();
      return;
    }

    var order = extractOrder(window.dataLayer, window.hotsaleOrder);
    var sentKey = SENT_KEY_PREFIX + order.order_id;
    if (!shouldSend(storageGet('sessionStorage', sentKey), order.order_status)) return;
    storageSet('sessionStorage', sentKey, order.order_status);

    var isTest = touch.is_test === true || readParams(location.search, ['hs_test']).hs_test === '1';
    send(CONFIG.collectorUrl, purchasePayload(touch, order, location.hostname, now, isTest, CONFIG));

    if (order.order_id) forgetTouch();
  } catch (e) {}
})();
