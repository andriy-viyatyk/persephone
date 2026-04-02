import type { BrowserEditorModel } from "../../editors/browser/BrowserEditorModel";

/**
 * Safe facade around BrowserEditorModel for script access.
 * Implements the IBrowserEditor interface from api/types/browser-editor.d.ts.
 *
 * - Direct model wrap (no ViewModel acquisition, no ref-counting)
 * - Exposes only navigation-related methods
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
}
