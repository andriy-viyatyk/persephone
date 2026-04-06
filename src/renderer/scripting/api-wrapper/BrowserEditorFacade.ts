import type { BrowserEditorModel } from "../../editors/browser/BrowserEditorModel";
import { CdpSession } from "../../automation/CdpSession";
import { pressKey, typeText } from "../../automation/input";
import { buildSnapshot } from "../../automation/snapshot";

/** Options for targeting a specific browser tab. */
interface TabOption {
    tabId?: string;
}

/** Options for wait methods. */
interface WaitOption extends TabOption {
    timeout?: number;
}

/**
 * Safe facade around BrowserEditorModel for script access.
 * Implements the IBrowserEditor interface from api/types/browser-editor.d.ts.
 *
 * - Direct model wrap (no ViewModel acquisition, no ref-counting)
 * - Exposes navigation, automation, and tab management methods
 * - All automation methods accept optional { tabId } to target specific tabs
 */
export class BrowserEditorFacade {
    constructor(private readonly model: BrowserEditorModel) {}

    get url(): string {
        return this.model.state.get().url;
    }

    get title(): string {
        return this.model.state.get().pageTitle;
    }

    navigate(url: string): void {
        this.model.navigate(url);
    }

    back(): void {
        this.model.webview.goBack();
    }

    forward(): void {
        this.model.webview.goForward();
    }

    reload(): void {
        this.model.webview.reloadOrStop();
    }

    /** Run JavaScript in the page and return the result. */
    async evaluate(expression: string, options?: TabOption): Promise<unknown> {
        return this.cdp(options?.tabId).evaluate(expression);
    }

    /**
     * Get an accessibility snapshot of the page as a YAML-like tree.
     * Format matches Playwright MCP's browser_snapshot output.
     * Each interactive element has a ref (e.g., ref=e52) usable for targeting.
     */
    async snapshot(options?: TabOption): Promise<string> {
        return buildSnapshot(this.cdp(options?.tabId));
    }

    // =====================================================================
    // Tab management
    // =====================================================================

    /** List of all open tabs in this browser page. */
    get tabs(): Array<{ id: string; url: string; title: string; loading: boolean; active: boolean }> {
        const state = this.model.state.get();
        return state.tabs.map(t => ({
            id: t.id,
            url: t.url,
            title: t.pageTitle,
            loading: t.loading,
            active: t.id === state.activeTabId,
        }));
    }

    /** The active tab. */
    get activeTab(): { id: string; url: string; title: string; loading: boolean; active: boolean } {
        const state = this.model.state.get();
        const tab = state.tabs.find(t => t.id === state.activeTabId);
        return {
            id: tab?.id ?? "",
            url: tab?.url ?? "",
            title: tab?.pageTitle ?? "",
            loading: tab?.loading ?? false,
            active: true,
        };
    }

    /** Open a new tab. Returns the new tab's ID. */
    addTab(url?: string): string {
        return this.model.addTab(url);
    }

    /** Close a tab. Defaults to active tab. */
    closeTab(tabId?: string): void {
        const id = tabId || this.model.state.get().activeTabId;
        this.model.closeTab(id);
    }

    /** Switch to a tab. */
    switchTab(tabId: string): void {
        this.model.switchTab(tabId);
    }

    // =====================================================================
    // Query methods
    // =====================================================================

    /** Get textContent of an element. Returns null if not found. */
    async getText(selector: string, options?: TabOption): Promise<string | null> {
        return this.cdp(options?.tabId).evaluate(
            `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`,
        );
    }

    /** Get the value of an input/textarea/select. Returns null if not found. */
    async getValue(selector: string, options?: TabOption): Promise<string | null> {
        return this.cdp(options?.tabId).evaluate(
            `document.querySelector(${JSON.stringify(selector)})?.value ?? null`,
        );
    }

    /** Get an attribute value. Returns null if element or attribute not found. */
    async getAttribute(selector: string, attribute: string, options?: TabOption): Promise<string | null> {
        return this.cdp(options?.tabId).evaluate(
            `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(attribute)}) ?? null`,
        );
    }

    /** Get innerHTML of an element. Returns null if not found. */
    async getHtml(selector: string, options?: TabOption): Promise<string | null> {
        return this.cdp(options?.tabId).evaluate(
            `document.querySelector(${JSON.stringify(selector)})?.innerHTML ?? null`,
        );
    }

    /** Check if an element exists on the page. */
    async exists(selector: string, options?: TabOption): Promise<boolean> {
        return this.cdp(options?.tabId).evaluate(
            `!!document.querySelector(${JSON.stringify(selector)})`,
        );
    }

    // =====================================================================
    // Interaction methods
    // =====================================================================

    /** Click an element. Throws if not found. */
    async click(selector: string, options?: TabOption): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp(options?.tabId).evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.scrollIntoView({ block: 'center' });
            el.click();
        })()`);
    }

    /** Type text into an input/textarea/contentEditable. Clears existing value first. Throws if not found. */
    async type(selector: string, text: string, options?: TabOption & { slowly?: boolean; submit?: boolean }): Promise<void> {
        await typeText(this.model.target, { selector, text, slowly: options?.slowly, submit: options?.submit });
    }

    /** Select an option in a <select> element by value. Throws if not found. */
    async select(selector: string, value: string, options?: TabOption): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp(options?.tabId).evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
    }

    /** Check a checkbox or radio button. Throws if not found. */
    async check(selector: string, options?: TabOption): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp(options?.tabId).evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            if (!el.checked) {
                el.checked = true;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        })()`);
    }

    /** Uncheck a checkbox. Throws if not found. */
    async uncheck(selector: string, options?: TabOption): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp(options?.tabId).evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            if (el.checked) {
                el.checked = false;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        })()`);
    }

    /** Clear the value of an input/textarea. Throws if not found. */
    async clear(selector: string, options?: TabOption): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp(options?.tabId).evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.focus();
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
    }

    // =====================================================================
    // Wait methods
    // =====================================================================

    /**
     * Wait for an element matching the selector to appear in the DOM.
     * Polls inside the page using requestAnimationFrame for efficiency.
     */
    async waitForSelector(selector: string, options?: WaitOption): Promise<void> {
        const timeout = options?.timeout ?? 30000;
        const s = JSON.stringify(selector);
        await this.cdp(options?.tabId).evaluate(`new Promise((resolve, reject) => {
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
    }

    /**
     * Wait for the page to finish loading (document.readyState === "complete").
     * For SPA navigations, use waitForSelector() instead.
     */
    async waitForNavigation(options?: WaitOption): Promise<void> {
        const timeout = options?.timeout ?? 30000;
        await this.cdp(options?.tabId).evaluate(`new Promise((resolve, reject) => {
            if (document.readyState === 'complete') { resolve(true); return; }
            const start = Date.now();
            const check = () => {
                if (document.readyState === 'complete') { resolve(true); return; }
                if (Date.now() - start > ${timeout}) {
                    reject(new Error('Timeout waiting for navigation'));
                    return;
                }
                setTimeout(check, 100);
            };
            setTimeout(check, 100);
        })`);
    }

    /** Wait for a specified number of milliseconds. */
    async wait(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Press a key or key combination via CDP.
     * Supports compound keys: "Control+a", "Shift+Enter", "Control+Shift+Delete".
     */
    async pressKey(key: string, options?: TabOption): Promise<void> {
        await pressKey(this.cdp(options?.tabId), key);
    }

    /** Get a CDP session for a tab. Defaults to active tab. */
    cdp(tabId?: string): CdpSession {
        const state = this.model.state.get();
        const targetTab = tabId || state.activeTabId;
        return new CdpSession(`${this.model.id}/${targetTab}`);
    }
}
