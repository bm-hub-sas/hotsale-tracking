'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TARGETS, PROFILES, render, checkSnippet, sha256, prepareLib, CONFIG, V1_ENDPOINT_ID } = require('../scripts/build.js');

const DIST = path.join(__dirname, '..', 'dist');
const gtm = TARGETS.find((t) => t.src === 'pixel2-gtm.js');
const shopify = TARGETS.find((t) => t.src === 'pixel2-shopify.js');

test('every snippet passes the checks', () => {
  for (const t of TARGETS) assert.deepEqual(checkSnippet(t, render(t)), [], t.out);
});

test('each profile folder: SHA256SUMS.txt matches its files', () => {
  for (const profile of Object.values(PROFILES)) {
    const dir = path.join(__dirname, '..', profile.outDir);
    if (!fs.existsSync(dir)) continue; // dist-prueba/ is local only (gitignored)
    const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    assert.equal(sums.length, TARGETS.length, profile.outDir);
    for (const line of sums) {
      const [hash, name] = line.split('  ');
      assert.equal(sha256(fs.readFileSync(path.join(dir, name), 'utf8')), hash, `${profile.outDir}/${name}`);
    }
  }
});

test('the test profile runs exactly the Hot Sale code: only the header and config lists differ', () => {
  const test = PROFILES['prueba-canales'];
  const strip = (text) => text.split('\n').filter((l) =>
    !/^(<!-- |\/\/ )(Hot Sale Pixel|Píxel de medición|Código fuente|Generado por|Fin )/.test(l) &&
    !/^\s*(pixelVersion|collectorUrl|hsSources|hsKeywords|referrerDomains):/.test(l)).join('\n');
  for (const t of TARGETS) {
    assert.equal(strip(render(t, test.config, test)), strip(render(t)), t.out);
    assert.deepEqual(checkSnippet(t, render(t, test.config, test), test.config), [], t.out);
  }
});

test('the Hot Sale profile never captures the test channels', () => {
  assert.deepEqual(PROFILES.hotsale.config.HS_SOURCES, ['hotsale']);
  assert.ok(!PROFILES.hotsale.config.REFERRER_DOMAINS.some((d) => d.includes('google')));
  assert.ok(!PROFILES.hotsale.config.HS_KEYWORDS.some((k) => /facebook|google|cpc|paid/.test(k)));
  assert.ok(!PROFILES['prueba-canales'].config.HS_KEYWORDS.some((k) => k.includes('hotsale') || k === 'ccce'));
});

test('the collector is the only URL in the code and v1 endpoints are gone', () => {
  for (const t of TARGETS) {
    const text = render(t);
    assert.ok(text.includes(`'${CONFIG.COLLECTOR_URL}'`), t.out);
    assert.ok(!text.includes('G-CD4K6VN4YV') && !text.includes('8614226731956808') && !text.includes(V1_ENDPOINT_ID), t.out);
  }
});

test('the checks catch what they claim to catch', () => {
  const base = render(gtm);
  const inject = (code) => base.replace("'use strict';", `'use strict';\n  ${code}`);
  const cases = {
    "fbq('track', 'Purchase');": 'fbq(',
    "gtag('config', 'G-X');": 'gtag(',
    "var u = 'https://script.google.com/macros/s/x/exec';": 'URL other than the collector',
    "var old = 'AKfycbydRbTiMXNk8_yzuVMPcyMMlDv1';": V1_ENDPOINT_ID,
    "var s = 'https://www.googletagmanager.com/gtag/js';": 'googletagmanager',
    "var f = 'https://connect.facebook.net/en_US/fbevents.js';": 'connect.facebook.net',
    'localStorage.clear();': 'localStorage.clear',
    'var c = document.cookie;': 'document.cookie',
    "document.createElement('script');": 'createElement',
    'window.dataLayer.push({});': 'dataLayer.push',
    "var u = 'https://other.example/collect';": 'URL other than the collector',
    'var e = checkout.email;': 'personal-data',
    'var a = x.shippingAddress;': 'personal-data',
    'var f = () => 1;': 'not valid ES5',
    'let x = 1;': 'not valid ES5',
    'const y = 2;': 'not valid ES5',
    'var z = `t`;': 'not valid ES5',
    "var g = '{{Page URL}}';": '{{',
    'module.exports = {};': 'module.exports',
  };
  for (const [code, expected] of Object.entries(cases)) {
    const errors = checkSnippet(gtm, inject(code));
    assert.ok(errors.some((e) => e.includes(expected)), `${code} -> ${JSON.stringify(errors)}`);
  }
});

test('the Shopify snippet may use modern syntax but not forbidden APIs', () => {
  const base = render(shopify);
  assert.deepEqual(checkSnippet(shopify, base.replace('const reportedInThisPage', 'let reportedInThisPage')), []);
  const bad = base + "\nbrowser.cookie.get('x');\n";
  assert.ok(checkSnippet(shopify, bad).some((e) => e.includes('browser.cookie')));
});

test('every ally gets the same file: no per-ally placeholder, one collector URL', () => {
  for (const t of TARGETS) {
    const text = render(t);
    assert.ok(!/SITE_KEY|site_key/.test(text), t.out);
    assert.equal(text.split(`'${CONFIG.COLLECTOR_URL}'`).length - 1, 1, t.out);
  }
});

test('CRLF sources inline exactly like LF sources (same SHA-256 on every OS)', () => {
  const lf = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'touch.js'), 'utf8');
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(prepareLib(crlf, '  '), prepareLib(lf, '  '));
  assert.ok(!prepareLib(crlf, '').includes('module.exports'));
});
