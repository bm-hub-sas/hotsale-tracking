'use strict';
// End-to-end: the built GTM/HTML snippets in real Chromium, against the mock
// collector. Every hostname (tienda.test, hotsale.com.co, px.hotsale.test) is
// mapped to 127.0.0.1, so referrers and Origin headers are real cross-site ones.
//
//   npm run test:e2e
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('./mock-collector.js');

const DAY = 86400000;
let server;
let browser;
let STORE;

before(async () => {
  server = await startServer();
  STORE = `http://tienda.test:${server.port}`;
  browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP * 127.0.0.1', '--disable-features=HttpsUpgrades'],
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fresh browser profile (empty storage) that records every network request.
async function newVisitor() {
  const context = await browser.newContext();
  const network = [];
  context.on('request', (r) => network.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
  server.requests.length = 0;
  return { context, network, page: await context.newPage() };
}

// Waits until the collector holds `count` requests, then a little longer to
// catch any extra one. Returns the payloads.
async function collected(count, settleMs = 400) {
  const deadline = Date.now() + 5000;
  while (server.requests.length < count && Date.now() < deadline) await sleep(25);
  await sleep(settleMs);
  return server.requests.map((r) => r.body);
}

// After every page load: the ally's tags got no calls, no global was added,
// the dataLayer was not touched.
async function assertAllyUntouched(page) {
  const s = await page.evaluate(() => ({
    newGlobals: Object.keys(window).filter((k) => window.__ally.before.keys.indexOf(k) === -1),
    newCalls: window.__ally.calls.slice(window.__ally.before.calls),
    dataLayerBefore: window.__ally.before.dataLayer,
    dataLayerAfter: window.dataLayer ? JSON.stringify(window.dataLayer) : null,
  }));
  assert.deepEqual(s.newGlobals, [], 'Hot Sale code added globals');
  assert.deepEqual(s.newCalls, [], "Hot Sale code called the ally's fbq/gtag");
  assert.equal(s.dataLayerAfter, s.dataLayerBefore, 'Hot Sale code touched the dataLayer');
}

async function visit(page, path) {
  await page.goto(STORE + path);
  await assertAllyUntouched(page);
}

// Arrives at the store through a link on hotsale.com.co (real referrer).
async function arriveFromHotsale(page, path) {
  await page.goto(`http://hotsale.com.co:${server.port}/?to=${encodeURIComponent(STORE + path)}`);
  await Promise.all([page.waitForURL(`${STORE}/**`), page.click('#go')]);
  await assertAllyUntouched(page);
}

async function storedTouch(page) {
  return page.evaluate(() => ({
    local: localStorage.getItem('hotsale_touch_v2'),
    session: sessionStorage.getItem('hotsale_touch_v2'),
  }));
}

// Checks shared by every scenario: one endpoint only, no preflight, no cookies.
function assertCleanTraffic(network) {
  for (const r of network) {
    const host = new URL(r.url).hostname;
    const isNavigation = r.type === 'document' && (host === 'tienda.test' || host === 'hotsale.com.co');
    const isCollector = r.url === server.collectorUrl && r.method === 'POST';
    assert.ok(isNavigation || isCollector, `unexpected request: ${r.method} ${r.url} (${r.type})`);
  }
  for (const r of server.requests) {
    assert.equal(r.method, 'POST', 'preflight or non-POST request reached the collector');
    assert.equal(r.contentType, 'text/plain;charset=UTF-8');
    assert.equal(r.origin, STORE);
    assert.equal(r.cookie, null);
    assert.equal(r.body.site_key, undefined);
    assert.equal(r.body.pixel_version, '2.0.0');
  }
}

test('referrer-only visit -> purchase: signal referrer_only, order complete', async () => {
  const { context, network, page } = await newVisitor();
  await arriveFromHotsale(page, '/landing.html');
  await Promise.all([page.waitForURL('**/product.html'), page.click('#next')]);
  await assertAllyUntouched(page);
  await Promise.all([page.waitForURL('**/gracias-ga4.html'), page.click('#buy')]);
  await assertAllyUntouched(page);

  const [touch, purchase, ...rest] = await collected(2);
  assert.equal(rest.length, 0);
  assert.equal(touch.event, 'touch');
  assert.equal(touch.signal, 'referrer_only');
  assert.equal(touch.utm_source, '');
  assert.equal(purchase.event, 'purchase');
  assert.equal(purchase.signal, 'referrer_only');
  assert.equal(purchase.order_status, 'complete');
  assert.equal(purchase.order_id, 'HS-1001', 'the most recent dataLayer purchase wins');
  assert.equal(purchase.order_value, 250000);
  assert.equal(purchase.currency, 'COP');
  assert.equal(purchase.value_source, 'ecommerce.value');
  assert.equal(purchase.store_domain, 'tienda.test');
  assert.equal(purchase.landed_at, touch.landed_at);
  assert.equal(purchase.is_test, false);
  assert.deepEqual(await storedTouch(page), { local: null, session: null }, 'touch deleted after a complete order');
  assertCleanTraffic(network);
  await context.close();
});

test('direct link with utm_source=HotSale (case/space) -> utm_only; VTEX/UA order', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=HotSale%20&utm_medium=referral&utm_campaign=hs26oct');
  await visit(page, '/gracias-ua.html');
  const [touch, purchase] = await collected(2);
  assert.equal(touch.signal, 'utm_only');
  assert.equal(touch.utm_source, 'HotSale');
  assert.equal(touch.utm_campaign, 'hs26oct');
  assert.equal(purchase.signal, 'utm_only');
  assert.equal(purchase.order_id, 'VTEX-2002');
  assert.equal(purchase.order_value, 99900);
  assert.equal(purchase.value_source, 'transactionTotal');
  assert.equal(purchase.order_status, 'complete');
  assertCleanTraffic(network);
  await context.close();
});

test('a March keyword in any UTM counts, labeled keyword_only', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=brand_email&utm_medium=email&utm_campaign=hotsale_newsletter');
  await visit(page, '/gracias-ga4.html');
  const [touch, purchase, ...rest] = await collected(2);
  assert.equal(rest.length, 0);
  assert.equal(touch.signal, 'keyword_only');
  assert.equal(touch.utm_campaign, 'hotsale_newsletter');
  assert.equal(purchase.signal, 'keyword_only');
  assert.equal(purchase.order_status, 'complete');
  assertCleanTraffic(network);
  await context.close();
});

test('no Hot Sale referrer, source or keyword: nothing is sent', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=google&utm_medium=cpc&utm_campaign=marca');
  await visit(page, '/landing.html?utm_source=newsletter&utm_campaign=black_friday');
  await visit(page, '/gracias-ga4.html');
  assert.deepEqual(await collected(0, 800), []);
  assert.deepEqual(await storedTouch(page), { local: null, session: null });
  assertCleanTraffic(network);
  await context.close();
});

test('reloads do not send twice (landing touch, thank-you purchase)', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale');
  await page.reload();
  await assertAllyUntouched(page);
  await visit(page, '/gracias-ga4.html');
  await page.reload();
  await assertAllyUntouched(page);
  const sent = await collected(2, 800);
  assert.deepEqual(sent.map((p) => p.event), ['touch', 'purchase']);
  assertCleanTraffic(network);
  await context.close();
});

test('UTMs carried over to internal links are not a new touch', async () => {
  const { context, network, page } = await newVisitor();
  await arriveFromHotsale(page, '/landing.html?utm_source=hotsale&utm_campaign=hs26oct');
  // Same UTMs on the next page, but the referrer is now the store itself.
  await visit(page, '/product.html?utm_source=hotsale&utm_campaign=hs26oct');
  await visit(page, '/gracias-ga4.html');
  const sent = await collected(2, 800);
  assert.deepEqual(sent.map((p) => [p.event, p.signal]), [['touch', 'referrer+utm'], ['purchase', 'referrer+utm']]);
  assertCleanTraffic(network);
  await context.close();
});

test('USD order arrives with currency USD (and signal referrer+utm)', async () => {
  const { context, network, page } = await newVisitor();
  await arriveFromHotsale(page, '/landing.html?utm_source=hotsale&utm_campaign=hs26oct');
  await visit(page, '/gracias-usd.html');
  const [touch, purchase] = await collected(2);
  assert.equal(touch.signal, 'referrer+utm');
  assert.equal(purchase.signal, 'referrer+utm');
  assert.equal(purchase.currency, 'USD');
  assert.equal(purchase.order_value, 120.5);
  assertCleanTraffic(network);
  await context.close();
});

test('hs_test=1 on the landing URL -> is_test true on touch and purchase', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale&hs_test=1');
  await visit(page, '/gracias-ga4.html');
  const [touch, purchase] = await collected(2);
  assert.equal(touch.is_test, true);
  assert.equal(purchase.is_test, true);
  assertCleanTraffic(network);
  await context.close();
});

test('hs_test=1 on the thank-you URL -> is_test true', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale');
  await visit(page, '/gracias-ga4.html?hs_test=1');
  const [touch, purchase] = await collected(2);
  assert.equal(touch.is_test, false);
  assert.equal(purchase.is_test, true);
  assertCleanTraffic(network);
  await context.close();
});

test('no order data -> incomplete, touch kept; a later page with the order reports it complete once', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale');
  await visit(page, '/gracias-sin-datalayer.html');
  let sent = await collected(2);
  assert.equal(sent[1].order_status, 'incomplete');
  assert.equal(sent[1].order_id, '');
  assert.equal(sent[1].order_value, 0);
  assert.equal(sent[1].currency, '');
  assert.equal(sent[1].value_source, 'none');
  const kept = await storedTouch(page);
  assert.ok(kept.local && kept.session, 'touch kept after an incomplete order');

  await page.reload();
  await assertAllyUntouched(page);
  await visit(page, '/gracias-override.html');
  sent = await collected(3, 800);
  assert.equal(sent.length, 3, 'the incomplete report is not repeated on reload');
  assert.equal(sent[2].order_status, 'complete');
  assert.equal(sent[2].order_id, 'WC-4004');
  assert.equal(sent[2].value_source, 'hotsaleOrder.value');
  assert.deepEqual(await storedTouch(page), { local: null, session: null });
  assertCleanTraffic(network);
  await context.close();
});

test('ambiguous value "250.000" -> incomplete with the raw text; the order still uses up the touch', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale');
  await visit(page, '/gracias-ambiguo.html');
  const [, purchase] = await collected(2);
  assert.equal(purchase.order_id, 'AMB-5005');
  assert.equal(purchase.order_value, 0);
  assert.equal(purchase.order_value_raw, '250.000');
  assert.equal(purchase.order_status, 'incomplete');
  assert.deepEqual(await storedTouch(page), { local: null, session: null }, 'one touch, one order');
  // A second order later in the same browser is not claimed by the same touch.
  await visit(page, '/gracias-ga4.html');
  assert.equal((await collected(2, 800)).length, 2);
  assertCleanTraffic(network);
  await context.close();
});

test('the same Hot Sale link opened in two tabs is one touch', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale&utm_campaign=hs26oct');
  const second = await context.newPage();
  await visit(second, '/landing.html?utm_source=hotsale&utm_campaign=hs26oct');
  const sent = await collected(1, 800);
  assert.deepEqual(sent.map((p) => p.event), ['touch']);
  assertCleanTraffic(network);
  await context.close();
});

test('a touch older than MAX_TOUCH_AGE_DAYS sends nothing and is deleted', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale');
  await collected(1);
  await page.close();

  const later = await context.newPage();
  await later.clock.setFixedTime(new Date(Date.now() + 31 * DAY));
  await later.goto(STORE + '/gracias-ga4.html');
  await assertAllyUntouched(later);
  const sent = await collected(1, 800);
  assert.deepEqual(sent.map((p) => p.event), ['touch']);
  assert.deepEqual(await storedTouch(later), { local: null, session: null });
  assertCleanTraffic(network);
  await context.close();
});

test('an expired touch is deleted on the next ordinary page view', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale');
  await collected(1);
  await page.close();

  const later = await context.newPage();
  await later.clock.setFixedTime(new Date(Date.now() + 31 * DAY));
  await later.goto(STORE + '/product.html');
  await assertAllyUntouched(later);
  assert.deepEqual(await storedTouch(later), { local: null, session: null });
  assertCleanTraffic(network);
  await context.close();
});

test('a 29-day-old touch in a new tab (localStorage only) still reports', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale');
  const [touch] = await collected(1);
  await page.close();

  const later = await context.newPage();
  await later.clock.setFixedTime(new Date(Date.now() + 29 * DAY));
  await later.goto(STORE + '/gracias-ga4.html');
  await assertAllyUntouched(later);
  const sent = await collected(2);
  assert.equal(sent[1].event, 'purchase');
  assert.equal(sent[1].landed_at, touch.landed_at);
  assertCleanTraffic(network);
  await context.close();
});

test('a later non-Hot Sale visit keeps the touch; a new Hot Sale touch replaces it', async () => {
  const { context, network, page } = await newVisitor();
  await visit(page, '/landing.html?utm_source=hotsale&utm_campaign=primero');
  await visit(page, '/landing.html?utm_source=google&utm_medium=cpc');
  await visit(page, '/landing.html?utm_source=hotsale&utm_campaign=segundo');
  await visit(page, '/landing.html?utm_source=ally_newsletter');
  await visit(page, '/gracias-ga4.html');
  const sent = await collected(3);
  assert.deepEqual(sent.map((p) => [p.event, p.utm_campaign]), [
    ['touch', 'primero'],
    ['touch', 'segundo'],
    ['purchase', 'segundo'],
  ]);
  assertCleanTraffic(network);
  await context.close();
});

test('storage blocked: only the touch is reported and the page does not break', async () => {
  const { context, network, page } = await newVisitor();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const deny = { get() { throw new DOMException('denied', 'SecurityError'); } };
    Object.defineProperty(window, 'localStorage', deny);
    Object.defineProperty(window, 'sessionStorage', deny);
  });
  await visit(page, '/landing.html?utm_source=hotsale');
  await visit(page, '/gracias-ga4.html');
  const sent = await collected(1, 800);
  assert.deepEqual(sent.map((p) => p.event), ['touch'], 'the touch is still reported; the purchase cannot be linked');
  assert.deepEqual(errors, []);
  assertCleanTraffic(network);
  await context.close();
});
