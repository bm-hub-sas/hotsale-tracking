// @strip-start
// Pure, ES5. Inlined into the conversion snippets by scripts/build.js; the strip
// blocks are removed. Also loaded by the unit tests through module.exports.
// @strip-end
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

// One dataLayer entry -> { id, value, currency, source } or null. Each known
// format is tried in turn; the first one with an id or a value is used, so an
// entry without data in one format (e.g. an empty GA4 "ecommerce" object next
// to top-level fields) does not hide another. If that format has no currency,
// another format of the same entry may supply it: VTEX IO pushes
// ecommerce.purchase without currencyCode, next to transactionCurrency.
// Refunds are never read.
function readEntry(d) {
  if (!d || typeof d !== 'object' || d.event === 'refund') return null;
  var e = d.ecommerce && typeof d.ecommerce === 'object' ? d.ecommerce : null;
  var p = d[2];
  var candidates = [];
  if (d[0] === 'event' && d[1] === 'purchase' && p && typeof p === 'object') {
    // gtag.js pushes the arguments object of each call: ['event', 'purchase', {...}]
    candidates.push({ id: p.transaction_id, value: p.value, currency: p.currency, source: 'gtag.value' });
  }
  if (e && (!isEmpty(e.transaction_id) || d.event === 'purchase')) {
    // GA4 ecommerce
    candidates.push({ id: e.transaction_id, value: e.value, currency: e.currency, source: 'ecommerce.value' });
  }
  if (e && e.purchase && e.purchase.actionField) {
    // Universal Analytics enhanced ecommerce
    var af = e.purchase.actionField;
    candidates.push({ id: af.id, value: af.revenue, currency: e.currencyCode, source: 'ecommerce.purchase.revenue' });
  }
  if (!isEmpty(d.transactionId)) {
    // Universal Analytics standard ecommerce (also VTEX orderPlaced)
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

// extractOrder(dataLayer, override) -> order fields (see buildOrder).
//   override: window.hotsaleOrder = { id, value, currency }, set by the ally
//   when the platform has no dataLayer. Used when it has an id or a value.
//   Otherwise, the order is the one named by the MOST RECENT dataLayer entry
//   that has an id; its value comes from the most recent entry for that same
//   id with a usable value (a later tag may repeat the id without the value).
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

// @strip-start
module.exports = {
  extractOrder: extractOrder,
  buildOrder: buildOrder,
  parseAmount: parseAmount,
  normalizeCurrency: normalizeCurrency,
  normalizeId: normalizeId
};
// @strip-end
