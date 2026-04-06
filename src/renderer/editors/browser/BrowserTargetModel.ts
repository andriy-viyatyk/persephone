import type { BrowserEditorModel } from "./BrowserEditorModel";
import { CdpSession } from "../../automation/CdpSession";
import type { IBrowserTarget, ITargetTab } from "../../automation/types";

/**
 * Lightweight automation adapter for BrowserEditorModel.
 * Exposes only what the automation layer needs — navigation, tabs, and CDP.
 * Follows the same sub-model pattern as BrowserWebviewModel.
 */
export class BrowserTargetModel implements IBrowserTarget {
    constructor(private readonly model: BrowserEditorModel) {}

    get id(): string {
        return this.model.id;
    }

    cdp(tabId?: string): CdpSession {
        const state = this.model.state.get();
        const targetTab = tabId || state.activeTabId;
        return new CdpSession(`${this.model.id}/${targetTab}`);
    }

    focusWebview(tabId?: string): void {
        const state = this.model.state.get();
        const targetTab = tabId || state.activeTabId;
        const webview = this.model.webview.webviewRefs.get(targetTab);
        webview?.focus();
    }

    async insertText(text: string, tabId?: string): Promise<void> {
        const state = this.model.state.get();
        const targetTab = tabId || state.activeTabId;
        const webview = this.model.webview.webviewRefs.get(targetTab);
        if (webview) {
            webview.focus();
            await webview.insertText(text);
        }
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

    get tabs(): ReadonlyArray<ITargetTab> {
        const state = this.model.state.get();
        return state.tabs.map(t => ({
            id: t.id,
            url: t.url,
            title: t.pageTitle,
            loading: t.loading,
            active: t.id === state.activeTabId,
        }));
    }

    get activeTab(): ITargetTab | undefined {
        const state = this.model.state.get();
        const tab = state.tabs.find(t => t.id === state.activeTabId);
        if (!tab) return undefined;
        return {
            id: tab.id,
            url: tab.url,
            title: tab.pageTitle,
            loading: tab.loading,
            active: true,
        };
    }

    addTab(url?: string): string {
        return this.model.addTab(url);
    }

    closeTab(tabId?: string): void {
        const id = tabId || this.model.state.get().activeTabId;
        this.model.closeTab(id);
    }

    switchTab(tabId: string): void {
        this.model.switchTab(tabId);
    }
}
