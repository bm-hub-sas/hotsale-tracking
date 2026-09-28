#!/usr/bin/env node
// Builds the snippets allies paste: inlines src/lib/* and the config below into
// src/pixel*.js, wraps the GTM/HTML ones in <script>, runs the safety checks,
// and writes dist/ plus dist/SHA256SUMS.txt.
//
//   node scripts/build.js           build dist/
//   node scripts/build.js --check   fail if dist/ is stale or any check fails
'use strict';

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  PIXEL_VERSION: '2.0.0',
  // [DEFINIR] Requires a DNS record from the CCCE. Placeholder until then.
  COLLECTOR_URL: 'https://px.hotsale.com.co/v1/collect',
  // Pixel 2 ignores (and deletes) touches older than this. The attribution
  // window itself is applied by the collector using landed_at.
  MAX_TOUCH_AGE_DAYS: 30,
  // Exact utm_source values, compared lower-cased and trimmed. No substrings.
  // [DEFINIR] Confirm with the media team which utm_source Hot Sale's own
  // paid ads use; add each value explicitly.
  HS_SOURCES: ['hotsale'],
  // Exact referrer hostnames.
  REFERRER_DOMAINS: ['hotsale.com.co', 'www.hotsale.com.co', 'hotsale.co', 'www.hotsale.co'],
};
// ────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const REPO_URL = 'https://github.com/bm-hub-sas/hotsale-tracking';
const SITE_KEY_PLACEHOLDER = 'REEMPLAZAR_SITE_KEY';

const TARGETS = [
  { src: 'pixel1-capture.js', out: 'pixel1-todas-las-paginas.html', es5: true, html: true,
    title: 'Pixel 1 — captura (todas las páginas)' },
  { src: 'pixel2-gtm.js', out: 'pixel2-gtm-confirmacion.html', es5: true, html: true,
    title: 'Pixel 2 — conversión (página de confirmación de compra)' },
  { src: 'pixel2-shopify.js', out: 'pixel2-shopify-customer-events.js', es5: false, html: false,
    title: 'Shopify — píxel personalizado (Customer events)' },
];

// Strings no snippet may contain, comments included.
const FORBIDDEN = [
  'script.google.com', 'googletagmanager', 'connect.facebook.net', 'fbevents',
  'fbq(', 'gtag(', 'localStorage.clear', 'sessionStorage.clear',
  'document.cookie', 'browser.cookie',
  'createElement', 'appendChild', 'insertBefore', 'innerHTML', 'outerHTML', 'document.write',
  'eval(', 'new Function', 'setTimeout', 'setInterval', 'addEventListener', 'XMLHttpRequest',
  'dataLayer.push', 'module.exports', 'require(', '@strip', '@inline', '@config',
];
// The pixel reads no personal data; these names must not appear at all.
const FORBIDDEN_PERSONAL = /email|phone|address|firstName|lastName|lineItems|billing|shipping/i;

function snippetConfig(config) {
  for (const list of [config.HS_SOURCES, config.REFERRER_DOMAINS]) {
    for (const v of list) {
      if (v !== v.trim().toLowerCase()) throw new Error(`config value must be lower-case and trimmed: "${v}"`);
    }
  }
  return {
    pixelVersion: config.PIXEL_VERSION,
    collectorUrl: config.COLLECTOR_URL,
    maxTouchAgeDays: config.MAX_TOUCH_AGE_DAYS,
    hsSources: config.HS_SOURCES,
    referrerDomains: config.REFERRER_DOMAINS,
  };
}

function literal(value) {
  if (Array.isArray(value)) return '[' + value.map(literal).join(', ') + ']';
  if (typeof value === 'string') return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  return String(value);
}

function configBlock(config, keyword, indent) {
  const cfg = snippetConfig(config);
  const lines = Object.keys(cfg).map((k, i, all) => `${indent}  ${k}: ${literal(cfg[k])}${i < all.length - 1 ? ',' : ''}`);
  return [`${indent}${keyword} CONFIG = {`, ...lines, `${indent}};`].join('\n');
}

// Sources are read with LF line endings whatever the checkout does, so the
// strip markers and the output (and its SHA-256) are the same on every OS.
function readSource(relPath) {
  return toLF(fs.readFileSync(path.join(SRC, relPath), 'utf8'));
}

function toLF(text) {
  return text.replace(/\r\n?/g, '\n');
}

// Lib text -> the code inlined into a snippet: strip blocks removed, indented.
function prepareLib(text, indent) {
  const stripped = toLF(text).replace(/^\/\/ @strip-start\n[\s\S]*?^\/\/ @strip-end\n?/gm, '').replace(/\s+$/, '');
  return stripped.split('\n').map((l) => (l ? indent + l : l)).join('\n');
}

function libSource(relPath, indent) {
  return prepareLib(readSource(relPath), indent);
}

// Returns the JavaScript of a target, with libs and config inlined.
function renderJs(target, config) {
  const src = readSource(target.src);
  return src
    .replace(/^([ \t]*)\/\* @config \*\/[ \t]*$/m, (_, indent) => configBlock(config, target.es5 ? 'var' : 'const', indent))
    .replace(/^([ \t]*)\/\* @inline (lib\/[\w-]+\.js) \*\/[ \t]*$/gm, (_, indent, rel) => libSource(rel, indent));
}

// Returns the final snippet text (what goes in dist/).
function render(target, config = CONFIG) {
  const header = [
    `Hot Sale Pixel v${config.PIXEL_VERSION} · ${target.title}`,
    `Código fuente, documentación y SHA-256: ${REPO_URL}`,
    `Generado por scripts/build.js desde src/${target.src}. Lo único que cambia entre aliados es SITE_KEY.`,
  ];
  const js = renderJs(target, config);
  if (!target.html) return header.map((l) => `// ${l}`).join('\n') + '\n\n' + js;
  return [
    `<!-- ${header[0]} -->`,
    `<!-- ${header[1]} -->`,
    `<!-- ${header[2]} -->`,
    '<script>',
    js.replace(/\s+$/, ''),
    '</script>',
    `<!-- Fin Hot Sale Pixel v${config.PIXEL_VERSION} -->`,
    '',
  ].join('\n');
}

function scriptBody(target, text) {
  if (!target.html) return text;
  const m = /<script>\n([\s\S]*)\n<\/script>/.exec(text);
  return m ? m[1] : '';
}

// Returns a list of problems; empty means the snippet passes.
function checkSnippet(target, text, config = CONFIG) {
  const errors = [];
  for (const s of FORBIDDEN) {
    if (text.includes(s)) errors.push(`contains forbidden string "${s}"`);
  }
  const personal = FORBIDDEN_PERSONAL.exec(text);
  if (personal) errors.push(`contains personal-data name "${personal[0]}"`);

  const urls = text.match(/https?:\/\/[^\s'"`)<>]+/g) || [];
  for (const u of urls) {
    if (u !== config.COLLECTOR_URL && u !== REPO_URL) errors.push(`contains a URL other than the collector: ${u}`);
  }
  if (!text.includes(`'${SITE_KEY_PLACEHOLDER}'`)) errors.push('SITE_KEY placeholder missing');
  if (target.html && text.includes('{{')) errors.push('contains "{{", which GTM treats as a variable');

  const js = scriptBody(target, text);
  try {
    acorn.parse(js, { ecmaVersion: target.es5 ? 5 : 'latest', sourceType: 'script' });
  } catch (e) {
    errors.push(`${target.es5 ? 'not valid ES5' : 'not valid JavaScript'}: ${e.message}`);
  }
  return errors;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function build({ check = false, config = CONFIG, outDir = DIST } = {}) {
  const outputs = {};
  const problems = [];
  for (const t of TARGETS) {
    const text = render(t, config);
    for (const err of checkSnippet(t, text, config)) problems.push(`${t.out}: ${err}`);
    outputs[t.out] = text;
  }
  outputs['SHA256SUMS.txt'] = TARGETS.map((t) => `${sha256(outputs[t.out])}  ${t.out}`).join('\n') + '\n';

  if (check) {
    for (const [name, text] of Object.entries(outputs)) {
      const file = path.join(outDir, name);
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (current !== text) problems.push(`${name}: dist/ is out of date, run "npm run build"`);
    }
  }
  if (problems.length) {
    const err = new Error('build failed:\n  ' + problems.join('\n  '));
    err.problems = problems;
    throw err;
  }
  if (!check) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, text] of Object.entries(outputs)) fs.writeFileSync(path.join(outDir, name), text);
  }
  return outputs;
}

module.exports = { CONFIG, TARGETS, FORBIDDEN, render, checkSnippet, build, sha256, prepareLib, SITE_KEY_PLACEHOLDER };

if (require.main === module) {
  const check = process.argv.includes('--check');
  try {
    const outputs = build({ check });
    process.stdout.write(check ? 'dist/ is up to date and passes all checks.\n' : `Wrote dist/ (v${CONFIG.PIXEL_VERSION}):\n`);
    if (!check) process.stdout.write(outputs['SHA256SUMS.txt']);
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exit(1);
  }
}
