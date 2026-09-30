// Píxel personalizado de Shopify (Configuración -> Eventos de cliente ->
// Agregar píxel personalizado).
// Fuente: scripts/build.js incluye las librerías y la configuración y escribe
// dist/pixel2-shopify-customer-events.js, que es lo que pegan los aliados.
//
// En Shopify este único snippet hace los dos trabajos, así que no va nada en
// theme.liquid:
//   page_viewed        -> la misma lógica de captura del Pixel 1 (lib/classify.js)
//   checkout_completed -> la misma lógica de reporte del Pixel 2 (lib/touch.js)
//
// Los píxeles personalizados se ejecutan en un iframe aislado (sandbox "lax"
// de Shopify, sin allow-same-origin). El almacenamiento solo se alcanza con
// browser.sessionStorage / browser.localStorage de Shopify, que son asíncronos
// y se ejecutan en el marco superior: el almacenamiento de la propia tienda,
// donde vive el toque. window.localStorage dentro del sandbox es una copia
// instantánea y no se usa.
// La petición sale por browser.sendBeacon, que Shopify ejecuta en el marco
// superior. Shopify lo marca como obsoleto; si no está disponible, se usa fetch.
// El número, el valor y la moneda son los únicos campos del pedido que se leen.

/* @config */

/* @inline lib/classify.js */
/* @inline lib/extract-order.js */
/* @inline lib/touch.js */

const reportedInThisPage = {};

async function readTouch(storage) {
  try {
    return parseTouch(await storage.getItem(TOUCH_KEY));
  } catch (e) {
    return null;
  }
}

async function storageSet(storage, key, value) {
  try {
    await storage.setItem(key, value);
  } catch (e) {}
}

async function storageRemove(storage, key) {
  try {
    await storage.removeItem(key);
  } catch (e) {}
}

// Algunas tiendas reportan el número de pedido como
// "gid://shopify/OrderIdentity/5210499102" y otras como "5210499102". Se
// conserva el número: el ID del pedido en su URL del administrador (no el
// nombre del pedido, como #1001, que el evento no trae).
function shopifyOrderId(id) {
  const s = id == null ? '' : String(id);
  return s.indexOf('gid://') === 0 ? s.slice(s.lastIndexOf('/') + 1) : s;
}

async function forgetTouch() {
  await storageRemove(browser.sessionStorage, TOUCH_KEY);
  await storageRemove(browser.localStorage, TOUCH_KEY);
}

// La única petición de red que hace el píxel. El cuerpo es un texto, así que
// se envía como text/plain: una petición CORS "simple", sin preflight.
async function send(payload) {
  const body = JSON.stringify(payload);
  try {
    if (await browser.sendBeacon(CONFIG.collectorUrl, body)) return;
  } catch (e) {}
  try {
    await fetch(CONFIG.collectorUrl, { method: 'POST', body, keepalive: true, credentials: 'omit' });
  } catch (e) {}
}

// Borra un toque guardado que esté vencido o dañado, para que ningún toque se
// conserve más de CONFIG.maxTouchAgeDays días después de la siguiente página
// que vea el visitante.
async function dropStale(storage, now) {
  let raw = null;
  try {
    raw = await storage.getItem(TOUCH_KEY);
  } catch (e) {}
  if (!raw) return;
  const stored = parseTouch(raw);
  if (!stored || isExpired(stored, now, CONFIG.maxTouchAgeDays)) await storageRemove(storage, TOUCH_KEY);
}

// La v1 (marzo de 2026) guardaba los UTM en "hotsale_data" sin vencimiento. La v2 nunca la lee.
storageRemove(browser.localStorage, 'hotsale_data');
storageRemove(browser.sessionStorage, 'hotsale_data');

analytics.subscribe('page_viewed', async (event) => {
  try {
    const now = Date.now();
    await dropStale(browser.localStorage, now);
    await dropStale(browser.sessionStorage, now);

    const doc = event.context.document;
    const hit = classify(doc.location.search, doc.referrer, CONFIG);
    if (!hit.isHotsale) return;

    const touch = buildTouch(hit, now, doc.location.hostname);
    // El mismo toque registrado hace menos de 30 minutos: no se reporta de nuevo.
    const stored = latestTouch(await readTouch(browser.sessionStorage), await readTouch(browser.localStorage));
    if (isRepeat(stored, touch, now)) return;

    const json = JSON.stringify(touch);
    await storageSet(browser.sessionStorage, TOUCH_KEY, json);
    await storageSet(browser.localStorage, TOUCH_KEY, json);
    await send(touchPayload(touch, doc.location.hostname, now, CONFIG));
  } catch (e) {}
});

analytics.subscribe('checkout_completed', async (event) => {
  try {
    const now = Date.now();
    const touch = latestTouch(await readTouch(browser.sessionStorage), await readTouch(browser.localStorage));
    if (!touch) return;
    if (isExpired(touch, now, CONFIG.maxTouchAgeDays)) {
      await forgetTouch();
      return;
    }

    const checkout = (event.data && event.data.checkout) || {};
    const total = checkout.totalPrice || {};
    const order = buildOrder(
      shopifyOrderId(checkout.order && checkout.order.id),
      total.amount,
      total.currencyCode || checkout.currencyCode,
      'shopify.totalPrice'
    );

    // Shopify dispara checkout_completed una vez por compra, en la página de
    // agradecimiento o en la primera página de upsell. Se protege igual: en
    // memoria para esta página y en sessionStorage entre páginas.
    const sentKey = SENT_KEY_PREFIX + order.order_id;
    if (!shouldSend(reportedInThisPage[sentKey] || null, order.order_status)) return;
    reportedInThisPage[sentKey] = order.order_status;
    let previous = null;
    try {
      previous = await browser.sessionStorage.getItem(sentKey);
    } catch (e) {}
    if (!shouldSend(previous, order.order_status)) return;
    await storageSet(browser.sessionStorage, sentKey, order.order_status);

    const doc = event.context.document;
    const isTest = touch.is_test === true || readParams(doc.location.search, ['hs_test']).hs_test === '1';
    await send(purchasePayload(touch, order, doc.location.hostname, now, isTest, CONFIG));

    // Un toque, un pedido: un pedido con número agota el toque.
    if (order.order_id) await forgetTouch();
  } catch (e) {}
});
