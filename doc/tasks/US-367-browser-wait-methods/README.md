# US-367: Browser Wait Methods

## Goal

Add wait methods to the browser scripting API: `waitForSelector`, `waitForNavigation`, and `wait`. These are essential for automation scripts that need to wait for page loads, dynamic content, and SPA transitions before interacting with elements.

## Background

### Current state (after US-366)

`BrowserEditorFacade` has query methods (`getText`, `exists`, etc.) and interaction methods (`click`, `type`, etc.), all using `CdpSession.evaluate()`. But there's no way to wait for:
- A page to finish loading after `navigate()` or `click()`
- An element to appear on the page (SPA rendering, lazy loading)
- A simple delay

### Implementation approach

**`waitForSelector`** — Poll via `evaluate()` in a loop with configurable interval and timeout. Use `requestAnimationFrame`-based polling inside the page (via single `evaluate` call with a promise) for efficiency — avoids repeated IPC roundtrips.

**`waitForNavigation`** — Use CDP `Page.lifecycleEvent` with `"load"` event name. Enable `Page.enable` first, then listen for the event via `CdpSession`. Alternatively, simpler approach: poll the model's `loading` state. But CDP approach is more reliable and doesn't depend on the model update timing.

Actually, the simplest reliable approach: inject a promise in the page that resolves on `window.addEventListener("load")`, with a timeout. But this doesn't work for SPA navigations (no full page load). 

**Recommended approach for `waitForNavigation`:** Poll-based using `CdpSession.evaluate()` — check `document.readyState === "complete"`. For SPA navigations, the caller should use `waitForSelector` instead (wait for the expected content to appear).

**`wait`** — Simple `setTimeout` wrapped in a promise. Runs in the script context (not the page).

### Key files

| File | Purpose |
|------|---------|
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Add wait methods |
| `src/renderer/api/types/browser-editor.d.ts` | Type definitions |
| `assets/editor-types/browser-editor.d.ts` | IntelliSense copy |

## Implementation Plan

### Step 1: Add wait methods to BrowserEditorFacade

**File: `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`**

```typescript
/**
 * Wait for an element matching the selector to appear in the DOM.
 * Polls inside the page using requestAnimationFrame for efficiency.
 * @param timeout — max wait time in ms (default 30000)
 */
async waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 30000;
    const s = JSON.stringify(selector);
    const found = await this.cdp().evaluate(`new Promise((resolve, reject) => {
        const timeout = ${timeout};
        if (document.querySelector(${s})) { resolve(true); return; }
        const start = Date.now();
        const check = () => {
            if (document.querySelector(${s})) { resolve(true); return; }
            if (Date.now() - start > timeout) {
                reject(new Error('Timeout waiting for selector: ' + ${s}));
                return;
            }
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    })`);
}

/**
 * Wait for the page to finish loading (document.readyState === "complete").
 * Useful after navigate() or clicking a link that triggers full page load.
 * For SPA navigations, use waitForSelector() instead.
 * @param timeout — max wait time in ms (default 30000)
 */
async waitForNavigation(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 30000;
    await this.cdp().evaluate(`new Promise((resolve, reject) => {
        const timeout = ${timeout};
        if (document.readyState === 'complete') { resolve(true); return; }
        const start = Date.now();
        const check = () => {
            if (document.readyState === 'complete') { resolve(true); return; }
            if (Date.now() - start > timeout) {
                reject(new Error('Timeout waiting for navigation'));
                return;
            }
            setTimeout(check, 100);
        };
        setTimeout(check, 100);
    })`);
}

/**
 * Wait for a specified number of milliseconds.
 * Runs in the script context (not the page).
 */
async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Key design decisions:**

- **`waitForSelector` uses `requestAnimationFrame` inside the page** — this is a single `evaluate()` call that returns a promise. The `awaitPromise: true` on `Runtime.evaluate` handles the async wait. No repeated IPC roundtrips.
- **`waitForNavigation` uses `setTimeout` polling** — checks `document.readyState` every 100ms. Works for full page loads. For SPAs, users should use `waitForSelector`.
- **`wait` runs in script context** — simple `setTimeout` promise, doesn't involve the page at all.
- **Default timeout is 30 seconds** — matches Playwright's default. Configurable via options.
- **Clear error messages** — timeout errors include the selector or "navigation" context.

### Step 2: Update type definitions

**File: `src/renderer/api/types/browser-editor.d.ts`** (and `assets/editor-types/browser-editor.d.ts`)

```typescript
// --- Wait methods ---

/**
 * Wait for an element matching the selector to appear in the DOM.
 * @param timeout — max wait time in ms (default 30000)
 */
waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;

/**
 * Wait for the page to finish loading (document.readyState === "complete").
 * Useful after navigate() or clicking a link that triggers full page load.
 * For SPA navigations, use waitForSelector() instead.
 * @param timeout — max wait time in ms (default 30000)
 */
waitForNavigation(options?: { timeout?: number }): Promise<void>;

/**
 * Wait for a specified number of milliseconds.
 */
wait(ms: number): Promise<void>;
```

### Step 3: Keep both type files in sync

Copy `src/renderer/api/types/browser-editor.d.ts` to `assets/editor-types/browser-editor.d.ts`.

## Edge Cases

- **Element already exists:** `waitForSelector` resolves immediately (checked before starting the poll loop).
- **Page already loaded:** `waitForNavigation` resolves immediately if `readyState === "complete"`.
- **Timeout:** Both methods reject with a descriptive `Error` including the selector or "navigation" context.
- **Page navigates away during wait:** The `evaluate()` promise may be rejected by CDP if the page navigates. This is acceptable — the script gets an error and can retry.
- **`requestAnimationFrame` throttling:** Browsers throttle `requestAnimationFrame` in background tabs (~1fps). For hidden tabs, polling may be slower but still works. Could use `setTimeout(check, 100)` as alternative if RAF throttling is a problem.
- **`wait(0)`:** Resolves on next microtask (standard `setTimeout(resolve, 0)` behavior).

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Add `waitForSelector`, `waitForNavigation`, `wait` |
| `src/renderer/api/types/browser-editor.d.ts` | Add 3 method signatures |
| `assets/editor-types/browser-editor.d.ts` | Mirror copy |

## Acceptance Criteria

- [ ] `waitForSelector(selector)` resolves when element appears, rejects on timeout
- [ ] `waitForSelector` resolves immediately if element already exists
- [ ] `waitForNavigation()` resolves when `readyState === "complete"`, rejects on timeout
- [ ] `waitForNavigation` resolves immediately if page already loaded
- [ ] `wait(ms)` delays for the specified milliseconds
- [ ] Default timeout is 30 seconds for both wait methods
- [ ] Custom timeout via `{ timeout: ms }` option
- [ ] Clear error messages on timeout
- [ ] Type definitions updated in both source and assets
