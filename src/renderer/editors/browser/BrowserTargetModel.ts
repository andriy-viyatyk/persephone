import type { BrowserEditor } from "./BrowserEditor";
import { CdpSession } from "../../automation/CdpSession";
import type { IAutomationTarget, IMutableTabTarget, INavigableTarget, ISyntheticInputHost, ITargetTab } from "../../automation/types";
import { createInputSession } from "../../automation/input-session";

/**
 * Lightweight automation adapter for BrowserEditor.
 * Exposes only what the automation layer needs — navigation, tabs, and CDP.
 * Follows the same sub-model pattern as BrowserWebviewModel.
 */
export class BrowserTargetModel implements IAutomationTarget, ISyntheticInputHost, INavigableTarget, IMutableTabTarget {
    constructor(private readonly model: BrowserEditor) {}

    get id(): string {
        return this.model.id;
    }

    async ensureReady(tabId?: string): Promise<void> {
        const id = tabId || this.model.state.get().activeTabId;
        if (this.model.popups.has(id)) return;
        if (!this.model.state.get().tabs.some((tab) => tab.id === id)) throw new Error(`Unknown, closed, or foreign browser target "${id}".`);
        const ready = this.model.webview.waitForLoaded(id);
        this.model.tabs.materialize(id);
        await ready;
    }

    cdp(tabId?: string): CdpSession {
        const state = this.model.state.get();
        const targetTab = tabId || state.activeTabId;
        return new CdpSession(this.registrationKey(targetTab));
    }

    inputCdp(tabId?: string, sessionId?: string) {
        return createInputSession(this.cdp(tabId), sessionId);
    }

    focusWebview(tabId?: string): void {
        const state = this.model.state.get();
        const targetTab = tabId || state.activeTabId;
        if (this.model.popups.has(targetTab)) {
            void this.model.popups.focus(targetTab).catch((): undefined => undefined);
            return;
        }
        const webview = this.model.webview.get(targetTab);
        webview?.focus();
    }

    async insertText(text: string, tabId?: string): Promise<void> {
        const state = this.model.state.get();
        const targetTab = tabId || state.activeTabId;
        await this.ensureReady(targetTab);
        if (this.model.popups.has(targetTab)) {
            await this.model.popups.insertText(targetTab, text);
            return;
        }
        const webview = this.model.webview.get(targetTab);
        if (!webview) throw new Error("Browser tab webview is not ready.");
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
        this.model.webview.reload();
    }

    get tabs(): ReadonlyArray<ITargetTab> {
        const state = this.model.state.get();
        return [...state.tabs.map(t => ({
            id: t.id,
            url: t.url,
            title: t.pageTitle,
            loading: t.loading,
            active: t.id === state.activeTabId,
        })), ...this.model.popups.list().map(popup => ({
            id: popup.id, url: popup.url, title: popup.title, loading: popup.loading, active: false,
        }))];
    }

    get activeTab(): ITargetTab | undefined {
        const tab = this.model.activeTab;
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
        this.model.tabs.closeTab(id);
    }

    switchTab(tabId: string): void {
        if (this.model.popups.has(tabId)) throw new Error("switchTab() accepts browser tab IDs; popup IDs cannot be switched in the tab strip.");
        if (!this.model.findTab(tabId)) throw new Error(`Unknown browser tab "${tabId}".`);
        this.model.tabs.switchTab(tabId);
    }

    isPopup(id: string): boolean { return this.model.popups.has(id); }

    assertTabId(id: string, method: string): void {
        if (this.model.popups.has(id)) throw new Error(`${method} accepts browser tab IDs; popup IDs are not supported.`);
        if (!this.model.findTab(id)) throw new Error(`${method} received an unknown browser tab ID "${id}".`);
    }

    private registrationKey(id: string): string {
        if (this.model.popups.has(id)) return this.model.popups.key(id);
        if (!this.model.findTab(id)) throw new Error(`Unknown, closed, or foreign browser target "${id}".`);
        return this.model.guest.key(id);
    }
}
