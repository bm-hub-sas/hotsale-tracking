'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, hostOf, readParams } = require('../src/lib/classify.js');
const { CONFIG } = require('../scripts/build.js');

const cfg = { hsSources: CONFIG.HS_SOURCES, referrerDomains: CONFIG.REFERRER_DOMAINS };
const run = (search, referrer = '') => classify(search, referrer, cfg);

test('A: referrer from Hot Sale with no UTMs is a touch (referrer_only)', () => {
  for (const ref of ['https://hotsale.com.co/', 'https://www.hotsale.com.co/ofertas?x=1', 'https://hotsale.co/', 'http://www.hotsale.co']) {
    const r = run('', ref);
    assert.equal(r.isHotsale, true, ref);
    assert.equal(r.signal, 'referrer_only', ref);
  }
});

test('B: utm_source=hotsale without referrer is a touch (utm_only)', () => {
  const r = run('?utm_source=hotsale&utm_medium=referral&utm_campaign=hs26oct');
  assert.equal(r.signal, 'utm_only');
  assert.deepEqual(r.utms, {
    utm_source: 'hotsale', utm_medium: 'referral', utm_campaign: 'hs26oct',
    utm_content: '', utm_term: '', utm_id: '',
  });
});

test('A and B together are referrer+utm', () => {
  assert.equal(run('?utm_source=hotsale', 'https://hotsale.com.co/').signal, 'referrer+utm');
});

test('utm_source match is case-insensitive and trimmed; the stored value is trimmed', () => {
  for (const q of ['?utm_source=HotSale%20', '?utm_source=+HOTSALE+', '?utm_source=%09hotsale']) {
    const r = run(q);
    assert.equal(r.signal, 'utm_only', q);
  }
  assert.equal(run('?utm_source=HotSale%20').utms.utm_source, 'HotSale');
});

test("the ally's own campaign mentioning Hot Sale is NOT a touch", () => {
  const r = run('?utm_source=brand_email&utm_medium=email&utm_campaign=hotsale_newsletter');
  assert.equal(r.isHotsale, false);
  assert.equal(r.signal, '');
});

test('keywords from v1 (epsilon, ccce, typos, substrings) are NOT a touch', () => {
  for (const q of [
    '?utm_source=ccce', '?utm_source=epsilon', '?utm_campaign=epsilon', '?utm_medium=hotsale',
    '?utm_source=hotsale2026', '?utm_source=hot_sale', '?utm_source=hotsael', '?utm_source=hotsale_meta',
    '?utm_term=hotsale&utm_content=ccce',
  ]) {
    assert.equal(run(q).isHotsale, false, q);
  }
});

test('lookalike referrers are NOT a touch', () => {
  for (const ref of [
    'https://hotsale.com.co.evil.com/',
    'https://evil-hotsale.com.co/',
    'https://nothotsale.co/',
    'https://blog.hotsale.com.co/',
    'https://evil.com/?r=hotsale.com.co',
    'https://evil.com/hotsale.com.co',
    'https://hotsale.com.co@evil.com/',
    'hotsale.com.co',
    '',
  ]) {
    assert.equal(run('', ref).isHotsale, false, ref);
  }
});

test('referrer hostname is compared without case, port or trailing dot', () => {
  assert.equal(run('', 'https://HOTSALE.COM.CO:443/').signal, 'referrer_only');
  assert.equal(run('', 'https://hotsale.com.co./').signal, 'referrer_only');
  assert.equal(hostOf('https://user:pw@www.hotsale.co:8080/x'), 'www.hotsale.co');
});

test('hs_test=1 marks the touch as a test; any other value does not', () => {
  assert.equal(run('?utm_source=hotsale&hs_test=1').isTest, true);
  assert.equal(run('?utm_source=hotsale&hs_test=0').isTest, false);
  assert.equal(run('?utm_source=hotsale&hs_test=true').isTest, false);
  assert.equal(run('?utm_source=hotsale').isTest, false);
});

test('the first utm_source wins when repeated (same as URLSearchParams.get)', () => {
  assert.equal(run('?utm_source=google&utm_source=hotsale').isHotsale, false);
  assert.equal(run('?utm_source=hotsale&utm_source=google').isHotsale, true);
});

test('long UTM values are clipped to 200 characters', () => {
  const r = run('?utm_source=hotsale&utm_campaign=' + 'x'.repeat(500));
  assert.equal(r.utms.utm_campaign.length, 200);
});

test('malformed input never throws', () => {
  assert.doesNotThrow(() => run('?utm_source=%E0%A4%A&utm_medium=%', '::::'));
  assert.equal(run('?utm_source=%E0%A4%A').utms.utm_source, '%E0%A4%A');
  assert.doesNotThrow(() => classify(undefined, undefined, cfg));
});

test('only UTM keys and hs_test are read; prototype keys are ignored', () => {
  const p = readParams('?__proto__=x&constructor=y&utm_source=hotsale', ['utm_source']);
  assert.deepEqual(Object.keys(p), ['utm_source']);
  assert.equal({}.x, undefined);
});

test('a full URL works too; the fragment is ignored', () => {
  assert.equal(run('https://tienda.com/p?utm_source=hotsale#utm_source=google').signal, 'utm_only');
  assert.equal(run('https://tienda.com/p#?utm_source=hotsale').isHotsale, false);
});
