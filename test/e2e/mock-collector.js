'use strict';
// Mock collector + static host for the e2e tests. One HTTP server answers for
// every hostname (the e2e test maps all hostnames to 127.0.0.1 in Chromium):
//
//   POST .../v1/collect            records method, Origin, Content-Type, cookies
//                                  and the JSON body, answers 204
//   host hotsale.com.co, /?to=URL  a "Hot Sale" page with one link to URL, so
//                                  the store gets a real cross-site referrer
//   any other host                 test/e2e/pages/*.html with the includes
//                                  below replaced by the built snippets
//
// Run it alone to click through the store pages by hand and watch the log:
//   node test/e2e/mock-collector.js [port]   ->  http://localhost:8787/landing.html?utm_source=hotsale
const http = require('http');
const fs = require('fs');
const path = require('path');
const { TARGETS, CONFIG, render, SITE_KEY_PLACEHOLDER } = require('../../scripts/build.js');

const PAGES = path.join(__dirname, 'pages');
const TEST_SITE_KEY = 'hs_pk_e2e';

// The snippets as an ally would receive them from MarOS: site_key filled in.
function buildSnippets(collectorUrl, overrides = {}) {
  const config = { ...CONFIG, COLLECTOR_URL: collectorUrl, ...overrides };
  const out = {};
  for (const t of TARGETS.filter((x) => x.html)) {
    out[t.src.replace(/\.js$/, '')] = render(t, config).replace(`'${SITE_KEY_PLACEHOLDER}'`, `'${TEST_SITE_KEY}'`);
  }
  return out;
}

const INCLUDES = {
  // The ally's own tags. They only record the calls they receive.
  'ally-tags': `<script>
  window.__ally = { calls: [] };
  window.fbq = function () { window.__ally.calls.push(['fbq'].concat([].slice.call(arguments))); };
  window.gtag = function () { window.__ally.calls.push(['gtag'].concat([].slice.call(arguments))); };
  fbq('init', 'ALLY_META_PIXEL');
  fbq('track', 'PageView');
  gtag('config', 'G-ALLY');
</script>`,
  // State right before the Hot Sale snippets run.
  snapshot: `<script>
  window.__ally.before = {
    keys: Object.keys(window),
    calls: window.__ally.calls.length,
    dataLayer: window.dataLayer ? JSON.stringify(window.dataLayer) : null
  };
</script>`,
};

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function startServer({ port = 0, listenHost = '127.0.0.1', collectorHost = 'px.hotsale.test', log = false, overrides = {} } = {}) {
  const requests = [];
  let snippets = {};

  function collect(req, res) {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch (e) { /* recorded as raw */ }
      const rec = {
        method: req.method,
        origin: req.headers.origin || null,
        contentType: req.headers['content-type'] || null,
        cookie: req.headers.cookie || null,
        body,
        raw,
      };
      requests.push(rec);
      if (log) console.log(`[collector] ${rec.method} origin=${rec.origin} type=${rec.contentType}\n${JSON.stringify(body, null, 2)}`);
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
    });
  }

  function send(res, status, html) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  }

  const server = http.createServer((req, res) => {
    const hostname = String(req.headers.host || '').split(':')[0];
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/v1/collect') return collect(req, res);
    if (hostname === 'hotsale.com.co') {
      const to = url.searchParams.get('to') || '/';
      return send(res, 200, `<!doctype html><link rel="icon" href="data:,"><title>Hot Sale</title><a id="go" href="${escapeAttr(to)}">Ir a la tienda</a>`);
    }
    const file = path.join(PAGES, path.basename(url.pathname === '/' ? 'landing.html' : url.pathname));
    if (!file.endsWith('.html') || !fs.existsSync(file)) return send(res, 404, 'not found');
    const html = fs.readFileSync(file, 'utf8')
      .replace(/<!-- include:([\w-]+) -->/g, (_, name) => INCLUDES[name])
      .replace(/<!-- pixel:([\w-]+) -->/g, (_, name) => snippets[name]);
    return send(res, 200, html);
  });

  return new Promise((resolve) => {
    server.listen(port, listenHost, () => {
      const actualPort = server.address().port;
      const collectorUrl = `http://${collectorHost}:${actualPort}/v1/collect`;
      snippets = buildSnippets(collectorUrl, overrides);
      resolve({
        port: actualPort,
        collectorUrl,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { startServer, buildSnippets, TEST_SITE_KEY };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8787;
  startServer({ port, collectorHost: 'localhost', log: true }).then((s) => {
    console.log(`Store pages:  http://localhost:${s.port}/landing.html?utm_source=hotsale&hs_test=1`);
    console.log(`Collector:    ${s.collectorUrl}`);
  });
}
