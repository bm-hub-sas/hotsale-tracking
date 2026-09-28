// Hot Sale Pixel v2.0.0 · Shopify — píxel personalizado (Customer events)
// Código fuente, documentación y SHA-256: https://github.com/bm-hub-sas/hotsale-tracking
// Generado por scripts/build.js desde src/pixel2-shopify.js. Lo único que cambia entre aliados es SITE_KEY.

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
// frame, so the collector sees the store's Origin. Shopify marks it deprecated;
// if it is unavailable, fetch is used, and a fetch from the sandbox carries
// "Origin: null" (see docs/contrato-collector.md).
// Order id, value and currency are the only order fields read.

const SITE_KEY = 'REEMPLAZAR_SITE_KEY';
const CONFIG = {
  pixelVersion: '2.0.0',
  collectorUrl: 'https://px.hotsale.com.co/v1/collect',
  maxTouchAgeDays: 30,
  hsSources: ['hotsale'],
  referrerDomains: ['hotsale.com.co', 'www.hotsale.com.co', 'hotsale.co', 'www.hotsale.co']
};

// Decides whether a page view is a Hot Sale touch.
//
// Rule (README, "Regla de atribución"):
//   A: the referrer hostname is exactly one of cfg.referrerDomains, or
//   B: utm_source, trimmed and lower-cased, is exactly one of cfg.hsSources.
// No substring matching, no keyword lists, no other UTM field is inspected.

var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
var MAX_FIELD_LENGTH = 200;

function clip(value, max) {
  var s = value == null ? '' : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function decodeParam(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch (e) {
    return s;
  }
}

// Returns the first value of each wanted key found in the query string of
// `url` (a full URL or just "?a=b"). Only wanted keys are read.
function readParams(url, wanted) {
  var out = {};
  var s = String(url || '');
  var hash = s.indexOf('#');
  if (hash !== -1) s = s.slice(0, hash);
  var q = s.indexOf('?');
  if (q === -1) return out;
  s = s.slice(q + 1);
  var pairs = s.split('&');
  for (var i = 0; i < pairs.length; i++) {
    if (!pairs[i]) continue;
    var eq = pairs[i].indexOf('=');
    var key = decodeParam(eq === -1 ? pairs[i] : pairs[i].slice(0, eq));
    var val = eq === -1 ? '' : decodeParam(pairs[i].slice(eq + 1));
    for (var k = 0; k < wanted.length; k++) {
      if (wanted[k] === key && !Object.prototype.hasOwnProperty.call(out, key)) out[key] = val;
    }
  }
  return out;
}

// Hostname of an absolute URL, lower-cased, without userinfo, port or trailing
// dot. "" if the string is not an absolute URL.
function hostOf(url) {
  var m = /^[a-z][a-z0-9+.\-]*:\/\/([^\/?#]*)/i.exec(String(url || ''));
  if (!m) return '';
  var authority = m[1];
  var at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  return authority.replace(/:\d*$/, '').replace(/\.$/, '').toLowerCase();
}

function inList(value, list) {
  if (!value) return false;
  for (var i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

// classify(url, referrer, cfg) -> { isHotsale, signal, utms, isTest }
//   signal: 'referrer+utm' | 'referrer_only' | 'utm_only' | ''
function classify(url, referrer, cfg) {
  var params = readParams(url, UTM_KEYS.concat(['hs_test']));
  var utms = {};
  for (var i = 0; i < UTM_KEYS.length; i++) {
    utms[UTM_KEYS[i]] = clip(String(params[UTM_KEYS[i]] || '').replace(/^\s+|\s+$/g, ''), MAX_FIELD_LENGTH);
  }
  var byReferrer = inList(hostOf(referrer), cfg.referrerDomains);
  var bySource = inList(utms.utm_source.toLowerCase(), cfg.hsSources);
  var signal = byReferrer && bySource ? 'referrer+utm'
    : byReferrer ? 'referrer_only'
    : bySource ? 'utm_only'
    : '';
  return { isHotsale: signal !== '', signal: signal, utms: utms, isTest: params.hs_test === '1' };
}
// Reads the order the page exposes; never reads anything about the buyer.
//
// Only three things are read from an order: its id, its value and its currency.

var MAX_ID_LENGTH = 100;
var MAX_RAW_LENGTH = 50;

// Strict amount parsing (documented in docs/contrato-collector.md):
//   250000, "250000", "250000.00", "250000,5"  -> decimal separator, unambiguous
//   "1.250.000", "1,250,000"                   -> repeated separator = thousands
//   "1.250.000,00", "1,250,000.00"             -> both: the last one is decimal
//   "250.000", "1,250"                         -> AMBIGUOUS: one separator followed
//                                                 by exactly 3 digits. Returns 0.
//   anything else (letters, negatives, empty)  -> 0
// A return of 0 makes the order "incomplete"; the raw text travels in
// order_value_raw so the collector can decide.
function parseAmount(raw) {
  if (typeof raw === 'number') return isFinite(raw) && raw > 0 ? raw : 0;
  if (typeof raw !== 'string') return 0;
  var s = raw.replace(/[\s $]/g, '');
  if (!/^\d(?:[\d.,]*\d)?$/.test(s)) return 0;
  var dots = s.split('.').length - 1;
  var commas = s.split(',').length - 1;
  var n;
  if (dots && commas) {
    var dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    var group = dec === '.' ? ',' : '.';
    if ((dec === '.' ? dots : commas) !== 1) return 0;
    var parts = s.split(dec);
    if (!validGroups(parts[0], group)) return 0;
    n = Number(parts[0].split(group).join('') + '.' + parts[1]);
  } else if (!dots && !commas) {
    n = Number(s);
  } else {
    var sep = dots ? '.' : ',';
    if (dots + commas > 1) {
      if (!validGroups(s, sep)) return 0;
      n = Number(s.split(sep).join(''));
    } else if (s.length - s.indexOf(sep) - 1 === 3) {
      return 0;
    } else {
      n = Number(s.replace(sep, '.'));
    }
  }
  return isFinite(n) && n > 0 ? n : 0;
}

// "1.250.000" with group "." -> true: first group 1-3 digits, the rest exactly 3.
function validGroups(s, group) {
  var g = s.split(group);
  if (!/^\d{1,3}$/.test(g[0])) return false;
  for (var i = 1; i < g.length; i++) {
    if (!/^\d{3}$/.test(g[i])) return false;
  }
  return true;
}

function normalizeId(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  var s = String(raw).replace(/^\s+|\s+$/g, '');
  if (/^(unknown|undefined|null|nan)$/i.test(s)) return '';
  return s.length > MAX_ID_LENGTH ? s.slice(0, MAX_ID_LENGTH) : s;
}

function normalizeCurrency(raw) {
  var s = typeof raw === 'string' ? raw.replace(/^\s+|\s+$/g, '').toUpperCase() : '';
  return /^[A-Z]{3}$/.test(s) ? s : '';
}

function isEmpty(v) {
  return v == null || v === '';
}

// buildOrder(id, value, currency, source) -> the order fields of the payload.
// order_status is 'complete' only with an order id AND a value > 0.
function buildOrder(id, value, currency, source) {
  var orderId = normalizeId(id);
  var orderValue = parseAmount(value);
  var raw = isEmpty(value) ? '' : String(value);
  return {
    order_id: orderId,
    order_value: orderValue,
    order_value_raw: raw.length > MAX_RAW_LENGTH ? raw.slice(0, MAX_RAW_LENGTH) : raw,
    currency: normalizeCurrency(currency),
    order_status: orderId && orderValue > 0 ? 'complete' : 'incomplete',
    value_source: isEmpty(value) ? 'none' : source
  };
}

// One dataLayer entry -> { id, value, currency, source } or null.
// Entries with neither an id nor a value are ignored so that empty shells
// (e.g. { event: 'purchase' } without data) cannot hide a real order.
function readEntry(d) {
  if (!d || typeof d !== 'object') return null;
  var e = d.ecommerce;
  var p = d[2];
  var found = null;
  if (d[0] === 'event' && d[1] === 'purchase' && p && typeof p === 'object') {
    // gtag.js pushes the arguments object of each call: ['event', 'purchase', {...}]
    found = { id: p.transaction_id, value: p.value, currency: p.currency, source: 'gtag.value' };
  } else if (e && typeof e === 'object' && (!isEmpty(e.transaction_id) || d.event === 'purchase')) {
    // GA4 ecommerce
    found = { id: e.transaction_id, value: e.value, currency: e.currency, source: 'ecommerce.value' };
  } else if (e && typeof e === 'object' && e.purchase && e.purchase.actionField) {
    // Universal Analytics enhanced ecommerce
    var af = e.purchase.actionField;
    found = { id: af.id, value: af.revenue, currency: e.currencyCode, source: 'ecommerce.purchase.revenue' };
  } else if (!isEmpty(d.transactionId)) {
    // Universal Analytics standard ecommerce (also VTEX orderPlaced)
    found = { id: d.transactionId, value: d.transactionTotal, currency: d.transactionCurrency, source: 'transactionTotal' };
  } else if (d.event === 'purchase') {
    found = { id: d.transaction_id, value: d.value, currency: d.currency, source: 'purchase.value' };
  }
  if (!found || (isEmpty(found.id) && isEmpty(found.value))) return null;
  return found;
}

// extractOrder(dataLayer, override) -> order fields (see buildOrder).
//   override: window.hotsaleOrder = { id, value, currency }, set by the ally
//   when the platform has no dataLayer. Takes precedence when present.
//   Otherwise the dataLayer is scanned from the END: the most recent entry wins.
function extractOrder(dataLayer, override) {
  if (override && typeof override === 'object') {
    return buildOrder(override.id, override.value, override.currency, 'hotsaleOrder.value');
  }
  if (dataLayer && typeof dataLayer.length === 'number') {
    for (var i = dataLayer.length - 1; i >= 0; i--) {
      var found = readEntry(dataLayer[i]);
      if (found) return buildOrder(found.id, found.value, found.currency, found.source);
    }
  }
  return buildOrder('', null, '', 'none');
}
// The stored touch and the payloads sent to the collector. Field order of the
// payloads follows docs/contrato-collector.md.

var TOUCH_KEY = 'hotsale_touch_v2';
var SENT_KEY_PREFIX = 'hotsale_sent_';
var DAY_MS = 86400000;

// The object stored under TOUCH_KEY.
function buildTouch(hit, nowMs, storeDomain) {
  return {
    v: 2,
    landed_at: new Date(nowMs).toISOString(),
    signal: hit.signal,
    store_domain: storeDomain,
    is_test: hit.isTest,
    utm_source: hit.utms.utm_source,
    utm_medium: hit.utms.utm_medium,
    utm_campaign: hit.utms.utm_campaign,
    utm_content: hit.utms.utm_content,
    utm_term: hit.utms.utm_term,
    utm_id: hit.utms.utm_id
  };
}

// Stored JSON -> touch, or null if missing, malformed or not v2 (v1 leftovers
// under the old key "hotsale_data" are never read).
function parseTouch(json) {
  if (!json) return null;
  var t;
  try {
    t = JSON.parse(json);
  } catch (e) {
    return null;
  }
  if (!t || t.v !== 2 || typeof t.landed_at !== 'string' || isNaN(Date.parse(t.landed_at))) return null;
  return t;
}

// Two touches are the same if everything but landed_at matches: a reload of
// the landing page in the same session is not a new touch.
function sameTouch(a, b) {
  if (!a || !b) return false;
  var keys = ['signal', 'is_test', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
  for (var i = 0; i < keys.length; i++) {
    if (a[keys[i]] !== b[keys[i]]) return false;
  }
  return true;
}

// The most recent of two touches (either may be null).
function latestTouch(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(b.landed_at) > Date.parse(a.landed_at) ? b : a;
}

// Older than maxDays, or more than a day in the future (clock changed).
function isExpired(touch, nowMs, maxDays) {
  var age = nowMs - Date.parse(touch.landed_at);
  return age > maxDays * DAY_MS || age < -DAY_MS;
}

function basePayload(event, storeDomain, touch, nowMs, isTest, siteKey, cfg, order) {
  var p = {
    v: 2,
    pixel_version: cfg.pixelVersion,
    site_key: siteKey,
    event: event,
    store_domain: storeDomain
  };
  if (order) {
    p.order_id = order.order_id;
    p.order_value = order.order_value;
    p.order_value_raw = order.order_value_raw;
    p.currency = order.currency;
    p.order_status = order.order_status;
    p.value_source = order.value_source;
  }
  p.signal = touch.signal;
  p.landed_at = touch.landed_at;
  p.sent_at = new Date(nowMs).toISOString();
  p.is_test = isTest === true;
  p.utm_source = touch.utm_source || '';
  p.utm_medium = touch.utm_medium || '';
  p.utm_campaign = touch.utm_campaign || '';
  p.utm_content = touch.utm_content || '';
  p.utm_term = touch.utm_term || '';
  p.utm_id = touch.utm_id || '';
  return p;
}

function touchPayload(touch, storeDomain, nowMs, siteKey, cfg) {
  return basePayload('touch', storeDomain, touch, nowMs, touch.is_test, siteKey, cfg, null);
}

function purchasePayload(touch, order, storeDomain, nowMs, isTest, siteKey, cfg) {
  return basePayload('purchase', storeDomain, touch, nowMs, isTest, siteKey, cfg, order);
}

// Double-send guard for the thank-you page. `previous` is the status stored
// under SENT_KEY_PREFIX + order_id in sessionStorage (or null). An incomplete
// report may be followed by one complete report of the same order; nothing
// is ever sent twice with the same status.
function shouldSend(previous, status) {
  if (previous === 'complete') return false;
  if (previous === 'incomplete') return status === 'complete';
  return true;
}

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
// others as "5210499102". Keep the number, which is what the ally sees in admin.
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
    // Same touch already recorded in this session: do not report again.
    if (sameTouch(await readTouch(browser.sessionStorage), touch)) return;

    const json = JSON.stringify(touch);
    await storageSet(browser.sessionStorage, TOUCH_KEY, json);
    await storageSet(browser.localStorage, TOUCH_KEY, json);
    await send(touchPayload(touch, doc.location.hostname, now, SITE_KEY, CONFIG));
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
    await send(purchasePayload(touch, order, doc.location.hostname, now, isTest, SITE_KEY, CONFIG));

    if (order.order_status === 'complete') await forgetTouch();
  } catch (e) {}
});
