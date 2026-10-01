# US-1589: Web pages cannot open internal Persephone schemes

**Epic:** [EPIC-118 — Security hardening](../../epics/EPIC-118.md) · finding F3 · **Medium**

## Goal

A web page in Persephone's browser can never open an internal Persephone page. Internal schemes
are `persephone-guide:`, `mneme:`, `folder-editor:`, `data:`, and every other platform or script
scheme. A page's navigation to one of them is simply ignored. The only schemes still routed are those
a trusted board claims for web content, such as the torrent board's `magnet:`. Those need a real user
click or key press in the page.

User-initiated paths keep working: the address bar, Markdown links, agent calls and `pages.openUrl`.

**User decision (2026-10-01):** "Persephone schemas designed for its internal functionality and for
the boards. I think web pages should not reach the persephone … Can we just block persephone schemas
for web pages?" Blocking replaces the earlier plan of a confirmation dialog. There is no dialog.

## Background

### The path today (verified 2026-10-01)

- `src/main/browser-service.ts:31-39`:
  - `BLOCKED_PROTOCOLS` = `file:` and `app-asset:`.
  - `CHROMIUM_NAVIGATION_PROTOCOLS` = `http:`, `https:`, `about:`, `blob:`, `mailto:` and `tel:`.
- `browser-service.ts:416-437`, the `will-navigate` handler:
  - It fires only for page-initiated main-frame navigations (links, `location`, forms). It does not
    fire for `loadURL`/`src`.
  - Any scheme outside `CHROMIUM_NAVIGATION_PROTOCOLS` is cancelled and sent to the host renderer:
    `sendHostEvent(sender, EventEndpoint.eOpenPipelineCandidate, url)`. `browser-service.ts` is
    the endpoint's only sender.
- `src/renderer/api/internal/RendererEventsService.ts:110-117` `handlePipelineCandidate` routes the
  URL to `openRawLink` whenever its scheme is registered. There is no gesture check and no origin
  check.
- Scheme registrations carry an `origin` (`src/renderer/content/scheme-registry.ts:28-32`):
  - **platform:** `builtin-schemes.ts:337-347` — http, https, data, folder-editor, git-tree,
    mneme, mneme-folder, persephone-board, persephone-guide, persephone-toolset, tree-category.
  - **script:** `io.registerScheme`.
  - **board:** a trusted board's `contentProviders[].schemes` (`custom-editor-registry.ts:304`).
    Boards cannot claim reserved schemes (`HARD_RESERVED_SCHEMES` and `persephone-*`, `:36-42`,
    `:89-91`, `:98-101`). They cannot claim a scheme already owned by the platform either, because
    duplicates are refused (`:104-111`).
- **Legitimate consumer — keep it working:**
  - The torrent board claims `magnet`. Clicking a magnet link in a Browser tab opens Torrent
    Viewer through this exact path (EPIC-114, measured 2026-09-27; `doc/epics/EPIC-113.md:22-26`).
  - Nothing else legitimately relies on a web page reaching a platform scheme. The bundled guides'
    `persephone-guide:` links render in the Markdown editor, not in a webview. Board
    navigation-return claims are https URLs handled by `browserUrlChanged`.

### Live probes (2026-10-01, dev build)

| Probe | Result |
|---|---|
| Page script `location.href = "persephone-guide://editors/browser"`, no click (epic F3) | **Opened a Markdown tab** — the hole |
| Trusted click on `<a target="_blank" href="persephone-guide://…">` | `setWindowOpenHandler` → `new-window` → `BrowserWebviewModel.ts:331-343` `addTab(url)`: a plain browser tab showing nothing. No Persephone page. Fine as is, per the user |
| Same-origin link → `302 Location: persephone-guide://…` | No `will-navigate`. The `openExternal` permission has no key for the scheme (`permission-policy-service.ts:147-152`), so it is denied (`:198`). Nothing opened |
| Sub-frame navigation to a custom scheme | `will-navigate` is main-frame only. `openExternal` is denied for sub-frames (`:203`) |

`will-navigate` → `eOpenPipelineCandidate` is the only route, so this is the only thing to change.

### Main-side input signals already in place

A page cannot fake these:

- `browser-service.ts:386-398` `before-mouse-event` tracks `reg.pressed` on
  `mouseDown`/`mouseUp`/`mouseMove`.
- `browser-service.ts:463` `before-input-event` sees keyboard input. It returns early unless the
  event is `keyDown`.
- `RegisteredWebview` (`:92-109`) holds per-webview state and is rebuilt by `registerWebview`
  (`:578-587`) on every `dom-ready`.
- Listeners go through the local `on()` (`:285-291`) so they are removed on unregister.

## Implementation plan

### Renderer — only board-claimed schemes are routable from a web page

1. `src/renderer/content/scheme-registry.ts`: add next to `isSchemeRegistered`:
   ```ts
   /** True when a trusted board claimed this scheme. Only these may be opened by a web page's own
    *  navigation; platform and script schemes are internal to Persephone. */
   export function isBoardClaimedScheme(scheme: string): boolean {
       return schemeOwnership.get(normalizeScheme(scheme))?.value.origin === "board";
   }
   ```
   Check the `OwnershipRegistry.get` return shape. `:133` uses `.get(...)?.value`, so this matches.
2. `src/renderer/api/internal/RendererEventsService.ts` `handlePipelineCandidate`: replace
   `isSchemeRegistered(scheme)` with `isBoardClaimedScheme(scheme)`. Keep everything else. Update the
   import, and drop `isSchemeRegistered` from it if it is no longer used in the file.

### Main — the navigation must follow a real user action

3. `src/main/browser-service.ts`:
   - Add `lastUserActivation: number` to `RegisteredWebview`, with the doc comment
     "Time (Date.now()) of the last trusted mouse or key press in the page; 0 = none or consumed."
     Initialize it to `0` in `registrations.set(...)`.
   - In `before-mouse-event`, on `mouseDown` and `mouseUp`, set `reg.lastUserActivation = Date.now()`.
   - In `before-input-event`, right after `if (input.type !== "keyDown") return;`, set
     `registrations.get(key)` → `lastUserActivation = Date.now()`. No other change to key handling.
   - Add the constant near `CHROMIUM_NAVIGATION_PROTOCOLS`:
     ```ts
     /** Chromium's transient user activation lasts 5 s. A page navigation to a non-web scheme
      *  is passed to the host only within this window after a real click or key press. */
     const USER_ACTIVATION_WINDOW_MS = 5000;
     ```
   - In `will-navigate`, the non-Chromium branch becomes:
     ```ts
     if (!CHROMIUM_NAVIGATION_PROTOCOLS.includes(parsed.protocol)) {
         event.preventDefault();
         const reg = registrations.get(key);
         // Consume the activation: one user action hands over at most one URL.
         const activated = !!reg && Date.now() - reg.lastUserActivation <= USER_ACTIVATION_WINDOW_MS;
         if (reg) reg.lastUserActivation = 0;
         if (activated) sendHostEvent(sender, EventEndpoint.eOpenPipelineCandidate, url);
     }
     ```
   - Update the comment above the handler to say that non-web schemes reach the host only after a
     user action, and that the host opens only board-claimed ones.
   - The IPC payload stays a `string`, so there is no typing change.

### Checks

4. `npm run typecheck`, `npm run lint`, `npm run build-prod`.

## Files changed

| File | Change |
|---|---|
| `src/renderer/content/scheme-registry.ts` | `isBoardClaimedScheme` |
| `src/renderer/api/internal/RendererEventsService.ts` | route only board-claimed schemes |
| `src/main/browser-service.ts` | `lastUserActivation`; record it on mouse/key; gate and consume it in `will-navigate` |

## Concerns / Open questions

1. **Gesture for board schemes.** The user asked for blocking. The gesture gate only hardens what
   is still allowed.
   - Without it, any page could silently send the torrent board a magnet, which starts swarm
     connections from the user's IP.
   - With it, a real click still works exactly as before.
2. **Agent-driven clicks — resolved.** Automation's trusted clicks (CDP `Input.dispatchMouseEvent`)
   do raise `before-mouse-event`. An agent's `editor.click()` on a magnet link counts as a user
   action and opens Torrent Viewer (verified 2026-10-01).
3. **Script-registered schemes** (`io.registerScheme`) are blocked for web pages too. They are the
   user's own internal tooling, and the same rule as the platform schemes applies. A script that
   wants web links can still use the address bar or `pages.openUrl`.
4. **Out of scope:** `target="_blank"` and the context-menu "Open link in new tab" on an internal
   link open an empty browser tab. That is unchanged and acceptable per the user.

## Acceptance criteria

- Page script `location.href = "persephone-guide://editors/browser"`, with or without a click,
  opens nothing.
- The same holds for `mneme:`, `folder-editor:` and `data:`.
- With the torrent board trusted: a trusted click on a magnet link opens Torrent Viewer, as before.
  A script-only `location.href = "magnet:…"` with no user input opens nothing.
- Unchanged:
  - `mailto:`/`tel:` (Chromium + `openExternal` prompt).
  - http/https.
  - `file:` blocking.
  - Markdown links to internal schemes, the address bar, and `pages.openUrl(...)` from MCP.
- typecheck, lint and build-prod pass.

## Progress

- [x] `isBoardClaimedScheme` + renderer routing
- [x] Main: activation tracking + gate
- [x] typecheck / lint / build-prod
- [x] Live verification (2026-10-01, dev build, local test page):
  - Script `location.href = "persephone-guide://…"` → nothing opened.
  - Trusted click on a `persephone-guide:` link → nothing opened. Same for a `mneme:` link.
  - Script-only `magnet:` navigation (more than 5 s after the last input) → nothing opened.
  - Trusted click on a `magnet:` link → Torrent Viewer opened.
  - `pages.openUrl("persephone-guide://editors/browser")` → the guide opened as a Markdown page.
  - mailto/tel, http/https and `file:` blocking are on code paths this task does not touch, so they
    were not re-tested.
