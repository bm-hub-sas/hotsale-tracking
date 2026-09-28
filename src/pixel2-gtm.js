// Pixel 2 — conversion for GTM or plain HTML. ES5. Runs on the order
// confirmation ("thank you") page only.
// Source of truth: scripts/build.js inlines the libs and the config and writes
// dist/pixel2-gtm-confirmacion.html, which is what allies paste.
//
// What it does, and nothing else:
//   1. Reads the Hot Sale touch stored by Pixel 1. None, or older than
//      CONFIG.maxTouchAgeDays -> stop (an expired touch is deleted).
//   2. Reads order id, value and currency from window.hotsaleOrder or the
//      dataLayer (lib/extract-order.js). Nothing about the buyer is read.
//   3. Sends one "purchase" request to the collector, complete or not; the
//      collector applies the attribution rules.
//   4. Order with an id (complete or not) -> deletes the touch: one touch,
//      one order. No order id -> keeps it, so a reload with full order data
//      can still report.
// Does not push to the dataLayer, does not call or load any other tag.
(function () {
  'use strict';

  var SITE_KEY = 'REEMPLAZAR_SITE_KEY';
  /* @config */

  /* @inline lib/classify.js */
  /* @inline lib/extract-order.js */
  /* @inline lib/touch.js */
  /* @inline lib/browser.js */

  function forgetTouch() {
    storageRemove('sessionStorage', TOUCH_KEY);
    storageRemove('localStorage', TOUCH_KEY);
  }

  try {
    var now = new Date().getTime();
    var touch = latestTouch(
      parseTouch(storageGet('sessionStorage', TOUCH_KEY)),
      parseTouch(storageGet('localStorage', TOUCH_KEY))
    );
    if (!touch) return;
    if (isExpired(touch, now, CONFIG.maxTouchAgeDays)) {
      forgetTouch();
      return;
    }

    var order = extractOrder(window.dataLayer, window.hotsaleOrder);
    var sentKey = SENT_KEY_PREFIX + order.order_id;
    if (!shouldSend(storageGet('sessionStorage', sentKey), order.order_status)) return;
    storageSet('sessionStorage', sentKey, order.order_status);

    var isTest = touch.is_test === true || readParams(location.search, ['hs_test']).hs_test === '1';
    send(CONFIG.collectorUrl, purchasePayload(touch, order, location.hostname, now, isTest, SITE_KEY, CONFIG));

    if (order.order_id) forgetTouch();
  } catch (e) {}
})();
