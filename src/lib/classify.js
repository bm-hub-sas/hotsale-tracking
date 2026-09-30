// @strip-start
// Función pura, ES5. scripts/build.js la incluye en cada snippet y quita los
// bloques strip. Las pruebas unitarias también la cargan con module.exports.
// @strip-end
// Decide si una visita es un toque de Hot Sale.
//
// Regla (README, "Regla de atribución"):
//   A: el dominio del referrer es exactamente uno de cfg.referrerDomains, o
//   B: utm_source, sin espacios y en minúsculas, es exactamente uno de
//      cfg.hsSources, o
//   C: algún valor de UTM, en minúsculas, CONTIENE una de cfg.hsKeywords (la
//      lista de palabras clave de ediciones anteriores).
// signal indica qué coincidió: 'referrer+utm' (A con B o C), 'referrer_only'
// (A), 'utm_only' (B sin A), 'keyword_only' (solo C).

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

// Devuelve el primer valor de cada clave pedida que aparece en la cadena de
// consulta de `url` (una URL completa o solo "?a=b"). Solo se leen las claves
// pedidas.
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

// Dominio de una URL absoluta, en minúsculas, sin usuario, puerto ni punto
// final. "" si el texto no es una URL absoluta.
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

// Verdadero si algún valor de UTM contiene una de las palabras clave (ambos en minúsculas).
function hasKeyword(utms, keywords) {
  if (!keywords) return false;
  for (var i = 0; i < UTM_KEYS.length; i++) {
    var value = utms[UTM_KEYS[i]].toLowerCase();
    if (!value) continue;
    for (var k = 0; k < keywords.length; k++) {
      if (keywords[k] && value.indexOf(keywords[k]) !== -1) return true;
    }
  }
  return false;
}

// classify(url, referrer, cfg) -> { isHotsale, signal, utms, isTest }
//   signal: 'referrer+utm' | 'referrer_only' | 'utm_only' | 'keyword_only' | ''
function classify(url, referrer, cfg) {
  var params = readParams(url, UTM_KEYS.concat(['hs_test']));
  var utms = {};
  for (var i = 0; i < UTM_KEYS.length; i++) {
    utms[UTM_KEYS[i]] = clip(String(params[UTM_KEYS[i]] || '').replace(/^\s+/, ''), MAX_FIELD_LENGTH).replace(/\s+$/, '');
  }
  var byReferrer = inList(hostOf(referrer), cfg.referrerDomains);
  var bySource = inList(utms.utm_source.toLowerCase(), cfg.hsSources);
  var byKeyword = !bySource && hasKeyword(utms, cfg.hsKeywords);
  var signal = byReferrer && (bySource || byKeyword) ? 'referrer+utm'
    : byReferrer ? 'referrer_only'
    : bySource ? 'utm_only'
    : byKeyword ? 'keyword_only'
    : '';
  return { isHotsale: signal !== '', signal: signal, utms: utms, isTest: params.hs_test === '1' };
}

// @strip-start
module.exports = { classify: classify, readParams: readParams, hostOf: hostOf, clip: clip, hasKeyword: hasKeyword, UTM_KEYS: UTM_KEYS };
// @strip-end
