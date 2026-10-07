🌐 [Español](README.md) · **English** · [Português](README.pt.md)

# Hot Sale pixel for partner stores

This repository contains the pixel that measures the sales partner stores receive from [hotsale.com.co](https://hotsale.com.co), the event run by the Colombian Chamber of Electronic Commerce (CCCE). The pixel has two parts. **Capture** recognizes, on your store, a visit that arrives from Hot Sale and saves it in the visitor's browser. **Conversion** reports the order number, value and currency on the purchase confirmation page. Each report is a single request to a single server. You paste the code from [`Pixels/`](Pixels/), which can be verified with SHA-256.

**Current version: 2.0.1** (Hot Sale, October 19–23, 2026). The March 2026 version is kept under the tag [`v1.0.0-marzo2026`](https://github.com/bm-hub-sas/hotsale-tracking/tree/v1.0.0-marzo2026). Changes between versions are in [CHANGELOG.md](CHANGELOG.md).

> The installation guides in [`docs/`](docs/) are currently available in Spanish only.

---


## 1. Installation

The code is the same for every store: it is the files in [`Pixels/`](Pixels/). If you have the March 2026 version installed (tags named "Hotsale UTM Capture" and "Hotsale Conversion Pixel", or code in `theme.liquid`), **remove it before** installing this one.

| Platform | What you install | Guide |
|---|---|---|
| Shopify | A single custom pixel in *Customer events*. Nothing in `theme.liquid` | [docs/instalacion-shopify.md](docs/instalacion-shopify.md) |
| Google Tag Manager (any platform) | Pixel 1 on all pages and Pixel 2 on the confirmation page | [docs/instalacion-gtm.md](docs/instalacion-gtm.md) |
| VTEX | Through GTM | [docs/instalacion-vtex.md](docs/instalacion-vtex.md) |
| WooCommerce | Through GTM or `functions.php` | [docs/instalacion-woocommerce.md](docs/instalacion-woocommerce.md) |
| Another platform, without GTM | Pixel 1 in the main template and Pixel 2 on the confirmation page | [docs/instalacion-gtm.md#sin-gtm](docs/instalacion-gtm.md#sin-gtm) |

**Video tutorials:** there is one for Google Tag Manager and one for Shopify [at this link](https://hi.switchy.io/tutopixelhot).

**If your site uses a Content-Security-Policy**, add `https://script.google.com` and `https://script.googleusercontent.com` to `connect-src`. If you don't, the browser blocks the report.

## 2. How to verify the installation

Visit your store with `?utm_source=hotsale&hs_test=1`, make a test purchase, and check the two requests to `script.google.com` in the browser's developer tools. Test reports do not count in the reports. The step-by-step guide is in [docs/pruebas.md](docs/pruebas.md) (in Spanish).

### What data is sent

**No personal data of the buyer is sent.** The pixel does not read name, email, phone, address, ID number or cart contents. From the confirmation page it only reads the order number, value and currency.

The pixel makes two kinds of reports:

- `touch`: a visitor arrived from Hot Sale. If the same link (same UTMs) repeats within 30 minutes, in the same tab or another, it is not sent again: reloading the page or opening the link twice counts as a single arrival.
- `purchase`: that visitor completed a purchase.

| Field | Example | What it is | In `touch` | In `purchase` |
|---|---|---|:-:|:-:|
| `event` | `"purchase"` | `touch` or `purchase` | ✓ | ✓ |
| `store_domain` | `"tienda.com"` | Domain of the page where the pixel runs | ✓ | ✓ |
| `order_id` | `"12345"` | Order identifier exposed by your page. On Shopify it is the order's internal ID, not the `#1001` number. Empty if your page does not expose it | | ✓ |
| `order_value` | `250000` | Order value. It is `0` if missing or ambiguous | | ✓ |
| `order_value_raw` | `"250000"` | The value exactly as your page exposes it, uninterpreted | | ✓ |
| `currency` | `"COP"` | Three-letter code of the order currency. Empty if your page does not expose it | | ✓ |
| `order_status` | `"complete"` | `complete` if there is an order number and a value greater than 0; otherwise `incomplete` | | ✓ |
| `value_source` | `"ecommerce.value"` | Where the value was read from | | ✓ |
| `signal` | `"referrer+utm"` | Why the visit counts as coming from Hot Sale (see §4) | ✓ | ✓ |
| `landed_at` | `"2026-10-19T14:03:22.000Z"` | Time of arrival from Hot Sale, per the browser clock, in UTC | ✓ | ✓ |
| `sent_at` | `"2026-10-19T14:21:05.000Z"` | Time of the report | ✓ | ✓ |
| `is_test` | `false` | `true` if the URL had `hs_test=1` (see [tests](docs/pruebas.md)) | ✓ | ✓ |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id` | `"hotsale"` | UTM parameters of the arrival URL, up to 200 characters each | ✓ | ✓ |

This is a complete `purchase` report:

```json
{
  "event": "purchase",
  "store_domain": "tienda.com", "order_id": "12345", "order_value": 250000, "order_value_raw": "250000",
  "currency": "COP", "order_status": "complete", "value_source": "ecommerce.value",
  "signal": "referrer+utm", "landed_at": "2026-10-19T14:03:22.000Z", "sent_at": "2026-10-19T14:21:05.000Z",
  "is_test": false, "utm_source": "hotsale", "utm_medium": "referral", "utm_campaign": "hs26oct",
  "utm_content": "", "utm_term": "", "utm_id": ""
}
```

### What is stored in the visitor's browser

The pixel does not use cookies. It only uses these keys:

| Key | Where | Contents | When it is deleted |
|---|---|---|---|
| `hotsale_touch_v2` | `localStorage` and `sessionStorage` | `v`, `landed_at`, `signal`, `store_domain`, `is_test` and the UTMs | After reporting an order with a number, whether complete or not. Also on the next visit to your store if it is older than 30 days, if it is corrupted, or if its date is more than one day in the future. The `sessionStorage` copy is deleted when the tab is closed |
| `hotsale_sent_<order number>` | `sessionStorage` | `complete` or `incomplete`. Prevents sending the same order twice. If the order has no number, the key is `hotsale_sent_` | When the tab is closed |

The pixel also deletes the `hotsale_data` key that the March 2026 version left behind.

## 3. Where the data goes

- **Single destination:** a Google Apps Script web app (`https://script.google.com/macros/s/…/exec`). It is the only server the pixel connects to.
- **Where it is stored:** in a private Google spreadsheet owned by UpSell/BM-Hub, which operates the measurement on behalf of the CCCE. The spreadsheet is not shared; reports are built in Looker Studio.
- **Retention:** 6 months.
- **Who can see it:** you (your store's report), the CCCE and UpSell/BM-Hub.
- **IP and browser:** Google receives the connection, as with any web service, but the script has no access to the IP or the request headers. It only receives the contents of the report.
- **What the collector rejects:** reports from domains that do not belong to a registered partner, with a format different from this version's, larger than 8 KB, or more than 120 per minute from the same store. Suspicious orders are flagged for review.
- **Format:** the request is a `POST` with a `text/plain` body (JSON). It does not trigger a CORS preflight.

## 4. Attribution rule

A visit to your store counts as a **Hot Sale touch** if at least one of these conditions is met:

- **A — referrer:** the previous page (`document.referrer`) is exactly one of these domains: `hotsale.com.co`, `www.hotsale.com.co`, `hotsale.co` or `www.hotsale.co`.
- **B — Hot Sale link:** the URL's `utm_source` parameter is exactly `hotsale`. It is case-insensitive and ignores leading and trailing spaces.
- **C — keyword:** any UTM parameter (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` or `utm_id`) contains one of the keywords from previous editions, case-insensitive. For example, `utm_campaign=hotsale_newsletter` counts because it contains `hotsale`. The list is: `hotsale`, `hot_sale`, `hot-sale`, `hot.sale`, `hotsale2026`, `hotsale_2026`, `hotsale-2026`, `hs2026`, `hs_2026`, `hs-2026`, `hotsale_mar`, `hotsale_marzo`, `hotsalemarzo`, `hotsale_oct`, `hotsale_octubre`, `hotsaleoct`, `hotsaleco`, `hotsale_co`, `hotsalecolombia`, `ccce`, `ccceco`, `ccce2026`, `hotsael`, `hotslae`, `hotsalee` and `epsilon`.

The domains in A are matched exactly: a subdomain such as `blog.hotsale.com.co` does not count. UTMs are stored decoded, without leading or trailing spaces, and with a maximum of 200 characters. If a parameter is repeated in the URL, the first one counts.

The `signal` field indicates which condition was met:

- `referrer+utm`: A, and also B or C;
- `referrer_only`: A only;
- `utm_only`: B, without A;
- `keyword_only`: C only.

This lets the report separate sales from the partner's own campaigns for the event (`keyword_only`, for example `utm_campaign=hotsale_oct` in your own newsletter) from those that arrive from the Hot Sale platform.

**Model: last Hot Sale touch.**

- A new Hot Sale touch replaces the previous one. Following the same link again within 30 minutes is not a new touch.
- A visit that is not from Hot Sale (Google, your own campaigns, direct traffic) does **not** delete the touch.
- Each touch is tied to a single order. After reporting an order with a number, whether complete or not, the touch is deleted.
- The pixel does not report purchases whose touch is older than 30 days.
- **Event window:** the report counts purchases up to 15 days after the event closes. The event runs from October 19 to 23, 2026, with an extension on October 24 and 25.
- Reports with `is_test: true` do not count in the reports.

> **For your marketing team:** in your own campaigns for the event, include `hotsale` in some UTM (for example, `utm_campaign=hotsale_oct`). That way those sales also count as Hot Sale sales.

**What this model does not claim:**

- Purchases made on another device or browser, because the touch is stored in the browser.
- Visits with no Hot Sale referrer and no Hot Sale UTM. For example, someone who saw Hot Sale and then typed your URL or searched for you on Google.
- Purchases made after the event window.
- A second order from the same visitor without a new arrival from Hot Sale.
- Purchases in browsers that block or clear storage, such as private mode or Safari when it clears a site's storage after 7 days without visits.

## 5. What the pixel does NOT do

- It does not read or write cookies.
- It does not load third-party scripts: no Google Analytics, no Meta, nothing else. The only code that runs is the code you paste.
- It does not send events to your GA4 or your Meta pixel, does not call your `gtag` or `fbq` functions, and does not add anything to your `dataLayer`.
- It does not modify the page: it does not create elements or insert HTML.
- In GTM/HTML it creates no global variables, registers no listeners and uses no timers. In Shopify it only uses Shopify's pixel API (`analytics.subscribe`, `browser.localStorage`, `browser.sessionStorage`, `browser.sendBeacon`) and `fetch` as a fallback for sending.
- It does not read buyer or cart data.
- It makes a single request per report, always to the same URL.

These claims are checked automatically before each version is published: the build fails if a snippet contains calls to `fbq`, `gtag`, cookies, `dataLayer.push`, timers, listeners, URLs other than the collector, or names of personal data; and Chromium tests on pages with a fake Meta pixel and a fake `gtag` confirm that those functions receive no calls, no global variables appear, the `dataLayer` does not change, and there are no requests other than the one to the collector.

## 6. How to uninstall

- **GTM:** pause or delete the two tags and publish the container.
- **Shopify:** in *Settings → Customer events*, disconnect or delete the "Hot Sale" pixel.
- **Other platforms:** remove the two code blocks.

Any keys left in your visitors' browsers (§2) are no longer read or sent anywhere.

## 7. Versions and verification

- Each snippet states its version on the first line and in `CONFIG.pixelVersion`. Each report includes `pixel_version`.
- The code lives on your site: it is not downloaded from any server, so it does not change unless you paste a new version.
- All partners receive exactly the same files. [`Pixels/SHA256SUMS.txt`](Pixels/SHA256SUMS.txt) has the SHA-256 of each one.

To verify the file you received, compute its SHA-256 and compare it with `Pixels/SHA256SUMS.txt`:

```sh
shasum -a 256 pixel2-gtm-confirmacion.html                          # macOS / Linux
cd Pixels && shasum -a 256 -c SHA256SUMS.txt                          # all of them, in a copy of the repository
```

```powershell
Get-FileHash .\pixel2-gtm-confirmacion.html -Algorithm SHA256        # Windows
```

## 8. Contact

- Implementation and questions: sergio@upsellmarketing.co
- Vulnerabilities: see [SECURITY.md](SECURITY.md)

---

License: [MIT](LICENSE).
