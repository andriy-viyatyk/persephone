# US-378: Browser Automation — Known Issues & Edge Cases

## Goal

Collect and fix known issues discovered during EPIC-021 implementation and testing. Review at the end of the epic before marking it complete.

## Issues

### 1. `browser_navigate` returns empty snapshot

**Severity:** Medium
**Found during:** US-369 testing, US-375 verification

The `browserNavigate()` function in `automation/commands.ts` calls `target.navigate(url)` then waits via CDP `Runtime.evaluate` polling `document.readyState`. The problem: `readyState === 'complete'` resolves immediately on the **old** page before the webview starts loading the new URL. By the time `snapshot()` runs, the page is mid-navigation and the accessibility tree is empty.

**Root cause:** `BrowserEditorModel.navigate()` updates state asynchronously — the webview picks up the URL change via a React effect, so there's a gap between the navigate call and the actual page load starting.

**Possible fix:** After calling `navigate()`, wait for the webview to start loading (detect `readyState !== 'complete'` or listen for CDP `Page.frameNavigated` event), then wait for it to finish.

---

### 2. `browser_type` doesn't work with contentEditable (Trusted Types)

**Severity:** Medium
**Found during:** US-369 Gmail testing

The current `browser_type` uses `Runtime.evaluate` to set `el.value` or `el.textContent`. Gmail and other sites with Trusted Types CSP policies block `innerHTML`/`textContent` assignment. Also, `el.value` doesn't work on contentEditable elements (like Gmail's compose body).

**Root cause:** DOM manipulation from page JS context is subject to CSP. Playwright uses CDP `Input.dispatchKeyEvent` / `Input.insertText` which execute at the browser process level, bypassing CSP.

**Fix planned:** US-376 (Input dispatch via CDP).

---

### 3. `browser_press_key("Tab")` doesn't always move focus

**Severity:** Low
**Found during:** US-369 Gmail testing

Pressing Tab via CDP `Input.dispatchKeyEvent` doesn't always move focus between elements (e.g., from Gmail's "To" field to "Body"). The page may have custom Tab key handling or focus trapping.

**Workaround:** Explicitly click/focus the target element before typing.

**Possible fix:** Use CDP `DOM.focus` on the target element before dispatching key events. Or implement a `browser_focus` tool.

---

### 4. Snapshot doesn't include iframe content

**Severity:** Medium
**Found during:** US-369 Gmail testing (feedback popup invisible in snapshot)

CDP `Accessibility.getFullAXTree` only returns the main frame's accessibility tree. Content inside iframes (e.g., Google's feedback popup) is invisible to the snapshot.

**Fix planned:** US-374 (iframe snapshot traversal).

---

### 5. `browser_wait_for` text mode uses `:has-text()` pseudo-selector

**Severity:** Low
**Found during:** Code review

The old `browserWaitFor` in mcp-handler.ts used `facade.waitForSelector('*:has-text("...")')` for text-based waiting. This pseudo-selector is not standard CSS — it's a Playwright extension. The refactored `commands.ts` uses `document.body.innerText.includes()` instead, which is correct, but should be verified on complex pages.

---

### 6. `browser_network_requests` accesses model internals

**Severity:** Low — cosmetic
**Found during:** US-375 refactoring

The old code used `(facade as any).model` to access the model's ID and activeTabId for the network log IPC call. The refactored version uses `IBrowserTarget` cleanly (`target.id` and `target.activeTab.id`), so this issue is already fixed.

**Status:** Fixed in US-375.

---

### 7. `slowly: true` doesn't work on Gmail's To field

**Severity:** Low
**Found during:** US-376 testing

`browser_type` with `slowly: true` on Gmail's To recipients input fails — text doesn't appear. The `typeSlowly` function calls `el.select()` in one evaluate, then `webview.insertText()` per character in separate calls. Gmail intercepts focus between them.

Works fine on Subject (`<input>`) and Body (contentEditable). The default mode (`slowly: false`) works on all fields.

---

### 8. CDP `Input.*` commands don't work in Electron `<webview>`

**Severity:** High — architectural
**Found during:** US-376 implementation

CDP `Input.dispatchKeyEvent` and `Input.insertText` produce no effect in Electron `<webview>` elements. The events don't cross the guest process isolation boundary. This is a known Chromium limitation confirmed by Electron, Playwright, and Puppeteer issue trackers.

**Workarounds implemented in US-376:**
- `<input>`: Native prototype `.value` setter via `Runtime.evaluate` (atomic)
- contentEditable: `webview.insertText()` (Electron native API)
- Key presses: JS `KeyboardEvent` dispatch via `Runtime.evaluate`

**Status:** Documented, workarounds in place.

---

### 9. Gmail has duplicate `[aria-label="Message Body"]` elements

**Severity:** Medium
**Found during:** US-376 testing

Gmail compose has a hidden `<textarea>` and a visible contentEditable `<div>`, both with `aria-label="Message Body"`. `querySelector` returns the hidden one first, causing type commands to target the wrong element.

**Fix implemented in US-376:** `focusElementBySelector` now checks visibility — if first match is hidden (`offsetHeight === 0`), scans all matches for a visible alternative.

**Status:** Fixed in US-376.

---

## Review Checklist

- [ ] Issue 1: Navigate snapshot race condition
- [x] Issue 2: Trusted Types / contentEditable (fixed in US-376)
- [ ] Issue 3: Tab key focus behavior
- [ ] Issue 4: Iframe content in snapshot (→ US-374)
- [ ] Issue 5: Wait-for-text implementation
- [x] Issue 6: Network requests model access (fixed in US-375)
- [ ] Issue 7: slowly: true on Gmail To field
- [x] Issue 8: CDP Input.* limitation (documented, workarounds in US-376)
- [x] Issue 9: Duplicate aria-label elements (fixed in US-376)
