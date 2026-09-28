// Pixel 1 — capture. ES5, safe for GTM Custom HTML. Runs on every page.
// Source of truth: scripts/build.js inlines the libs and the config and writes
// dist/pixel1-todas-las-paginas.html, which is what allies paste.
//
// What it does, and nothing else:
//   1. Removes the v1 key "hotsale_data" if an old install left it behind, and
//      a stored touch older than CONFIG.maxTouchAgeDays.
//   2. Classifies the visit (lib/classify.js). Not a Hot Sale touch -> stop.
//   3. Stores the touch under "hotsale_touch_v2" in sessionStorage and
//      localStorage, and reports it once per session with event "touch".
// No listeners, no timers, no DOM changes, no cookies.
(function () {
  'use strict';

  var SITE_KEY = 'REEMPLAZAR_SITE_KEY';
  /* @config */

  /* @inline lib/classify.js */
  /* @inline lib/touch.js */
  /* @inline lib/browser.js */

  // Deletes a stored touch that is expired or unreadable, so no touch is
  // kept longer than CONFIG.maxTouchAgeDays past the visitor's next page view.
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

    // Same touch already recorded in this session (e.g. a reload of the
    // landing page): keep the original landed_at and do not report again.
    if (sameTouch(parseTouch(storageGet('sessionStorage', TOUCH_KEY)), touch)) return;

    // A new Hot Sale touch replaces the previous one. Visits that are not
    // Hot Sale touches never reach this point, so they never clear it.
    var json = JSON.stringify(touch);
    storageSet('sessionStorage', TOUCH_KEY, json);
    storageSet('localStorage', TOUCH_KEY, json);

    send(CONFIG.collectorUrl, touchPayload(touch, location.hostname, now, SITE_KEY, CONFIG));
  } catch (e) {}
})();
