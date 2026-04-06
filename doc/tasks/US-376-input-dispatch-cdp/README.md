# US-376: Input Dispatch via CDP (Trusted Types Fix)

## Goal

Replace DOM-based text input (`el.value = text`) with CDP `Input.dispatchKeyEvent` / `Input.insertText` so that `browser_type` and `browser_press_key` work on all pages including those with Trusted Types CSP (Gmail, Google Workspace, etc.) and contentEditable elements.

## Background

### Current implementation (broken on Trusted Types sites)

**`browser_type`** in `automation/commands.ts` (lines 120-141):
```typescript
// Selector path
await target.cdp().evaluate(`(() => {
    const el = document.querySelector(${s});
    el.focus();
    el.value = ${JSON.stringify(text)};                    // ← FAILS on contentEditable
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
})()`);

// Ref path (callOnRef)
`function() { this.focus(); this.value = ${JSON.stringify(text)}; ... }`  // ← same problem
```

**`browser_press_key`** in `automation/commands.ts` (lines 164-171):
```typescript
await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key });
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key });
// Missing: windowsVirtualKeyCode, code, text, modifiers, location
```

**`BrowserEditorFacade.type()`** in `scripting/api-wrapper/BrowserEditorFacade.ts` (lines 165-175):
```typescript
el.focus();
el.value = ${JSON.stringify(text)};           // Same DOM assignment approach
el.dispatchEvent(new Event('input', { bubbles: true }));
```

### Problems

1. **Trusted Types CSP** — Sites like Gmail block `innerHTML`/`textContent` assignment from page JS
2. **contentEditable** — `el.value` doesn't exist on contentEditable divs (Gmail compose body, rich text editors)
3. **Incomplete key events** — `browser_press_key` sends only `key` without `windowsVirtualKeyCode`, `code`, `text` — many sites don't respond correctly
4. **No select-all before fill** — Doesn't clear existing content in contentEditable elements

### Playwright's approach (from source investigation)

Playwright uses two strategies:

**`fill()` (default for `browser_type` MCP tool):**
1. Focus the element
2. Select all existing content (Ctrl+A / Meta+A)
3. Call `Input.insertText({ text })` — bulk text insertion at browser process level
4. Bypasses CSP/Trusted Types completely

**`pressSequentially()` (opt-in via `slowly: true`):**
1. For each character:
   - If char is in keyboard layout → `Input.dispatchKeyEvent` with full params
   - If char is not on keyboard (emoji, unicode) → `Input.insertText`

**CDP `Input.dispatchKeyEvent` full params** (from `crInput.ts`):
```typescript
// keyDown
{
    type: text ? 'keyDown' : 'rawKeyDown',
    modifiers: toModifiersMask(modifiers),
    windowsVirtualKeyCode: description.keyCodeWithoutLocation,
    code,        // e.g. "KeyA", "Enter", "Tab"
    key,         // e.g. "a", "Enter", "Tab"
    text,        // e.g. "a", "\r", undefined
    unmodifiedText: text,
    autoRepeat,
    location,
    isKeypad: location === 3
}
// keyUp
{
    type: 'keyUp',
    modifiers: toModifiersMask(modifiers),
    key,
    windowsVirtualKeyCode: description.keyCodeWithoutLocation,
    code,
    location
}
```

**CDP `Input.insertText`** — simple, powerful:
```typescript
{ text: "Hello world" }  // Inserted at cursor, bypasses CSP
```

### Key layout data

Playwright ships a `USKeyboardLayout` (from `usKeyboardLayout.ts`, Apache 2.0 licensed, originally from Puppeteer/Google) mapping key names to `{ keyCode, key, code, text, shiftKey, location }`. We need a subset of this for `browser_press_key`.

## Implementation Plan

### Step 1: Create `automation/input.ts` — keyboard layout + helpers

```typescript
/** Key definition for CDP Input.dispatchKeyEvent. */
export interface KeyDefinition {
    key: string;
    keyCode: number;
    code?: string;
    text?: string;
    location?: number;
}

/**
 * US keyboard layout subset — maps key names to CDP parameters.
 * Derived from Playwright's USKeyboardLayout (Apache 2.0, originally Puppeteer/Google).
 * Only includes keys needed for browser automation (not full 104-key layout).
 */
const KEY_DEFINITIONS: Record<string, KeyDefinition> = {
    // Letters (a-z) — generated programmatically
    // Digits (0-9) — generated programmatically
    "Backspace": { key: "Backspace", keyCode: 8, code: "Backspace" },
    "Tab":       { key: "Tab", keyCode: 9, code: "Tab" },
    "Enter":     { key: "Enter", keyCode: 13, code: "Enter", text: "\r" },
    "Escape":    { key: "Escape", keyCode: 27, code: "Escape" },
    " ":         { key: " ", keyCode: 32, code: "Space" },
    "ArrowLeft": { key: "ArrowLeft", keyCode: 37, code: "ArrowLeft" },
    "ArrowUp":   { key: "ArrowUp", keyCode: 38, code: "ArrowUp" },
    "ArrowRight":{ key: "ArrowRight", keyCode: 39, code: "ArrowRight" },
    "ArrowDown": { key: "ArrowDown", keyCode: 40, code: "ArrowDown" },
    "Delete":    { key: "Delete", keyCode: 46, code: "Delete" },
    // ... F1-F12, Home, End, PageUp, PageDown
    // Modifiers
    "Shift":   { key: "Shift", keyCode: 16, code: "ShiftLeft", location: 1 },
    "Control": { key: "Control", keyCode: 17, code: "ControlLeft", location: 1 },
    "Alt":     { key: "Alt", keyCode: 18, code: "AltLeft", location: 1 },
    "Meta":    { key: "Meta", keyCode: 91, code: "MetaLeft", location: 1 },
};

// Generate a-z entries
for (let i = 0; i < 26; i++) {
    const lower = String.fromCharCode(97 + i);  // 'a'
    const upper = String.fromCharCode(65 + i);  // 'A'
    const code = `Key${upper}`;
    const keyCode = 65 + i;
    KEY_DEFINITIONS[lower] = { key: lower, keyCode, code, text: lower };
    KEY_DEFINITIONS[upper] = { key: upper, keyCode, code, text: upper };
}

// Generate 0-9
for (let i = 0; i < 10; i++) {
    const d = String(i);
    KEY_DEFINITIONS[d] = { key: d, keyCode: 48 + i, code: `Digit${d}`, text: d };
}
```

**Public functions:**

```typescript
import type { CdpSession } from "./CdpSession";

/**
 * Insert text at the current cursor position via CDP.
 * Bypasses Trusted Types CSP. Works on contentEditable.
 * This is the equivalent of Playwright's fill() — bulk text insertion.
 */
export async function insertText(cdp: CdpSession, text: string): Promise<void> {
    await cdp.send("Input.insertText", { text });
}

/**
 * Press a single key via CDP (keyDown + keyUp with full params).
 * Supports key names: "Enter", "Tab", "Backspace", "ArrowDown", "a", etc.
 * Supports compound keys: "Control+a", "Shift+Enter"
 */
export async function pressKey(cdp: CdpSession, key: string): Promise<void> {
    // Parse compound keys (e.g. "Control+a")
    const parts = key.split("+");
    const mainKey = parts.pop()!;
    const modifiers = new Set(parts);  // "Control", "Shift", "Alt", "Meta"

    const def = resolveKey(mainKey);
    const modMask = toModifiersMask(modifiers);

    // Press modifier keys down
    for (const mod of modifiers) {
        const modDef = resolveKey(mod);
        await cdp.send("Input.dispatchKeyEvent", {
            type: "rawKeyDown", key: modDef.key,
            windowsVirtualKeyCode: modDef.keyCode,
            code: modDef.code, location: modDef.location,
            modifiers: modMask,
        });
    }

    // Main key down
    await cdp.send("Input.dispatchKeyEvent", {
        type: def.text ? "keyDown" : "rawKeyDown",
        key: def.key, code: def.code,
        windowsVirtualKeyCode: def.keyCode,
        text: def.text, unmodifiedText: def.text,
        location: def.location,
        modifiers: modMask,
    });

    // Main key up
    await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp", key: def.key, code: def.code,
        windowsVirtualKeyCode: def.keyCode,
        location: def.location,
        modifiers: modMask,
    });

    // Release modifiers (reverse order)
    for (const mod of [...modifiers].reverse()) {
        const modDef = resolveKey(mod);
        await cdp.send("Input.dispatchKeyEvent", {
            type: "keyUp", key: modDef.key,
            windowsVirtualKeyCode: modDef.keyCode,
            code: modDef.code, location: modDef.location,
            modifiers: 0,
        });
    }
}

/**
 * Type text by selecting all existing content, then inserting new text.
 * This is the "fill" approach — replaces existing content.
 * Works on <input>, <textarea>, and contentEditable elements.
 */
export async function fill(cdp: CdpSession, text: string): Promise<void> {
    // Select all existing content
    await pressKey(cdp, "Control+a");
    // Insert new text (replaces selection)
    if (text) {
        await insertText(cdp, text);
    } else {
        // Empty text → just delete the selection
        await pressKey(cdp, "Delete");
    }
}

function resolveKey(key: string): KeyDefinition {
    return KEY_DEFINITIONS[key] || { key, keyCode: 0, code: "" };
}

function toModifiersMask(modifiers: Set<string>): number {
    let mask = 0;
    if (modifiers.has("Alt")) mask |= 1;
    if (modifiers.has("Control")) mask |= 2;
    if (modifiers.has("Meta")) mask |= 4;
    if (modifiers.has("Shift")) mask |= 8;
    return mask;
}
```

### Step 2: Update `automation/commands.ts` — use `input.ts` for browser_type

**Before:**
```typescript
async function browserType(target: IBrowserTarget, params: any): Promise<McpResponse> {
    // ... el.value = text via Runtime.evaluate
}
```

**After:**
```typescript
import { fill, insertText } from "./input";

async function browserType(target: IBrowserTarget, params: any): Promise<McpResponse> {
    const text = params?.text;
    if (text == null) return { error: { code: -32602, message: "Missing 'text' parameter" } };

    const cdp = target.cdp();
    const selector = refOrSelector(params);

    // Focus the target element
    if (selector) {
        const s = JSON.stringify(selector);
        await cdp.evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.scrollIntoView({ block: 'center' });
            el.focus();
        })()`);
    } else if (params?.ref) {
        await callOnRef(cdp, params.ref,
            "function() { this.scrollIntoView({block:'center'}); this.focus(); }");
    } else {
        return { error: { code: -32602, message: "Missing 'selector' or 'ref' parameter" } };
    }

    // Fill text via CDP (bypasses Trusted Types, works on contentEditable)
    await fill(cdp, text);

    return { result: await snapshot(target) };
}
```

### Step 3: Update `automation/commands.ts` — use `input.ts` for browser_press_key

**Before:**
```typescript
async function browserPressKey(target: IBrowserTarget, params: any): Promise<McpResponse> {
    const key = params?.key;
    const cdp = target.cdp();
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key });
    return { result: await snapshot(target) };
}
```

**After:**
```typescript
import { pressKey } from "./input";

async function browserPressKey(target: IBrowserTarget, params: any): Promise<McpResponse> {
    const key = params?.key;
    if (!key) return { error: { code: -32602, message: "Missing 'key' parameter" } };
    await pressKey(target.cdp(), key);
    return { result: await snapshot(target) };
}
```

### Step 4: Update `BrowserEditorFacade.type()` — use CDP input for scripts too

The script API should also benefit from CDP input dispatch:

```typescript
import { fill } from "../../automation/input";

async type(selector: string, text: string, options?: TabOption): Promise<void> {
    const s = JSON.stringify(selector);
    const cdp = this.cdp(options?.tabId);
    // Focus element
    await cdp.evaluate(`(() => {
        const el = document.querySelector(${s});
        if (!el) throw new Error('Element not found: ' + ${s});
        el.scrollIntoView({ block: 'center' });
        el.focus();
    })()`);
    // Fill via CDP
    await fill(cdp, text);
}
```

### Step 5: Update `BrowserEditorFacade` — add `pressKey()` method

Add a new method for scripts to press keys:

```typescript
import { pressKey } from "../../automation/input";

/** Press a key or key combination. Supports compound keys: "Control+a", "Shift+Enter". */
async pressKey(key: string, options?: TabOption): Promise<void> {
    await pressKey(this.cdp(options?.tabId), key);
}
```

Update `IBrowserEditor` type definition in `api/types/browser-editor.d.ts` and `assets/editor-types/browser-editor.d.ts`.

### Step 6: Verify on problematic sites

Test the following scenarios:
- [ ] Type into Gmail compose body (contentEditable + Trusted Types)
- [ ] Type into a regular `<input>` field
- [ ] Type into a `<textarea>`
- [ ] Press Tab, Enter, Escape, arrow keys
- [ ] Press compound keys: Ctrl+A (select all), Ctrl+C (copy)
- [ ] Type unicode/special characters

## Concerns / Open Questions

1. **`select()` and `check()` methods** — These still use DOM manipulation (`el.value =`, `el.checked =`). Should they also move to CDP? `select()` on a `<select>` element may be fine with DOM since it's a native control, not affected by Trusted Types. `check()` on checkboxes is also native. Leave as-is for now.

2. **`click()` still uses DOM** — `el.click()` via `Runtime.evaluate` works because `click()` is a method call, not a property assignment. No CSP issue. However, Playwright uses CDP mouse events for more accurate simulation. Could be a future improvement but not needed for this task.

3. **Keyboard layout** — We're hardcoding US keyboard layout. This matches what Playwright does. International characters that aren't on the US layout will go through `insertText()` which is layout-agnostic.

4. **Meta vs Control** — On macOS, `Meta` (Cmd) is the primary modifier. On Windows, `Control` is. For select-all in `fill()`, should we use `Control+a` or detect the platform? Since Persephone is Windows-only, `Control+a` is correct.

## Acceptance Criteria

- [ ] `automation/input.ts` created with `insertText()`, `pressKey()`, `fill()`, and keyboard layout
- [ ] `browser_type` uses CDP `Input.insertText` (via `fill()`) instead of DOM `el.value =`
- [ ] `browser_press_key` sends full CDP params (windowsVirtualKeyCode, code, text, modifiers)
- [ ] `browser_press_key` supports compound keys ("Control+a", "Shift+Enter")
- [ ] `BrowserEditorFacade.type()` uses CDP input
- [ ] `BrowserEditorFacade.pressKey()` method added
- [ ] Type definitions updated for `pressKey()`
- [ ] Works on Gmail compose (contentEditable + Trusted Types)
- [ ] Works on regular input/textarea elements
- [ ] Build succeeds

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/automation/input.ts` | **NEW** — keyboard layout, pressKey, insertText, fill |
| `src/renderer/automation/commands.ts` | Update `browserType` and `browserPressKey` to use input.ts |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Update `type()`, add `pressKey()` |
| `src/renderer/api/types/browser-editor.d.ts` | Add `pressKey()` to IBrowserEditor |
| `assets/editor-types/browser-editor.d.ts` | Add `pressKey()` to IBrowserEditor |

### Files NOT changed

| File | Why |
|------|-----|
| `automation/CdpSession.ts` | Already supports `send()` for any CDP command |
| `automation/snapshot.ts` | Not related to input |
| `automation/BrowserTargetModel.ts` | Not related to input |
| `main/mcp-http-server.ts` | Tool schemas unchanged (browser_type, browser_press_key params stay the same) |
| `main/cdp-service.ts` | CDP forwarding unchanged |
