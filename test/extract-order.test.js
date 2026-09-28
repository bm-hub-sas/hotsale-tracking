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
