// Pixel 1 — captura. ES5, apto para HTML personalizado de GTM. Se ejecuta en
// todas las páginas.
// Fuente: scripts/build.js incluye las librerías y la configuración y escribe
// dist/pixel1-todas-las-paginas.html, que es lo que pegan los aliados.
//
// Qué hace, y nada más:
//   1. Borra la clave de la v1, "hotsale_data", si una instalación anterior la
//      dejó, y un toque guardado de más de CONFIG.maxTouchAgeDays días.
//   2. Clasifica la visita (lib/classify.js). Si no es un toque de Hot Sale, se detiene.
//   3. Guarda el toque con la clave "hotsale_touch_v2" en sessionStorage y en
//      localStorage y lo reporta con el evento "touch", salvo que repita el
//      toque guardado en los últimos 30 minutos (lib/touch.js, isRepeat).
// Sin listeners, sin temporizadores, sin cambios en el DOM y sin cookies.
(function () {
  'use strict';

  /* @config */

  /* @inline lib/classify.js */
  /* @inline lib/touch.js */
  /* @inline lib/browser.js */

  // Borra un toque guardado que esté vencido o dañado, para que ningún toque
  // se conserve más de CONFIG.maxTouchAgeDays días después de la siguiente
  // página que vea el visitante.
  function dropStale(area, now) {
    var raw = storageGet(area, TOUCH_KEY);
    if (!raw) return;
    var stored = parseTouch(raw);
    if (!stored || isExpired(stored, now, CONFIG.maxTouchAgeDays)) storageRemove(area, TOUCH_KEY);
  }

  try {
    var now = new Date().getTime();
    storageRemove('localStorage', 'hotsale_data');
    storageRemove('sessionStorage', 'hotsale_data');
    dropStale('localStorage', now);
    dropStale('sessionStorage', now);

    var hit = classify(location.search, document.referrer, CONFIG);
    if (!hit.isHotsale) return;

    var touch = buildTouch(hit, now, location.hostname);

    // El mismo toque registrado hace menos de 30 minutos (una recarga, o el
    // mismo enlace en otra pestaña): se conserva el landed_at original y no se
    // reporta de nuevo.
    var stored = latestTouch(
      parseTouch(storageGet('sessionStorage', TOUCH_KEY)),
      parseTouch(storageGet('localStorage', TOUCH_KEY))
    );
    if (isRepeat(stored, touch, now)) return;

    // Un toque nuevo de Hot Sale reemplaza al anterior. Las visitas que no son
    // toques de Hot Sale nunca llegan aquí, así que nunca lo borran.
    var json = JSON.stringify(touch);
    storageSet('sessionStorage', TOUCH_KEY, json);
    storageSet('localStorage', TOUCH_KEY, json);

    send(CONFIG.collectorUrl, touchPayload(touch, location.hostname, now, CONFIG));
  } catch (e) {}
})();
