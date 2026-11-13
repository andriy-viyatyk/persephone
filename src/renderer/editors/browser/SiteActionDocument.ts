import type { SiteActionItem } from "../../../shared/site-extension-actions";
import { siteExtensionTrust } from "../../api/site-extension-trust";
import { api } from "../../../ipc/renderer/api";
import type { BrowserEditor } from "./BrowserEditor";
import type { BrowserTargetModel } from "./BrowserTargetModel";
import { isPrivateBrowserSession } from "./agent-access";

export class SiteActionDocument {
    readonly tabId: string;
    readonly target: BrowserTargetModel;
    readonly model: BrowserEditor;
    readonly isCurrentDocument: () => boolean;
    private cancelled = false;

    documentId: number;
    host: string;
    id: string;
    hosts: string[];
    fetchHosts: string[];
    contextId?: number;
    fetchKey: string;
    fetchRequests: Set<number>;
    injected: boolean;
    items: SiteActionItem[];
    running: boolean;
    runVersion: number;
    lastPublish: number;
    pending?: SiteActionItem[];
    timer?: ReturnType<typeof setTimeout>;
    cancelRun?: () => void;

    constructor(
        model: BrowserEditor,
        tabId: string,
        documentId: number,
        host: string,
        id: string,
        hosts: string[],
        fetchHosts: string[],
        target: BrowserTargetModel,
        isCurrentDocument: () => boolean,
    ) {
        this.model = model;
        this.tabId = tabId;
        this.documentId = documentId;
        this.host = host;
        this.id = id;
        this.hosts = hosts;
        this.fetchHosts = fetchHosts;
        this.target = target;
        this.isCurrentDocument = isCurrentDocument;
        this.fetchKey = model.guest.key(tabId);
        this.fetchRequests = new Set();
        this.injected = false;
        this.items = [];
        this.running = false;
        this.runVersion = 0;
        this.lastPublish = 0;
    }

    isCurrent(active: boolean): boolean {
        const state = this.model.state.get();
        return this.model.siteExtensions.actionDocuments.get(this.tabId) === this
            && !isPrivateBrowserSession(state)
            && (!active || state.activeTabId === this.tabId)
            && state.tabs.some((tab) => tab.id === this.tabId)
            && siteExtensionTrust.isGranted(this)
            && this.isCurrentDocument();
    }

    resolveFetch(id: number, result: { text?: string; error?: string }): void {
        if (this.contextId === undefined) return;
        const response = JSON.stringify({ id, ...result });
        void this.target.cdp(this.tabId).send("Runtime.evaluate", {
            expression: `window.__persephoneSiteRuntime?.resolveFetch(${response})`,
            contextId: this.contextId,
            returnByValue: true,
        }).catch((): undefined => undefined);
    }

    cancel(): void {
        this.cancelResources(true);
    }

    cancelAfterTargetDetach(): void {
        this.cancelResources(false);
    }

    private cancelResources(resolvePending: boolean): void {
        if (this.cancelled) return;
        this.cancelled = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        this.cancelRun?.();
        this.cancelRun = undefined;
        void api.cancelSiteExtensionFetches(this.fetchKey).catch((): undefined => undefined);
        if (resolvePending) {
            for (const id of this.fetchRequests) this.resolveFetch(id, { error: "Fetch cancelled" });
        }
        this.fetchRequests.clear();
    }
}
