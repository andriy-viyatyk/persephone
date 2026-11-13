import { callOnRef } from "./ref";
import { pressKey } from "./input";
import type { CdpSession } from "./CdpSession";
import type { IAutomationTarget, ISyntheticInputHost } from "./types";


/** Element kind used by the explicitly synthetic legacy fill path. */
type ElementKind = "input" | "textarea" | "contentEditable" | "unknown";

// ── Public API ──────────────────────────────────────────────────────

/**
 * Resolve and focus an element only for the explicitly requested synthetic fill path.
 */
async function focusElementBySelector(cdp: CdpSession, selector: string): Promise<ElementKind> {
    const s = JSON.stringify(selector);
    return await cdp.evaluate(`(() => {
        // Legacy synthetic compatibility picks the first selector match, preferring a visible
        // alternative only when that first match is hidden. Trusted operations use strict locators.
        let el = document.querySelector(${s});
        if (!el) throw new Error('Element not found: ' + ${s});
        // In this explicitly synthetic route only, if the first match is hidden, try a visible alternative.
        if (el.offsetHeight === 0 || getComputedStyle(el).display === 'none') {
            const all = document.querySelectorAll(${s});
            for (const candidate of all) {
                if (candidate.offsetHeight > 0 && getComputedStyle(candidate).display !== 'none') {
                    el = candidate;
                    break;
                }
            }
        }
        el.scrollIntoView({ block: 'center' });
        el.focus();
        if (el.tagName === 'INPUT') return 'input';
        if (el.tagName === 'TEXTAREA') return 'textarea';
        if (el.isContentEditable) return 'contentEditable';
        return 'unknown';
    })()`);
}

/**
 * Focus an element by ref (backendDOMNodeId) and detect its type.
 */
async function focusElementByRef(cdp: CdpSession, ref: string): Promise<ElementKind> {
    return await callOnRef(cdp, ref, `function() {
        this.scrollIntoView({ block: 'center' });
        this.focus();
        if (this.tagName === 'INPUT') return 'input';
        if (this.tagName === 'TEXTAREA') return 'textarea';
        if (this.isContentEditable) return 'contentEditable';
        return 'unknown';
    }`, true) || "unknown";
}

/**
 * Fill a form control via direct value assignment for synthetic compatibility.
 * For <textarea>, uses the native prototype setter to bypass framework interception
 * (e.g., Gmail ignores regular .value assignment on its textarea).
 */
async function fillInput(cdp: CdpSession, selector: string | undefined, ref: string | undefined, text: string): Promise<void> {
    const t = JSON.stringify(text);
    // JS snippet that sets value using native prototype setter (bypasses framework interception)
    // and dispatches InputEvent (not just Event) to trigger framework change detection
    const fillCode = `
        this.scrollIntoView({ block: 'center' });
        this.focus();
        const proto = this.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        nativeSetter.call(this, ${t});
        this.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${t} }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
    `;
    if (selector) {
        const s = JSON.stringify(selector);
        await cdp.evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            (function() { ${fillCode} }).call(el);
        })()`);
    } else if (ref) {
        await callOnRef(cdp, ref, `function() { ${fillCode} }`);
    }
}

/**
 * Fill a <textarea> or contentEditable element via Electron's webview.insertText() for synthetic compatibility.
 * Selects all existing content first, then inserts new text.
 * The element must already be focused via focusElement.
 *
 * The legacy synthetic path uses this because:
 * - <textarea>: Frameworks (Gmail) may ignore programmatic .value changes
 * - contentEditable: .value doesn't exist, and Trusted Types may block DOM assignment
 * - webview.insertText() works like real typing at the Chromium level
 */
async function fillWithInsertText(
    cdp: CdpSession,
    target: IAutomationTarget & ISyntheticInputHost,
    elementKind: ElementKind,
    text: string,
    tabId?: string,
): Promise<void> {
    // Select all existing content
    if (elementKind === "textarea") {
        await cdp.evaluate(`(() => {
            const el = document.activeElement;
            if (el && el.select) el.select();
        })()`);
    } else {
        await cdp.evaluate("document.execCommand('selectAll')");
    }
    if (text) {
        // Retain the legacy native insertion behavior for synthetic callers.
        await target.insertText(text, tabId);
    } else {
        await cdp.evaluate("document.execCommand('delete')");
    }
}

/**
 * Type text character by character via Electron's webview.insertText() for synthetic callers.
 * Works on both input/textarea and contentEditable.
 * The element must already be focused.
 */
async function typeSlowly(
    cdp: CdpSession,
    target: IAutomationTarget & ISyntheticInputHost,
    elementKind: ElementKind,
    text: string,
    tabId?: string,
): Promise<void> {
    if (elementKind === "input" || elementKind === "textarea") {
        await cdp.evaluate(`(() => {
            const el = document.activeElement;
            if (el && el.select) el.select();
        })()`);
    } else {
        await cdp.evaluate("document.execCommand('selectAll')");
    }
    if (text) {
        // Type character by character via webview.insertText()
        for (const char of text) {
            await target.insertText(char, tabId);
        }
    } else {
        await cdp.evaluate("document.execCommand('delete')");
    }
}

// ── Unified Type Command ────────────────────────────────────────────

/** Options for the type command (matches Playwright MCP browser_type). */
export interface TypeOptions {
    /** CSS selector for the target element. */
    selector?: string;
    /** Element ref from accessibility snapshot (e.g. "e52"). */
    ref?: string;
    /** Text to type. */
    text: string;
    /** Target tab, defaulting to the active tab. */
    tabId?: string;
    /** Type one character at a time (triggers key handlers). Default: false (bulk fill). */
    slowly?: boolean;
    /** Press Enter after typing. Default: false. */
    submit?: boolean;
    /** Keep the legacy DOM/value path for pages that explicitly request it. */
    synthetic?: boolean;
}

/**
 * Retain the legacy synthetic type path for callers that explicitly request { synthetic: true }.
 *
 * It detects element type and uses the previous value/insertText strategy:
 * - <input>/<textarea> default: el.value = text (atomic, fast)
 * - <input>/<textarea> slowly: webview.insertText() char by char
 * - contentEditable default: selectAll + webview.insertText() (bulk)
 * - contentEditable slowly: webview.insertText() char by char
 *
 * @param target - Browser automation target (provides webview access)
 * @param options - Type options (selector/ref, text, slowly, submit)
 */
export async function typeText(target: IAutomationTarget & ISyntheticInputHost, options: TypeOptions): Promise<void> {
    const { selector, ref, text, tabId, slowly, submit } = options;
    if (!selector && !ref) throw new Error("Missing 'selector' or 'ref' parameter");

    await target.ensureReady?.(tabId);
    const cdp = target.cdp(tabId);

    // The old synthetic path still asks Electron to focus the host before DOM evaluation.
    target.focusWebview(tabId);

    // Detect element type
    const elementKind = selector
        ? await focusElementBySelector(cdp, selector)
        : await focusElementByRef(cdp, ref);

    // Fill using the appropriate strategy
    if (slowly) {
        await typeSlowly(cdp, target, elementKind, text, tabId);
    } else if (elementKind === "input" || elementKind === "textarea") {
        // Atomic focus + value assignment via native setter (prevents focus interception)
        await fillInput(cdp, selector, ref, text);
    } else if (elementKind === "contentEditable") {
        await fillWithInsertText(cdp, target, elementKind, text, tabId);
    } else {
        // Legacy synthetic compatibility retains the old unknown-element value-setter fallback.
        await fillInput(cdp, selector, ref, text);
    }

    // Submit (press Enter) if requested
    if (submit) {
        await pressKey(cdp, "Enter", { synthetic: options.synthetic });
    }
}
