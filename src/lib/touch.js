// @strip-start
// Pure, ES5. Inlined into every snippet by scripts/build.js; the strip blocks are
// removed. Also loaded by the unit tests through module.exports.
// @strip-end
// The stored touch and the payloads sent to the collector. Field order of the
// payloads follows docs/contrato-collector.md.

var TOUCH_KEY = 'hotsale_touch_v2';
var SENT_KEY_PREFIX = 'hotsale_sent_';
var DAY_MS = 86400000;
var REPEAT_WINDOW_MS = 30 * 60000;

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

// Two touches are the same if their UTMs and is_test match. landed_at,
// signal and store_domain are ignored: a reload of the landing page, or a
// store that carries the UTMs over to internal links (the referrer is then
// the store itself, so the signal changes), is not a new touch.
function sameTouch(a, b) {
  if (!a || !b) return false;
  var keys = ['is_test', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
  for (var i = 0; i < keys.length; i++) {
    if (a[keys[i]] !== b[keys[i]]) return false;
  }
  return true;
}

// True if `touch` repeats the stored touch: same UTMs and is_test, landed less
// than 30 minutes ago (in this tab or another). A repeat is not reported
// again and does not move landed_at, so a reload or the same link opened in
// two tabs is one visit, while the same link followed days later is a new one.
function isRepeat(stored, touch, nowMs) {
  if (!sameTouch(stored, touch)) return false;
  var age = nowMs - Date.parse(stored.landed_at);
  return age >= 0 && age < REPEAT_WINDOW_MS;
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

// @strip-start
module.exports = {
  TOUCH_KEY: TOUCH_KEY,
  SENT_KEY_PREFIX: SENT_KEY_PREFIX,
  buildTouch: buildTouch,
  parseTouch: parseTouch,
  sameTouch: sameTouch,
  isRepeat: isRepeat,
  latestTouch: latestTouch,
  isExpired: isExpired,
  touchPayload: touchPayload,
  purchasePayload: purchasePayload,
  shouldSend: shouldSend
};
// @strip-end
