# US-360: View Actual DOM — Include iframe Content

## Goal

Enhance "View Actual DOM" and "Show Resources" in the browser editor to capture and include iframe content in the output. Move DOM collection to the main process, which can iterate the webContents frame tree via Electron's `WebFrameMain` API and collect each frame's DOM — including cross-origin iframes. Use cheerio to parse the collected HTML and inject iframe content inside the corresponding `<iframe>` elements.

## Background

### Current implementation

The "View Actual DOM" menu item is defined in:
- **`src/renderer/editors/browser/BrowserWebviewModel.ts`** lines 468–484

Current code:
```typescript
// View Actual DOM (line 472)
const html = await webview.executeJavaScript(
    "document.documentElement.outerHTML",
);
```

The "Show Resources" feature (lines 487–501) uses the same pattern:
```typescript
// Show Resources (line 490)
const html = await webview.executeJavaScript(
    "document.documentElement.outerHTML",
);
const { extractHtmlResources } = await import("../../core/utils/html-resources");
const links = extractHtmlResources(html, { baseUrl: pageUrl });
```

Both call `executeJavaScript` on the `<webview>` element in the renderer, which only executes in the main frame of the guest page. Iframes are separate browsing contexts and their DOM is not included.

### Main process browser service

- **`src/main/browser-service.ts`** — manages registered webviews in a `registrations` Map keyed by `${tabId}/${internalTabId}`. Each registration holds a `webContents` reference.
- **`src/ipc/browser-ipc.ts`** — IPC channel definitions (`BrowserChannel` object)

### Electron frame tree API

`WebContents.mainFrame` returns a `WebFrameMain` which has:
- `framesInSubtree: WebFrameMain[]` — all descendant frames (confirmed in `node_modules/electron/electron.d.ts:18356`)
- `executeJavaScript(code): Promise<any>` — execute JS in that specific frame
- `url: string` — the frame's current URL
- `name: string` — the frame's name attribute

This runs at the Electron/Chromium level, not subject to web same-origin policy.

### Existing patterns

- `ipcRenderer` is already imported at line 1 of `BrowserWebviewModel.ts`: `const { ipcRenderer } = require("electron");`
- `BrowserChannel` is imported from `../../../ipc/browser-ipc`
- `ipcMain.handle` pattern is used for `clearProfileData` and `clearCache` in `browser-service.ts` (lines 407–420)
- cheerio `^1.2.0` is in `package.json` dependencies (line 54)

## Implementation Plan

### Step 1: Add new IPC channel

**File: `src/ipc/browser-ipc.ts`**

Add to the `BrowserChannel` object, in the "Renderer → Main" section:

```typescript
// Before:
/** Clear only HTTP cache (not cookies/storage) for a given partition. Returns when done. */
clearCache: "browser:clear-cache",

// After:
/** Clear only HTTP cache (not cookies/storage) for a given partition. Returns when done. */
clearCache: "browser:clear-cache",
/** Renderer → Main (invoke): collect full DOM including iframe content. Args: (key: string) */
collectDom: "browser:collect-dom",
```

### Step 2: Implement DOM collection in main process

**File: `src/main/browser-service.ts`**

Add `import * as cheerio from "cheerio";` at the top (after existing imports).

Add a `collectDom` function before `initBrowserHandlers`:

```typescript
/**
 * Collect the full DOM from a registered webview, including all iframe content.
 * Uses Electron's WebFrameMain API to iterate all frames in the subtree and
 * cheerio to inject each iframe's DOM into the corresponding <iframe> element.
 */
async function collectDom(key: string): Promise<string> {
    const reg = registrations.get(key);
    if (!reg || reg.webContents.isDestroyed()) return "";

    const mainFrame = reg.webContents.mainFrame;

    // Collect DOM from main frame
    const mainHtml: string = await mainFrame.executeJavaScript(
        "document.documentElement.outerHTML"
    );

    // Collect DOM from all child frames
    const childFrames = mainFrame.framesInSubtree.filter(f => f !== mainFrame);
    if (childFrames.length === 0) return mainHtml;

    // Build a map of frame URL → collected HTML
    // Multiple frames can share the same URL, so we use an array
    const frameResults: Array<{ url: string; name: string; html: string }> = [];
    
    for (const frame of childFrames) {
        try {
            const frameHtml: string = await frame.executeJavaScript(
                "document.documentElement.outerHTML"
            );
            frameResults.push({
                url: frame.url || "",
                name: frame.name || "",
                html: frameHtml,
            });
        } catch {
            // Frame may have been destroyed or navigated away — skip
        }
    }

    if (frameResults.length === 0) return mainHtml;

    // Use cheerio to find <iframe> elements and inject content
    const $ = cheerio.load(mainHtml, { xml: { xmlMode: false } });
    const unmatched: typeof frameResults = [];

    for (const result of frameResults) {
        let matched = false;

        // Try to match by src attribute
        if (result.url && result.url !== "about:blank") {
            $("iframe").each((_i, el) => {
                if (matched) return;
                const src = $(el).attr("src") || "";
                // Match if the iframe src is contained in the frame URL or vice versa
                // (handles relative vs absolute URLs, redirects, etc.)
                if (src && (result.url.includes(src) || src.includes(result.url) || urlsMatch(src, result.url))) {
                    injectContent($, el, result);
                    matched = true;
                    return false; // break .each()
                }
            });
        }

        // Try to match by name attribute
        if (!matched && result.name) {
            $("iframe").each((_i, el) => {
                if (matched) return;
                const name = $(el).attr("name") || "";
                if (name && name === result.name) {
                    injectContent($, el, result);
                    matched = true;
                    return false;
                }
            });
        }

        if (!matched) {
            unmatched.push(result);
        }
    }

    // For unmatched frames, try matching by index order
    // (iframes without src or name, or with mismatched URLs)
    if (unmatched.length > 0) {
        const emptyIframes = $("iframe").filter((_i, el) => {
            return $(el).children().length === 0 && !$(el).attr("data-dom-injected");
        });
        
        for (let i = 0; i < unmatched.length && i < emptyIframes.length; i++) {
            injectContent($, emptyIframes[i], unmatched[i]);
        }

        // Any remaining unmatched frames: append at end of body
        for (let i = emptyIframes.length; i < unmatched.length; i++) {
            const result = unmatched[i];
            const comment = `\n<!-- ===== UNMATCHED IFRAME: src="${result.url}"${result.name ? ` name="${result.name}"` : ""} ===== -->`;
            $("body").append(comment + "\n" + result.html + "\n");
        }
    }

    return $.html();
}

/** Inject iframe DOM content inside an <iframe> element. */
function injectContent(
    $: cheerio.CheerioAPI,
    el: cheerio.Element,
    result: { url: string; name: string; html: string },
) {
    const $el = $(el);
    const comment = `<!-- IFRAME DOM: src="${result.url}"${result.name ? ` name="${result.name}"` : ""} -->`;
    $el.attr("data-dom-injected", "true");
    $el.html(comment + "\n" + result.html);
}

/** Compare two URLs ignoring protocol, trailing slashes, and fragment. */
function urlsMatch(a: string, b: string): boolean {
    try {
        const urlA = new URL(a, "http://base");
        const urlB = new URL(b, "http://base");
        const normalize = (u: URL) =>
            (u.hostname + u.pathname).replace(/\/+$/, "") + u.search;
        return normalize(urlA) === normalize(urlB);
    } catch {
        return false;
    }
}
```

Register the handler inside `initBrowserHandlers()`, after the `clearCache` handler (after line 420):

```typescript
ipcMain.handle(BrowserChannel.collectDom, async (_event, key: string) => {
    return collectDom(key);
});
```

### Step 3: Update renderer to use new IPC channel

**File: `src/renderer/editors/browser/BrowserWebviewModel.ts`**

**Change 1: "View Actual DOM" (lines 471–474)**

Before:
```typescript
onClick: async () => {
    const html = await webview.executeJavaScript(
        "document.documentElement.outerHTML",
    );
```

After:
```typescript
onClick: async () => {
    const key = `${this.model.page.tabId}/${tab!.internalTabId}`;
    const html = await ipcRenderer.invoke(BrowserChannel.collectDom, key);
```

**Change 2: "Show Resources" (lines 489–492)**

Before:
```typescript
onClick: async () => {
    const html = await webview.executeJavaScript(
        "document.documentElement.outerHTML",
    );
```

After:
```typescript
onClick: async () => {
    const key = `${this.model.page.tabId}/${tab!.internalTabId}`;
    const html = await ipcRenderer.invoke(BrowserChannel.collectDom, key);
```

Note: `ipcRenderer` is already imported at line 1. `BrowserChannel` is already imported. The `tab` variable is available in scope (declared at line 427). `this.model.page.tabId` provides the page tab ID.

### Step 4: Edge cases handled

- **Frame destroyed during collection:** try/catch around each `frame.executeJavaScript()` — skipped silently
- **about:blank frames:** URL matching skips them, falls through to index-based matching
- **Deeply nested iframes:** `framesInSubtree` returns ALL descendant frames; cheerio injection works recursively since we process the flat list and inject into the main frame HTML
- **URL mismatch (redirects):** `urlsMatch()` normalizes URLs; fallback to name matching, then index matching, then append at end
- **Multiple iframes with same URL:** Each match consumes one `<iframe>` element (via `data-dom-injected` attribute preventing re-match)
- **No iframes on page:** Early return of main frame HTML when `childFrames.length === 0`

## Files Changed

| File | Change |
|------|--------|
| `src/ipc/browser-ipc.ts` | Add `collectDom` channel |
| `src/main/browser-service.ts` | Add `collectDom()`, `injectContent()`, `urlsMatch()` functions + handler |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Update "View Actual DOM" and "Show Resources" to use `collectDom` IPC |

### Files NOT changed

- `src/renderer/editors/browser/BrowserEditorModel.ts` — no changes needed
- `src/renderer/editors/browser/BrowserEditorView.tsx` — no changes needed
- `src/renderer/core/utils/html-resources.ts` — receives HTML string, doesn't care where it came from
- `src/ipc/browser-ipc.ts` types — no new types needed, the channel returns a plain string

## Acceptance Criteria

- [ ] "View Actual DOM" on a page with iframes includes iframe DOM content inside the `<iframe>` elements
- [ ] Original `<iframe>` elements are preserved with their attributes; content is injected inside them
- [ ] Each injected iframe DOM is marked with a comment showing the iframe's src URL
- [ ] "Show Resources" also uses the full DOM with iframe contents
- [ ] Main frame DOM is still captured correctly (no regression for pages without iframes)
- [ ] Frames that fail to return DOM (destroyed, navigated away) are handled gracefully
- [ ] Works with nested iframes (iframe inside iframe)
- [ ] Works with cross-origin iframes
