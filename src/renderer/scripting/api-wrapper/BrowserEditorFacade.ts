import type { BrowserEditorModel } from "../../editors/browser/BrowserEditorModel";
import { CdpSession } from "../../editors/browser/CdpSession";

/**
 * Safe facade around BrowserEditorModel for script access.
 * Implements the IBrowserEditor interface from api/types/browser-editor.d.ts.
 *
 * - Direct model wrap (no ViewModel acquisition, no ref-counting)
 * - Exposes navigation and automation methods
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
    async evaluate(expression: string): Promise<unknown> {
        return this.cdp().evaluate(expression);
    }

    // =====================================================================
    // Query methods
    // =====================================================================

    /** Get textContent of an element. Returns null if not found. */
    async getText(selector: string): Promise<string | null> {
        return this.cdp().evaluate(
            `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`,
        );
    }

    /** Get the value of an input/textarea/select. Returns null if not found. */
    async getValue(selector: string): Promise<string | null> {
        return this.cdp().evaluate(
            `document.querySelector(${JSON.stringify(selector)})?.value ?? null`,
        );
    }

    /** Get an attribute value. Returns null if element or attribute not found. */
    async getAttribute(selector: string, attribute: string): Promise<string | null> {
        return this.cdp().evaluate(
            `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(attribute)}) ?? null`,
        );
    }

    /** Get innerHTML of an element. Returns null if not found. */
    async getHtml(selector: string): Promise<string | null> {
        return this.cdp().evaluate(
            `document.querySelector(${JSON.stringify(selector)})?.innerHTML ?? null`,
        );
    }

    /** Check if an element exists on the page. */
    async exists(selector: string): Promise<boolean> {
        return this.cdp().evaluate(
            `!!document.querySelector(${JSON.stringify(selector)})`,
        );
    }

    // =====================================================================
    // Interaction methods
    // =====================================================================

    /** Click an element. Throws if not found. */
    async click(selector: string): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp().evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.scrollIntoView({ block: 'center' });
            el.click();
        })()`);
    }

    /** Type text into an input/textarea. Clears existing value first. Throws if not found. */
    async type(selector: string, text: string): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp().evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.focus();
            el.value = ${JSON.stringify(text)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
    }

    /** Select an option in a <select> element by value. Throws if not found. */
    async select(selector: string, value: string): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp().evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
    }

    /** Check a checkbox or radio button. Throws if not found. */
    async check(selector: string): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp().evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            if (!el.checked) {
                el.checked = true;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        })()`);
    }

    /** Uncheck a checkbox. Throws if not found. */
    async uncheck(selector: string): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp().evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            if (el.checked) {
                el.checked = false;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        })()`);
    }

    /** Clear the value of an input/textarea. Throws if not found. */
    async clear(selector: string): Promise<void> {
        const s = JSON.stringify(selector);
        await this.cdp().evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            el.focus();
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
    }

    /** Get a CDP session for the active tab (for advanced use). */
    cdp(): CdpSession {
        const state = this.model.state.get();
        return new CdpSession(`${this.model.id}/${state.activeTabId}`);
    }
}
