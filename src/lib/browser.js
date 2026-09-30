// Acceso al almacenamiento y transporte de los snippets de GTM/HTML. Todas las
// funciones ignoran los errores: el almacenamiento puede estar bloqueado (modo
// privado, configuración de privacidad estricta) y el píxel nunca debe dañar
// la página.

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

// La única petición de red que hace el píxel. El cuerpo es un texto, así que
// los dos caminos envían Content-Type text/plain;charset=UTF-8: una petición
// CORS "simple", sin preflight. La alternativa con fetch no envía credenciales.
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
