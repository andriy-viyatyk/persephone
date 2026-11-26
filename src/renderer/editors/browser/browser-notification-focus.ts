import { api } from "../../../ipc/renderer/api";
import type { BrowserEditor } from "./BrowserEditor";

/** Presents the owning app page and internal tab for a click from a live guest. */
export class BrowserNotificationFocus {
    private readonly pageId: string | undefined;
    private readonly windowIndex: Promise<number>;
    private resolvedWindowIndex: number | undefined;

    constructor(private readonly model: BrowserEditor) {
        this.pageId = model.page?.id;
        this.windowIndex = api.getWindowIndex().then((index) => {
            this.resolvedWindowIndex = index;
            return index;
        });
    }

    show(tabId: string, webview: Electron.WebviewTag): void {
        if (!this.isCurrent(tabId, webview)) return;
        const windowIndex = this.resolvedWindowIndex;
        if (windowIndex !== undefined) {
            this.present(windowIndex, tabId, webview);
            return;
        }
        void this.windowIndex.then((index) => this.present(index, tabId, webview));
    }

    private present(windowIndex: number, tabId: string, webview: Electron.WebviewTag): void {
        if (!this.isCurrent(tabId, webview)) return;
        const pageId = this.pageId;
        if (!pageId) return;
        void api.showWindowPage(windowIndex, pageId);
        this.model.tabs.switchTab(tabId);
    }

    private isCurrent(tabId: string, webview: Electron.WebviewTag): boolean {
        return !!this.pageId
            && this.model.page?.id === this.pageId
            && this.model.findTab(tabId) !== undefined
            && webview.isConnected
            && this.model.webview.isRegistered(tabId)
            && this.model.webview.get(tabId) === webview;
    }
}
