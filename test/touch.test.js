'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/lib/touch.js');
const { classify } = require('../src/lib/classify.js');
const { extractOrder } = require('../src/lib/extract-order.js');
const { CONFIG } = require('../scripts/build.js');

const cfg = { hsSources: CONFIG.HS_SOURCES, referrerDomains: CONFIG.REFERRER_DOMAINS, pixelVersion: '2.0.0' };
const NOW = Date.parse('2026-10-19T14:03:22.000Z');
const DAY = 86400000;
const hit = classify('?utm_source=hotsale&utm_medium=referral&utm_campaign=hs26oct', 'https://hotsale.com.co/', cfg);
const touch = t.buildTouch(hit, NOW, 'tienda.com');

// The payload contract (docs/contrato-collector.md), in order.
const TOUCH_FIELDS = ['v', 'pixel_version', 'site_key', 'event', 'store_domain', 'signal', 'landed_at', 'sent_at', 'is_test',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
const PURCHASE_FIELDS = ['v', 'pixel_version', 'site_key', 'event', 'store_domain',
  'order_id', 'order_value', 'order_value_raw', 'currency', 'order_status', 'value_source',
  'signal', 'landed_at', 'sent_at', 'is_test', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];

test('stored touch', () => {
  assert.deepEqual(touch, {
    v: 2, landed_at: '2026-10-19T14:03:22.000Z', signal: 'referrer+utm', store_domain: 'tienda.com', is_test: false,
    utm_source: 'hotsale', utm_medium: 'referral', utm_campaign: 'hs26oct', utm_content: '', utm_term: '', utm_id: '',
  });
});

test('parseTouch accepts v2 only', () => {
  assert.deepEqual(t.parseTouch(JSON.stringify(touch)), touch);
  assert.equal(t.parseTouch(JSON.stringify({ utm_source: 'hotsale', store_domain: 'tienda.com' })), null, 'v1 shape');
  assert.equal(t.parseTouch(JSON.stringify({ ...touch, landed_at: 'yesterday' })), null);
  assert.equal(t.parseTouch('{not json'), null);
  assert.equal(t.parseTouch(null), null);
  assert.equal(t.parseTouch('null'), null);
});

test('sameTouch ignores landed_at and store_domain only', () => {
  assert.equal(t.sameTouch(touch, { ...touch, landed_at: '2026-10-20T00:00:00.000Z' }), true);
  assert.equal(t.sameTouch(touch, { ...touch, store_domain: 'www.tienda.com' }), true);
  assert.equal(t.sameTouch(touch, { ...touch, utm_campaign: 'other' }), false);
  assert.equal(t.sameTouch(touch, { ...touch, is_test: true }), false);
  assert.equal(t.sameTouch(null, touch), false);
});

test('latestTouch picks the most recent landed_at', () => {
  const older = { ...touch, landed_at: '2026-10-18T00:00:00.000Z' };
  assert.equal(t.latestTouch(older, touch), touch);
  assert.equal(t.latestTouch(touch, older), touch);
  assert.equal(t.latestTouch(null, older), older);
  assert.equal(t.latestTouch(older, null), older);
  assert.equal(t.latestTouch(null, null), null);
});

test('isExpired: older than maxDays, or more than a day in the future', () => {
  assert.equal(t.isExpired(touch, NOW + 29 * DAY, 30), false);
  assert.equal(t.isExpired(touch, NOW + 30 * DAY, 30), false);
  assert.equal(t.isExpired(touch, NOW + 30 * DAY + 1, 30), true);
  assert.equal(t.isExpired(touch, NOW - 2 * DAY, 30), true);
});

test('touch payload has exactly the contract fields, in order', () => {
  const p = t.touchPayload(touch, 'tienda.com', NOW + 1000, 'hs_pk_test', cfg);
  assert.deepEqual(Object.keys(p), TOUCH_FIELDS);
  assert.equal(p.event, 'touch');
  assert.equal(p.v, 2);
  assert.equal(p.sent_at, '2026-10-19T14:03:23.000Z');
});

test('purchase payload has exactly the contract fields, in order', () => {
  const order = extractOrder([{ event: 'purchase', ecommerce: { transaction_id: '12345', value: 250000, currency: 'COP' } }]);
  const p = t.purchasePayload(touch, order, 'tienda.com', NOW, false, 'hs_pk_test', cfg);
  assert.deepEqual(Object.keys(p), PURCHASE_FIELDS);
  assert.equal(p.event, 'purchase');
  assert.equal(p.order_status, 'complete');
  assert.equal(p.is_test, false);
  assert.equal(p.pixel_version, '2.0.0');
});

test('is_test is a strict boolean', () => {
  const order = extractOrder([]);
  assert.equal(t.purchasePayload(touch, order, 'x', NOW, 'yes', 'k', cfg).is_test, false);
  assert.equal(t.purchasePayload(touch, order, 'x', NOW, true, 'k', cfg).is_test, true);
});

test('shouldSend: never twice with the same status; incomplete may upgrade once', () => {
  assert.equal(t.shouldSend(null, 'complete'), true);
  assert.equal(t.shouldSend(null, 'incomplete'), true);
  assert.equal(t.shouldSend('incomplete', 'complete'), true);
  assert.equal(t.shouldSend('incomplete', 'incomplete'), false);
  assert.equal(t.shouldSend('complete', 'complete'), false);
  assert.equal(t.shouldSend('complete', 'incomplete'), false);
});
