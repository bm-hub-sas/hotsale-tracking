// @strip-start
// Función pura, ES5. scripts/build.js la incluye en cada snippet y quita los
// bloques strip. Las pruebas unitarias también la cargan con module.exports.
// @strip-end
// El toque guardado y los envíos al collector. El orden de los campos de los
// envíos sigue docs/contrato-collector.md.

var TOUCH_KEY = 'hotsale_touch_v2';
var SENT_KEY_PREFIX = 'hotsale_sent_';
var DAY_MS = 86400000;
var REPEAT_WINDOW_MS = 30 * 60000;

// El objeto que se guarda con TOUCH_KEY.
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

// JSON guardado -> toque, o null si falta, está dañado o no es v2 (los restos
// de la v1 con la clave anterior, "hotsale_data", nunca se leen).
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

// Dos toques son el mismo si coinciden sus UTM e is_test. landed_at, signal y
// store_domain se ignoran: una recarga de la página de llegada, o una tienda
// que conserva los UTM en sus enlaces internos (entonces el referrer es la
// propia tienda y la señal cambia), no es un toque nuevo.
function sameTouch(a, b) {
  if (!a || !b) return false;
  var keys = ['is_test', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
  for (var i = 0; i < keys.length; i++) {
    if (a[keys[i]] !== b[keys[i]]) return false;
  }
  return true;
}

// Verdadero si `touch` repite el toque guardado: mismos UTM e is_test, y llegó
// hace menos de 30 minutos (en esta pestaña o en otra). Una repetición no se
// reporta de nuevo y no mueve landed_at, así que una recarga o el mismo enlace
// abierto en dos pestañas es una sola visita, mientras que el mismo enlace
// seguido días después es una nueva.
function isRepeat(stored, touch, nowMs) {
  if (!sameTouch(stored, touch)) return false;
  var age = nowMs - Date.parse(stored.landed_at);
  return age >= 0 && age < REPEAT_WINDOW_MS;
}

// El más reciente de dos toques (cualquiera puede ser null).
function latestTouch(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(b.landed_at) > Date.parse(a.landed_at) ? b : a;
}

// Con más de maxDays días, o con más de un día en el futuro (el reloj cambió).
function isExpired(touch, nowMs, maxDays) {
  var age = nowMs - Date.parse(touch.landed_at);
  return age > maxDays * DAY_MS || age < -DAY_MS;
}

function basePayload(event, storeDomain, touch, nowMs, isTest, cfg, order) {
  var p = {
    v: 2,
    pixel_version: cfg.pixelVersion,
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

function touchPayload(touch, storeDomain, nowMs, cfg) {
  return basePayload('touch', storeDomain, touch, nowMs, touch.is_test, cfg, null);
}

function purchasePayload(touch, order, storeDomain, nowMs, isTest, cfg) {
  return basePayload('purchase', storeDomain, touch, nowMs, isTest, cfg, order);
}

// Protección contra el doble envío en la página de agradecimiento. `previous`
// es el estado guardado con SENT_KEY_PREFIX + order_id en sessionStorage (o
// null). Un reporte incompleto puede ir seguido de un reporte completo del
// mismo pedido; nunca se envía dos veces con el mismo estado.
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
