import type { BrowserPopupSnapshot } from "../../../ipc/browser-ipc";
import type { BrowserEditor } from "./BrowserEditor";
import { agentMayAccessBrowserPage } from "./agent-access";
import { logBrowserPopupClosed, logBrowserPopupOpened } from "../../scripting/ai-vision/event-log";
import { releaseAutomationInputs } from "../../automation/input";

interface OwnedPopup extends BrowserPopupSnapshot {
    rootTabId: string;
}

/** Keeps live popup metadata outside persisted browser state and routes popup service calls. */
export class BrowserPopupModel {
    private readonly popups = new Map<string, OwnedPopup>();
    private readonly closedPopups = new Set<string>();
    private readonly releasedTabs = new Set<string>();
    private readonly unsubscribe: () => void;
    private disposed = false;

    constructor(private readonly model: BrowserEditor) {
        this.unsubscribe = model.guest.onEvent((_event, browserEvent) => {
            if (browserEvent.tabId !== model.id || !this.hasRootTab(browserEvent.internalTabId)) return;
            const popup = browserEvent.data.popup;
            if (!popup) return;
            if (browserEvent.type === "popup-opened") {
                if (this.closedPopups.has(popup.id) || this.releasedTabs.has(browserEvent.internalTabId)
                    || !this.validOpener(popup.openerId, browserEvent.internalTabId)) return;
                const isNew = !this.popups.has(popup.id);
                this.popups.set(popup.id, { ...popup, rootTabId: browserEvent.internalTabId });
                if (isNew) this.notifyAgent((pageId) => logBrowserPopupOpened(pageId, popup.id, popup.openerId));
            } else if (browserEvent.type === "popup-changed") {
                const current = this.popups.get(popup.id);
                if (current && current.rootTabId === browserEvent.internalTabId) this.popups.set(popup.id, { ...popup, rootTabId: current.rootTabId });
            } else if (browserEvent.type === "popup-closed") {
                this.closedPopups.add(popup.id);
                void releaseAutomationInputs([this.model.guest.key(popup.id)]).catch((): undefined => undefined);
                const current = this.popups.get(popup.id);
                if (current?.rootTabId === browserEvent.internalTabId) {
                    this.popups.delete(popup.id);
                    this.notifyAgent((pageId) => logBrowserPopupClosed(pageId, popup.id));
                }
            }
        });
        for (const tab of model.state.get().tabs) void this.load(tab.id);
    }

    list(): BrowserPopupSnapshot[] {
        return [...this.popups.values()].map(({ rootTabId: _rootTabId, ...popup }) => popup);
    }

    has(id: string): boolean {
        const popup = this.popups.get(id);
        return !!popup && this.hasRootTab(popup.rootTabId);
    }

    key(id: string): string {
        if (!this.has(id)) throw new Error(`Unknown, closed, or foreign browser popup "${id}".`);
        return this.model.guest.key(id);
    }

    async close(id: string): Promise<void> {
        const popup = this.require(id);
        await this.model.guest.closePopup(this.model.guest.key(popup.rootTabId), id);
    }

    focus(id: string): Promise<void> {
        const popup = this.require(id);
        return this.model.guest.focusPopup(this.model.guest.key(popup.rootTabId), id);
    }

    insertText(id: string, text: string): Promise<void> {
        const popup = this.require(id);
        return this.model.guest.insertPopupText(this.model.guest.key(popup.rootTabId), id, text);
    }

    releaseTab(tabId: string): void {
        this.releasedTabs.add(tabId);
        void releaseAutomationInputs([...this.popups.values()]
            .filter(popup => popup.rootTabId === tabId).map(popup => this.model.guest.key(popup.id)))
            .catch((): undefined => undefined);
        this.dropForTab(tabId);
        void this.model.guest.closeOwnedPopups(this.model.guest.key(tabId)).catch((): void => undefined);
    }

    dispose(): void {
        this.disposed = true;
        this.unsubscribe();
        void releaseAutomationInputs(this.list().map(popup => this.model.guest.key(popup.id))).catch((): undefined => undefined);
        for (const tab of this.model.state.get().tabs) {
            this.dropForTab(tab.id);
            void this.model.guest.closeOwnedPopups(this.model.guest.key(tab.id)).catch((): void => undefined);
        }
        this.popups.clear();
    }

    private async load(tabId: string): Promise<void> {
        try {
            const snapshots = await this.model.guest.listPopups(this.model.guest.key(tabId));
            if (this.disposed || !this.hasRootTab(tabId) || this.releasedTabs.has(tabId)) return;
            for (const popup of snapshots) {
                if (this.validOpener(popup.openerId, tabId) && !this.closedPopups.has(popup.id) && !this.popups.has(popup.id)) {
                    this.popups.set(popup.id, { ...popup, rootTabId: tabId });
                }
            }
        } catch {
            // The tab may not have registered its webContents yet.
        }
    }

    /** Pop-up events reach the agent's event feed only for pages it may access (private user pages stay silent). */
    private notifyAgent(log: (pageId: string) => void): void {
        const pageId = this.model.page?.id;
        if (pageId && agentMayAccessBrowserPage(this.model.state.get())) log(pageId);
    }

    private require(id: string): OwnedPopup {
        const popup = this.popups.get(id);
        if (!popup || !this.hasRootTab(popup.rootTabId)) throw new Error(`Unknown, closed, or foreign browser popup "${id}".`);
        return popup;
    }

    private validOpener(openerId: string, rootTabId: string): boolean {
        return openerId === rootTabId || this.popups.get(openerId)?.rootTabId === rootTabId;
    }

    private hasRootTab(tabId: string): boolean {
        return this.model.state.get().tabs.some(tab => tab.id === tabId);
    }

    private dropForTab(tabId: string): void {
        for (const [id, popup] of this.popups) if (popup.rootTabId === tabId) this.popups.delete(id);
    }
}
