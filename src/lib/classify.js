// @strip-start
// Pure, ES5. Inlined into every snippet by scripts/build.js; the strip blocks are
// removed. Also loaded by the unit tests through module.exports.
// @strip-end
// Decides whether a page view is a Hot Sale touch.
//
// Rule (README, "Regla de atribución"):
//   A: the referrer hostname is exactly one of cfg.referrerDomains, or
//   B: utm_source, trimmed and lower-cased, is exactly one of cfg.hsSources.
// No substring matching, no keyword lists, no other UTM field is inspected.

var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
var MAX_FIELD_LENGTH = 200;

function clip(value, max) {
  var s = value == null ? '' : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function decodeParam(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch (e) {
    return s;
  }
}

// Returns the first value of each wanted key found in the query string of
// `url` (a full URL or just "?a=b"). Only wanted keys are read.
function readParams(url, wanted) {
  var out = {};
  var s = String(url || '');
  var hash = s.indexOf('#');
  if (hash !== -1) s = s.slice(0, hash);
  var q = s.indexOf('?');
  if (q === -1) return out;
  s = s.slice(q + 1);
  var pairs = s.split('&');
  for (var i = 0; i < pairs.length; i++) {
    if (!pairs[i]) continue;
    var eq = pairs[i].indexOf('=');
    var key = decodeParam(eq === -1 ? pairs[i] : pairs[i].slice(0, eq));
    var val = eq === -1 ? '' : decodeParam(pairs[i].slice(eq + 1));
    for (var k = 0; k < wanted.length; k++) {
      if (wanted[k] === key && !Object.prototype.hasOwnProperty.call(out, key)) out[key] = val;
    }
  }
  return out;
}

// Hostname of an absolute URL, lower-cased, without userinfo, port or trailing
// dot. "" if the string is not an absolute URL.
function hostOf(url) {
  var m = /^[a-z][a-z0-9+.\-]*:\/\/([^\/?#]*)/i.exec(String(url || ''));
  if (!m) return '';
  var authority = m[1];
  var at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  return authority.replace(/:\d*$/, '').replace(/\.$/, '').toLowerCase();
}

function inList(value, list) {
  if (!value) return false;
  for (var i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

// classify(url, referrer, cfg) -> { isHotsale, signal, utms, isTest }
//   signal: 'referrer+utm' | 'referrer_only' | 'utm_only' | ''
function classify(url, referrer, cfg) {
  var params = readParams(url, UTM_KEYS.concat(['hs_test']));
  var utms = {};
  for (var i = 0; i < UTM_KEYS.length; i++) {
    utms[UTM_KEYS[i]] = clip(String(params[UTM_KEYS[i]] || '').replace(/^\s+/, ''), MAX_FIELD_LENGTH).replace(/\s+$/, '');
  }
  var byReferrer = inList(hostOf(referrer), cfg.referrerDomains);
  var bySource = inList(utms.utm_source.toLowerCase(), cfg.hsSources);
  var signal = byReferrer && bySource ? 'referrer+utm'
    : byReferrer ? 'referrer_only'
    : bySource ? 'utm_only'
    : '';
  return { isHotsale: signal !== '', signal: signal, utms: utms, isTest: params.hs_test === '1' };
}

// @strip-start
module.exports = { classify: classify, readParams: readParams, hostOf: hostOf, clip: clip, UTM_KEYS: UTM_KEYS };
// @strip-end
