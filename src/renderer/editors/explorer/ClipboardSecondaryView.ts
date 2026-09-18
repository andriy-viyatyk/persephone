import { app } from "../../api/app";
import { pagesModel } from "../../api/pages";
import { normalizeClipboardMaxItems, settings } from "../../api/settings";
import { ui } from "../../api/ui";
import { api } from "../../../ipc/renderer/api";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import type {
    ClipboardHistoryChanged,
    ClipboardHistoryItem,
    ClipboardStatus,
} from "../../../ipc/clipboard-ipc";
import { createLinkData } from "../../../shared/link-data";
import { errMessage } from "../../../shared/utils";
import { createFileIconElement, subscribeFileIconElements } from "../../components/icons/icon-elements";
import type { SecondaryViewProps } from "../../ui/secondary-views/secondary-view-registry";
import {
    createSideBarPanelHeader,
    type SideBarPanelHeaderHandle,
} from "../../ui/secondary-views/SideBarPanelHeaderView";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { ListBoxView } from "../../uikit/ListBox/ListBoxView";
import type { IListBoxItem } from "../../uikit/ListBox/types";
import { NotificationView } from "../../uikit/Notification/NotificationView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { TagView } from "../../uikit/Tag/TagView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { createIconElement } from "../../uikit/shared/slots";
import type { MenuItem } from "../../uikit/Menu";
import type { ExplorerEditor } from "./ExplorerEditorModel";
import { clipboardTimeLabel } from "./clipboard-date";
import "../../uikit/Button/Button.css";
import "../../uikit/IconButton/IconButton.css";
import "../../uikit/Notification/Notification.css";
import "../../uikit/Tag/Tag.css";
import "./ClipboardSecondaryView.css";

interface ClipboardListItem extends IListBoxItem {
    clipboardItem: ClipboardHistoryItem;
}

interface ClipboardRowControls {
    host: HTMLSpanElement;
    time: TagView;
    copy: IconButtonView;
}

const MAX_PREVIEW_LENGTH = 200;

export default class ClipboardSecondaryView extends VanillaView<SecondaryViewProps> {
    private model: ExplorerEditor;
    private header: SideBarPanelHeaderHandle | undefined;
    private headerActions: HTMLDivElement | undefined;
    private closeButton: IconButtonView | undefined;
    private clearButton: ButtonView | undefined;
    private restartButton: ButtonView | undefined;
    private healthBadge: TagView | undefined;
    private unavailableNotification: NotificationView | undefined;
    private notificationHost: HTMLDivElement | undefined;
    private openSettingsButton: ButtonView | undefined;
    private list: ListBoxView<ClipboardListItem> | undefined;
    private readonly rowControls = new Map<string, ClipboardRowControls>();
    private items: ClipboardHistoryItem[] = [];
    private rows: ClipboardListItem[] = [];
    private status: ClipboardStatus | undefined;
    private loading = true;
    private historyLoaded = false;
    private latestRevision = -1;
    private historyRequestGeneration = 0;
    private statusRequestGeneration = 0;
    private statusEventGeneration = 0;
    private restarting = false;
    private selectedId: string | undefined;
    private activeIndex: number | null = null;
    private openQueue: Promise<void> = Promise.resolve();
    private openQueueGeneration = 0;
    private selectNextCapture = false;

    public constructor(props: SecondaryViewProps) {
        super(props, createPanelElement({
            name: "clipboard-secondary-view",
            direction: "column",
            flex: true,
            minHeight: 0,
            overflow: "hidden",
        }));
        this.model = props.model as ExplorerEditor;
    }

    protected onMount(): void {
        this.closeButton = this.child(new IconButtonView({
            name: "clipboard-close",
            size: "sm",
            title: "Close Clipboard",
            icon: "close",
            onClick: (event) => {
                event.stopPropagation();
                this.model.closeClipboard();
            },
        }));
        this.clearButton = this.child(new ButtonView({
            name: "clipboard-clear",
            size: "sm",
            variant: "ghost",
            children: "Clear",
            onClick: () => { void this.clearHistory(); },
        }));
        this.restartButton = this.child(new ButtonView({
            name: "clipboard-restart",
            size: "sm",
            variant: "ghost",
            children: "Restart",
            onClick: () => { void this.restart(); },
        }));
        this.healthBadge = this.child(new TagView({
            name: "clipboard-health",
            label: "Unavailable",
            tone: "warning",
            size: "sm",
        }));
        // Column, not row: the sidebar is narrow, and putting the message beside the
        // button squeezed the notification into a few words per line and pushed the
        // button past the panel edge.
        this.notificationHost = createPanelElement({
            name: "clipboard-notification",
            direction: "column",
            align: "stretch",
            gap: "xs",
            paddingX: "sm",
            paddingY: "xs",
            shrink: false,
        });
        this.openSettingsButton = this.child(new ButtonView({
            name: "clipboard-open-settings",
            size: "sm",
            children: "Open Settings",
            onClick: () => { void pagesModel.showSettingsPage(); },
        }));

        this.list = this.child(new ListBoxView<ClipboardListItem>(this.listProps()));
        this.listen(this.list.root, "keydown", this.handleArrowKeys, { capture: true });
        this.own(subscribeFileIconElements(() => {
            if (this.isDisposed) return;
            this.rebuildRows();
            this.list?.update(this.listProps());
        }));
        this.root.append(this.notificationHost, this.list.root);
        this.closeButton.mount();
        this.clearButton.mount();
        this.restartButton.mount();
        this.healthBadge.mount();
        this.openSettingsButton.mount();
        this.list.mount();

        this.headerActions = createPanelElement({
            name: "clipboard-header-actions",
            direction: "row",
            align: "center",
            gap: "xs",
            shrink: false,
        });
        this.header = createSideBarPanelHeader({
            headerHost: this.props.headerHost,
            icon: this.props.iconElement,
            title: "Clipboard",
            actions: this.headerActions,
        });
        this.own(() => this.header?.dispose());

        this.own(rendererEvents.eClipboardHistoryChanged.subscribe(({ revision, reason }) => {
            if (revision < this.latestRevision) return;
            this.latestRevision = revision;
            this.queryHistory(reason);
        }));
        this.own(rendererEvents.eClipboardStatusChanged.subscribe((status) => {
            this.statusEventGeneration++;
            this.applyStatus(status);
        }));

        this.updatePresentation();
        void this.initialize();
    }

    protected onUpdate(props: SecondaryViewProps): void {
        const model = props.model as ExplorerEditor;
        if (model !== this.model) this.model = model;
        this.updatePresentation();
    }

    protected onDispose(): void {
        this.historyRequestGeneration++;
        this.statusRequestGeneration++;
        this.openQueueGeneration++;
        void api.setClipboardHealthMonitoring(false).catch((error: unknown) => {
            console.error("Failed to stop clipboard health monitoring", errMessage(error));
        });
        this.header = undefined;
        this.headerActions = undefined;
        this.closeButton = undefined;
        this.clearButton = undefined;
        this.restartButton = undefined;
        this.healthBadge = undefined;
        this.unavailableNotification = undefined;
        this.notificationHost = undefined;
        this.openSettingsButton = undefined;
        this.list = undefined;
        this.rowControls.clear();
    }

    private async initialize(): Promise<void> {
        const statusEventsAtRequest = this.statusEventGeneration;
        try {
            const status = await api.setClipboardHealthMonitoring(true);
            if (!this.isDisposed && statusEventsAtRequest === this.statusEventGeneration) {
                this.applyStatus(status);
            }
        } catch (error: unknown) {
            if (!this.isDisposed) {
                this.applyStatus(this.errorStatus(`Failed to start clipboard monitoring: ${errMessage(error)}`));
                void ui.notify(errMessage(error, "Failed to start clipboard monitoring."), "error");
            }
        }
        if (this.isDisposed) return;
        this.queryStatus();
        this.queryHistory();
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
            this.applyStatus(this.errorStatus(`Failed to query clipboard status: ${errMessage(error)}`));
            void ui.notify(errMessage(error, "Failed to query clipboard status."), "error");
        });
    }

    private queryHistory(reason?: ClipboardHistoryChanged["reason"]): void {
        const requestGeneration = ++this.historyRequestGeneration;
        if (!this.historyLoaded) {
            this.loading = true;
            this.list?.update(this.listProps());
        }
        void api.getClipboardHistory().then((snapshot) => {
            if (
                this.isDisposed
                || requestGeneration !== this.historyRequestGeneration
                || snapshot.revision < this.latestRevision
            ) return;
            this.latestRevision = snapshot.revision;
            this.items = snapshot.items;
            this.historyLoaded = true;
            this.loading = false;
            this.applyCaptureSelection(reason);
            this.rebuildRows();
            this.updatePresentation();
        }).catch((error: unknown) => {
            if (this.isDisposed || requestGeneration !== this.historyRequestGeneration) return;
            this.loading = false;
            this.updatePresentation();
            void ui.notify(errMessage(error, "Failed to load clipboard history."), "error");
        });
    }

    /** Copying an item puts its content back on the clipboard, so the watcher captures it and
     *  the item returns at the top under a NEW id — the old row is gone and selection would be
     *  left pointing at nothing. Follow the content to its new row instead. Only a capture can
     *  honour the request; any other refresh means the copy produced no capture (an excluded
     *  write, a failed one) and the request is dropped rather than left armed for later. */
    private applyCaptureSelection(reason: ClipboardHistoryChanged["reason"] | undefined): void {
        if (!this.selectNextCapture || reason === undefined) return;
        this.selectNextCapture = false;
        if (reason === "captured" && this.items.length > 0) this.selectedId = this.items[0].id;
    }

    private applyStatus(status: ClipboardStatus): void {
        this.status = status;
        this.updatePresentation();
    }

    private rebuildRows(): void {
        const nextIds = new Set(this.items.map((item) => item.id));
        for (const [id, controls] of this.rowControls) {
            if (nextIds.has(id)) continue;
            this.releaseChild(controls.time);
            this.releaseChild(controls.copy);
            controls.host.remove();
            this.rowControls.delete(id);
        }

        this.rows = this.items.map((item) => {
            const time = clipboardTimeLabel(item.capturedAt);
            let controls = this.rowControls.get(item.id);
            if (!controls) {
                controls = this.createRowControls(item, time);
                this.rowControls.set(item.id, controls);
            } else {
                controls.time.update({
                    name: `clipboard-time-${item.id}`,
                    label: time.badge,
                    title: time.tooltip,
                    variant: "outlined",
                    size: "sm",
                });
            }
            return {
                value: item.id,
                label: previewLabel(item),
                iconElement: createFileIconElement({
                    path: iconPathFor(item),
                    width: 16,
                    height: 16,
                }),
                rowClass: "clipboard-row",
                trailingElement: controls.host,
                clipboardItem: item,
            };
        });
        this.reconcileSelectionAndActive();
    }

    private createRowControls(
        item: ClipboardHistoryItem,
        time: ReturnType<typeof clipboardTimeLabel>,
    ): ClipboardRowControls {
        const host = document.createElement("span");
        host.dataset.clipboardTrailing = "";
        const timeBadge = this.child(new TagView({
            name: `clipboard-time-${item.id}`,
            label: time.badge,
            title: time.tooltip,
            variant: "outlined",
            size: "sm",
        }));
        const copyButton = this.child(new IconButtonView({
            name: `clipboard-copy-${item.id}`,
            size: "sm",
            title: "Copy",
            icon: "copy",
            onClick: (event) => {
                event.stopPropagation();
                void this.copyItem(item.id);
            },
        }));
        timeBadge.mount();
        copyButton.mount();
        timeBadge.root.dataset.clipboardTime = "";
        copyButton.root.dataset.clipboardCopy = "";
        host.append(timeBadge.root, copyButton.root);
        return { host, time: timeBadge, copy: copyButton };
    }

    private reconcileSelectionAndActive(): void {
        const selectedIndex = this.rows.findIndex((row) => row.value === this.selectedId);
        if (this.selectedId !== undefined && selectedIndex === -1) {
            this.selectedId = undefined;
        }
        this.activeIndex = this.selectedId === undefined ? null : selectedIndex;
    }

    private listProps(): Parameters<ListBoxView<ClipboardListItem>["update"]>[0] {
        return {
            name: "clipboard-history",
            items: this.rows,
            variant: "browse",
            // The selected row is the one the page is showing, which is persistent navigation
            // state rather than a pick — the same treatment the Explorer tree gets.
            selectionStyle: "focus",
            value: this.rows.find((row) => row.value === this.selectedId) ?? null,
            // `activeIndex` follows the SELECTED row and nothing else. Deliberately no
            // `onActiveChange`: the ListBox reports hover through it, and letting hover move the
            // active row left the last row the pointer touched painted as active after the mouse
            // had left the list entirely — an active row is never cleared by leaving, only moved.
            // Hover still gets its own cue from the `browse` variant's `:hover` rule, which ends
            // the moment the pointer goes, and the keyboard cursor stays where the user left it.
            activeIndex: this.activeIndex,
            keyboardNav: true,
            loading: this.loading,
            emptyMessage: "No clipboard history yet.",
            onChange: this.handleSelection,
            getContextMenu: this.getContextMenu,
        };
    }

    private readonly handleSelection = (row: ClipboardListItem): void => {
        this.selectedId = row.clipboardItem.id;
        this.activeIndex = this.rows.findIndex((candidate) => candidate.value === row.value);
        this.list?.update(this.listProps());
        this.takeListFocus();
        this.enqueueOpen(row.clipboardItem);
    };

    /**
     * Arrow keys belong to this panel, not to the ListBox.
     *
     * The ListBox's own `keyboardNav` moves an ACTIVE index and leaves selection to Enter, which
     * is the wrong shape here: the point of this list is reviewing captured items one key press at
     * a time, so an arrow has to select and open in a single stroke. Distinguishing an arrow-driven
     * `onActiveChange` from the pointer-driven one the ListBox fires on hover proved unreliable, so
     * this handler claims the two keys outright — it is registered in the CAPTURE phase before the
     * ListBox mounts its own listener, and `stopImmediatePropagation` keeps the ListBox from also
     * moving its active index. Everything else `keyboardNav` offers (Home, End, Page keys, Enter)
     * is left to the ListBox untouched.
     *
     * Stepping is measured from the SELECTED row rather than the active one, so hovering the mouse
     * over a distant row cannot teleport the next arrow press away from where the user is reading.
     */
    private readonly handleArrowKeys = (event: KeyboardEvent): void => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if (this.rows.length === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const current = this.rows.findIndex((row) => row.value === this.selectedId);
        const next = event.key === "ArrowDown"
            ? Math.min(this.rows.length - 1, current + 1)
            : Math.max(0, current - 1);
        if (next === current) return;
        this.handleSelection(this.rows[next]);
    };

    private enqueueOpen(item: ClipboardHistoryItem): void {
        const generation = this.openQueueGeneration;
        this.openQueue = this.openQueue.then(async () => {
            if (this.isDisposed || generation !== this.openQueueGeneration) return;
            await this.openItem(item);
            this.takeListFocus();
        }).catch((error: unknown) => {
            if (!this.isDisposed) {
                void ui.notify(`Failed to open clipboard item: ${errMessage(error)}`, "error");
            }
        });
    }

    /** The list is the keyboard target for as long as the user is browsing it, so every open the
     *  panel itself starts ends with focus back on the list.
     *
     *  Two things take it away. Clicking a row does not focus the list at all — a mousedown on a
     *  row leaves `activeElement` wherever it was — and opening the FIRST item creates the host
     *  page's editor, which grabs focus for itself. Together those made the panel navigable only
     *  from the second click onward: the first arrow press moved the new editor's caret instead
     *  of stepping through the history, which is the whole point of the feature. Later opens
     *  reuse the editor and leave focus alone, so the defect looked intermittent.
     *
     *  Claiming focus unconditionally is safe here because only `handleSelection` reaches this —
     *  a click or an arrow on this panel, never a background refresh. */
    private takeListFocus(): void {
        const root = this.list?.root;
        if (!root || this.isDisposed || root.contains(document.activeElement)) return;
        root.focus({ preventScroll: true });
    }
    private readonly getContextMenu = (row: ClipboardListItem): MenuItem[] => [{
        label: "Remove",
        icon: createIconElement("delete", { width: 14, height: 14 }),
        onClick: () => { void this.removeItem(row.clipboardItem.id); },
    }];

    private async openItem(item: ClipboardHistoryItem): Promise<void> {
        const path = item.payloads[item.primary];
        if (!path) {
            void ui.notify("The clipboard item payload is unavailable.", "error");
            return;
        }
        try {
            // Navigate the host page rather than opening a new tab — the same
            // `pageId` link route the Explorer's own search results use
            // (`ExplorerEditor.openSearchResult`). `app.pages.openFile` would
            // spawn a page per item, which turns browsing the history into tab
            // cleanup. Without a page host there is nothing to navigate, so fall
            // back to opening one.
            const pageId = this.model.page?.id;
            if (pageId) {
                await app.events.openRawLink.sendAsync(createLinkData(path, { pageId }));
            } else {
                await app.pages.openFile(path);
            }
        } catch (error: unknown) {
            void ui.notify(`Failed to open clipboard item: ${errMessage(error)}`, "error");
        }
    }

    private async copyItem(id: string): Promise<void> {
        try {
            this.selectNextCapture = !this.isDisabled();
            const copied = await api.copyClipboardItem(id);
            if (!copied || this.isDisabled()) this.selectNextCapture = false;
            if (!copied && !this.isDisposed) {
                void ui.notify("The clipboard item is no longer available.", "error");
            }
        } catch (error: unknown) {
            this.selectNextCapture = false;
            if (!this.isDisposed) {
                void ui.notify(`Failed to copy clipboard item: ${errMessage(error)}`, "error");
            }
        }
    }

    private async removeItem(id: string): Promise<void> {
        const { showConfirmationDialog } = await import("../../ui/dialogs/ConfirmationDialog");
        const confirmed = await showConfirmationDialog({
            title: "Remove clipboard item",
            message: "Remove this clipboard item? Its stored payload will be permanently deleted.",
            buttons: ["Remove", "Cancel"],
        });
        if (confirmed === "Cancel" || !confirmed) return;
        try {
            await api.removeClipboardItem(id);
        } catch (error: unknown) {
            if (!this.isDisposed) {
                void ui.notify(`Failed to remove clipboard item: ${errMessage(error)}`, "error");
            }
        }
    }

    private async clearHistory(): Promise<void> {
        if (this.items.length === 0) return;
        const { showConfirmationDialog } = await import("../../ui/dialogs/ConfirmationDialog");
        const confirmed = await showConfirmationDialog({
            title: "Clear clipboard history",
            message: "Clear all clipboard history? Stored payload files will be permanently deleted.",
            buttons: ["Clear", "Cancel"],
        });
        if (confirmed !== "Clear") return;
        try {
            await api.clearClipboardHistory();
        } catch (error: unknown) {
            if (!this.isDisposed) {
                void ui.notify(`Failed to clear clipboard history: ${errMessage(error)}`, "error");
            }
        }
    }

    private async restart(): Promise<void> {
        if (this.restarting) return;
        this.restarting = true;
        const statusEventsAtRequest = this.statusEventGeneration;
        this.updateHeader(this.props);
        try {
            const status = await api.restartClipboard(
                normalizeClipboardMaxItems(settings.get("clipboard.max-items")),
            );
            if (!this.isDisposed && statusEventsAtRequest === this.statusEventGeneration) {
                this.applyStatus(status);
            }
        } catch (error: unknown) {
            if (!this.isDisposed) {
                this.applyStatus(this.errorStatus(errMessage(error, "Failed to restart clipboard listener.")));
                void ui.notify(errMessage(error, "Failed to restart clipboard listener."), "error");
            }
        } finally {
            this.restarting = false;
            if (!this.isDisposed) this.updateHeader(this.props);
        }
    }

    private updatePresentation(): void {
        this.updateUnavailableNotification();
        this.list?.update(this.listProps());
        this.updateHeader(this.props);
    }

    private updateUnavailableNotification(): void {
        const disabled = !this.loading && this.isDisabled();
        const unavailable = !disabled && !this.loading && this.items.length === 0 && this.isUnavailable();
        if (!disabled && !unavailable) {
            this.notificationHost?.replaceChildren();
            return;
        }

        const status = this.status;
        const message = disabled
            ? "Clipboard history is disabled in Settings."
            : status?.error
                ? `Clipboard listener is unavailable. No new items will be captured. ${status.error}`
                : "Clipboard listener is unavailable. No new items will be captured.";
        const type = disabled || status?.health !== "error" ? "warning" : "error";
        if (!this.unavailableNotification) {
            this.unavailableNotification = this.child(new NotificationView({
                name: "clipboard-unavailable",
                type,
                message,
            }));
            this.unavailableNotification.mount();
        } else {
            this.unavailableNotification.update({
                name: "clipboard-unavailable",
                type,
                message,
            });
        }
        this.notificationHost?.replaceChildren(
            this.unavailableNotification.root,
            ...(disabled && this.openSettingsButton ? [this.openSettingsButton.root] : []),
        );
    }

    private updateHeader(props: SecondaryViewProps): void {
        const disabled = this.isDisabled();
        const unavailable = !disabled && this.isUnavailable();
        const showHealth = disabled || unavailable;
        const badge = this.healthBadge;
        const status = this.status;
        if (badge) {
            const health = disabled ? "default" : status?.health === "error" ? "error" : "warning";
            badge.update({
                name: "clipboard-health",
                label: disabled ? "Disabled" : status?.health === "deaf" ? "Deaf" : "Error",
                tone: health,
                size: "sm",
                title: disabled
                    ? "Clipboard history is disabled in Settings."
                    : status?.error ?? "Clipboard listener is unavailable.",
            });
        }
        this.clearButton?.update({
            name: "clipboard-clear",
            size: "sm",
            variant: "ghost",
            children: "Clear",
            disabled: this.items.length === 0,
            onClick: () => { void this.clearHistory(); },
        });
        this.restartButton?.update({
            name: "clipboard-restart",
            size: "sm",
            variant: "ghost",
            children: "Restart",
            disabled: this.restarting,
            onClick: () => { void this.restart(); },
        });

        this.headerActions?.replaceChildren(
            ...(props.expanded !== false && this.items.length > 0 && this.clearButton
                ? [this.clearButton.root]
                : []),
            ...(unavailable && this.restartButton ? [this.restartButton.root] : []),
            ...(this.closeButton ? [this.closeButton.root] : []),
        );
        this.header?.update({
            headerHost: props.headerHost,
            icon: props.iconElement,
            badge: showHealth ? this.healthBadge?.root : undefined,
            title: "Clipboard",
            actions: this.headerActions,
        });
    }

    private isUnavailable(): boolean {
        return this.status?.health === "deaf" || this.status?.health === "error";
    }

    private isDisabled(): boolean {
        return this.status?.enabled === false || this.status?.health === "disabled";
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

function iconPathFor(item: ClipboardHistoryItem): string {
    switch (item.primary) {
        case "image":
            return "clipboard.png";
        case "html":
            return "clipboard.html";
        case "files":
            return "clipboard";
        case "text":
            return "clipboard.txt";
    }
}

function previewLabel(item: ClipboardHistoryItem): string {
    switch (item.primary) {
        case "image":
            return "Image";
        case "html":
            return "HTML";
        case "files":
            return item.preview;
        case "text": {
            const normalized = item.preview.replace(/\s+/g, " ").trim();
            if (normalized.length <= MAX_PREVIEW_LENGTH) return normalized || "Text";
            return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 1)}…`;
        }
    }
}
