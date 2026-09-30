#!/usr/bin/env node
// Builds the snippets allies paste: inlines src/lib/* and the config below into
// src/pixel*.js, wraps the GTM/HTML ones in <script>, runs the safety checks,
// and writes one folder per profile (see PROFILES) plus its SHA256SUMS.txt.
//
//   node scripts/build.js           build dist/ and dist-prueba/
//   node scripts/build.js --check   fail if either is stale or any check fails
'use strict';

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  PIXEL_VERSION: '2.0.0',
  // The Google Apps Script web app (collector/apps-script.gs), October 2026
  // deployment. Code updates must reuse this deployment (Manage deployments >
  // New version) so the URL never changes under the allies' installs.
  COLLECTOR_URL: 'https://script.google.com/macros/s/AKfycbzeCZ3yX3SDL462PF5tLrPPtU3U3qze3Ptx99QbwUc2lbZAbzK2NjDhrZtdPkbBnj-BGA/exec',
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

// ── Profiles ────────────────────────────────────────────────────────────────
// Same code, different lists. "hotsale" is what Hot Sale allies install.
// "prueba-canales" is a TEST build for other clients' stores: it records visits
// from Facebook/Instagram and Google (by exact utm_source) and from Google
// search (by referrer). Never install it on a Hot Sale ally.
const PROFILES = {
  hotsale: {
    outDir: 'dist',
    label: 'Hot Sale Pixel',
    note: 'Es el mismo archivo para todos los aliados.',
    config: CONFIG,
  },
  'prueba-canales': {
    outDir: 'dist-prueba',
    label: 'Píxel de medición (prueba de canales)',
    note: 'Versión de prueba para otras tiendas: no instalar en aliados de Hot Sale.',
    config: Object.assign({}, CONFIG, {
      PIXEL_VERSION: '2.0.0-prueba',
      // A separate web app + Sheet (same collector/apps-script.gs), so these
      // stores' sales never mix with Hot Sale's data. Placeholder until deployed.
      COLLECTOR_URL: 'https://script.google.com/macros/s/REEMPLAZAR_ID_DE_PRUEBA/exec',
      // Meta's {{site_source_name}} gives fb / ig; some accounts write facebook
      // / instagram / meta. Google Ads needs utm_source=google in its template.
      HS_SOURCES: ['facebook', 'fb', 'instagram', 'ig', 'meta', 'google'],
      // Google search (web and the Android Google app). Organic visits carry no UTMs.
      REFERRER_DOMAINS: ['google.com', 'www.google.com', 'google.com.co', 'www.google.com.co',
        'com.google.android.googlequicksearchbox'],
    }),
  },
};
// ────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const REPO_URL = 'https://github.com/bm-hub-sas/hotsale-tracking';
// The v1 (March 2026) Apps Script deployment: public, unauthenticated, retired.
const V1_ENDPOINT_ID = 'AKfycbydRbTiMXNk8';

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
  V1_ENDPOINT_ID, 'googletagmanager', 'connect.facebook.net', 'fbevents',
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

// Returns the final snippet text (what goes in dist/ or dist-prueba/).
function render(target, config = CONFIG, profile = PROFILES.hotsale) {
  const header = [
    `${profile.label} v${config.PIXEL_VERSION} · ${target.title}`,
    `Código fuente, documentación y SHA-256: ${REPO_URL}`,
    `Generado por scripts/build.js desde src/${target.src}. ${profile.note}`,
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
    `<!-- Fin ${profile.label} v${config.PIXEL_VERSION} -->`,
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
  if (!/^https:\/\/[^\s'"\\]+$/.test(config.COLLECTOR_URL)) errors.push('COLLECTOR_URL must be an https URL');
  if (text.split(`'${config.COLLECTOR_URL}'`).length !== 2) errors.push('the collector URL must appear exactly once');
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

function build({ check = false } = {}) {
  const problems = [];
  const all = {};
  for (const [name, profile] of Object.entries(PROFILES)) {
    const outputs = {};
    for (const t of TARGETS) {
      const text = render(t, profile.config, profile);
      for (const err of checkSnippet(t, text, profile.config)) problems.push(`${profile.outDir}/${t.out}: ${err}`);
      outputs[t.out] = text;
    }
    outputs['SHA256SUMS.txt'] = TARGETS.map((t) => `${sha256(outputs[t.out])}  ${t.out}`).join('\n') + '\n';
    if (check) {
      for (const [file, text] of Object.entries(outputs)) {
        const full = path.join(ROOT, profile.outDir, file);
        const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
        if (current !== text) problems.push(`${profile.outDir}/${file}: out of date, run "npm run build"`);
      }
    }
    all[name] = outputs;
  }
  if (problems.length) {
    const err = new Error('build failed:\n  ' + problems.join('\n  '));
    err.problems = problems;
    throw err;
  }
  if (!check) {
    for (const [name, outputs] of Object.entries(all)) {
      const dir = path.join(ROOT, PROFILES[name].outDir);
      fs.mkdirSync(dir, { recursive: true });
      for (const [file, text] of Object.entries(outputs)) fs.writeFileSync(path.join(dir, file), text);
    }
  }
  return all;
}

module.exports = { CONFIG, PROFILES, TARGETS, FORBIDDEN, render, checkSnippet, build, sha256, prepareLib, V1_ENDPOINT_ID };

if (require.main === module) {
  const check = process.argv.includes('--check');
  try {
    const all = build({ check });
    for (const [name, profile] of Object.entries(PROFILES)) {
      const where = `${profile.outDir}/ (${name}, v${profile.config.PIXEL_VERSION})`;
      process.stdout.write(check ? `${where} is up to date and passes all checks.\n` : `Wrote ${where}:\n${all[name]['SHA256SUMS.txt']}`);
      if (profile.config.COLLECTOR_URL.includes('REEMPLAZAR')) {
        process.stdout.write(`WARNING: ${name} COLLECTOR_URL is still the placeholder. Do not install ${profile.outDir}/ yet.\n`);
      }
    }
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exit(1);
  }
}
