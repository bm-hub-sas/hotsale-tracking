// Storage access and transport for the GTM/HTML snippets. Every function
// swallows errors: storage can be blocked (private mode, strict privacy
// settings) and the pixel must never break the page.

function storageGet(area, key) {
  try {
    return window[area].getItem(key);
  } catch (e) {
    return null;
  }
}

function storageSet(area, key, value) {
  try {
    window[area].setItem(key, value);
  } catch (e) {}
}

function storageRemove(area, key) {
  try {
    window[area].removeItem(key);
  } catch (e) {}
}

// The only network request the pixel makes. The body is a string, so both
// paths send Content-Type text/plain;charset=UTF-8: a CORS "simple" request,
// no preflight. The fetch fallback sends no credentials.
function send(url, payload) {
  var body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
  } catch (e) {}
  try {
    if (window.fetch) {
      window.fetch(url, { method: 'POST', body: body, keepalive: true, credentials: 'omit' }).then(null, function () {});
    }
  } catch (e) {}
}
