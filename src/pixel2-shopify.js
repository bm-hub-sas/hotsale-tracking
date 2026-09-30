// Shopify custom pixel (Settings -> Customer events -> Add custom pixel).
// Source of truth: scripts/build.js inlines the libs and the config and writes
// dist/pixel2-shopify-customer-events.js, which is what allies paste.
//
// On Shopify this one snippet does both jobs, so nothing goes in theme.liquid:
//   page_viewed        -> same capture logic as Pixel 1 (lib/classify.js)
//   checkout_completed -> same reporting logic as Pixel 2 (lib/touch.js)
//
// Custom pixels run in a sandboxed iframe (Shopify "lax" sandbox, no
// allow-same-origin). Storage is reached only through Shopify's async
// browser.sessionStorage / browser.localStorage, which run in the top frame:
// the store's own storage, where the touch lives. window.localStorage inside
// the sandbox is a snapshot and is not used.
// The request goes through browser.sendBeacon, which Shopify runs in the top
// frame. Shopify marks it deprecated; if it is unavailable, fetch is used.
// Order id, value and currency are the only order fields read.

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

// Some stores report order ids as "gid://shopify/OrderIdentity/5210499102",
// others as "5210499102". Keep the number: the order ID in the admin URL of the
// order (not the order name such as #1001, which the event does not carry).
function shopifyOrderId(id) {
  const s = id == null ? '' : String(id);
  return s.indexOf('gid://') === 0 ? s.slice(s.lastIndexOf('/') + 1) : s;
}

async function forgetTouch() {
  await storageRemove(browser.sessionStorage, TOUCH_KEY);
  await storageRemove(browser.localStorage, TOUCH_KEY);
}

// The only network request the pixel makes. The body is a string, so it is
// sent as text/plain: a CORS "simple" request, no preflight.
async function send(payload) {
  const body = JSON.stringify(payload);
  try {
    if (await browser.sendBeacon(CONFIG.collectorUrl, body)) return;
  } catch (e) {}
  try {
    await fetch(CONFIG.collectorUrl, { method: 'POST', body, keepalive: true, credentials: 'omit' });
  } catch (e) {}
}

// Deletes a stored touch that is expired or unreadable, so no touch is kept
// longer than CONFIG.maxTouchAgeDays past the visitor's next page view.
async function dropStale(storage, now) {
  let raw = null;
  try {
    raw = await storage.getItem(TOUCH_KEY);
  } catch (e) {}
  if (!raw) return;
  const stored = parseTouch(raw);
  if (!stored || isExpired(stored, now, CONFIG.maxTouchAgeDays)) await storageRemove(storage, TOUCH_KEY);
}

// v1 (March 2026) stored UTMs under "hotsale_data" with no expiry. v2 never reads it.
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
    // Same touch recorded less than 30 minutes ago: do not report again.
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

    // Shopify fires checkout_completed once per checkout, on the Thank you page
    // or on the first upsell page. Guard anyway: in memory for this page, and
    // in sessionStorage across pages.
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

    // One touch, one order: an order with an id uses up the touch.
    if (order.order_id) await forgetTouch();
  } catch (e) {}
});
