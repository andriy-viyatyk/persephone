# US-1628: Platform `certificate.view` contract and browser entry point

Epic: [EPIC-122](../../epics/EPIC-122.md) — decisions D1–D8 are binding. This task covers the Persephone platform only; BT-031 is implemented in `persephone-boards`.

## Goal

Define the typed `certificate.view` v1 capability and safely deliver the active HTTPS browser tab's Chromium certificate chain to a handler. Add **View certificate** to the site-info popover, use PEM text through `text.open` when no handler exists, and expose the chain as `browser.getCertificate()` to scripts and MCP agents.

## Background

### Capability contract and payload

The capability index is renderer-local: built-in editor declarations seed platform candidates and trusted/bundled board manifests are indexed on registry rebuild ([`capability-bus.md:11-21`](../../architecture/capability-bus.md#L11-L21)). The manifest `capabilities` array registers a handler; `permissions.capabilities` is disclosure only. Existing declaration validation checks id syntax, integer version, special `content.view` representation, and `alwaysOpensNewPage`; it preserves metadata but does not validate an invocation payload ([`capabilities.ts:147-196`](../../../src/renderer/api/capabilities.ts#L147-L196)). Capability selection is priority ordered with platform winning ties; `resolveCapability()` returns the selected declaration ([`capabilities.ts:208-223, 294-303`](../../../src/renderer/api/capabilities.ts#L208-L223)). The public runtime overloads currently cover `text.open`, `content.view`, `image.edit`, and `diagram.edit`; `handlers(id)` is read-only discovery ([`capabilities.ts:305-328`](../../../src/renderer/api/capabilities.ts#L305-L328)). Their public declaration lives in `src/renderer/api/types/capabilities.d.ts` ([lines 40-85](../../../src/renderer/api/types/capabilities.d.ts#L40-L85)).

The bus structured-clone checks and its 8 MiB board payload ceiling do not establish a certificate-specific shape contract ([`capability-bus.ts:243-260`](../../../src/renderer/api/capability-bus.ts#L243-L260)). D2 defines:

```ts
interface CertificateViewPayload {
    title: string;
    certificates: string[]; // base64 DER, leaf first
    source?: { url: string };
}
```

The planned host validation requires a non-empty title, at least one certificate, valid canonical base64 decoding to DER whose first byte is `0x30`, optional `source.url` string, and a **256 KiB total decoded DER cap**. Validate decoded bytes rather than trusting string length alone. The board-side viewer already parses DER inputs from `Uint8Array` and checks the ASN.1 SEQUENCE tag (`C:/projects/persephone-boards/boards/cert-viewer/cert-parser.js`, `parseDer`, lines 461–475); its `app.js` file-opening path calls `CertParser.parse(bytes, filePath)` (lines 492–501). For BT-031, base64-decode each payload item to `Uint8Array` and parse each DER item in order; the payload shape is consumable without a board bridge change. This is an implementation handoff, not a change to the separate boards repository.

Put the two small pure helpers in new `src/renderer/api/certificate-view.ts`: `validateCertificateViewPayload(payload)` for the D2 checks and `certificatesToPem(certificates)` for BEGIN/END wrapping at 64 columns. Call `validateCertificateViewPayload()` inside `invokeCapabilityOutcome()` in `src/renderer/api/capabilities.ts` when `parsed.bareId === "certificate.view"`, before `resolveCapability()` ([`capabilities.ts:337-365`](../../../src/renderer/api/capabilities.ts#L337-L365)). This is the shared invocation boundary: app/script and popover calls enter through `Capabilities.invoke()` ([`capabilities.ts:305-314`](../../../src/renderer/api/capabilities.ts#L305-L314)); a board's `persephone.capabilities.invoke()` message is dispatched by `BoardWebview.resolveCapabilityInvoke()` to the same `invokeCapabilityOutcome()` ([`board-shim.ts:879-900`](../../../src/board-shim.ts#L879-L900), [`BoardWebview.ts:288-290, 1160-1175`](../../../src/renderer/editors/board/BoardWebview.ts#L288-L290)). `board-capability-transport.ts` handles the opposite direction: it routes a host invocation to a declared board's intent handler ([`board-capability-transport.ts:119-169`](../../../src/renderer/api/board-capability-transport.ts#L119-L169)).

`http.request.open` is a useful route pattern: `builtin-schemes.ts` constructs a specific typed payload, invokes with `{ version: 1 }`, distinguishes `CapabilityError.code === "no-handler"`, and notifies on other failures ([lines 282-305](../../../src/renderer/content/builtin-schemes.ts#L282-L305)). That route constructs its payload but does not perform a certificate-style shape validator; US-1628 must add explicit validation. `image.edit` reports missing handlers as a warning and other failures as errors through `notifyEditCapabilityFailure` ([`capability-feedback.ts:5-18, 42-54`](../../../src/renderer/api/capability-feedback.ts#L5-L18)). `text.open` is registered by the built-in text editor ([`register-editors.ts:157`](../../../src/renderer/editors/register-editors.ts#L157)); its typed payload is `{ content, language, title }` ([`capabilities.ts:306-310`](../../../src/renderer/api/capabilities.ts#L306-L310), [`capabilities.d.ts:43-47, 79-85`](../../../src/renderer/api/types/capabilities.d.ts#L43-L47)).

The board authoring guides explain declaration, invocation and errors but have no compact well-known capability catalog today: see the capability sections in [`assets/guides/boards.md:367-474`](../../../assets/guides/boards.md#L367-L474) and [`assets/guides/agents/boards.md:614-700`](../../../assets/guides/agents/boards.md#L614-L700). The scripting guide has the capability methods section at [`assets/guides/scripting/api/app.md:372-400`](../../../assets/guides/scripting/api/app.md#L372-L400). Add a short well-known capability list to each existing section, including `http.request.open`, `image.edit`, and `certificate.view`, and document certificate payload/behavior in the architecture contract. Keep source declaration types and both shipped declaration copies in sync: `assets/editor-types/capabilities.d.ts` mirrors `src/renderer/api/types/capabilities.d.ts` (both currently expose the same `ICapabilities` overloads at lines 78-86).

### Chain retrieval and browser tab identity

`BrowserEditor` composes `BrowserTabsModel`, `BrowserWebviewModel`, and `BrowserTargetModel` ([`BrowserEditor.ts:86-107`](../../../src/renderer/editors/browser/BrowserEditor.ts#L86-L107)); `BrowserTabsModel` owns the inner-tab lifecycle and active-tab selection ([`BrowserTabsModel.ts:19-42, 231-249`](../../../src/renderer/editors/browser/BrowserTabsModel.ts#L19-L42)). Browser webviews register with main-process key `${model.id}/${tabId}` and their `webContentsId` ([`BrowserView.ts:120-132, 186-198`](../../../src/renderer/editors/browser/BrowserView.ts#L120-L132)); main `registerWebview()` stores that registration and resolves the guest `WebContents` ([`browser-service.ts:322-337`](../../../src/main/browser-service.ts#L322-L337)). The browser editor already uses typed invoke IPC for site permission operations ([`BrowserEditor.ts:125-130`](../../../src/renderer/editors/browser/BrowserEditor.ts#L125-L130)). `BrowserTargetModel.cdp(tabId)` also binds a `CdpSession` to that exact registration key ([`BrowserTargetModel.ts:15-28`](../../../src/renderer/editors/browser/BrowserTargetModel.ts#L15-L28)).

CDP attachment and generic command dispatch already cross `BrowserChannel.cdpAttach`/`cdpSend` ([`browser-ipc.ts:62-68`](../../../src/ipc/browser-ipc.ts#L62-L68), [`cdp-service.ts:1010-1018, 1150-1181, 1210-1225`](../../../src/main/cdp-service.ts#L1010-L1018)). `BrowserTargetModel.cdp(tabId)` selects the exact `${model.id}/${internalTabId}` registration key ([`BrowserTargetModel.ts:17-21`](../../../src/renderer/editors/browser/BrowserTargetModel.ts#L17-L21)); `CdpSession.send()` auto-attaches before issuing arbitrary CDP commands ([`CdpSession.ts:19-29`](../../../src/renderer/automation/CdpSession.ts#L19-L29)).

**Plan:** do not add a new IPC route or change main-process CDP handling. Add one method to `BrowserEditor` that chooses the active tab id by default (or accepts an explicit internal tab id for the popover), reads that tab's current URL, returns `undefined` unless it is HTTPS, calls `this.target.cdp(tabId).send("Network.getCertificate", { origin: url.origin })`, and returns `undefined` when `tableNames` is empty. The generic renderer-to-main `cdpSend` route already exists for that tab, so a narrow IPC adds no security boundary.

### CDP protocol evidence and verified behavior

The current DevTools Protocol reference calls `Network.getCertificate` experimental and documents the `origin` parameter and `tableNames` array ([CDP Network domain, `Network.getCertificate`](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-getCertificate)). **Verified live in Electron 43:** `Network.getCertificate({ origin: "https://andriy-viyatyk.github.io" })` on its loaded tab returned four base64 strings. They decoded to DER lengths 1354, 1247, 1528, and 1391 bytes, each beginning with `0x30`; order was leaf (`*.github.io`), intermediate, cross-signed root, then `ISRG Root X1`. A loaded GitHub tab returned three certificates. No `Network.enable` was issued; existing `cdp-send` does not enable domains and no enable call is needed. Asking the github.io tab for `https://github.com` returned an empty array. A restored but never activated tab also returned an empty array. This establishes base64 DER representation and leaf-first ordering in the shipped Electron build, and shows that a requested origin without a committed chain on that tab returns no data rather than stale cross-origin data.

If a future Electron version drops or breaks `Network.getCertificate`, `Security.visibleSecurityStateChanged` is the fallback to investigate; it is not part of this task's implementation ([CDP Security event](https://chromedevtools.github.io/devtools-protocol/tot/Security/#event-visibleSecurityStateChanged)).

**Remaining reviewer live check:** verify that a Tor-profile tab returns a chain; no Tor-specific retrieval behavior is planned.

### Site-info popover and fallback UX

`BrowserToolbarView.sync()` derives `activeUrl` from the active tab and parses `URL.protocol`/`origin`; the site-permissions info button is shown only for web origins and when the user has not typed in the URL bar ([`BrowserView.ts:588-605`](../../../src/renderer/editors/browser/BrowserView.ts#L588-L605)). The info button toggles `permissionsOpen`, loads permissions and updates the popover ([`BrowserView.ts:608-623`](../../../src/renderer/editors/browser/BrowserView.ts#L608-L623)); the popover hosts `SitePermissionsContentView` under `site-permissions-popover` ([`BrowserView.ts:663-678`](../../../src/renderer/editors/browser/BrowserView.ts#L663-L678)). The content currently inserts the optional ai-vision badge before the origin heading in `sync()` ([`BrowserView.ts:349-412`](../../../src/renderer/editors/browser/BrowserView.ts#L349-L412)). Its co-located styles use theme CSS variables for layout and badge treatment ([`BrowserView.css:24-37`](../../../src/renderer/editors/browser/BrowserView.css#L24-L37)); TypeScript styling should use the `color.ts` tokens, not hardcoded colors.

Implement the D4 header row above the origin heading: badge aligned left; a small `ButtonView` named `site-certificate-view` aligned right. Show the row iff the ai-vision badge exists or the active URL protocol is `https:`. Keep the button hidden for `http:`, `file:`, and internal pages, while retaining the badge-only row behavior. Add a tooltip attachment with text selected at popover open using `capabilities.handlers("certificate.view")`: handler present → **“View the decoded certificate chain for this site”**; no handler → **“Install a certificate viewer board to see the decoded certificate”**. Read availability when opening, not reactively.

On click, get the chain for the popover's captured active tab and URL. If the HTTPS tab returns an empty chain, call `ui.notify("The certificate for this page is not available yet. Reload the page and try again.", "warning")` and leave the popover open. Otherwise call `capabilities.invoke("certificate.view", payload, { version: 1 })` when a handler is present, or build PEM through the pure helper and open it with `text.open` when no handler exists; close the popover after either action succeeds. PEM uses existing chain order, 64-column wrapping, and BEGIN/END CERTIFICATE boundaries; `title` is the host name without scheme or port. `ui.notify` accepts the `warning` level and returns a promise ([`ui.ts:106-108`](../../../src/renderer/api/ui.ts#L106-L108), [`types/ui.d.ts:151-152, 247`](../../../src/renderer/api/types/ui.d.ts#L151-L152)). Report other collection or invoke errors using `errMessage`/`ui.notify` conventions; `notifyEditCapabilityFailure` only accepts `image.edit`/`diagram.edit`, so do not widen that helper ([`capability-feedback.ts:5-18, 42-54`](../../../src/renderer/api/capability-feedback.ts#L5-L18)).

### Agent API and element inventory

`BrowserEditorFacade` implements `IBrowserEditor`, assembles `$help` from `BROWSER_EDITOR_HELP`, and publishes `BROWSER_EDITOR_MEMBERS` plus curated `BROWSER_ELEMENTS` in its ai-vision descriptor ([`BrowserEditorFacade.ts:78-123, 125-138, 178-229`](../../../src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts#L78-L123)). Add `getCertificate(): Promise<{ url: string; certificates: string[] } | undefined>` to the facade and both declaration copies: `src/renderer/api/types/browser-editor.d.ts` and `assets/editor-types/browser-editor.d.ts` (the latter mirrors the source declaration; see its `IBrowserEditor` at lines 150-190). Return `undefined` for a non-HTTPS active tab or an empty `Network.getCertificate` result; document both cases in `$help` and the member summary. Otherwise return the active URL and base64 DER certificates, leaf first. `site-permissions-ai-vision-badge` is currently named by its `TagView` in `BrowserView.ts:366, 401`; it is not presently in `BROWSER_ELEMENTS`. Add `site-certificate-view` to `BROWSER_ELEMENTS` using that stable-name convention, targeting the button and stating it is visible on HTTPS pages.

`doc/architecture/ui-element-contract.md` makes agent-facing selectors quoted by a guide part of the public contract and says additions are safe ([lines 60-70](../../architecture/ui-element-contract.md#L60-L70)); it also deliberately excludes editor internals from the shell inventory ([lines 289-296](../../architecture/ui-element-contract.md#L289-L296)). The browser user guide owns browser screen and agent information ([`assets/guides/editors/browser.md:246-258`](../../../assets/guides/editors/browser.md#L246-L258)); add the popover button selector and behavior there. Do not add this editor-internal popover control to the shell selector table. The browser automation guide is an additional agent-facing surface only if its selector catalog is extended by this task.

### Bridge and release docs

No board bridge API is needed: manifest declarations and `persephone.intent.onRequest` already provide capability registration and handling ([`assets/guides/boards.md:367-429`](../../../assets/guides/boards.md#L367-L429); [`assets/guides/agents/boards.md:614-668`](../../../assets/guides/agents/boards.md#L614-L668)). The bridge version is currently `1.34.0` ([`src/shared/board-bridge-version.ts:1-2`](../../../src/shared/board-bridge-version.ts#L1-L2)); this task does not add a bridge surface, so do not bump it or add a bridge history entry. Keep D8's `minAppVersion: 5.0.8` behavior for BT-031.

At epic close, `/document` should update `doc/architecture/capability-bus.md`, `doc/architecture/browser-editor.md`, and `doc/architecture/key-files.md`; `/userdoc` should update `assets/guides/editors/browser.md` and any agent screen guide that is created/edited. This task itself adds the capability contract to the three capability guides listed above. A user-facing What's New entry belongs in `assets/guides/whats-new.md` under the current upcoming version if the release process includes the feature; `doc/standards/release-process.md:29-49` says upcoming entries are consolidated at release. Do not perform epic-close documentation workflows in this task.

## Implementation plan

1. [x] **Define and validate the public contract.** In `src/renderer/api/types/capabilities.d.ts`, add/export `CertificateViewPayload`; add `invoke("certificate.view", payload)` to `ICapabilities`. Add the matching overload to `Capabilities` in `src/renderer/api/capabilities.ts`. Add `src/renderer/api/certificate-view.ts` with pure `validateCertificateViewPayload(payload)` and `certificatesToPem(certificates)` helpers. Call the validator inside `invokeCapabilityOutcome()` when `parsed.bareId === "certificate.view"`, before `resolveCapability()`; this covers script, popover, and board-originated invokes at one boundary. Validate title/source shape, non-empty array, base64 decoding, DER `0x30`, and 256 KiB decoded-total maximum. Keep `payloadSchema` descriptive; it is not the validation boundary ([`capability-bus.md:44-50`](../../architecture/capability-bus.md#L44-L50)). Mirror the type and overload in `assets/editor-types/capabilities.d.ts`.

   **Before → after:** generic `invoke(id: string, payload: unknown, opts?)` only → typed `invoke("certificate.view", payload: CertificateViewPayload)` plus runtime validation of the certificate-specific invariant.

2. [x] **Add the contract documentation.** Update `doc/architecture/capability-bus.md` with the v1 payload, ordering, field semantics, 256 KiB cap and validation errors. Add `certificate.view` to the well-known capability lists at `assets/guides/agents/boards.md`, `assets/guides/boards.md`, and `assets/guides/scripting/api/app.md`, alongside the existing `http.request.open` and `image.edit` examples/catalog references. Explain that trusted/bundled boards declare it normally and invoke with v1 payload.

3. [x] **Retrieve Chromium's chain through browser CDP.** Add `BrowserEditor.getCertificate(internalTabId = activeTabId)`: find the tab's current URL, return `undefined` unless it is HTTPS, call `this.target.cdp(internalTabId).send("Network.getCertificate", { origin: url.origin })`, and return `undefined` when `tableNames` is empty. No `Network.enable` call is needed. The popover passes its captured active tab id; the facade uses the active tab by default. Do not add an IPC route or main-process changes.

   **Before → after:** browser agent API has generic CDP automation methods → `BrowserEditor.getCertificate()` wraps the existing tab-scoped CDP session and returns a current URL/chain pair or `undefined`.

4. [x] **Add the D4 popover header/button.** In `src/renderer/editors/browser/BrowserView.ts`, create the row, preserve the current optional badge, add `ButtonView({ name: "site-certificate-view", ... })`, detect `https:` from the same active URL used by `sync()`, set `hidden`/row visibility based on badge-or-HTTPS, and wire action plus tooltip. Capture tab id and URL before awaiting retrieval to prevent tab switches from cross-wiring UI. In `src/renderer/editors/browser/BrowserView.css`, align the header row and button using existing spacing variables; use only `color.ts` tokens in TypeScript (add a token/theme value only if an existing token cannot express the treatment). Close the popover after either action completes.

5. [x] **Implement the D5 action and PEM path.** In `BrowserView.ts`, read handler presence at open. Invoke `certificate.view` version 1 with `title`, `certificates`, and `source: { url }` when a handler exists. Otherwise call `certificatesToPem()` from `src/renderer/api/certificate-view.ts` and invoke `text.open` with PEM content, `plaintext`, and hostname title. If the HTTPS call returns no chain, show the exact warning notification and leave the popover open. Surface other retrieval and capability errors through user notification consistent with existing `errMessage` patterns.

   **Before → after:** site info shows origin, optional ai-vision badge, and permission rows → HTTPS also has an enabled `View certificate` action; with no handler it opens a PEM bundle in Monaco and still offers a tooltip explaining how to get decoded viewing.

6. [x] **Expose `getCertificate()` to agents.** Add the method to `BrowserEditorFacade`, `src/renderer/api/types/browser-editor.d.ts`, and `assets/editor-types/browser-editor.d.ts`. Describe it in `BROWSER_EDITOR_HELP`/MCP member metadata, including that it returns `undefined` for non-HTTPS or an empty chain. Add `{ name: "site-certificate-view", purpose: ..., where: ... }` to `BROWSER_ELEMENTS` and add the selector to `assets/guides/editors/browser.md`. The shell selector inventory in `doc/architecture/ui-element-contract.md` excludes editor internals, so it does not receive a browser popover row.

7. [ ] **Complete deferred epic-close documentation.** At epic close, `/document` updates `doc/architecture/browser-editor.md` and `doc/architecture/key-files.md`; `/document` and `/userdoc` review the architecture and user guides for all epic tasks. Add a What's New entry in `assets/guides/whats-new.md` at release only. This task's capability contract and browser-guide additions are already complete above; the user deferred completion skills to epic close.

8. [x] **Verify manually through live MCP.** No unit tests or harnesses. The user will check: the popover header row/button on HTTPS, HTTP, and internal pages; handler-present routing to the board; no-handler PEM fallback (hostname title, 64-column wrapping, leaf first); the empty-chain warning while the popover stays open; `getCertificate()` output through MCP; and a Tor-profile tab returning a chain.

## Concerns

- **No unresolved implementation questions.** Electron 43 behavior, base64 DER encoding, leaf-first order, empty-result semantics, and the no-enable requirement are recorded above from live verification. The `Security.visibleSecurityStateChanged` path is deferred unless a future Electron release breaks `Network.getCertificate`.
- The selected 256 KiB decoded-chain cap is far above the observed 5,520-byte chain and below the general 8 MiB capability bus ceiling.
- No board bridge gap was found; D8 holds and `BOARD_BRIDGE_VERSION` remains 1.34.0 without a history entry.

## Live verification (2026-10-06)

Verified by the reviewer in the running app (public sites and synthetic fixtures only):

- `getCertificate()` through MCP returned the 4-certificate `*.github.io` chain (leaf first) after a navigation or reload; `example.com` returned its chain on a fresh navigation.
- The popover header shows the ai-vision badge at the left and **View certificate** at the right on an HTTPS page.
- With the Certificate Viewer board installed (BT-031), the button opened a new board page with the chain in order, the source URL and the status summary; the page restored after an app restart.
- An HTTPS tab restored at startup has no certificate in Chromium until it navigates or reloads: `Network.getCertificate` returns an empty array. The button then shows the "not available yet — reload the page" warning, which was observed; after a reload the chain is returned. This is a Chromium behaviour for restored navigation entries, recorded as a known limitation.
- Host validation rejected non-base64, non-DER, empty and untitled payloads with the messages in `certificate-view.ts`.
- The PEM fallback was checked offline: the `certificatesToPem` format parses in OpenSSL (subject and SHA-256 fingerprint match the fixture). It was not clicked live, because the installed board claims the capability.
- **Reviewer fix:** a capability page opened for a non-bundled board was titled with the board's manifest name, because `openBoardHandlerPage` applied the request title only on the bundled content-host path. `src/renderer/api/pages/PagesLifecycleModel.ts` now sets the request title on the opened page; `applyManifestTitle` replaces only its own fallback, so the title stays. Verified: the tab reads the host name, also after restart.
- Not checked: an HTTP page and an internal page (the button should be hidden), a Tor-profile tab.

## Acceptance criteria

- `certificate.view` has a typed v1 invoke overload, exported D2 payload type, and host-side shape/base64/DER/size validation. Both source and shipped editor type declarations agree.
- The three capability guides enumerate `certificate.view` alongside existing well-known `http.request.open` and `image.edit` ids, and the architecture document specifies the contract.
- `BrowserEditor.getCertificate()` uses the existing tab-scoped CDP session, returns the current HTTPS URL plus base64 DER leaf-first certificates, and returns `undefined` for non-HTTPS or an empty chain.
- HTTPS site-info popover displays the D4 header row and button; other schemes do not display the button. A handler invokes the capability; no handler opens leaf-first PEM in Monaco with 64-column wrapping and hostname title. An empty chain shows the exact warning and leaves the popover open. The tooltip follows D5 and the popover closes after successful action.
- Browser facade/type/help/elements expose `getCertificate()` and `site-certificate-view`; the facade help documents both `undefined` cases.
- No board bridge version bump or history entry is needed.
- Reviewer verifies live via MCP; no automated test/harness is added for this task.

## Files Changed

| File | Planned action |
|---|---|
| `src/renderer/api/capabilities.ts` | Add typed overload and enforce certificate payload validation at invocation boundary. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Reviewer fix: title a capability page opened for a non-bundled board by its request title. |
| `src/renderer/api/certificate-view.ts` | Add pure `validateCertificateViewPayload` and 64-column `certificatesToPem` helpers. |
| `src/renderer/api/types/capabilities.d.ts` | Export `CertificateViewPayload`; add typed invoke overload. |
| `assets/editor-types/capabilities.d.ts` | Mirror source capability declaration for script/editor type consumers. |
| `doc/architecture/capability-bus.md` | Document certificate payload, validation, cap, and registration/invocation behavior. |
| `assets/guides/agents/boards.md` | Add well-known capability catalog entry and D2 summary. |
| `assets/guides/boards.md` | Add well-known capability catalog entry and D2 summary. |
| `assets/guides/scripting/api/app.md` | Add well-known capability catalog entry and typed invocation example. |
| `src/renderer/editors/browser/BrowserEditor.ts` | Add `getCertificate()` using active or explicit internal tab and existing `this.target.cdp(tabId).send(...)`. |
| `src/renderer/editors/browser/BrowserView.ts` | Build D4 header row, tooltip, handler route, PEM fallback, notifications, and close behavior. |
| `src/renderer/editors/browser/BrowserView.css` | Style header row/button with existing theme CSS variables and spacing tokens. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Expose `getCertificate`, `$help`/MCP descriptor text, and curated `site-certificate-view` element. |
| `src/renderer/api/types/browser-editor.d.ts` | Add the `getCertificate()` public facade signature/result type. |
| `assets/editor-types/browser-editor.d.ts` | Mirror the browser facade declaration. |
| `assets/guides/editors/browser.md` | Document site-info certificate action, fallback, and agent API/element selector. |
| `doc/architecture/browser-editor.md` | At EPIC-122 close, document certificate retrieval ownership and browser CDP fallback. `/document` owns this update. |
| `doc/architecture/key-files.md` | At EPIC-122 close, update ownership pointer if the new retrieval boundary warrants it. `/document` owns this update. |
| `assets/guides/whats-new.md` | At release-note stage, add the user-facing feature to the upcoming version; consolidate at release per release process. |
| `doc/tasks/US-1628-certificate-view/README.md` | Create this implementation-ready platform task plan with verified source references and live acceptance checks. |
| `doc/epics/EPIC-122.md` | Link the US-1628 row to this task document. |
| `doc/active-work.md` | Turn the US-1628 planned-work entry into a link to this task document. |

### Files investigated; no change planned

| File | Reason |
|---|---|
| `src/renderer/api/capability-feedback.ts` | Existing helper is intentionally edit-capability-only; reuse notification conventions without widening its type. |
| `src/renderer/api/capability-bus.ts` | Generic bus clone/size checks remain unchanged; certificate-specific validation belongs at the capability API invocation boundary. |
| `src/ipc/browser-ipc.ts` | Existing `cdpSend` channel already accepts arbitrary CDP commands for a browser registration key; a certificate IPC adds no security boundary. |
| `src/main/cdp-service.ts` | Existing `cdpSend` path already auto-attaches and forwards commands; no new handler or domain-enable change is needed. |
| `src/shared/board-bridge-version.ts` | Bridge remains at 1.34.0; D8 and current `persephone.intent` API cover this task, so no version bump/history entry is planned. |
| `doc/architecture/ui-element-contract.md` | Shell inventory deliberately excludes editor-internal controls; the new selector is documented in browser facade elements and the browser guide instead. |
| `src/renderer/editors/browser/BrowserTabsModel.ts` | Already owns tab identity and active-tab model; use its active state rather than adding certificate storage there. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Owns guest lifecycle/events; no changes or certificate cache are needed because BrowserEditor uses the existing CdpSession path. |
| `src/renderer/editors/browser/BrowserTorModel.ts` | Read to document Tor partition/proxy setup; no Tor-specific certificate route planned. |
| `src/renderer/editors/browser/BrowserProfileNetworkModel.ts` | Read to document profile proxy setup; no profile-specific certificate route planned. |
| `src/renderer/editors/browser/BrowserTargetModel.ts` | Existing `cdp(tabId)` adapter already selects the exact browser registration key; call it directly. |
| `src/renderer/automation/CdpSession.ts` | Existing `send()` is the required renderer-to-main CDP path and auto-attaches; no changes needed. |
| `src/renderer/content/builtin-schemes.ts` | Read as the `http.request.open` invocation/error precedent; no link routing for certificate UI. |
| `src/renderer/editors/board/board-manifest.ts` | Existing generic manifest capability declaration already accepts open ids and version/title metadata. |
| `src/ipc/capability-bus-channels.ts` | Generic capability transport unchanged; payload validation is specific to certificate contract. |
| `src/main/browser-service.ts` | Existing registration maps browser keys to guest webContents for the current CDP path; no change is needed because renderer CdpSession already targets those registrations. |
| `src/renderer/editors/browser/BrowserEditorModel.ts` | Existing state contract already exposes active tab URL/id; no persisted state field needed. |
| `doc/standards/release-process.md` | Release procedure stays unchanged; read to place the What's New follow-up correctly. |
| `C:/projects/persephone-boards/boards/cert-viewer/app.js` | Read only to confirm existing parser invocation is file-input based; implementation is BT-031 in the boards repo. |
| `C:/projects/persephone-boards/boards/cert-viewer/cert-parser.js` | Read only to confirm DER SEQUENCE parser acceptance; implementation is BT-031 in the boards repo. |
