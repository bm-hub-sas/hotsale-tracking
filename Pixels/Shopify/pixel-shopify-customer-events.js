// Hot Sale Pixel v2.0.1 · Shopify — píxel personalizado (Customer events)
// Código fuente, documentación y SHA-256: https://github.com/bm-hub-sas/hotsale-tracking
// Generado por scripts/build.js desde src/pixel2-shopify.js. Es el mismo archivo para todos los aliados.

// Píxel personalizado de Shopify (Configuración -> Eventos de cliente ->
// Agregar píxel personalizado).
// Fuente: scripts/build.js incluye las librerías y la configuración y escribe
// Pixels/pixel2-shopify-customer-events.js, que es lo que pegan los aliados.
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

const CONFIG = {
  pixelVersion: '2.0.1',
  collectorUrl: 'https://script.google.com/macros/s/AKfycbzeCZ3yX3SDL462PF5tLrPPtU3U3qze3Ptx99QbwUc2lbZAbzK2NjDhrZtdPkbBnj-BGA/exec',
  maxTouchAgeDays: 30,
  hsSources: ['hotsale'],
  hsKeywords: ['hotsale', 'hot_sale', 'hot-sale', 'hot.sale', 'hotsale2026', 'hotsale_2026', 'hotsale-2026', 'hs2026', 'hs_2026', 'hs-2026', 'hotsale_mar', 'hotsale_marzo', 'hotsalemarzo', 'hotsale_oct', 'hotsale_octubre', 'hotsaleoct', 'hotsaleco', 'hotsale_co', 'hotsalecolombia', 'ccce', 'ccceco', 'ccce2026', 'hotsael', 'hotslae', 'hotsalee', 'epsilon'],
  referrerDomains: ['hotsale.com.co', 'www.hotsale.com.co', 'hotsale.co', 'www.hotsale.co']
};

// Decide si una visita es un toque de Hot Sale.
//
// Regla (README, "Regla de atribución"):
//   A: el dominio del referrer es exactamente uno de cfg.referrerDomains, o
//   B: utm_source, sin espacios y en minúsculas, es exactamente uno de
//      cfg.hsSources, o
//   C: algún valor de UTM, en minúsculas, CONTIENE una de cfg.hsKeywords (la
//      lista de palabras clave de ediciones anteriores).
// signal indica qué coincidió: 'referrer+utm' (A con B o C), 'referrer_only'
// (A), 'utm_only' (B sin A), 'keyword_only' (solo C).

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

// Devuelve el primer valor de cada clave pedida que aparece en la cadena de
// consulta de `url` (una URL completa o solo "?a=b"). Solo se leen las claves
// pedidas.
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

// Dominio de una URL absoluta, en minúsculas, sin usuario, puerto ni punto
// final. "" si el texto no es una URL absoluta.
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

// Verdadero si algún valor de UTM contiene una de las palabras clave (ambos en minúsculas).
function hasKeyword(utms, keywords) {
  if (!keywords) return false;
  for (var i = 0; i < UTM_KEYS.length; i++) {
    var value = utms[UTM_KEYS[i]].toLowerCase();
    if (!value) continue;
    for (var k = 0; k < keywords.length; k++) {
      if (keywords[k] && value.indexOf(keywords[k]) !== -1) return true;
    }
  }
  return false;
}

// classify(url, referrer, cfg) -> { isHotsale, signal, utms, isTest }
//   signal: 'referrer+utm' | 'referrer_only' | 'utm_only' | 'keyword_only' | ''
function classify(url, referrer, cfg) {
  var params = readParams(url, UTM_KEYS.concat(['hs_test']));
  var utms = {};
  for (var i = 0; i < UTM_KEYS.length; i++) {
    utms[UTM_KEYS[i]] = clip(String(params[UTM_KEYS[i]] || '').replace(/^\s+/, ''), MAX_FIELD_LENGTH).replace(/\s+$/, '');
  }
  var byReferrer = inList(hostOf(referrer), cfg.referrerDomains);
  var bySource = inList(utms.utm_source.toLowerCase(), cfg.hsSources);
  var byKeyword = !bySource && hasKeyword(utms, cfg.hsKeywords);
  var signal = byReferrer && (bySource || byKeyword) ? 'referrer+utm'
    : byReferrer ? 'referrer_only'
    : bySource ? 'utm_only'
    : byKeyword ? 'keyword_only'
    : '';
  return { isHotsale: signal !== '', signal: signal, utms: utms, isTest: params.hs_test === '1' };
}
// Lee el pedido que expone la página; nunca lee nada del comprador.
//
// Del pedido solo se leen tres cosas: su número, su valor y su moneda.

var MAX_ID_LENGTH = 100;
var MAX_RAW_LENGTH = 50;

// Lectura estricta de montos (documentada en docs/contrato-collector.md):
//   250000, "250000", "250000.00", "250000,5"  -> separador decimal, sin ambigüedad
//   "1.250.000", "1,250,000"                   -> separador repetido = miles
//   "1.250.000,00", "1,250,000.00"             -> ambos: el último es el decimal
//   "250.000", "1,250"                         -> AMBIGUO: un separador seguido de
//                                                 exactamente 3 dígitos. Devuelve 0.
//   cualquier otra cosa (letras, negativos, vacío) -> 0
// Devolver 0 marca el pedido como "incomplete"; el texto original viaja en
// order_value_raw para que el collector decida.
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

// "1.250.000" con grupo "." -> true: el primer grupo tiene 1-3 dígitos y el resto exactamente 3.
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

// buildOrder(id, value, currency, source) -> los campos del pedido en el envío.
// order_status es 'complete' solo con número de pedido Y un valor > 0.
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

// Una entrada del dataLayer -> { id, value, currency, source } o null. Se
// prueba cada formato conocido en orden; se usa el primero que tenga número o
// valor, así que una entrada sin datos en un formato (por ejemplo, un objeto
// "ecommerce" de GA4 vacío junto a campos de nivel superior) no oculta otro.
// Si ese formato no trae moneda, otro formato de la misma entrada puede
// aportarla: VTEX IO envía ecommerce.purchase sin currencyCode, junto a
// transactionCurrency. Los reembolsos nunca se leen.
function readEntry(d) {
  if (!d || typeof d !== 'object' || d.event === 'refund') return null;
  var e = d.ecommerce && typeof d.ecommerce === 'object' ? d.ecommerce : null;
  var p = d[2];
  var candidates = [];
  if (d[0] === 'event' && d[1] === 'purchase' && p && typeof p === 'object') {
    // gtag.js agrega el objeto de argumentos de cada llamada: ['event', 'purchase', {...}]
    candidates.push({ id: p.transaction_id, value: p.value, currency: p.currency, source: 'gtag.value' });
  }
  if (e && (!isEmpty(e.transaction_id) || d.event === 'purchase')) {
    // GA4, comercio electrónico
    candidates.push({ id: e.transaction_id, value: e.value, currency: e.currency, source: 'ecommerce.value' });
  }
  if (e && e.purchase && e.purchase.actionField) {
    // Universal Analytics, comercio electrónico mejorado
    var af = e.purchase.actionField;
    candidates.push({ id: af.id, value: af.revenue, currency: e.currencyCode, source: 'ecommerce.purchase.revenue' });
  }
  if (!isEmpty(d.transactionId)) {
    // Universal Analytics estándar (también VTEX orderPlaced)
    candidates.push({ id: d.transactionId, value: d.transactionTotal, currency: d.transactionCurrency, source: 'transactionTotal' });
  }
  if (d.event === 'purchase') {
    candidates.push({ id: d.transaction_id, value: d.value, currency: d.currency, source: 'purchase.value' });
  }
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (isEmpty(c.id) && isEmpty(c.value)) continue;
    for (var j = 0; j < candidates.length && !normalizeCurrency(c.currency); j++) {
      if (normalizeCurrency(candidates[j].currency)) c.currency = candidates[j].currency;
    }
    return c;
  }
  return null;
}

// extractOrder(dataLayer, override) -> campos del pedido (ver buildOrder).
//   override: window.hotsaleOrder = { id, value, currency }, que define el
//   aliado cuando la plataforma no tiene dataLayer. Se usa si trae número o valor.
//   Si no, el pedido es el que nombra la entrada MÁS RECIENTE del dataLayer que
//   tenga número; su valor sale de la entrada más reciente de ese mismo número
//   con un valor utilizable (una etiqueta posterior puede repetir el número sin
//   el valor).
function extractOrder(dataLayer, override) {
  if (override && typeof override === 'object' && (!isEmpty(override.id) || !isEmpty(override.value))) {
    return buildOrder(override.id, override.value, override.currency, 'hotsaleOrder.value');
  }
  var found = [];
  var i;
  if (dataLayer && typeof dataLayer.length === 'number') {
    for (i = dataLayer.length - 1; i >= 0; i--) {
      var f = readEntry(dataLayer[i]);
      if (f) found.push(f);
    }
  }
  if (!found.length) return buildOrder('', null, '', 'none');
  var id = '';
  for (i = 0; i < found.length && !id; i++) id = normalizeId(found[i].id);
  if (!id) return buildOrder(found[0].id, found[0].value, found[0].currency, found[0].source);
  var pick = null;
  for (i = 0; i < found.length; i++) {
    if (normalizeId(found[i].id) !== id) continue;
    if (!pick) pick = found[i];
    if (parseAmount(found[i].value) > 0) {
      pick = found[i];
      break;
    }
  }
  return buildOrder(pick.id, pick.value, pick.currency, pick.source);
}
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
