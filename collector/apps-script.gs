/**
 * Hot Sale collector: Google Apps Script web app + Google Sheet.
 * Receives the pixel's events (docs/contrato-collector.md), validates them and
 * keeps them in the Sheet that Looker Studio reads.
 *
 * Setup, from the Google account that owns the data (2-step verification on):
 *   1. Open the Sheet > Extensions > Apps Script > replace everything with this
 *      file > Save.
 *   2. Pick "setup" > Run > authorize. It creates the tabs and a trigger that
 *      runs "procesar" every 10 minutes.
 *   3. Tab "aliados": one row per ally store, aliado | dominio (e.g. tienda.com).
 *   4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *      Put the /exec URL in COLLECTOR_URL (scripts/build.js) and run npm run build.
 *   5. Retire the March deployment: Deploy > Manage deployments > archive it.
 *
 * What Apps Script cannot do: read request headers (no Origin check) or the
 * visitor's IP. Requests are checked by content and by registered domain.
 *
 * Tabs:
 *   eventos     every accepted event, in arrival order (raw log)
 *   rechazados  rejected requests and the reason (capped per minute)
 *   toques      one row per Hot Sale arrival       (built by procesar)
 *   pedidos     one row per order, with alerts     (built by procesar)
 *   aliados     registered stores
 */

// ── Config ──────────────────────────────────────────────────────────────────
const MAX_BODY_BYTES = 8192;
const MAX_PER_DOMAIN_PER_MINUTE = 120; // above this, a store's events are rejected
const MAX_REJECTS_LOGGED_PER_MINUTE = 30; // a flood of garbage cannot fill the Sheet
const MAX_TOUCH_AGE_DAYS = 31; // the pixel sends nothing older than 30
const HIGH_VALUE = { COP: 20000000, USD: 5000 }; // above this, the order is flagged (not rejected)
// ────────────────────────────────────────────────────────────────────────────

const FIELDS = [
  'v', 'pixel_version', 'event', 'store_domain',
  'order_id', 'order_value', 'order_value_raw', 'currency', 'order_status', 'value_source',
  'signal', 'landed_at', 'sent_at', 'is_test',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
];
const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
const TEXT_FIELDS = ['pixel_version', 'store_domain', 'sent_at'].concat(UTM_FIELDS);
const ORDER_TEXT_FIELDS = ['order_id', 'order_value_raw', 'currency', 'value_source'];
const SIGNALS = ['referrer+utm', 'referrer_only', 'utm_only', 'keyword_only'];
const EVENT_COLUMNS = ['recibido', 'aliado'].concat(FIELDS);
const TABS = {
  eventos: EVENT_COLUMNS,
  rechazados: ['recibido', 'motivo', 'cuerpo'],
  toques: ['clave'].concat(EVENT_COLUMNS),
  pedidos: ['clave'].concat(EVENT_COLUMNS, ['clave_llegada', 'alerta']),
  aliados: ['aliado', 'dominio'],
};
const DAY_MS = 86400000;

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('America/Bogota');
  Object.keys(TABS).forEach((name) => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) sheet.appendRow(TABS[name]);
    sheet.setFrozenRows(1);
  });
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'procesar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('procesar').timeBased().everyMinutes(10).create();
}

function doGet() {
  return ContentService.createTextOutput('ok');
}

// Always answers "ok": the reason for a rejection goes to the Sheet, never back
// to whoever sent the request.
function doPost(e) {
  const now = new Date();
  const body = (e && e.postData && e.postData.contents) || '';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  try {
    const verdict = check_(ss, body, now);
    lock.waitLock(10000);
    store_(ss, CacheService.getScriptCache(), verdict, body, now);
  } catch (err) {
    console.error(err);
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput('ok');
}

// -> { row, domain } for a valid event, or { reason } for a rejected one.
function check_(ss, body, now) {
  if (body.length > MAX_BODY_BYTES) return { reason: 'cuerpo de más de 8 KB' };
  let p;
  try {
    p = JSON.parse(body);
  } catch (err) {
    return { reason: 'JSON inválido' };
  }
  const invalid = invalid_(p, now);
  if (invalid) return { reason: invalid };
  const host = p.store_domain.toLowerCase();
  const ally = allies_(ss).find((a) => host === a.domain || host.endsWith('.' + a.domain));
  if (!ally) return { reason: 'dominio no registrado: ' + host };
  return { row: [now, text_(ally.name)].concat(FIELDS.map((f) => cell_(p[f]))), domain: ally.domain };
}

function invalid_(p, now) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'no es un objeto';
  if (p.v !== 2) return 'v distinto de 2';
  if (typeof p.pixel_version !== 'string' || p.pixel_version.indexOf('2.') !== 0) return 'versión del píxel no soportada';
  if (p.event !== 'touch' && p.event !== 'purchase') return 'event inválido';
  if (SIGNALS.indexOf(p.signal) === -1) return 'signal inválido';
  if (typeof p.is_test !== 'boolean') return 'is_test inválido';
  const landed = typeof p.landed_at === 'string' ? Date.parse(p.landed_at) : NaN;
  if (isNaN(landed)) return 'landed_at inválido';
  if (landed > now.getTime() + DAY_MS || landed < now.getTime() - MAX_TOUCH_AGE_DAYS * DAY_MS) return 'landed_at fuera de rango';
  const texts = p.event === 'purchase' ? TEXT_FIELDS.concat(ORDER_TEXT_FIELDS) : TEXT_FIELDS;
  for (let i = 0; i < texts.length; i++) {
    if (typeof p[texts[i]] !== 'string' || p[texts[i]].length > 500) return texts[i] + ' inválido';
  }
  if (!p.store_domain) return 'store_domain vacío';
  if (p.event === 'purchase') {
    if (typeof p.order_value !== 'number' || !isFinite(p.order_value) || p.order_value < 0) return 'order_value inválido';
    if (p.order_status !== 'complete' && p.order_status !== 'incomplete') return 'order_status inválido';
    if (p.currency !== '' && !/^[A-Z]{3}$/.test(p.currency)) return 'currency inválida';
  }
  return '';
}

function store_(ss, cache, verdict, body, now) {
  const minute = Math.floor(now.getTime() / 60000);
  if (verdict.row && bump_(cache, 'n:' + verdict.domain + ':' + minute) > MAX_PER_DOMAIN_PER_MINUTE) {
    verdict = { reason: 'más de ' + MAX_PER_DOMAIN_PER_MINUTE + ' envíos por minuto de ' + verdict.domain };
  }
  if (verdict.row) {
    ss.getSheetByName('eventos').appendRow(verdict.row);
  } else if (bump_(cache, 'r:' + minute) <= MAX_REJECTS_LOGGED_PER_MINUTE) {
    ss.getSheetByName('rechazados').appendRow([now, text_(verdict.reason), text_(String(body).slice(0, 2000))]);
  }
}

function bump_(cache, key) {
  const n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 120);
  return n;
}

function allies_(ss) {
  return ss.getSheetByName('aliados').getDataRange().getValues().slice(1)
    .map((r) => ({ name: String(r[0]).trim(), domain: normalizeDomain_(r[1]) }))
    .filter((a) => a.domain);
}

function normalizeDomain_(v) {
  return String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
}

// ── procesar: eventos -> toques + pedidos (every 10 minutes) ────────────────

function procesar() {
  const lock = LockService.getUserLock(); // not the lock doPost uses: events keep arriving meanwhile
  if (!lock.tryLock(30000)) return;
  try {
    process_(SpreadsheetApp.getActiveSpreadsheet(), PropertiesService.getScriptProperties());
  } finally {
    lock.releaseLock();
  }
}

// Rebuilds toques and pedidos from the whole raw log.
function reprocesar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ['toques', 'pedidos'].forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, TABS[name].length).clearContent();
  });
  PropertiesService.getScriptProperties().setProperty('ultima_fila_procesada', '1');
  procesar();
}

function process_(ss, props) {
  const eventos = ss.getSheetByName('eventos');
  const toques = ss.getSheetByName('toques');
  const pedidos = ss.getSheetByName('pedidos');
  const last = eventos.getLastRow();
  const from = Number(props.getProperty('ultima_fila_procesada') || 1) + 1;
  if (last < from) return 0;

  const touchKeys = new Set(values_(toques, TABS.toques.length).map((r) => String(r[0])));
  const col = (name) => TABS.pedidos.indexOf(name);
  const orders = new Map(); // order key -> { status, sheetRow } or { status, index }
  const touchUsedBy = new Map(); // arrival key -> order key
  values_(pedidos, TABS.pedidos.length).forEach((r, i) => {
    const key = String(r[0]);
    if (key) orders.set(key, { status: r[col('order_status')], sheetRow: i + 2 });
    if (key && !touchUsedBy.has(String(r[col('clave_llegada')]))) touchUsedBy.set(String(r[col('clave_llegada')]), key);
  });

  const newTouches = [];
  const newOrders = [];
  const updates = [];
  eventos.getRange(from, 1, last - from + 1, EVENT_COLUMNS.length).getValues().forEach((r) => {
    const ev = {};
    EVENT_COLUMNS.forEach((c, i) => { ev[c] = r[i]; });
    const arrival = [ev.aliado, ev.landed_at].concat(UTM_FIELDS.map((f) => ev[f])).join('|');
    if (ev.event === 'touch') {
      if (!touchKeys.has(arrival)) {
        touchKeys.add(arrival);
        newTouches.push([arrival].concat(r));
      }
      return;
    }
    const key = ev.order_id !== '' ? ev.aliado + '|' + ev.order_id : '';
    const alerts = [];
    if (!touchKeys.has(arrival)) alerts.push('sin llegada registrada');
    if (touchUsedBy.has(arrival) && touchUsedBy.get(arrival) !== key) alerts.push('llegada ya usada por otro pedido');
    if (Number(ev.order_value) > (HIGH_VALUE[ev.currency] || Infinity)) alerts.push('valor alto');
    const row = [key].concat(r, [arrival, alerts.join(', ')]);
    const known = key && orders.get(key);
    if (known) {
      // The same order again: only a complete report replaces an incomplete one.
      if (known.status === 'incomplete' && ev.order_status === 'complete') {
        known.status = 'complete';
        if (known.sheetRow) updates.push({ sheetRow: known.sheetRow, row: row });
        else newOrders[known.index] = row;
      }
      return;
    }
    newOrders.push(row);
    if (key) {
      orders.set(key, { status: ev.order_status, index: newOrders.length - 1 });
      if (!touchUsedBy.has(arrival)) touchUsedBy.set(arrival, key);
    }
  });

  append_(toques, newTouches);
  append_(pedidos, newOrders);
  updates.forEach((u) => pedidos.getRange(u.sheetRow, 1, 1, u.row.length).setValues([u.row.map(rewrite_)]));
  props.setProperty('ultima_fila_procesada', String(last));
  return last - from + 1;
}

function values_(sheet, width) {
  const last = sheet.getLastRow();
  return last > 1 ? sheet.getRange(2, 1, last - 1, width).getValues() : [];
}

function append_(sheet, rows) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows.map((r) => r.map(rewrite_)));
}

// ── Cell values ─────────────────────────────────────────────────────────────

function cell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return text_(String(v));
}

// Text read back from the Sheet loses its apostrophe: add it again.
function rewrite_(v) {
  return typeof v === 'string' ? text_(v) : v;
}

// Stores a string as literal text. Without the leading apostrophe, Sheets
// would turn "=..." into a formula (UTMs come from the URL, so anyone can
// write one) and "00123" into the number 123.
function text_(s) {
  return s === '' ? '' : "'" + s;
}
