import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import type {
    ClipboardHistoryChanged,
    ClipboardHistoryItem,
    ClipboardHistorySnapshot,
    ClipboardStatus,
} from "../../ipc/clipboard-ipc";
import { createLinkData } from "../../shared/link-data";
import { SerialQueue } from "../../shared/serial-queue";
import { errMessage } from "../../shared/utils";
import { app } from "./app";
import { settings } from "./settings";
import { normalizeClipboardMaxItems } from "./settings-schema";
import { ui } from "./ui";
import { t } from "../../shared/i18n/t";
import { TOneState } from "../core/state/state";

export interface ClipboardHistoryState {
    items: ClipboardHistoryItem[];
    status: ClipboardStatus | undefined;
    loading: boolean;
    historyLoaded: boolean;
    latestRevision: number;
    restarting: boolean;
    selectedId: string | undefined;
    selectNextCapture: boolean;
}

const defaultState: ClipboardHistoryState = {
    items: [],
    status: undefined,
    loading: true,
    historyLoaded: false,
    latestRevision: -1,
    restarting: false,
    selectedId: undefined,
    selectNextCapture: false,
};

export class ClipboardHistoryModel {
    readonly state = new TOneState<ClipboardHistoryState>({ ...defaultState });
    private historyRequestGeneration = 0;
    private statusRequestGeneration = 0;
    private statusEventGeneration = 0;
    private openQueueGeneration = 0;
    private readonly openQueue = new SerialQueue();
    private isDisposed = false;
    private unsubscribeHistory: (() => void) | undefined;
    private unsubscribeStatus: (() => void) | undefined;

    private get latestRevision(): number {
        return this.state.get().latestRevision;
    }

    async startMonitoring(): Promise<void> {
        this.isDisposed = false;
        this.unsubscribeHistory = rendererEvents.eClipboardHistoryChanged.subscribe(({ revision, reason }) => {
            if (revision < this.latestRevision) return;
            this.state.update((state) => { state.latestRevision = revision; });
            this.refresh(reason);
        });
        this.unsubscribeStatus = rendererEvents.eClipboardStatusChanged.subscribe((status) => {
            this.statusEventGeneration++;
            this.applyStatus(status);
        });

        const statusEventsAtRequest = this.statusEventGeneration;
        try {
            const status = await api.setClipboardHealthMonitoring(true);
            if (!this.isDisposed && statusEventsAtRequest === this.statusEventGeneration) {
                this.applyStatus(status);
            }
        } catch (error: unknown) {
            if (!this.isDisposed) {
                this.applyStatus(this.errorStatus(t("explorer.failedStartClipboardMonitoring", { error: errMessage(error) })));
                void ui.notify(errMessage(error, t("explorer.failedStartClipboardMonitoringFallback")), "error");
            }
        }
        if (this.isDisposed) return;
        this.queryStatus();
        this.refresh();
    }

    stopMonitoring(): void {
        this.isDisposed = true;
        this.historyRequestGeneration++;
        this.statusRequestGeneration++;
        this.openQueueGeneration++;
        this.unsubscribeHistory?.();
        this.unsubscribeStatus?.();
        this.unsubscribeHistory = undefined;
        this.unsubscribeStatus = undefined;
        void api.setClipboardHealthMonitoring(false).catch((error: unknown) => {
            console.error("Failed to stop clipboard health monitoring", errMessage(error));
        });
    }

    refresh(reason?: ClipboardHistoryChanged["reason"]): void {
        const requestGeneration = ++this.historyRequestGeneration;
        if (!this.state.get().historyLoaded) {
            this.state.update((state) => { state.loading = true; });
        }
        void api.getClipboardHistory().then((snapshot) => {
            if (this.isDisposed || requestGeneration !== this.historyRequestGeneration || snapshot.revision < this.latestRevision) return;
            this.state.update((state) => {
                state.latestRevision = snapshot.revision;
                state.items = snapshot.items;
                state.historyLoaded = true;
                state.loading = false;
                if (state.selectedId !== undefined && !state.items.some((item) => item.id === state.selectedId)) {
                    state.selectedId = undefined;
                }
                if (state.selectNextCapture && reason !== undefined) {
                    state.selectNextCapture = false;
                    if (reason === "captured" && state.items.length > 0) state.selectedId = state.items[0].id;
                }
            });
        }).catch((error: unknown) => {
            if (this.isDisposed || requestGeneration !== this.historyRequestGeneration) return;
            this.state.update((state) => { state.loading = false; });
            void ui.notify(errMessage(error, t("explorer.failedLoadClipboardHistory")), "error");
        });
    }

    getSnapshot(): Promise<ClipboardHistorySnapshot> {
        return api.getClipboardHistory();
    }

    select(id: string | undefined): void {
        this.state.update((state) => { state.selectedId = id; });
    }

    async open(item: ClipboardHistoryItem, pageId?: string, onComplete?: () => void): Promise<void> {
        const generation = this.openQueueGeneration;
        void this.openQueue.run(async () => {
            if (this.isDisposed || generation !== this.openQueueGeneration) return;
            await this.openItem(item, pageId);
            onComplete?.();
        }).catch((error: unknown) => {
            if (!this.isDisposed) {
                void ui.notify(t("explorer.failedOpenClipboardItem", { error: errMessage(error) }), "error");
            }
        });
    }

    async copy(id: string): Promise<boolean> {
        this.state.update((state) => { state.selectNextCapture = !this.isDisabled(); });
        try {
            const copied = await api.copyClipboardItem(id);
            if (!copied || this.isDisabled()) this.state.update((state) => { state.selectNextCapture = false; });
            return copied;
        } catch (error: unknown) {
            this.state.update((state) => { state.selectNextCapture = false; });
            throw error;
        }
    }

    clearCopyFollow(): void {
        this.state.update((state) => { state.selectNextCapture = false; });
    }

    remove(id: string): Promise<void> {
        return api.removeClipboardItem(id);
    }

    clear(): Promise<void> {
        return api.clearClipboardHistory();
    }

    async restart(): Promise<void> {
        if (this.state.get().restarting) return;
        this.state.update((state) => { state.restarting = true; });
        const statusEventsAtRequest = this.statusEventGeneration;
        try {
            const status = await api.restartClipboard(
                normalizeClipboardMaxItems(settings.get("clipboard.max-items")),
            );
            if (!this.isDisposed && statusEventsAtRequest === this.statusEventGeneration) {
                this.applyStatus(status);
            }
        } catch (error: unknown) {
            if (!this.isDisposed) {
                this.applyStatus(this.errorStatus(errMessage(error, t("explorer.failedRestartClipboardListener"))));
            }
            throw error;
        } finally {
            this.state.update((state) => { state.restarting = false; });
        }
    }

    private queryStatus(): void {
        const requestGeneration = ++this.statusRequestGeneration;
        const statusEventsAtRequest = this.statusEventGeneration;
        void api.getClipboardStatus().then((status) => {
            if (
                this.isDisposed
                || requestGeneration !== this.statusRequestGeneration
                || statusEventsAtRequest !== this.statusEventGeneration
            ) return;
            this.applyStatus(status);
        }).catch((error: unknown) => {
            if (this.isDisposed || requestGeneration !== this.statusRequestGeneration) return;
            this.applyStatus(this.errorStatus(t("explorer.failedQueryClipboardStatus", { error: errMessage(error) })));
            void ui.notify(errMessage(error, t("explorer.failedQueryClipboardStatusFallback")), "error");
        });
    }

    private async openItem(item: ClipboardHistoryItem, pageId?: string): Promise<void> {
        const path = item.payloads[item.primary];
        if (!path) {
            void ui.notify(t("explorer.clipboardPayloadUnavailable"), "error");
            return;
        }
        try {
            if (pageId) {
                await app.events.openRawLink.sendAsync(createLinkData(path, { pageId }));
            } else {
                await app.pages.openPath(path);
            }
        } catch (error: unknown) {
            void ui.notify(t("explorer.failedOpenClipboardItem", { error: errMessage(error) }), "error");
        }
    }

    private applyStatus(status: ClipboardStatus): void {
        this.state.update((state) => { state.status = status; });
    }

    private isDisabled(): boolean {
        const status = this.state.get().status;
        return status?.enabled === false || status?.health === "disabled";
    }

    private errorStatus(error: string): ClipboardStatus {
        return {
            enabled: true,
            running: false,
            health: "error",
            monitoring: true,
            error,
        };
    }
}
