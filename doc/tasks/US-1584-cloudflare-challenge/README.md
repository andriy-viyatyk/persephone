# US-1584: Pass Cloudflare "Verify you are human" challenges

## Status

**Status:** Planned — placeholder, needs investigation before implementation
**Priority:** High
**Epic:** None (standalone)

## Goal

Browser pages pass Cloudflare's managed challenge ("Verify you are human") the way Chrome does:
one checkbox click (or none) gets through, instead of the page reloading with the same checkbox.

## Background (verified 2026-10-01)

- Reproduces on https://www.scrapingcourse.com/cloudflare-challenge in a fresh browser page with
  no agent involvement: clicking the checkbox reloads the page and shows the checkbox again,
  indefinitely. The same sites pass in Chrome/Edge/Firefox on the same machine, usually after the
  first click.
- [US-1582](../US-1582-permission-policy/README.md) (permission policy) removed the all-`granted`
  permission fingerprint; the loop still reproduces after it, so other signals are involved.
- [US-1583](../US-1583-chrome-brand/README.md) (Client Hints brands lack `Google Chrome` while the
  User-Agent string claims Chrome) is a known mismatch and a likely contributor — investigate it
  as part of this task or implement it first.

## Test pages

Challenge pages:

| URL | What it shows | Notes |
|---|---|---|
| https://www.scrapingcourse.com/cloudflare-challenge | Full-page managed challenge, always on | **Reproduces the loop** — primary test |
| https://nopecha.com/demo/cloudflare | Cloudflare challenge demo | Not yet checked in Persephone |
| https://2captcha.com/demo/cloudflare-turnstile | Turnstile widget demo | Check whether the live widget renders |
| https://nowsecure.nl | Challenges only browsers it flags | Pass/fail probe, not a guaranteed checkbox |

Fingerprint diagnostics (compare Persephone against Chrome side by side):

| URL | What it shows |
|---|---|
| https://bot.sannysoft.com | WebDriver, `window.chrome`, permissions, plugins, languages, WebGL |
| https://browserscan.net/bot-detection | Bot-detection summary |
| https://abrahamjuliot.github.io/creepjs/ | Detailed fingerprint and lies detection |
| https://pixelscan.net | Fingerprint consistency check |

Cloudflare's Turnstile test sitekeys
(https://developers.cloudflare.com/turnstile/troubleshooting/testing) force a visible challenge,
but they pass or fail by design regardless of the browser, so they are useful only for checking
that the widget renders, not for this investigation.

## Pre-investigation findings (2026-10-01, live page in Persephone, default profile)

Probed with `WebFrameMain.executeJavaScript` from the main process (no CDP attached) in the top
frame and in the Turnstile iframe, plus the page's network log.

- **The clearance cookie is issued but rejected.** The reloaded page already sends `cf_clearance`
  (and `cf_chl_rc_ni`, Cloudflare's retry counter, was 4) and is challenged again. So the
  challenge "completes" and the server then refuses the result — a fingerprint verdict, not a
  cookie-storage problem.
- **`window.chrome` differs between frames.** Top frame: the US-813 polyfill
  (`src/preload-webview.ts:16-60`) adds `loadTimes`/`csi`/`app`, but
  `Function.prototype.toString(chrome.loadTimes)` returns the arrow-function source instead of
  `function loadTimes() { [native code] }` — a classic tampering tell. Turnstile iframe
  (`challenges.cloudflare.com`): `window.chrome` is an empty `{}` because the webview preload runs
  only in the main frame. Turnstile runs in that iframe, so it sees a bare Electron `chrome`
  object while the User-Agent claims Chrome. Strongest suspect.
- **Brands lack `Google Chrome`** in both frames, also in `getHighEntropyValues().fullVersionList`
  (US-1583).
- **Permission states read `denied`, not `prompt`.** After US-1582, `Notification.permission` and
  `permissions.query` for notifications/geolocation return `denied` on a never-visited site:
  Electron maps a `false` from the permission check handler to `denied`; it has no "prompt"
  result. Real Chrome reports `default`/`prompt`. (Before US-1582 everything read `granted`.)
- **Persephone global in the page's main world:** `window.__aiVisionHostSignal` is visible to page
  scripts (top frame only).
- Consistent with Chrome (not suspects): `navigator.webdriver` false, 5 plugins / 2 mimeTypes,
  `pdfViewerEnabled` true, no `process`/`require`, WebGL ANGLE/Intel, platformVersion 19.0.0.
- The one failed request, `brunhild.challenges.cloudflare.com` → `ERR_NAME_NOT_RESOLVED`, is an
  IPv6-only probe host (AAAA records only); it fails the same way for every browser on this
  machine and is not a cause.

Suggested experiment order: (1) make `window.chrome` identical in every frame and native-looking
(or drop the polyfill and re-test Google sign-in), (2) Chrome brands (US-1583), (3) remove the
main-world `__aiVisionHostSignal` global, (4) permission states reading `prompt`.

Also carried from US-1582: verify at runtime whether a cross-origin iframe without an `allow`
attribute can reach the permission request handler; if it can, deny cross-origin subframe Ask
requests (see the US-1582 Phase 2 note).

## Scope to investigate

1. Diff Persephone against Chrome on the diagnostics pages above; list every mismatch
   (User-Agent vs Client Hints brands, `window.chrome` shape, `navigator.plugins`/`mimeTypes`,
   `navigator.webdriver`, languages, WebGL vendor/renderer, permissions, screen/window metrics).
2. What the challenge does on the failing click: watch the network log for the
   `challenges.cloudflare.com` requests and the `cf_clearance` cookie — is the cookie never set,
   set but not sent, or set and rejected? Check third-party cookie / storage partitioning for the
   challenge iframe, and whether `onBeforeSendHeaders` handling (`src/main/network-logger.ts`) or
   the cleaned User-Agent changes anything between the iframe and the page.
3. Persephone-specific injections into browser pages (preloads, `ai-vision`, automation/CDP
   attachment in `cdp-service.ts`, context-menu or input hooks) that a bot check could detect, and
   whether they run on a page no agent touched.
4. Electron/Castlabs differences that cannot be changed, so the fix targets the ones that can.

## Acceptance criteria (draft)

- [ ] https://www.scrapingcourse.com/cloudflare-challenge passes in a normal profile after at
      most one click.
- [ ] The other challenge pages above behave as in Chrome.
- [ ] No regression in Google / Microsoft (US-1581) sign-in or Widevine playback.
