# US-366: Browser Query and Interaction API

## Goal

Add high-level query and interaction methods to the browser scripting API: `getText`, `getValue`, `getAttribute`, `getHtml`, `exists`, `click`, `type`, `select`, `check`, `uncheck`, `clear`. All methods delegate to `CdpSession.evaluate()` (established in US-365) with injected JavaScript that queries/manipulates the DOM in the guest page.

## Background

### Current state (after US-365)

`BrowserEditorFacade` exposes:
- `url`, `title` — read-only getters
- `navigate()`, `back()`, `forward()`, `reload()` — navigation
- `evaluate(expression)` — run arbitrary JS in the page, returns result
- `cdp()` — get raw `CdpSession` for advanced use

`CdpSession.evaluate(expression)` uses `Runtime.evaluate` CDP command with `returnByValue: true` and `awaitPromise: true`.

### Implementation approach

All new methods are thin wrappers around `evaluate()` with injected JavaScript. The JS runs in the guest page context where `document.querySelector` and DOM APIs are natively available.

For interaction methods (click, type), we use JS-level DOM manipulation:
- `element.click()` for clicks
- `element.focus()` + set `.value` + dispatch `InputEvent`/`Event('change')` for typing — this triggers React/Angular/Vue change detection
- `element.dispatchEvent(new MouseEvent('click'))` as fallback for stubborn elements

We do NOT use `Input.dispatchMouseEvent` or `Input.dispatchKeyEvent` CDP commands in this task. Those are lower-level and require element coordinates. If JS-level interaction proves insufficient for specific SPAs, `sendInputEvent`-based methods can be added in a follow-up.

### Files to modify

| File | Current state |
|------|--------------|
| `src/renderer/api/types/browser-editor.d.ts` | 7 methods (nav + evaluate) |
| `assets/editor-types/browser-editor.d.ts` | Same (script IntelliSense copy) |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | 8 methods (nav + evaluate + cdp) |

## Implementation Plan

### Step 1: Add query and interaction methods to BrowserEditorFacade

**File: `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`**

All methods follow the same pattern — build a JS snippet, pass to `this.cdp().evaluate()`:

```typescript
/** Get textContent of an element. Returns null if not found. */
async getText(selector: string): Promise<string | null> {
    return this.cdp().evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`
    );
}

/** Get the value of an input/textarea/select. Returns null if not found. */
async getValue(selector: string): Promise<string | null> {
    return this.cdp().evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.value ?? null`
    );
}

/** Get an attribute value. Returns null if element or attribute not found. */
async getAttribute(selector: string, attribute: string): Promise<string | null> {
    return this.cdp().evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(attribute)}) ?? null`
    );
}

/** Get innerHTML of an element. Returns null if not found. */
async getHtml(selector: string): Promise<string | null> {
    return this.cdp().evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.innerHTML ?? null`
    );
}

/** Check if an element exists on the page. */
async exists(selector: string): Promise<boolean> {
    return this.cdp().evaluate(
        `!!document.querySelector(${JSON.stringify(selector)})`
    );
}

/** Click an element. Throws if not found. */
async click(selector: string): Promise<void> {
    await this.cdp().evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        el.scrollIntoView({ block: 'center' });
        el.click();
    })()`);
}

/** Type text into an input/textarea. Clears existing value first. Throws if not found. */
async type(selector: string, text: string): Promise<void> {
    await this.cdp().evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
}

/** Select an option in a <select> element by value. Throws if not found. */
async select(selector: string, value: string): Promise<void> {
    await this.cdp().evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
}

/** Check a checkbox or radio button. Throws if not found. */
async check(selector: string): Promise<void> {
    await this.cdp().evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        if (!el.checked) {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    })()`);
}

/** Uncheck a checkbox. Throws if not found. */
async uncheck(selector: string): Promise<void> {
    await this.cdp().evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        if (el.checked) {
            el.checked = false;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    })()`);
}

/** Clear the value of an input/textarea. Throws if not found. */
async clear(selector: string): Promise<void> {
    await this.cdp().evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
}
```

**Key patterns:**
- `JSON.stringify(selector)` prevents injection — selector is safely embedded in the JS string
- Query methods return `null` when element not found (non-destructive)
- Interaction methods `throw` when element not found (fail fast)
- `scrollIntoView` before click ensures element is in viewport
- `dispatchEvent(new Event('input/change', { bubbles: true }))` triggers framework change detection (React, Angular, Vue all listen for these)

### Step 2: Update type definitions

**File: `src/renderer/api/types/browser-editor.d.ts`** (and `assets/editor-types/browser-editor.d.ts`)

Add all new methods to `IBrowserEditor`:

```typescript
// --- Query methods ---

/** Get textContent of an element. Returns null if not found. */
getText(selector: string): Promise<string | null>;

/** Get the value of an input/textarea/select. Returns null if not found. */
getValue(selector: string): Promise<string | null>;

/** Get an attribute value. Returns null if element or attribute not found. */
getAttribute(selector: string, attribute: string): Promise<string | null>;

/** Get innerHTML of an element. Returns null if not found. */
getHtml(selector: string): Promise<string | null>;

/** Check if an element exists on the page. */
exists(selector: string): Promise<boolean>;

// --- Interaction methods ---

/** Click an element. Throws if not found. */
click(selector: string): Promise<void>;

/** Type text into an input/textarea. Clears existing value first. Throws if not found. */
type(selector: string, text: string): Promise<void>;

/** Select an option in a <select> element by value. Throws if not found. */
select(selector: string, value: string): Promise<void>;

/** Check a checkbox or radio button. Throws if not found. */
check(selector: string): Promise<void>;

/** Uncheck a checkbox. Throws if not found. */
uncheck(selector: string): Promise<void>;

/** Clear the value of an input/textarea. Throws if not found. */
clear(selector: string): Promise<void>;
```

### Step 3: Keep both type files in sync

Both `src/renderer/api/types/browser-editor.d.ts` and `assets/editor-types/browser-editor.d.ts` must have identical content. The assets copy provides IntelliSense in the script editor.

## Edge Cases

- **Selector matches nothing:** Query methods return `null`. Interaction methods throw with a clear error message including the selector.
- **Selector injection:** `JSON.stringify(selector)` safely embeds the selector string — no code injection possible.
- **Frameworks (React, Angular, Vue):** Setting `.value` directly doesn't trigger framework change detection. The `dispatchEvent(new Event('input/change', { bubbles: true }))` pattern is the standard workaround — all major frameworks listen for these bubbling events.
- **Disabled elements:** `element.click()` on a disabled button is a no-op in browsers (doesn't fire click event). This matches real user behavior.
- **Hidden elements:** `element.click()` works on `display: none` / `visibility: hidden` elements at the JS level. `scrollIntoView` may not work for invisible elements, but the click still fires.
- **Multiple matches:** `querySelector` returns the first match. If users need "click the 3rd button", they use `evaluate()` with custom JS.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Add 11 methods |
| `src/renderer/api/types/browser-editor.d.ts` | Add 11 method signatures to `IBrowserEditor` |
| `assets/editor-types/browser-editor.d.ts` | Mirror of above (script IntelliSense) |

### Files NOT changed

- `src/renderer/editors/browser/CdpSession.ts` — `evaluate()` already handles everything
- `src/main/cdp-service.ts` — no changes needed
- `src/ipc/browser-ipc.ts` — no new IPC channels

## Acceptance Criteria

- [ ] `getText(selector)` returns element's textContent or null
- [ ] `getValue(selector)` returns input/textarea value or null
- [ ] `getAttribute(selector, attr)` returns attribute value or null
- [ ] `getHtml(selector)` returns innerHTML or null
- [ ] `exists(selector)` returns boolean
- [ ] `click(selector)` clicks element, throws if not found
- [ ] `type(selector, text)` types text into input, triggers change events
- [ ] `select(selector, value)` selects dropdown option, triggers change event
- [ ] `check(selector)` / `uncheck(selector)` toggles checkbox
- [ ] `clear(selector)` clears input value, triggers change events
- [ ] All methods work on hidden (`display: none`) browser tabs
- [ ] Type definitions updated in both source and assets
- [ ] Script IntelliSense shows all new methods
