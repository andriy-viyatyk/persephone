# EPIC-122: Site certificates in the browser, shown by a `certificate.view` board

## Status

**Status:** Completed (2026-10-06)
**Created:** 2026-10-06
**Completed:** 2026-10-06

## Overview

Persephone's browser cannot show a site's TLS certificate, which Chrome and Firefox do from the
padlock. This epic adds that, without putting a certificate viewer in the core. Persephone defines
a well-known capability, **`certificate.view`**, and the browser offers **View certificate** for an
HTTPS page. A board that claims the capability renders the chain: the Certificate Viewer board
(`persephone-boards`, BT-030) is the first one. This is the same split as `image.edit`
(Excalidraw board) and `http.request.open` (REST Client board): the platform owns the contract and
the entry point, a board owns the UI.

## Goals

- `certificate.view` v1 is a documented, typed capability that any trusted or bundled board can
  claim in its manifest.
- On an HTTPS page, the browser's site-info popover shows **View certificate**. It opens the chain
  Chromium actually received for that page (leaf first) in the best `certificate.view` handler.
- With no handler installed, the button still works: the chain opens as PEM text in Monaco, and the
  tooltip says a certificate viewer board would decode it.
- Agents can read the same chain from the browser facade.
- The Certificate Viewer board claims `certificate.view` and renders a chain from the request
  payload, including after the page is restored on restart.

## Non-goals

- Certificate validation, revocation checking or trust decisions in Persephone or the board. The
  board stays descriptive (BT-030).
- A built-in certificate viewer in the core.
- Fetching a certificate from an arbitrary host:port outside the browser (it would need the board's
  `execute` permission; a possible later board feature).
- Certificate error interstitials or "proceed anyway" UI.

## Decisions

**D1 — A well-known capability, declared by Persephone, claimed by boards.** Capability ids are
open strings, so a board could already invent one. What makes `certificate.view` a platform
contract is that Persephone documents and types it: a typed `invoke` overload in
`src/renderer/api/capabilities.ts` and `api/types/capabilities.d.ts`, the payload contract in
`doc/architecture/capability-bus.md`, and the guides that list well-known capabilities. A board
claims it with an ordinary manifest declaration:
`{ "id": "certificate.view", "version": 1, "alwaysOpensNewPage": true, "title": "View certificate" }`.
Resolution and priority are the existing capability-bus rules; nothing new is built there.

**D2 — Payload v1.**

```ts
interface CertificateViewPayload {
    title: string;            // e.g. "example.com" — becomes the page title
    certificates: string[];   // base64 DER, leaf first, as received; at least one
    source?: { url: string }; // the page the chain came from, when there is one
}
```

DER base64 rather than PEM keeps the bytes exact (fingerprints are computed from them) and needs
no parsing on the platform side. The host validates shape and size (each entry decodes, a sane
total cap) before invoking, as `http.request.open` does.

**D3 — Where the chain comes from: CDP `Network.getCertificate`.** The browser's webview already has
a CDP session with the `Network` domain enabled (`src/main/cdp-service.ts`, `enableDomain`).
`Network.getCertificate({ origin })` returns the chain Chromium used for that origin as base64 DER
(`tableNames`), so what the user sees is what the browser checked, including through a proxy or
Tor. Investigation must confirm three things before the task document settles on it: it works for
a page loaded before `Network` was enabled, it works for Tor and proxy profiles, and what it
returns for a page served from cache. The fallback, if it does not hold, is the `Security` domain
(`Security.visibleSecurityStateChanged` carries the certificate chain).

**D4 — UI: the site-info popover header, right-aligned.** The browser's **i** button in the URL
bar opens the site popover (`SitePermissionsContentView` in `editors/browser/BrowserView.ts`,
`data-name` `site-permissions-popover`). Its top row already holds the ai-vision badge
(`site-permissions-ai-vision-badge`, US-1620), inserted above the origin heading. That row becomes
a header row: the badge stays at the left, and **View certificate** (a small button, `data-name`
`site-certificate-view`) sits at the right. On an HTTPS page the row is shown even when there is no
badge, holding only the button; for `http:`, `file:` and internal pages there is no button, and the
row exists only for the badge, as today. (User decision, 2026-10-06; no separate toolbar button.)

**D5 — No handler: open PEM text in Monaco, do not disable the button.** The button is shown for
every HTTPS page. With a `certificate.view` handler it invokes the capability. Without one it
converts the chain to PEM and opens it through `text.open` (always registered), and the button's
tooltip says "Install a certificate viewer board to see the decoded certificate". A disabled
button would be a dead end; PEM text is useful on its own (copy into `openssl`, save as `.pem`,
which the board then opens). Handler presence is read when the popover opens
(`capabilities.handlers("certificate.view")`), so no reactive subscription is needed.

**D6 — Agent surface.** The browser editor facade gets `getCertificate()`, returning
`{ url, certificates: string[] }` (base64 DER, leaf first) or `undefined` for a non-HTTPS page,
and the popover button's `data-name` (`site-certificate-view`, D4) is listed in the browser's
`elements`. Agents can then inspect a site's chain without the UI, or invoke `certificate.view`
themselves.

**D7 — Board side lives in `persephone-boards`.** The Certificate Viewer board declares the
capability, handles the request with `persephone.intent.onRequest`, renders from the payload
instead of a file, and stores the chain in per-page state (`persephone.pageState`, bridge 1.34.0)
so a restored page still shows it. The board's file-opening path is unchanged. BT-030 (the board
itself) is committed to `persephone-boards` `develop` as 1.0.0 but **not published** (user decision,
2026-10-06): BT-031 lands on top of it, and the board is published once a Persephone release ships
the capability.

**D8 — Versions.** The capability needs no new bridge API (manifest capabilities and
`persephone.intent` already exist), so `BOARD_BRIDGE_VERSION` does not change unless the task
investigation finds a gap. The board's `minAppVersion` is the first Persephone version that ships
D1–D6. That is 5.0.8, the unreleased version on `upcoming-v5.0.8`, which the board already declares;
an older Persephone would ignore the declaration harmlessly.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1628 | Platform: `certificate.view` contract, browser chain retrieval, site-popover button with PEM fallback, `getCertificate()` | Completed |
| BT-031 *(persephone-boards)* | Certificate Viewer claims `certificate.view`: render from the request payload, restore from page state | Completed |

## Risks

- **`Network.getCertificate` is an experimental CDP method.** It has been stable in Chromium for
  years, but D3 makes the task confirm it on the Electron version shipped, and names the fallback.
- **Payload size.** A chain is a few KB; the cap in D2 only guards against a bad caller.

## Notes

### 2026-10-06
- Design from the user: the board should claim a Persephone-defined role, as Excalidraw claims image
  editing, and the browser should offer the action depending on whether a handler exists. The
  no-handler choice (D5: PEM in Monaco rather than a disabled button) was one of the two options the
  user named; recorded here as the recommendation, open to change at task review.
