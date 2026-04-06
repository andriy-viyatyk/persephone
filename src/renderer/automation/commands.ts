/**
 * Browser automation MCP command handlers (Playwright-compatible).
 *
 * Extracted from mcp-handler.ts — all browser_* tool logic lives here.
 * Uses IBrowserTarget for browser access, keeping this module
 * independent of the browser editor's internal implementation.
 */
const { ipcRenderer } = require("electron"); // eslint-disable-line @typescript-eslint/no-var-requires
import { pagesModel } from "../api/pages";
import { BrowserChannel } from "../../ipc/browser-ipc";
import { pressKey, typeText } from "./input";
import { callOnRef } from "./ref";
import { buildSnapshot, detectOverlay } from "./snapshot";
import type { IBrowserTarget } from "./types";

// ── Types ───────────────────────────────────────────────────────────

interface McpResponse {
    result?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    error?: { code: number; message: string; data?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ── Target Resolution ───────────────────────────────────────────────

/**
 * Get the automation target for the ACTIVE browser page.
 * Falls back to the first browser page if the active page is not a browser.
 */
async function getTarget(): Promise<IBrowserTarget | null> {
    const pages = pagesModel.state.get().pages;
    const activePage = pagesModel.activePage;

    // Prefer active page if it's a browser
    let browserPage = (activePage?.mainEditor?.type === "browserPage") ? activePage : null;

    // Fallback to first browser page
    if (!browserPage) {
        browserPage = pages.find(p => p.mainEditor?.type === "browserPage") ?? null;
    }
    if (!browserPage?.mainEditor) return null;

    // Ensure the browser page is active (webview needs display != none for focus/input)
    if (browserPage !== activePage) {
        pagesModel.showPage(browserPage.id);
    }

    const { BrowserEditorModel } = await import("../editors/browser/BrowserEditorModel");
    if (browserPage.mainEditor instanceof BrowserEditorModel) {
        return browserPage.mainEditor.target;
    }
    return null;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Get composite accessibility snapshot (main frame + iframes + overlay hint). */
async function snapshot(target: IBrowserTarget, tabId?: string): Promise<string> {
    const cdp = target.cdp(tabId);
    const overlayHint = await detectOverlay(cdp);
    const tree = await buildSnapshot(cdp);
    if (overlayHint) {
        return `# ${overlayHint}\n${tree}`;
    }
    return tree;
}

/** Resolve a ref (e.g. "e52") or selector from params. Returns CSS selector or null (if ref). */
function refOrSelector(params: any): string | null { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (params?.selector) return params.selector;
    if (params?.ref) return null; // ref is handled separately via callOnRef
    if (params?.element) return params.element; // human-readable fallback
    return null;
}


// ── Command Handlers ────────────────────────────────────────────────

async function browserNavigate(target: IBrowserTarget, params: any): Promise<McpResponse> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const url = params?.url;
    if (!url) return { error: { code: -32602, message: "Missing 'url' parameter" } };

    // Capture current URL so we can detect when navigation starts.
    // navigate() triggers a React state update — the webview picks up the new src
    // via a React effect (async), so we must wait for that gap before polling readyState.
    const oldUrl = await target.cdp().evaluate('document.location.href').catch(() => '');
    target.navigate(url);

    // Phase 1: wait for URL to change OR readyState to go non-complete (navigation started).
    // Max 2s — if nothing changes we fall through and let phase 2 time out gracefully.
    await target.cdp().evaluate(`new Promise((resolve) => {
        const oldHref = ${JSON.stringify(oldUrl)};
        const start = Date.now();
        const check = () => {
            if (document.location.href !== oldHref || document.readyState !== 'complete') {
                resolve(true); return;
            }
            if (Date.now() - start > 2000) { resolve(true); return; }
            setTimeout(check, 50);
        };
        setTimeout(check, 50);
    })`).catch(() => {}); // old page context is destroyed on navigation — that's fine

    // Phase 2: wait for the new page to finish loading.
    await target.cdp().evaluate(`new Promise((resolve) => {
        if (document.readyState === 'complete') { resolve(true); return; }
        const start = Date.now();
        const check = () => {
            if (document.readyState === 'complete') { resolve(true); return; }
            if (Date.now() - start > 10000) { resolve(true); return; }
            setTimeout(check, 100);
        };
        setTimeout(check, 100);
    })`).catch(() => {});

    return { result: await snapshot(target) };
}

async function browserSnapshot(target: IBrowserTarget): Promise<McpResponse> {
    return { result: await snapshot(target) };
}

async function browserClick(target: IBrowserTarget, params: any): Promise<McpResponse> { // eslint-disable-line @typescript-eslint/no-explicit-any
    target.focusWebview();
    const selector = refOrSelector(params);
    if (selector) {
        const s = JSON.stringify(selector);
        await target.cdp().evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.scrollIntoView({ block: 'center' });
            el.click();
        })()`);
    } else if (params?.ref) {
        await callOnRef(target.cdp(), params.ref,
            "function() { this.scrollIntoView({block:'center'}); this.click(); }");
    } else {
        return { error: { code: -32602, message: "Missing 'selector' or 'ref' parameter" } };
    }
    return { result: await snapshot(target) };
}

async function browserType(target: IBrowserTarget, params: any): Promise<McpResponse> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const text = params?.text;
    if (text == null) return { error: { code: -32602, message: "Missing 'text' parameter" } };
    const selector = refOrSelector(params);
    if (!selector && !params?.ref) {
        return { error: { code: -32602, message: "Missing 'selector' or 'ref' parameter" } };
    }

    await typeText(target, {
        selector: selector || undefined,
        ref: params?.ref,
        text,
        slowly: params?.slowly,
        submit: params?.submit,
    });

    return { result: await snapshot(target) };
}

async function browserSelectOption(target: IBrowserTarget, params: any): Promise<McpResponse> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const value = params?.value;
    if (value == null) return { error: { code: -32602, message: "Missing 'value' parameter" } };
    const selector = refOrSelector(params);
    if (selector) {
        const s = JSON.stringify(selector);
        await target.cdp().evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
    } else if (params?.ref) {
        await callOnRef(target.cdp(), params.ref,
            `function() { this.value = ${JSON.stringify(value)}; this.dispatchEvent(new Event('change',{bubbles:true})); }`);
    } else {
        return { error: { code: -32602, message: "Missing 'selector' or 'ref' parameter" } };
    }
    return { result: await snapshot(target) };
}

async function browserPressKey(target: IBrowserTarget, params: any): Promise<McpResponse> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const key = params?.key;
    if (!key) return { error: { code: -32602, message: "Missing 'key' parameter" } };
    target.focusWebview();
    await pressKey(target.cdp(), key);
    return { result: await snapshot(target) };
}

async function browserEvaluate(target: IBrowserTarget, params: any): Promise<McpResponse> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const expression = params?.expression;
    if (!expression) return { error: { code: -32602, message: "Missing 'expression' parameter" } };
    const value = await target.cdp().evaluate(expression);
    return { result: value };
}

async function browserGetTabs(target: IBrowserTarget): Promise<McpResponse> {
    return { result: target.tabs };
}

async function browserNavigateBack(target: IBrowserTarget): Promise<McpResponse> {
    const oldUrl = await target.cdp().evaluate('document.location.href').catch(() => '');
    target.back();

    // Phase 1: wait for navigation to start (same race-condition fix as browserNavigate).
    await target.cdp().evaluate(`new Promise((resolve) => {
        const oldHref = ${JSON.stringify(oldUrl)};
        const start = Date.now();
        const check = () => {
            if (document.location.href !== oldHref || document.readyState !== 'complete') {
                resolve(true); return;
            }
            if (Date.now() - start > 2000) { resolve(true); return; }
            setTimeout(check, 50);
        };
        setTimeout(check, 50);
    })`).catch(() => {});

    // Phase 2: wait for the new page to finish loading.
    await target.cdp().evaluate(`new Promise((resolve) => {
        if (document.readyState === 'complete') { resolve(true); return; }
        const start = Date.now();
        const check = () => {
            if (document.readyState === 'complete') { resolve(true); return; }
            if (Date.now() - start > 10000) { resolve(true); return; }
            setTimeout(check, 100);
        };
        setTimeout(check, 100);
    })`).catch(() => {});

    return { result: await snapshot(target) };
}

async function browserWaitFor(target: IBrowserTarget, params: any): Promise<McpResponse> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const selector = params?.selector;
    const text = params?.text;
    const timeout = params?.timeout ?? 30000;
    if (selector) {
        const s = JSON.stringify(selector);
        await target.cdp().evaluate(`new Promise((resolve, reject) => {
            if (document.querySelector(${s})) { resolve(true); return; }
            const start = Date.now();
            const check = () => {
                if (document.querySelector(${s})) { resolve(true); return; }
                if (Date.now() - start > ${timeout}) {
                    reject(new Error('Timeout waiting for selector: ' + ${s}));
                    return;
                }
                requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        })`);
    } else if (text) {
        // Wait for text to appear anywhere on the page
        const escaped = text.replace(/"/g, '\\"');
        await target.cdp().evaluate(`new Promise((resolve, reject) => {
            const check = () => {
                if (document.body?.innerText?.includes(${JSON.stringify(text)})) { resolve(true); return; }
                if (Date.now() - start > ${timeout}) {
                    reject(new Error('Timeout waiting for text: "${escaped}"'));
                    return;
                }
                requestAnimationFrame(check);
            };
            const start = Date.now();
            check();
        })`);
    } else {
        return { error: { code: -32602, message: "Missing 'selector' or 'text' parameter" } };
    }
    return { result: await snapshot(target) };
}

async function browserTakeScreenshot(target: IBrowserTarget): Promise<McpResponse> {
    const cdp = target.cdp();
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    return { result: { type: "image", data, mimeType: "image/png" } };
}

async function browserNetworkRequests(target: IBrowserTarget): Promise<McpResponse> {
    const activeTab = target.activeTab;
    if (!activeTab) return { error: { code: -32602, message: "No active tab" } };
    const regKey = `${target.id}/${activeTab.id}`;
    const log = await ipcRenderer.invoke(BrowserChannel.getNetworkLog, regKey);
    return { result: log };
}

async function browserClose(target: IBrowserTarget): Promise<McpResponse> {
    target.closeTab();
    return { result: "Tab closed" };
}

// ── Public Dispatch ─────────────────────────────────────────────────

/**
 * Dispatch a browser automation command.
 * Called from mcp-handler.ts for any method starting with "browser_".
 */
export async function handleBrowserCommand(
    command: string,
    params: any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<McpResponse> {
    const target = await getTarget();
    if (!target) return { error: { code: -32602, message: "No browser page open" } };

    switch (command) {
        case "browser_navigate":        return browserNavigate(target, params);
        case "browser_snapshot":        return browserSnapshot(target);
        case "browser_click":           return browserClick(target, params);
        case "browser_type":            return browserType(target, params);
        case "browser_select_option":   return browserSelectOption(target, params);
        case "browser_press_key":       return browserPressKey(target, params);
        case "browser_evaluate":        return browserEvaluate(target, params);
        case "browser_tabs":            return browserGetTabs(target);
        case "browser_navigate_back":   return browserNavigateBack(target);
        case "browser_wait_for":        return browserWaitFor(target, params);
        case "browser_take_screenshot": return browserTakeScreenshot(target);
        case "browser_network_requests": return browserNetworkRequests(target);
        case "browser_close":           return browserClose(target);
        default:
            return { error: { code: -32601, message: `Unknown browser command: ${command}` } };
    }
}
