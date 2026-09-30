'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOrder, parseAmount, buildOrder } = require('../src/lib/extract-order.js');

const gtagArgs = function () { return arguments; };

test('GA4 ecommerce purchase', () => {
  const o = extractOrder([{ event: 'purchase', ecommerce: { transaction_id: 'T-1', value: 250000, currency: 'COP' } }]);
  assert.deepEqual(o, {
    order_id: 'T-1', order_value: 250000, order_value_raw: '250000', currency: 'COP',
    order_status: 'complete', value_source: 'ecommerce.value',
  });
});

test('Universal Analytics transaction (also VTEX orderPlaced)', () => {
  const o = extractOrder([{ event: 'orderPlaced', transactionId: 'V-2', transactionTotal: '99900.00', transactionCurrency: 'COP' }]);
  assert.equal(o.order_id, 'V-2');
  assert.equal(o.order_value, 99900);
  assert.equal(o.value_source, 'transactionTotal');
  assert.equal(o.order_status, 'complete');
});

test('VTEX IO orderPlaced: the enhanced ecommerce order, with transactionCurrency as its currency', () => {
  // What the VTEX IO Google Tag Manager app pushes: the order's fields at the top
  // level plus ecommerce.purchase, without ecommerce.currencyCode.
  const ecommerce = { purchase: { actionField: { id: '1665433331879', revenue: 132900 }, products: [] } };
  const o = extractOrder([{
    event: 'orderPlaced', transactionId: '1665433331879', transactionTotal: 132900, transactionCurrency: 'COP',
    ecommerce, ecommerceV2: { ecommerce },
  }]);
  assert.equal(o.order_id, '1665433331879');
  assert.equal(o.order_value, 132900);
  assert.equal(o.value_source, 'ecommerce.purchase.revenue');
  assert.equal(o.currency, 'COP');
});

test('a currency from another format of the same entry, never from another entry', () => {
  assert.equal(extractOrder([{ ecommerce: { currencyCode: 'usd', purchase: { actionField: { id: 'A', revenue: 1 } } }, transactionId: 'A', transactionCurrency: 'COP' }]).currency,
    'USD', "the format's own currency comes first");
  assert.equal(extractOrder([
    { event: 'orderPlaced', transactionId: 'OLD', transactionTotal: 1, transactionCurrency: 'COP' },
    { ecommerce: { purchase: { actionField: { id: 'NEW', revenue: 2 } } } },
  ]).currency, '');
});

test('Universal Analytics enhanced ecommerce', () => {
  const o = extractOrder([{ ecommerce: { currencyCode: 'COP', purchase: { actionField: { id: 'EE-3', revenue: '150000' } } } }]);
  assert.equal(o.order_id, 'EE-3');
  assert.equal(o.order_value, 150000);
  assert.equal(o.value_source, 'ecommerce.purchase.revenue');
});

test("top-level { event: 'purchase' }", () => {
  const o = extractOrder([{ event: 'purchase', transaction_id: 'P-4', value: 50000, currency: 'COP' }]);
  assert.equal(o.order_id, 'P-4');
  assert.equal(o.value_source, 'purchase.value');
});

test('gtag.js purchase call (arguments object in the dataLayer)', () => {
  const o = extractOrder([gtagArgs('event', 'purchase', { transaction_id: 'G-5', value: 120.5, currency: 'usd' })]);
  assert.equal(o.order_id, 'G-5');
  assert.equal(o.order_value, 120.5);
  assert.equal(o.currency, 'USD');
  assert.equal(o.value_source, 'gtag.value');
});

test('multiple entries: the LAST one wins', () => {
  const o = extractOrder([
    { event: 'purchase', ecommerce: { transaction_id: 'OLD', value: 1000, currency: 'COP' } },
    { ecommerce: null },
    { event: 'purchase', ecommerce: { transaction_id: 'NEW', value: 2000, currency: 'COP' } },
  ]);
  assert.equal(o.order_id, 'NEW');
  assert.equal(o.order_value, 2000);
});

test('later non-purchase and empty entries do not hide the order', () => {
  const o = extractOrder([
    { event: 'purchase', ecommerce: { transaction_id: 'T-6', value: 3000, currency: 'COP' } },
    { event: 'view_item', ecommerce: { value: 999, currency: 'COP' } },
    { event: 'purchase' },
    { event: 'purchase', ecommerce: null },
    { event: 'gtm.load' },
    null,
    'string',
  ]);
  assert.equal(o.order_id, 'T-6');
});

test('value parsing rule', () => {
  const cases = [
    [250000, 250000],
    ['250000', 250000],
    ['250000.00', 250000],
    ['19.99', 19.99],
    ['250000,5', 250000.5],
    ['1.250.000', 1250000],
    ['1,250,000', 1250000],
    ['1.250.000,00', 1250000],
    ['1,250,000.00', 1250000],
    ['$ 250000', 250000],
    ['0.5', 0.5],
    // ambiguous: one separator followed by exactly three digits
    ['250.000', 0],
    ['1,250', 0],
    // invalid
    ['1.2.3', 0], ['1.250,000.5', 0], ['12,34,567', 0], ['abc', 0], ['-5', 0], ['', 0], ['250.', 0],
    [0, 0], [-10, 0], [NaN, 0], [Infinity, 0], [null, 0], [undefined, 0], [{}, 0],
  ];
  for (const [input, expected] of cases) {
    assert.equal(parseAmount(input), expected, JSON.stringify(input));
  }
});

test('ambiguous value -> incomplete, value 0, raw text kept for the collector', () => {
  const o = extractOrder([{ event: 'purchase', ecommerce: { transaction_id: 'T-7', value: '250.000', currency: 'COP' } }]);
  assert.equal(o.order_status, 'incomplete');
  assert.equal(o.order_value, 0);
  assert.equal(o.order_value_raw, '250.000');
  assert.equal(o.value_source, 'ecommerce.value');
});

test('missing currency -> "" (never defaults to COP); currency is normalized', () => {
  assert.equal(extractOrder([{ event: 'purchase', ecommerce: { transaction_id: 'T', value: 1 } }]).currency, '');
  assert.equal(extractOrder([{ event: 'purchase', ecommerce: { transaction_id: 'T', value: 1, currency: 'pesos' } }]).currency, '');
  assert.equal(extractOrder([{ event: 'purchase', ecommerce: { transaction_id: 'T', value: 1, currency: ' cop ' } }]).currency, 'COP');
});

test('missing order id -> incomplete; never the literal "unknown"', () => {
  const o = extractOrder([{ event: 'purchase', ecommerce: { value: 1000, currency: 'COP' } }]);
  assert.equal(o.order_id, '');
  assert.equal(o.order_status, 'incomplete');
  for (const id of ['unknown', 'undefined', 'null', ' ']) {
    assert.equal(buildOrder(id, 1, 'COP', 'x').order_id, '', id);
  }
  assert.equal(buildOrder(12345, 1, 'COP', 'x').order_id, '12345');
});

test('no dataLayer, empty dataLayer or no purchase -> incomplete with value_source "none"', () => {
  for (const dl of [undefined, null, [], [{ event: 'gtm.js' }], {}]) {
    const o = extractOrder(dl);
    assert.deepEqual(o, {
      order_id: '', order_value: 0, order_value_raw: '', currency: '',
      order_status: 'incomplete', value_source: 'none',
    });
  }
});

test('window.hotsaleOrder override takes precedence over the dataLayer', () => {
  const o = extractOrder(
    [{ event: 'purchase', ecommerce: { transaction_id: 'DL', value: 1, currency: 'COP' } }],
    { id: 'WC-8', value: '180000', currency: 'COP' },
  );
  assert.equal(o.order_id, 'WC-8');
  assert.equal(o.order_value, 180000);
  assert.equal(o.value_source, 'hotsaleOrder.value');
});

test('an order id without a value is incomplete with value_source "none"', () => {
  const o = extractOrder([{ transactionId: 'T-9' }]);
  assert.equal(o.order_id, 'T-9');
  assert.equal(o.order_status, 'incomplete');
  assert.equal(o.value_source, 'none');
});

test('only id, value and currency are read from an order', () => {
  const o = extractOrder([{
    event: 'purchase',
    ecommerce: { transaction_id: 'T-10', value: 1, currency: 'COP', items: [{ item_name: 'x' }] },
    user_data: { sha256_email_address: 'abc' },
  }]);
  assert.deepEqual(Object.keys(o).sort(), ['currency', 'order_id', 'order_status', 'order_value', 'order_value_raw', 'value_source']);
});

test('an entry with an empty ecommerce object still yields its other formats', () => {
  const ee = extractOrder([{ event: 'purchase', ecommerce: { currencyCode: 'COP', purchase: { actionField: { id: 'EE-3', revenue: '150000' } } } }]);
  assert.equal(ee.order_id, 'EE-3');
  assert.equal(ee.value_source, 'ecommerce.purchase.revenue');
  const top = extractOrder([{ event: 'purchase', transaction_id: 'P-1', value: 5000, currency: 'COP', ecommerce: { items: [{ item_id: 'x' }] } }]);
  assert.equal(top.order_id, 'P-1');
  assert.equal(top.order_status, 'complete');
  assert.equal(top.value_source, 'purchase.value');
});

test('a later entry repeating the id without the value does not hide the value', () => {
  const o = extractOrder([
    { event: 'purchase', ecommerce: { transaction_id: 'T1', value: 100, currency: 'COP' } },
    { event: 'affiliate_conversion', transactionId: 'T1' },
  ]);
  assert.equal(o.order_id, 'T1');
  assert.equal(o.order_value, 100);
  assert.equal(o.order_status, 'complete');
});

test('an older complete order never replaces the most recent order id', () => {
  const o = extractOrder([
    { event: 'purchase', ecommerce: { transaction_id: 'OLD', value: 100, currency: 'COP' } },
    { event: 'orderPlaced', transactionId: 'NEW' },
  ]);
  assert.equal(o.order_id, 'NEW');
  assert.equal(o.order_status, 'incomplete');
});

test('refund entries are never read', () => {
  const o = extractOrder([
    { event: 'purchase', ecommerce: { transaction_id: 'T2', value: 100, currency: 'COP' } },
    { event: 'refund', ecommerce: { transaction_id: 'T2', value: 100, currency: 'COP' } },
    { event: 'refund', ecommerce: { transaction_id: 'R-9' } },
  ]);
  assert.equal(o.order_id, 'T2');
  assert.equal(o.order_status, 'complete');
});

test('an empty window.hotsaleOrder does not override the dataLayer', () => {
  const dl = [{ event: 'purchase', ecommerce: { transaction_id: 'DL', value: 1, currency: 'COP' } }];
  for (const override of [{}, [], { currency: 'COP' }, { id: '', value: '' }]) {
    assert.equal(extractOrder(dl, override).order_id, 'DL', JSON.stringify(override));
  }
});
