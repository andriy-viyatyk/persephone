# US-1590: Main-window CSP hardening; investigate `webSecurity: false`

**Epic:** [EPIC-118 — Security hardening](../../epics/EPIC-118.md) · finding F4 · **Medium**

## Goal

If an HTML-injection bug ever reaches the main window, the injected markup cannot run script there:
- no inline `<script>`;
- no `onerror=`-style handler;
- no remote `<script src="https://…">`.

The main window has Node, so this is the last line before code execution.

`webSecurity: false` is investigated, and stays for documented reasons.

HTML previews keep exactly the script freedom they have today.

## Background

### The current policy (`index.html:6-7`)

```
script-src 'self' 'unsafe-inline' 'unsafe-eval' file: data: blob: https: http:; worker-src 'self' blob:; child-src 'self' blob: board:;
```

- **`'unsafe-eval'` must stay.** The script runner uses `new Function`
  (`src/renderer/scripting/ScriptRunnerBase.ts:84,96`).
- **The window has two inline scripts**, verified live in dev (`document.scripts`) and in the
  production output `.vite/renderer/main_window/index.html`:
  1. `self["MonacoEnvironment"] = …`, injected `head-prepend` by `vite-plugin-monaco-editor-esm`
     (`node_modules/vite-plugin-monaco-editor-esm/dist/index.js:58-93`, `transformIndexHtml`).
     - Its worker paths differ between dev and prod, so its hash is build-dependent.
     - It overrides the equivalent `window.MonacoEnvironment` that `src/preload.ts:69-84` sets with
       the same `./monacoeditorwork/*.worker.bundle.js` paths. So if this script were ever blocked,
       Monaco would still find its workers.
  2. The theme bootstrap, `index.html:14-34`. It is static.
- **Every other script is same-origin:**
  - dev: `http://localhost:5273/@vite/client`, `/src/renderer.ts`;
  - prod: `./assets/index-*.js` under `file://`.
- **Nothing in the renderer injects script elements.** There is no `createElement("script")`, no
  inline `on*=` attribute, and no remote `import()`.
- `app-asset:` is registered with `bypassCSP: true` (`src/main/main-setup.ts:49-63`), so it is
  unaffected.
- Board frames are `board://` pages with their own served CSP (`board-protocol-service.ts:306`), so
  they are unaffected.

### Blocker: the HTML preview inherits the main window's CSP (verified live 2026-10-01)

- `src/renderer/editors/html/HtmlBodyView.ts:54-58,96-107`: the preview is
  `<iframe sandbox="allow-scripts">` with `srcdoc`. `about:srcdoc` documents inherit their embedder's
  policy container, CSP included.
- **Probe:**
  - A sandboxed `srcdoc` frame A carries the meta CSP `script-src 'unsafe-inline'`.
  - A nested sandboxed `srcdoc` frame B inside A runs `eval('1')`.
  - Result: `eval-blocked`. B inherited A's policy.
- So removing `'unsafe-inline'`/`https:` from the main window would break every user HTML file that
  has an inline script or a CDN `<script src>`.
- `blob:` and `data:` frames inherit the same way. The preview therefore has to load from a
  **non-local scheme** that serves its own policy. That is exactly how `board://` frames already
  work.

### `webSecurity: false` (`src/main/open-window.ts:54`)

- Added in `5628dab6` (2026-01-04, "ScriptRunner"), replacing `webSecurity: true`. That commit
  introduced user scripts.
- Things that rely on it today:
  - **Renderer Chromium `fetch` of cross-origin URLs**, which reads bodies without CORS:
    - favicon cache (`components/icons/favicon-cache.ts:204-208`);
    - Image editor remote images (`editors/image/ImageEditor.ts:284,307`);
    - the in-app MCP client (`editors/mcp-inspector/McpConnectionManager.ts`, SDK
      `StreamableHTTPClientTransport` → global `fetch`);
    - user scripts calling the global `fetch`.
  - **No `Origin` header.** The in-app MCP client sends none because of it (verified in US-1588).
    US-1588 refuses any request that carries an `Origin`, so turning `webSecurity` on would break
    Persephone's own MCP Inspector and Mneme connection.
  - **Dev origin loading local files.** The dev window is `http://localhost:5273`, and with
    `webSecurity` on, `file://` images and video would be refused.
- **What it costs:** nothing an attacker in the main window doesn't already have. That window has
  `nodeIntegration`, and Node's `http`/`fs` ignore SOP anyway.
  - The live probes for the epic showed the sandboxed preview and the `board://` frames still
    isolated from the host.
  - The CSP is still enforced; the probe above ran in this window.
- **Decision:** keep it, and document why next to the setting. Removing it would mean moving every
  renderer `fetch` above onto `nodeFetch` (`src/renderer/api/node-fetch.ts`) and breaking scripts'
  global `fetch`, for no security gain.

## Implementation plan

### 1. Hash every inline script at build time — `vite.renderer.config.ts`

Add a plugin next to `editorTypesPlugin`:

```ts
import crypto from 'node:crypto';

const INLINE_HASHES_TOKEN = "'inline-script-hashes'";

/**
 * Replaces INLINE_HASHES_TOKEN in index.html's CSP with a 'sha256-…' source for every inline
 * <script> in the final HTML, so the main window needs no 'unsafe-inline'. Runs last ('post'),
 * after vite-plugin-monaco-editor-esm has injected its MonacoEnvironment script, in dev and build.
 */
function inlineScriptHashesPlugin(): Plugin {
  return {
    name: 'inline-script-hashes',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
          .map((match) => `'sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
        if (!html.includes(INLINE_HASHES_TOKEN)) throw new Error('index.html CSP is missing the inline-script-hashes token');
        return html.replace(INLINE_HASHES_TOKEN, hashes.join(' '));
      },
    },
  };
}
```

- Register it in `plugins`, after `monacoEditorPlugin(...)`.
- If the token survives (the plugin didn't run), it is an invalid source that Chromium ignores. The
  inline scripts are then blocked, and that shows at once as a theme flash plus CSP console errors.
  It never fails open.

### 2. The new policy — `index.html:7`

Before:
```
script-src 'self' 'unsafe-inline' 'unsafe-eval' file: data: blob: https: http:; worker-src 'self' blob:; child-src 'self' blob: board:;
```
After:
```
script-src 'self' 'inline-script-hashes' 'unsafe-eval' file: blob:; worker-src 'self' blob:; child-src 'self' blob: board: html-preview:; object-src 'none'; base-uri 'self';
```

- **Removed:**
  - `'unsafe-inline'`: replaced by the hashes.
  - `http:`, `https:`: no remote scripts.
  - `data:`: no `data:` scripts are used.
- **Kept:**
  - `file:`: the prod document is `file://`.
  - `blob:`.
- **Added:**
  - `html-preview:` (step 3).
  - `object-src 'none'`: no plugins in the main window. `plugins: true` exists for the PDF viewer in
    browser webviews, which have their own documents. Verify the PDF editor still opens (see
    Concerns).
  - `base-uri 'self'`: blocks an injected `<base>`.
- Update the bootstrap comment at `index.html:15-16` ("before React loads" → "before the renderer
  bundle loads") and add one line saying its hash is computed by `inlineScriptHashesPlugin`.

### 3. Serve the HTML preview from its own scheme — `html-preview://`

**3a. `src/main/main-setup.ts` `registerSchemesAsPrivileged`:** add

```ts
{
    // Native HTML preview documents (US-1590). A srcdoc frame would inherit the main window's
    // strict CSP; this scheme serves each preview with its own (the pre-US-1590 policy).
    scheme: "html-preview",
    privileges: { standard: true, secure: true },
},
```

**3b. New file `src/main/html-preview-protocol.ts`:**

```ts
/** Each preview's current HTML, keyed by its random id (the URL host). */
const previews = new Map<string, { html: string; owner: WebContents }>();

/** The policy a preview inherited from the main window before US-1590; kept verbatim so user HTML
 *  (inline scripts, CDN scripts) behaves exactly as before. */
const PREVIEW_CSP = "script-src 'self' 'unsafe-inline' 'unsafe-eval' file: data: blob: https: http:; worker-src 'self' blob:; child-src 'self' blob:;";

export function setHtmlPreview(owner: WebContents, id: string, html: string): void
export function clearHtmlPreview(id: string): void
export function initHtmlPreviewProtocol(partition: string): void
```

- **`setHtmlPreview`:**
  - Validate `id` against `/^[a-f0-9-]{36}$/`.
  - Store the entry.
  - Once per owner, add `owner.once("destroyed", …)` to drop every entry of that owner.
- **`initHtmlPreviewProtocol`:**
  - `session.fromPartition(partition).protocol.handle("html-preview", …)`.
  - Look up `new URL(request.url).hostname`.
  - Unknown id → `new Response("", { status: 404 })`.
  - Otherwise `new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": PREVIEW_CSP, "Cache-Control": "no-store" } })`.
  - Serve the same document for any path and query. The query is only a revision cache-buster.
- Call `initHtmlPreviewProtocol(appPartition)` next to `initBoardProtocol(appPartition)`
  (`main-setup.ts:161`).

**3c. IPC: follow the `registerBoard` endpoint pattern.**
- `src/ipc/api-types.ts`:
  - add `Endpoint.setHtmlPreview = "setHtmlPreview"` and
    `Endpoint.clearHtmlPreview = "clearHtmlPreview"`;
  - add their `Api` signatures `(id: string, html: string) => Promise<void>` and
    `(id: string) => Promise<void>`.
- Bind both in `src/ipc/main/core-handlers.ts` with `bindEndpoint`:
  - `setHtmlPreview` passes `event.sender` as the owner;
  - use a lazy `await import("../../main/html-preview-protocol")` like `board-handlers.ts:46-71`.
- Add the endpoints to that file's endpoint union type, if it has one.
- Expose them on the renderer `api` in `src/ipc/renderer/api.ts`, next to `registerBoard`
  (`:438-456`), using `executeOnce`.

**3d. `src/renderer/editors/html/HtmlBodyView.ts`:**
- Add `private readonly previewId = crypto.randomUUID();` and `private revision = 0;`.
- `applyContent(content)`:
  - Keep the `appliedSrcdoc` equality guard (rename it `appliedContent`).
  - Then:
    ```ts
    const revision = ++this.revision;
    void api.setHtmlPreview(this.previewId, next).then(() => {
        // A newer edit may have been sent while this one was in flight; only the latest loads.
        if (revision === this.revision && !this.isDisposed) {
            this.iframe.src = `html-preview://${this.previewId}/?r=${revision}`;
        }
    }, (error: unknown) => console.warn(`HTML preview update failed: ${errMessage(error)}`));
    ```
  - Use the view's existing disposed flag. If `VanillaView` has none, add a private flag set in
    `onDispose`.
- `onDispose`: `void api.clearHtmlPreview(this.previewId);`.
- Keep `injectedPrologue` and `injectedScript` unchanged. The frame is still sandboxed without
  `allow-same-origin`, so `location.origin` is still `"null"` and the prologue still applies.
- Update the file's comments that say `srcdoc`/`about:srcdoc` to describe `html-preview://`.

**3e. `src/renderer/scripting/api-wrapper/HtmlEditorFacade.ts:39`:** in the help text, replace
"sandboxed srcdoc iframe" with "sandboxed `html-preview://` iframe".

### 4. Document `webSecurity: false` — `src/main/open-window.ts:54`

Add a comment above the setting:

```ts
// webSecurity stays off (investigated in US-1590). The renderer reads cross-origin responses with
// Chromium fetch — favicon cache, Image editor, the in-app MCP client (which must send no Origin:
// the MCP servers refuse browser requests, US-1588), and user scripts' global fetch — and the dev
// origin (http://localhost) loads file:// media. It grants nothing an attacker in this window lacks:
// nodeIntegration already bypasses SOP. Guest content stays isolated (sandboxed preview, board://).
webSecurity: false,
```

### 5. Checks

`npm run typecheck`, `npm run lint`, `npm run build-prod`. Then check the built
`.vite/renderer/main_window/index.html`: its CSP must list two `sha256-` sources and no
`inline-script-hashes` token.

## Files changed

| File | Change |
|---|---|
| `vite.renderer.config.ts` | `inlineScriptHashesPlugin` |
| `index.html` | new CSP with the hash token; comment fixes |
| `src/main/main-setup.ts` | privileged `html-preview` scheme; `initHtmlPreviewProtocol(appPartition)` |
| `src/main/html-preview-protocol.ts` | **new**: preview store + protocol handler |
| `src/ipc/api-types.ts` | `setHtmlPreview` / `clearHtmlPreview` endpoints |
| `src/ipc/main/core-handlers.ts` | bind both endpoints |
| `src/ipc/renderer/api.ts` | expose both |
| `src/renderer/editors/html/HtmlBodyView.ts` | load from `html-preview://` instead of `srcdoc` |
| `src/renderer/scripting/api-wrapper/HtmlEditorFacade.ts` | help text |
| `src/main/open-window.ts` | `webSecurity` rationale comment |

**No changes needed:**
- `src/preload.ts`: its `MonacoEnvironment` stays as the fallback.
- `board-protocol-service.ts`: board pages already have their own CSP.
- `markdown-sanitize.ts` and `hast-dom.ts`: Markdown builds no scripts. The sanitizer's
  `srcdoc` drop stays.
- `McpConnectionManager.ts`: `webSecurity` stays off, so the US-1588 coupling note no longer applies.
- `browser-service.ts`: webviews are separate documents and do not inherit this CSP.

## Concerns / Open questions

1. **`object-src 'none'` is safe — resolved.** No main-window editor creates `<embed>` or `<object>`.
   `grep` for `createElement("embed"|"object")`, `pdfjs` and a PDF editor under `src/renderer/editors`
   finds none. PDFs open in a browser webview, which is a separate document.
2. **Preview behavior change.**
   - Relative URLs in a previewed document now resolve against `html-preview://<id>/`, so they get
     a 404. Before, they resolved against the app's own document (dev server root, or the packaged
     `index.html` folder). Neither ever found files next to the user's HTML, so nothing that worked
     before stops working.
   - Serving sibling files is a possible later improvement and is out of scope.
3. **Snapshot of the preview.** `window.screen.snapshot()` merges the preview's AX tree
   (`HtmlEditorFacade.ts:39`). A custom-scheme frame may become an out-of-process frame. The
   snapshot code already attaches to iframes (`src/renderer/automation/ref.ts`, `snapshot.ts`), but
   verify that preview text still appears.
4. **Preview frame navigation.**
   - A preview script doing `location.href = …` navigates its own frame away, as it did with
     `srcdoc`. No change.
   - The `will-frame-navigate` guard in `open-window.ts:202-227` only covers `board://` frames and is
     not extended here.
5. **Vite tag injection order.** The plan assumes that a `post` `transformIndexHtml` hook sees the
   tags injected by earlier hooks. Step 5's check of the built HTML, plus the live dev check below,
   prove it either way.

## Acceptance criteria

- Dev and prod both start with no CSP violations in the console. Check the main window console after:
  - opening a Monaco text page, a Markdown page with a Mermaid diagram, an image, a Draw page and a
    board;
  - running a script (`new Function` still works).
- The theme bootstrap still runs, so there is no background flash on a non-default theme.
- In the main window:
  - `document.head.append(Object.assign(document.createElement("script"), { textContent: "window.__csp1=1" }))`
    leaves `window.__csp1` unset;
  - a `<script src="https://example.com/x.js">` is blocked by CSP;
  - `<img src=x onerror="window.__csp2=1">` inserted with `innerHTML` leaves `window.__csp2` unset.
- HTML preview, for a file with an inline `<script>` that writes to the DOM and a CDN
  `<script src="https://cdn.jsdelivr.net/…">`:
  - both run as before;
  - link clicks are still blocked;
  - the `html:interact` ping still closes host menus;
  - `history.replaceState` mockups still render;
  - editing the source updates the preview.
- Closing an HTML page releases its preview entry. Reopening shows content, not a 404.
- The built `index.html` has two `sha256-` sources and no token.
- typecheck, lint and build-prod pass.

## Progress

- [x] Hash plugin + new CSP
- [x] `html-preview://` protocol, IPC, HtmlBodyView
- [x] `webSecurity` comment; facade help text
- [x] typecheck / lint / build-prod; built-HTML check
- [x] Live verification (dev, 2026-10-01):
  - **Main window.**
    - An injected inline `<script>`, an `innerHTML` `onerror=` handler and a remote jsDelivr
      `<script src>` are all blocked.
    - `new Function` works.
    - Both inline scripts' hashes match the live CSP.
    - No `securitypolicyviolation` events while opening Markdown + Mermaid (renders as an image),
      Monaco TypeScript, and an HTML preview. The Monaco TypeScript worker loads.
  - **HTML preview** (`html-preview://<id>/?r=N`).
    - An inline script and the jsDelivr lodash 4.17.21 script both run.
    - `history.replaceState('#tab')` renders.
    - An `<a>` click is still blocked.
    - Editing the source reloads the preview (`r=2`).
    - The sandbox holds: `self.origin` is `"null"`, parent access throws `SecurityError`, there is no
      `require`, and `localStorage` throws.
    - `window.screen.snapshot()` merges the preview's content (`f1-` refs), which resolves concern 3.
    - Closing the page → the entry returns 404.
    - Window reload → the old entry returns 404 and the restored page registers and renders a new
      preview.
  - **Prod.** The `build-prod` output has two matching `sha256-` sources and no token. The packaged
    app itself was not launched.
- Fixes made during verification (Claude):
  1. **`vite.renderer.config.ts`: hash after CRLF → LF normalization.** `index.html` has mixed line
     endings, and the browser hashes post-parse text, so the theme bootstrap was blocked in both dev
     and prod.
  2. **`HtmlBodyView.ts`: the prologue guard is now `self.origin`, not `location.origin`.** The latter
     reports `html-preview://<id>` now, so the history no-op silently stopped applying. It keeps
     the no-op proven in the packaged build.
  3. **`html-preview-protocol.ts`: an owner's previews are also dropped on its `did-navigate`.** A
     renderer reload keeps the same WebContents, so the entries would otherwise last until the window
     closed.
