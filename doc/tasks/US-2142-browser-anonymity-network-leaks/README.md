# US-2142: Browser — anonymity / proxy network leaks

**Status:** Completed (2026-11-21) — planned, implemented and completed by Claude in one authorized
run. Found by the 2026-11-21 browser security review. **#1, #2, #3, #6 reproduced on 5.0.20 with
harmless in-app signals; #4, #5 code-confirmed** (see "Runtime reproduction"); all six fixed and
verified on an owned dev instance (see "Verification").
**Severity:** High for Tor/proxied-profile users; the whole point of Tor mode is defeated by any one
of these.
**Evidence branch:** `upcoming-v5.0.21` @ `4656a6cb`; plan re-verified on `26ad3cf4` (after US-2140
and US-2141).

## Goal

Apply a Tor or proxied page's network policy to every path that can carry its traffic — host-drawn
images, popups, the session after close, TLS client certificates, the site-extension fetch broker
and the favicon cache — so no page-chosen request leaves over the real network or a local share.
The six sub-fixes are grouped because they share the "apply the session's network policy to
*every* path, not just the webview" theme.

## Confirmed by code review

1. **Page favicon `file://host/…` loaded by the host renderer.** The preload reports any
   `<link rel=icon>` href unchecked (`src/preload-webview/page-reporters.ts:6-15`); the tab strip
   renders it as an `<img>` (`BrowserTabsPanel.ts:53, 76-85`); `routed-src.ts:61,79` passes `file://`
   through unrouted even for Tor (`LOCAL_SRC_RE`); the host window has a `file:` origin with
   `webSecurity:false` (`open-window.ts:116,329`) and no `img-src` CSP (`index.html:7`). A `file://host`
   favicon therefore makes the host open an SMB/WebDAV connection from the real IP (de-anonymizing
   Tor, and leaking the NTLM challenge on Windows). Same sink for clicked images
   (`page-reporters.ts:136-157`) and web Markdown opened in-app (`markdown-sanitize.ts:15-21` allows
   `file` in `src`).
2. **WebRTC policy applied to webview only.** `browser-network-service.ts:165-177` sets
   `disable_non_proxied_udp` only when `contents.getType() === "webview"`. A **popup** of a Tor page
   is a `BrowserWindow` (type `window`) in the same session with the default policy
   (`BrowserGuest.ts:160-171`, `popup-policy.ts:57-104` set no policy), so `RTCPeerConnection` leaks
   the real public IP via STUN.
3. **Tor session set to `direct://` on page close.** `BrowserTorModel.ts:96-106,144-150` →
   `tor-service.ts:147-153` → `setSessionDirect` (`session-proxy.ts:35-38`,
   `tor-service.ts:422-428`). The in-memory `Session` lives on with a DIRECT proxy, so a service
   worker, keepalive `fetch` or `sendBeacon` still running after close leaks the real IP. *(Verified
   the `setProxy({mode:"direct"})` call.)*
4. **Auto TLS client-certificate selection.** `main-setup.ts:27-32` only `preventDefault()`s when
   `webContents === null`; for a guest Electron auto-selects `list[0]`. Any HTTPS site requesting a
   client cert with an empty CA list silently receives the user's first personal/smart-card cert,
   in every session including Tor/incognito — a strong cross-profile and cross-Tor identifier.
   *(Verified the handler.)*
5. **Site-extension fetch broker skips the profile proxy.** `site-extension-fetch-service.ts:32`
   uses Node global `fetch` in main, not `session.fromPartition(partition).fetch`, so a proxied
   (non-incognito) profile's route is ignored; and the page itself can call the CDP binding that
   drives it (`BrowserSiteExtensionController.ts:627-651`), revealing the real IP to `fetchHosts`.
6. **Favicon cache makes Node HTTP GETs to page-chosen URLs.** `favicon-cache.ts:208-218` runs
   `protocol.get(url)` (following redirects to any host) for bookmarked hosts
   (`BrowserTabsModel.ts:58-63`) — an SSRF-shaped GET to loopback/intranet from the host process
   (no response read by the page).

## Runtime reproduction (5.0.20, 2026-11-21)

Owned test instance (`--profile sec-2142`), loopback fixtures only, Tor via the local `tnet.exe`.

| # | Result | Evidence |
|---|---|---|
| 1 favicon `file:` | **Reproduces** | A page's `<link rel=icon href="file:///…/icon.png">` became the host tab-strip `<img src="file:///…/icon.png">`, loaded (`complete`, `naturalWidth` 1), in a normal **and** a Tor tab; the Tor tab model's favicon was the raw `file:` URL. That a `file://host/…` path would make Windows open SMB/WebDAV is inferred, not run. |
| 2 WebRTC in popup | **Reproduces (policy gap)** | Tor tab: 0 ICE candidates, webview policy `disable_non_proxied_udp`. Its popup (`type:"window"`): policy `default`, 1 host candidate (mDNS `.local`), while `resolveProxy` shows it on the same Tor session (`SOCKS5 127.0.0.1:9052`). No STUN used, so no `srflx` observed — with a STUN server the popup would gather one. |
| 3 Tor → direct on close | **Reproduces** | `resolveProxy('http://probe.invalid/')` on the Tor session: `SOCKS5 127.0.0.1:9052` while open, `DIRECT` ~3 s after close (same in-memory `Session`; no traffic sent). Note for retesting: loopback URLs always resolve `DIRECT`, so probe with a non-loopback host. |
| 4 client cert | **Code-confirmed** | `main-setup.ts:27-32` calls `preventDefault()`/`callback()` only when `webContents === null`; guests fall through to Electron's auto-select. |
| 5 fetch broker | **Code-confirmed** | `site-extension-fetch-service.ts:32` uses global `fetch(url, {redirect:"manual", credentials:"omit"})` in main, not the session's `fetch`. |
| 6 favicon cache GET | **Reproduces** | Starring (bookmarking) the page triggers `saveFavicon`, which sent a GET to the page-chosen favicon URL with no User-Agent and no Accept (Node `http`), and followed a 302 to a second loopback port. Loopback is not refused. The code is in `src/renderer/components/icons/favicon-cache.ts` (host renderer), not main. |

## Background

- **Page-reported image URLs.** The webview preload (`src/preload-webview/page-reporters.ts`) reports
  the favicon href and every clicked `<img>` src unchecked. The host receives them in
  `BrowserWebviewModel.handleGuestMessage` → `BrowserTabsModel.onFavicon` /
  `BrowserBookmarksModel.trackClickedImages`. The tab strip (`BrowserTabsPanel.renderFavicon`) draws
  `BrowserProfileNetworkModel.routeSrc(favicon)`, which calls `resolveRoutedSrc()`
  (`src/renderer/editors/link-editor/routed-src.ts`); its `LOCAL_SRC_RE` passes `file://` through
  unrouted. `LOCAL_SRC_RE` is also what lets the Link editor show a user's own local thumbnails, so it
  must not change — the fix belongs at the page-origin boundary. `discoverImages()` already keeps only
  `http*` URLs.
- **Web Markdown.** A Markdown document opened from a URL has `filePath` = that URL (the HTTP pipe's
  `logicalPath`). `rehypeMarkdownOverrides` rewrites `img` src with `resolveRelatedLink()`, and
  `isSafeMarkdownUrl()` allows `file:` and scheme-less paths (so a UNC path `\\host\share\x.png` too).
- **Shared scheme policy.** US-2140 put the page-URL scheme rules in
  `src/shared/browser-navigation-policy.ts` (main and renderer). The image rule joins it.
- **WebRTC.** `BrowserNetworkService.handleWebContentsCreated` and `setGuestWebRtcPolicy`
  (`src/main/browser-network-service.ts`) skip anything that is not `getType() === "webview"`, so a
  guest popup (a `BrowserWindow` on the same session) keeps the default policy.
- **Tor close.** `TorService.stopForPartition` → `clearProxyForPartition` → `setSessionDirect`
  (`src/main/tor-service.ts`, `src/main/session-proxy.ts`). The in-memory `Session` lives on. A Tor
  page's partition id is a per-instance UUID (`BrowserEditor.torId`), never reused after close — a
  moved or duplicated page gets a new partition — so a closed partition can be retired for good.
- **Client certificates.** `src/main/main-setup.ts` handles `select-client-certificate` only for
  `webContents === null`; any other contents falls through to Electron's default (first
  certificate). `permission-policy-service.ts` already denies device choosers (`denySelection`).
- **Fetch broker.** `src/main/site-extension-fetch-service.ts` uses Node global `fetch`. Its IPC entry
  (`src/ipc/main/site-extension-handlers.ts`) passes `event.sender.id` and the renderer's `fetchKey`
  = `BrowserGuestChannel.key(tabId)` = `${editorId}/${tabId}`, the guest registration key that
  `BrowserGuestRegistry.owned(key, sender)` already validates.
- **Favicon cache.** `src/renderer/components/icons/favicon-cache.ts` (host renderer, strict folder)
  downloads with Node `http(s).get` when there is no route, following one redirect anywhere.
  `src/shared/board-network-guard.ts` already exports `isPrivateAddress()` and `pinnedLookup()`
  (used by `session-src-protocol.ts` and `renderer/api/node-fetch.ts`).

## Implementation plan

### #1 Page images: only `http(s)` and `data:image/` reach the host
- [x] `src/shared/browser-navigation-policy.ts` (owner of page-URL scheme rules): add
  `isWebImageUrl(url)` — true for `http:`/`https:` URLs and `data:image/…`; everything else
  (`file:`, UNC/scheme-less paths, `blob:`, `app-asset:`) false.
- [x] `BrowserTabsModel.onFavicon`: ignore a favicon that is not `isWebImageUrl` (no cache, no tab
  update, no favicon save).
- [x] `BrowserProfileNetworkModel.routeSrc` / `routedFetchUrl`: return `null` for a non-web image URL
  — also covers favicons restored from state saved before the fix.
- [x] `BrowserBookmarksModel.trackClickedImages`: keep only `isWebImageUrl` entries.
- [x] `src/renderer/editors/markdown/rehypeMarkdownOverrides.ts`: for a web document (`filePath` is an
  `http(s)` URL) resolve `img` src against the document URL and drop any src that is not
  `isWebImageUrl`. Local documents keep today's behavior (local and UNC images of a local note are
  legitimate).

### #2 WebRTC policy for every contents of a routed session
- [x] `browser-network-service.ts`: drop the `webview` filter in `handleWebContentsCreated` and
  `setGuestWebRtcPolicy`; the session test alone decides (app and board contents are never on a Tor
  or proxied session). Popups get `disable_non_proxied_udp` at creation, before their first
  navigation.

### #3 A closed Tor partition fails closed
- [x] `tor-service.ts`: `stopForPartition` retires the partition instead of setting it direct:
  re-apply the SOCKS proxy with `applySessionProxy` (also closes pooled connections), then
  `clearStorageData()` + `clearCache()` so no service worker or cache of the closed page survives.
  The partition stays in `proxiedPartitions`, so `isTorSession` keeps answering true for it (WebRTC
  and client-certificate policy). `clearProxyForPartition` and the `setSessionDirect` import leave Tor;
  profile networks keep `setSessionDirect` for an explicit switch to direct.

### #4 No client certificate for private or routed sessions
- [x] New `src/main/client-certificate-policy.ts` (one job): `installClientCertificatePolicy()`
  registers `app.on("select-client-certificate")`. It calls `preventDefault()` + `callback()` (send no
  certificate) when the contents is null or destroyed, or its session is a Tor session
  (`torService.isTorSession`), a proxied profile (`browserNetworkService.isProxiedSession`), or a
  non-persistent session other than the app session (`nopersist`) — Incognito, Tor and other
  in-memory guest sessions. Otherwise Electron's default stays.
- [x] `main-setup.ts`: replace the inline handler with `installClientCertificatePolicy()` (same
  registration point, before `ready`).

### #5 Fetch broker uses the page's session
- [x] `BrowserGuestRegistry.pageSession(key, sender)`: the session of the browser page that owns a tab
  or popup key (`${editorId}/${id}`) when `sender` hosts it (exact `owned()` match first, then any
  live guest of the same editor — all tabs and popups of a page share one partition).
- [x] `site-extension-fetch-service.ts`: take the sender `WebContents`; resolve the session with
  `browserGuests.pageSession`; refuse when there is none; fetch with
  `ses.fetch(url, { method: "GET", redirect: "manual", credentials: "omit", cache: "no-store", signal })`.
  All existing guards (trusted host list per hop, https only, ≤3 redirects, size/time/concurrency
  caps) stay; the cancellation key stays `${sender.id}:${tab}`.
- [x] `src/ipc/main/site-extension-handlers.ts`: pass `event.sender` to the fetch call.

### #6 Favicon cache: no page-steered GET to private addresses
- [x] `favicon-cache.ts` (direct path only; the routed path already goes through the page session):
  `downloadToBuffer(url, pageHost, redirectsLeft)` checks every hop — `http(s)` only, no userinfo,
  resolve once and refuse when any address is private/loopback/link-local (`isPrivateAddress`)
  **unless the hop's host is the page's own host** (a page served from `localhost` or an intranet
  name keeps its favicon; a public page cannot aim the host at the LAN), then connect through
  `pinnedLookup(addresses)` so the checked address is the one used. One redirect, re-checked.
- [x] `saveFavicon` passes its `hostname` (the page host) as `pageHost`.

### Dashboard / completion
- [x] Dashboard entry moved to Active.
- [x] Gates: `npm run typecheck`, `npm run lint`.
- [x] Runtime verification (owned dev instance), review, `/document`, `/userdoc`, dashboard close.

## Concerns / decisions

- **Client-certificate scope (#4).** Denying certificates in *every* session would break sites that
  rely on Windows' certificate auto-selection in the normal profile (smart-card or device-certificate
  sign-in, mTLS intranet APIs) and in the app session (REST client, boards). Persistent, direct
  sessions therefore keep Electron's behavior; Tor, Incognito and proxied profiles never send one.
  An origin-named picker for the normal profile is under **Deferred**.
- **No `img-src` CSP.** The host window legitimately draws local `file:` images (image viewer, Link
  editor thumbnails, cached favicon files, local Markdown), and CSP cannot tell `file:///C:/…` from
  `file://host/…`. Filtering at the page-origin boundary is the precise fix.
- **A retired Tor partition stays on the Tor port.** With the daemon stopped every request fails
  (`ERR_SOCKS_CONNECTION_FAILED`); with another Tor page running, a straggler still goes over Tor —
  never direct. Its storage is cleared, so nothing of the closed page can run later.
- **Favicon same-host exemption.** DNS rebinding of the page's own host could still aim the cache's
  single GET at a private address. The response only lands in the favicon cache (never shown to the
  page), no cookies or credentials are sent, and the page can already request its own host from its
  webview, so this residual is accepted.
- **Fetch broker clients.** The page itself can trigger the broker (the CDP binding is reachable from
  the main world). With the fetch now on the page's own session/proxy and the per-extension
  `fetchHosts` allow-list, that gives the page nothing it could not reach through its own route.
- **Markdown hrefs.** A `file:` link in web Markdown still needs a user click to open; out of scope.
- **Concurrent tasks.** US-2144 edits `page-reporters.ts` (length caps); this task does not touch the
  preload, it filters at the host.

## Deferred

- **Origin-named client-certificate picker for persistent direct profiles.** Options: (a) keep the
  auto-select (current), (b) deny everywhere (breaks certificate sign-in), (c) a prompt bar naming the
  origin with a certificate list and Send / Don't send, remembered per origin for the session.
  Recommendation: (c), built on the prompt bar once US-2143's rework lands.

## Acceptance criteria

- No favicon, clicked-image or web-Markdown path makes the host load a `file:`/UNC URL, and the
  favicon cache refuses a cross-host private/loopback target and re-checks redirects.
- Popups of a Tor/proxied page use the same WebRTC policy as the tab (`disable_non_proxied_udp`).
- A closed Tor page's session never resolves to `DIRECT`.
- Tor, Incognito and proxied sessions never send a client certificate.
- The site-extension fetch broker uses the page's session (Tor/profile proxy applies).
- `npm run typecheck` and `npm run lint` pass.

## Verification

Owned dev instance (`electron .vite/build/main.js --test … --profile sec-fix-2142`), loopback fixture
(127.0.0.1/.2/.3 ports 18142-18144, `::1` 18144), Tor via the local `tnet.exe`. Scripts and logs:
`<scratchpad>/verify-us2142/` (`v.test.mjs`, `v2.test.mjs`, `server.log`, `run1.out`, `run2.out`).
"Before" is the 5.0.20 reproduction above (same signals). 7 tests, all passed.

| # | After the fix | Before (5.0.20) |
|---|---|---|
| 1 favicon / clicked image | Page with `<link rel=icon href="file:///…/icon.png">` and a clicked `<img src="file:///…">`: host DOM has **no** `file:` `<img>` (normal and Tor tab); tab-model favicon `""` (normal, Tor); tracked images = only the `http` thumbnail | host `<img src="file:///…">` loaded in both; Tor model held the raw `file:` URL |
| 1 web Markdown | `doc.md` from loopback opened in the Markdown view: `file:` image has **no src**; relative `rel.png` resolved to `http://127.0.0.1:18142/rel.png`; web image kept | (not run before; `file:` allowed by `isSafeMarkdownUrl`) |
| 2 WebRTC | Tor popup (`type:"window"`): policy `disable_non_proxied_udp`, **0** ICE candidates; Tor tab 0. Normal tab/popup unchanged (`default`, 1 host candidate) | Tor popup `default`, 1 host candidate |
| 3 Tor close | `resolveProxy('http://probe.invalid/')` on the stashed session: `SOCKS5 127.0.0.1:9052` open **and** ~4.5 s after close (daemon stopped) | `DIRECT` after close |
| 4 client cert | Synthetic `select-client-certificate` (empty list) emitted in main at each contents: Tor tab, Tor popup and Incognito tab → `preventDefault` + `callback(undefined)`; normal-profile tab/popup and the app window → untouched (Electron default) | code: only `webContents === null` handled |
| 5 fetch broker | `api.fetchSiteExtensionText(<valid tab key>, untrusted id, …)` → "Fetch host is not trusted" (page session resolved, grant check next); foreign key → "Browser tab is unavailable" | code: global `fetch` |
| 6 favicon cache | Star (bookmark) click: page 127.0.0.2 → favicon 127.0.0.1 (cross-host): **no** UA-less GET; page 127.0.0.1 → same-host `redir.ico` (UA-less GET, allowed) → 302 to `localhost:18144`: **no** UA-less request at the target; page 127.0.0.3 → same-host favicon: UA-less GET arrives (exemption works) | UA-less GET to a page-chosen loopback URL, 302 followed to another port |

**Code-only:** #5 an actual granted `fetchText` going over a Tor/proxied session (needs a trusted
extension and a real HTTPS host on 443 — no third-party hosts allowed); #4 a real TLS server
requesting a certificate (deliberately not built); #1 a real `file://host/…` (UNC) favicon (no
UNC/SMB used — the scheme filter is proven with a local `file:` URL).
**Hand check:** none required; optionally, a site-extension `fetchText` on a proxied profile.

## Files changed

| File | Change |
|---|---|
| `src/shared/browser-navigation-policy.ts` | `isWebImageUrl()` |
| `src/renderer/editors/browser/BrowserTabsModel.ts` | ignore non-web favicons |
| `src/renderer/editors/browser/BrowserProfileNetworkModel.ts` | `routeSrc`/`routedFetchUrl` refuse non-web URLs |
| `src/renderer/editors/browser/BrowserBookmarksModel.ts` | filter clicked images |
| `src/renderer/editors/markdown/rehypeMarkdownOverrides.ts` | web Markdown image rule |
| `src/main/browser-network-service.ts` | WebRTC policy for all contents of a routed session |
| `src/main/tor-service.ts` | retire partition instead of direct |
| `src/main/client-certificate-policy.ts` (new) | certificate selection policy |
| `src/main/main-setup.ts` | install the policy |
| `src/main/browser/BrowserGuestRegistry.ts` | `pageSession()` |
| `src/main/site-extension-fetch-service.ts` | fetch through the page session |
| `src/ipc/main/site-extension-handlers.ts` | pass the sender |
| `src/renderer/components/icons/favicon-cache.ts` | private-address guard, pinned lookup, per-hop checks |
| `doc/architecture/browser-editor.md`, `doc/architecture/key-files.md` | developer docs (page-image rule, favicon-cache guard, WebRTC for popups, certificate policy, Tor retirement, fetch broker session) |
| `assets/guides/editors/browser/network-and-agent.md`, `assets/guides/site-extensions.md`, `assets/guides/whats-new.md` | user docs |

**No changes needed:** `src/preload-webview/page-reporters.ts` (filtered at the host),
`src/renderer/editors/link-editor/routed-src.ts` (`LOCAL_SRC_RE` stays for user-owned links),
`src/main/session-proxy.ts`, `src/main/routed-fetch-protocol.ts`, `src/main/session-src-protocol.ts`,
`BrowserTabsPanel.ts` (draws what `routeSrc` returns), `permission-policy-service.ts` (US-2143's
area). No i18n messages and no `window.persephone` change (no bridge bump).
