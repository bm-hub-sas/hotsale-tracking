'use strict';
// The built Shopify custom pixel, run in a Node vm that mimics the Web Pixels
// API surface it is allowed to use: analytics.subscribe, browser.localStorage /
// browser.sessionStorage (async) and browser.sendBeacon, plus fetch. There is
// no window, document or navigator, so any use of them fails the test.
//
// This checks the pixel's logic against the documented API shape. It is NOT a
// substitute for a test purchase in a Shopify development store.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { TARGETS, render } = require('../scripts/build.js');

const target = TARGETS.find((t) => t.src === 'pixel2-shopify.js');
const CODE = render(target).replace("'REEMPLAZAR_SITE_KEY'", "'hs_pk_shop'");
const DAY = 86400000;
const T0 = Date.parse('2026-10-19T14:00:00.000Z');

function asyncStorage(map) {
  return {
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => { map.set(k, String(v)); },
    removeItem: async (k) => { map.delete(k); },
  };
}

// One page load of the pixel. `local` and `session` are shared across loads
// to model the same browser (and tab).
function loadPixel({ local = new Map(), session = new Map(), beacon = true, now = T0, sent = [] } = {}) {
  const handlers = {};
  const context = vm.createContext({
    analytics: { subscribe: (name, fn) => { handlers[name] = fn; } },
    browser: {
      localStorage: asyncStorage(local),
      sessionStorage: asyncStorage(session),
      sendBeacon: beacon
        ? async (url, body) => { sent.push({ via: 'beacon', url, body: JSON.parse(body) }); return true; }
        : undefined,
    },
    init: {},
    fetch: async (url, opts) => { sent.push({ via: 'fetch', url, opts, body: JSON.parse(opts.body) }); return {}; },
    __now: now,
  });
  vm.runInContext('Date.now = function () { return __now; };', context);
  vm.runInContext(CODE, context);
  return { handlers, sent, local, session, context };
}

function pageViewed(search, referrer, hostname = 'tienda.com') {
  return {
    name: 'page_viewed',
    context: { document: { location: { href: `https://${hostname}/${search}`, search, hostname }, referrer } },
    data: {},
  };
}

function checkoutCompleted({ id = 'gid://shopify/OrderIdentity/5210499102', totalPrice = { amount: 250000, currencyCode: 'COP' }, search = '' } = {}) {
  return {
    name: 'checkout_completed',
    context: {
      document: {
        location: { href: `https://tienda.com/checkouts/c/abc/thank-you${search}`, search, hostname: 'tienda.com' },
        referrer: 'https://tienda.com/checkouts/c/abc',
      },
    },
    data: {
      checkout: {
        order: { id },
        totalPrice,
        currencyCode: 'COP',
        token: 'abc',
        email: 'comprador@example.com',
        phone: '+573001234567',
        shippingAddress: { address1: 'Calle 1 # 2-3', city: 'Bogotá', firstName: 'Ana' },
        lineItems: [{ title: 'Producto secreto', quantity: 1 }],
      },
    },
  };
}

const PERSONAL = ['comprador@example.com', '+573001234567', 'Calle 1', 'Bogotá', 'Ana', 'Producto secreto', 'abc'];

test('referrer-only landing, then purchase: touch + complete purchase, no personal data', async () => {
  const shared = { local: new Map(), session: new Map(), sent: [] };
  const landing = loadPixel(shared);
  await landing.handlers.page_viewed(pageViewed('', 'https://www.hotsale.com.co/'));
  assert.ok(shared.local.get('hotsale_touch_v2'));
  assert.ok(shared.session.get('hotsale_touch_v2'));

  const thanks = loadPixel({ ...shared, now: T0 + 3600000 });
  await thanks.handlers.checkout_completed(checkoutCompleted());

  const [touch, purchase, ...rest] = shared.sent.map((s) => s.body);
  assert.equal(rest.length, 0);
  assert.equal(touch.event, 'touch');
  assert.equal(touch.signal, 'referrer_only');
  assert.equal(touch.store_domain, 'tienda.com');
  assert.equal(purchase.event, 'purchase');
  assert.equal(purchase.order_id, '5210499102');
  assert.equal(purchase.order_value, 250000);
  assert.equal(purchase.currency, 'COP');
  assert.equal(purchase.value_source, 'shopify.totalPrice');
  assert.equal(purchase.order_status, 'complete');
  assert.equal(purchase.signal, 'referrer_only');
  assert.equal(purchase.site_key, 'hs_pk_shop');
  assert.equal(purchase.landed_at, touch.landed_at);
  assert.ok(shared.sent.every((s) => s.via === 'beacon' && s.url === 'https://px.hotsale.com.co/v1/collect'));
  assert.equal(shared.local.has('hotsale_touch_v2'), false, 'touch deleted after a complete order');

  const wire = JSON.stringify(shared.sent);
  for (const value of PERSONAL) assert.ok(!wire.includes(value), `sent personal data: ${value}`);
});

test('checkout_completed twice (same page, concurrently) sends one purchase', async () => {
  const p = loadPixel();
  await p.handlers.page_viewed(pageViewed('?utm_source=hotsale', ''));
  await Promise.all([
    p.handlers.checkout_completed(checkoutCompleted({ totalPrice: null })),
    p.handlers.checkout_completed(checkoutCompleted({ totalPrice: null })),
  ]);
  assert.deepEqual(p.sent.map((s) => [s.body.event, s.body.order_status || null]), [['touch', null], ['purchase', 'incomplete']]);
});

test('an incomplete order WITH an id uses up the touch: one touch, one order', async () => {
  const shared = { local: new Map(), session: new Map(), sent: [] };
  await loadPixel(shared).handlers.page_viewed(pageViewed('?utm_source=hotsale', ''));
  await loadPixel(shared).handlers.checkout_completed(checkoutCompleted({ id: '1001', totalPrice: null }));
  // Later orders in new tabs, still without a price: nothing more is claimed.
  await loadPixel({ ...shared, session: new Map(), now: T0 + 10 * DAY }).handlers.checkout_completed(checkoutCompleted({ id: '1002', totalPrice: null }));
  const purchases = shared.sent.filter((x) => x.body.event === 'purchase').map((x) => x.body);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].order_id, '1001');
  assert.equal(purchases[0].order_status, 'incomplete');
  assert.equal(purchases[0].value_source, 'none');
  assert.equal(purchases[0].currency, 'COP', 'falls back to checkout.currencyCode');
  assert.equal(shared.local.has('hotsale_touch_v2'), false);
});

test('an order WITHOUT an id keeps the touch and is not re-sent on the next page', async () => {
  const shared = { local: new Map(), session: new Map(), sent: [] };
  await loadPixel(shared).handlers.page_viewed(pageViewed('?utm_source=hotsale', ''));
  await loadPixel(shared).handlers.checkout_completed(checkoutCompleted({ id: null, totalPrice: null }));
  await loadPixel(shared).handlers.checkout_completed(checkoutCompleted({ id: null, totalPrice: null }));
  const purchases = shared.sent.filter((x) => x.body.event === 'purchase');
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].body.order_id, '');
  assert.ok(shared.local.has('hotsale_touch_v2'));
});

test('the same link again after 30 minutes is a new touch with a new landed_at', async () => {
  const shared = { local: new Map(), session: new Map(), sent: [] };
  await loadPixel(shared).handlers.page_viewed(pageViewed('?utm_source=hotsale', ''));
  await loadPixel({ ...shared, now: T0 + 29 * 60000 }).handlers.page_viewed(pageViewed('?utm_source=hotsale', ''));
  await loadPixel({ ...shared, now: T0 + 19 * DAY }).handlers.page_viewed(pageViewed('?utm_source=hotsale', ''));
  assert.deepEqual(shared.sent.map((x) => x.body.landed_at), [new Date(T0).toISOString(), new Date(T0 + 19 * DAY).toISOString()]);
});

test('the same touch seen again in the session is not re-sent; non-Hot Sale pages keep it', async () => {
  const shared = { local: new Map(), session: new Map(), sent: [] };
  await loadPixel(shared).handlers.page_viewed(pageViewed('?utm_source=hotsale&utm_campaign=a', ''));
  await loadPixel(shared).handlers.page_viewed(pageViewed('?utm_source=hotsale&utm_campaign=a', ''));
  await loadPixel(shared).handlers.page_viewed(pageViewed('?utm_source=google', 'https://www.google.com/'));
  await loadPixel(shared).handlers.page_viewed(pageViewed('', 'https://tienda.com/collections/all'));
  assert.equal(shared.sent.length, 1);
  assert.equal(JSON.parse(shared.local.get('hotsale_touch_v2')).utm_campaign, 'a');
});

test("the ally's own campaign mentioning Hot Sale is not a touch", async () => {
  const p = loadPixel();
  await p.handlers.page_viewed(pageViewed('?utm_source=brand_email&utm_campaign=hotsale_newsletter', ''));
  await p.handlers.checkout_completed(checkoutCompleted());
  assert.deepEqual(p.sent, []);
});

test('a touch older than MAX_TOUCH_AGE_DAYS sends nothing and is deleted; 29 days still reports', async () => {
  for (const [days, expected] of [[31, 0], [29, 1]]) {
    const shared = { local: new Map(), session: new Map(), sent: [] };
    await loadPixel(shared).handlers.page_viewed(pageViewed('?utm_source=hotsale', ''));
    const newTab = { ...shared, session: new Map(), now: T0 + days * DAY };
    await loadPixel(newTab).handlers.checkout_completed(checkoutCompleted());
    assert.equal(shared.sent.filter((s) => s.body.event === 'purchase').length, expected, `${days} days`);
    assert.equal(shared.local.has('hotsale_touch_v2'), false, `${days} days`);
  }
});

test('an expired touch is deleted on the next ordinary page view', async () => {
  const shared = { local: new Map(), session: new Map(), sent: [] };
  await loadPixel(shared).handlers.page_viewed(pageViewed('?utm_source=hotsale', ''));
  await loadPixel({ ...shared, now: T0 + 29 * DAY }).handlers.page_viewed(pageViewed('', ''));
  assert.ok(shared.local.has('hotsale_touch_v2'), 'kept at 29 days');
  await loadPixel({ ...shared, now: T0 + 31 * DAY }).handlers.page_viewed(pageViewed('', ''));
  assert.equal(shared.local.has('hotsale_touch_v2'), false);
  assert.equal(shared.session.has('hotsale_touch_v2'), false);
});

test('reads a touch written by Pixel 1 (GTM or theme.liquid) in localStorage', async () => {
  const touch = {
    v: 2, landed_at: new Date(T0).toISOString(), signal: 'referrer+utm', store_domain: 'tienda.com', is_test: true,
    utm_source: 'hotsale', utm_medium: 'referral', utm_campaign: 'hs26oct', utm_content: '', utm_term: '', utm_id: '',
  };
  const p = loadPixel({ local: new Map([['hotsale_touch_v2', JSON.stringify(touch)]]), now: T0 + DAY });
  await p.handlers.checkout_completed(checkoutCompleted({ id: '1234', totalPrice: { amount: 120.5, currencyCode: 'USD' } }));
  const [purchase] = p.sent.map((s) => s.body);
  assert.equal(purchase.order_id, '1234');
  assert.equal(purchase.currency, 'USD');
  assert.equal(purchase.order_value, 120.5);
  assert.equal(purchase.signal, 'referrer+utm');
  assert.equal(purchase.is_test, true);
});

test('no touch -> nothing is sent at checkout', async () => {
  const p = loadPixel();
  await p.handlers.checkout_completed(checkoutCompleted());
  assert.deepEqual(p.sent, []);
});

test('without browser.sendBeacon it falls back to fetch: POST, keepalive, no credentials', async () => {
  const p = loadPixel({ beacon: false });
  await p.handlers.page_viewed(pageViewed('?utm_source=hotsale&hs_test=1', ''));
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0].via, 'fetch');
  assert.equal(p.sent[0].opts.method, 'POST');
  assert.equal(p.sent[0].opts.keepalive, true);
  assert.equal(p.sent[0].opts.credentials, 'omit');
  assert.equal(typeof p.sent[0].opts.body, 'string');
  assert.equal(p.sent[0].opts.headers, undefined, 'no custom headers: stays a CORS simple request');
  assert.equal(p.sent[0].body.is_test, true);
});

test('v1 leftovers ("hotsale_data") are removed on load', async () => {
  const local = new Map([['hotsale_data', '{"utm_source":"hotsale"}']]);
  loadPixel({ local });
  await new Promise((r) => setImmediate(r));
  assert.equal(local.has('hotsale_data'), false);
});
