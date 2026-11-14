import { t } from "../../../shared/i18n/t";
import { api } from "../../../ipc/renderer/api";
import { pages } from "../../api/pages";
import { menuFolders, type MenuFolder } from "../../api/menu-folders";
import {
    getMenuBarSourceFolders,
    isBuiltinFolder,
    openTabsId,
    scriptLibraryId,
} from "../../api/menu-bar";
import { recent } from "../../api/recent";
import { app } from "../../api/app";
import { settings } from "../../api/settings";
import { ContextMenuEvent } from "../../api/events/events";
import { FileTreeProvider } from "../../content/tree-providers/FileTreeProvider";
import type { TreeProviderViewSavedState } from "../../components/tree-provider/TreeProviderViewModel";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { SpacerView } from "../../uikit/Spacer/SpacerView";
import { SplitterView } from "../../uikit/Splitter/SplitterView";
import { ListBoxView } from "../../uikit/ListBox/ListBoxView";
import type { ListBoxProps } from "../../uikit/ListBox/types";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import {
    createFolderItemRecord,
    type FolderItemRecord,
} from "./FolderItemView";
import { createFolderRightView, getFolderUiEntry, type MenuBarFolderUiContext, type MenuBarRightViewHandle } from "./menu-bar-folder-ui";
import "../../uikit/Button/Button.css";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Spacer/Spacer.css";
import "./MenuBar.css";
import "./FolderItem.css";

export interface MenuBarProps {
    open?: boolean;
    onClose?: () => void;
}

const canOpenInTab = (folder: MenuFolder): boolean =>
    !isBuiltinFolder(folder) || folder.id === scriptLibraryId;

export class MenuBarView extends VanillaView<MenuBarProps> {
    private readonly content = document.createElement("div");
    private readonly categories = createPanelElement({
        name: "menubar-categories",
        direction: "column",
        flex: "1 1 40%",
        minWidth: 0,
        padding: "xs",
        borderRight: true,
    });
    private readonly toolbar = createPanelElement({
        name: "menubar-toolbar",
        direction: "row",
        align: "center",
        gap: "sm",
        paddingBottom: "sm",
    });
    private readonly addFolderPanel = createPanelElement({
        name: "menubar-add-folder",
        justify: "center",
        paddingTop: "sm",
    });
    private readonly contentPanel = createPanelElement({
        name: "menubar-content",
        direction: "column",
        flex: "1 1 60%",
        minWidth: 0,
        paddingRight: "xs",
    });
    private readonly openFileButton = new IconButtonView({
        name: "menubar-open-file",
        size: "md",
        icon: "open-file",
        title: t("shell.openFileCtrlO", { shortcut: "Ctrl+O" }),
        onClick: () => { void this.openFile(); },
    });
    private readonly newWindowButton = new IconButtonView({
        name: "menubar-new-window",
        size: "md",
        icon: "new-window",
        title: t("shell.newWindowCtrlShiftN", { shortcut: "Ctrl+Shift+N" }),
        onClick: () => { void this.newWindow(); },
    });
    private readonly spacer = new SpacerView({});
    private readonly aboutButton = new IconButtonView({
        name: "menubar-about",
        size: "md",
        icon: "info",
        title: t("shell.about"),
        onClick: () => this.openAbout(),
    });
    private readonly settingsButton = new IconButtonView({
        name: "menubar-settings",
        size: "md",
        icon: "settings",
        title: t("shell.settings"),
        onClick: () => this.openSettings(),
    });
    private readonly addFolderButton = new ButtonView({
        name: "menubar-add-folder-button",
        icon: "folder-plus",
        title: t("shell.addAFolderToTheSidebar"),
        size: "sm",
        onClick: () => { void menuFolders.addWithDialog(); },
        children: t("shell.addFolder"),
    });
    private readonly folderList: ListBoxView<FolderItemRecord>;
    private readonly splitter = new SplitterView({
        name: "menubar-splitter",
        orientation: "vertical",
        side: "before",
        value: 600,
        onChange: (width) => this.setContentWidth(width),
        border: "none",
        background: "dark",
        hoverBackground: "default",
    });
    private readonly folderDragStates = new Map<string, { dragEnterCount: number }>();
    private rightView: VanillaView<unknown> | undefined;
    private rightViewKey = "";
    private rightViewHandle: MenuBarRightViewHandle = {};
    private readonly expandStateMap = new Map<string, TreeProviderViewSavedState>();
    private readonly providerMap = new Map<string, FileTreeProvider>();
    private contentWidth = 600;
    private previousOpen: boolean | undefined;

    public constructor(props: MenuBarProps) {
        super(props);
        this.folderList = new ListBoxView<FolderItemRecord>(this.folderListProps([]));
    }

    protected onMount(): void {
        this.root.className = "menu-bar-backdrop";
        this.root.dataset.name = "menu-bar";
        this.content.className = "menu-bar-content";
        this.content.dataset.name = "menu-bar-content";
        this.content.tabIndex = 0;
        this.content.style.width = `${this.contentWidth}px`;
        this.root.append(this.content);
        this.content.append(this.categories, this.contentPanel, this.splitter.root);
        this.toolbar.append(
            this.openFileButton.root,
            this.newWindowButton.root,
            this.spacer.root,
            this.aboutButton.root,
            this.settingsButton.root,
        );
        this.addFolderPanel.append(this.addFolderButton.root);
        this.categories.append(this.toolbar, this.folderList.root, this.addFolderPanel);

        this.child(this.openFileButton).mount();
        this.child(this.newWindowButton).mount();
        this.child(this.spacer).mount();
        this.child(this.aboutButton).mount();
        this.child(this.settingsButton).mount();
        this.child(this.addFolderButton).mount();
        this.child(this.folderList).mount();
        this.child(this.splitter).mount();

        this.listen(this.root, "click", () => app.window.menuBar.close());
        this.listen(this.content, "click", (event) => event.stopPropagation());
        this.listen(this.content, "keydown", (event) => this.onContentKeyDown(event));
        this.bind(menuFolders.state, (state) => state.folders, () => this.refreshFolders());
        this.bind(app.window.menuBar.state, (state) => state.selectedId, () => {
            this.refreshFolders();
            this.updateRightView();
        });
        this.updateOpenState();
    }

    protected onUpdate(_props: MenuBarProps): void {
        this.updateOpenState();
        this.refreshFolders();
        this.updateRightView();
    }

    private applyRootState(): void {
        this.root.classList.toggle("doDisplay", Boolean(this.props.open));
        this.content.style.width = `${this.contentWidth}px`;
    }

    private updateOpenState(): void {
        const open = Boolean(this.props.open);
        const changed = open !== this.previousOpen;
        this.previousOpen = open;
        this.applyRootState();
        if (!changed) return;
        this.root.classList.toggle("doDisplay", open);
        if (!open) {
            this.root.classList.remove("open");
            return;
        }
        this.rightViewHandle.buildTree?.();
        // Flush the display change before adding `open`, or the opening transform can be skipped.
        this.root.getBoundingClientRect();
        this.root.classList.add("open");
        this.content.focus();
    }

    private refreshFolders(): void {
        const folders = getMenuBarSourceFolders();
        const presentIds = new Set(folders.map((folder) => folder.id));
        for (const id of this.folderDragStates.keys()) {
            if (!presentIds.has(id)) this.folderDragStates.delete(id);
        }
        const records = folders.map((folder) => this.folderRecord(folder));
        this.folderList.update(this.folderListProps(records));
    }

    private get selectedFolderId(): string { return app.window.menuBar.selected.id; }

    private folderListProps(items: FolderItemRecord[]): ListBoxProps<FolderItemRecord> {
        return {
            name: "menubar-folders",
            items,
            selectionStyle: "focus",
            variant: "browse",
            rowHeight: 22,
            isSelected: (folder) => folder.folder.id === this.selectedFolderId,
            onChange: (record) => this.setLeftItem(record.folder),
            onItemDoubleClick: (record) => this.openFolderOnDoubleClick(record.folder),
            getTooltip: (record) => record.tooltip,
            getContextMenu: (record) => {
                const folder = record.folder;
                this.setLeftItem(folder);
                return this.getMenuFolderContextMenu(folder);
            },
            onContextMenu: (event) => this.onLeftPanelContextMenu(event),
        };
    }

    private folderRecord(folder: MenuFolder): FolderItemRecord {
        const id = folder.id ?? "";
        let dragState = this.folderDragStates.get(id);
        if (!dragState) {
            dragState = { dragEnterCount: 0 };
            this.folderDragStates.set(id, dragState);
        }
        const row = getFolderUiEntry(folder).row(folder);
        const props = {
            folder,
            selected: folder.id === this.selectedFolderId,
            icon: row.icon,
            label: row.label,
            tooltip: row.tooltip,
            onSelectedIconClick: canOpenInTab(folder)
                ? (value: MenuFolder) => this.openFolderInTab(value)
                : undefined,
            canDrag: !isBuiltinFolder(folder),
            canDrop: !isBuiltinFolder(folder),
        };
        return createFolderItemRecord(props, dragState);
    }

    private setLeftItem(folder: MenuFolder): void {
        const nextId = folder.id ?? "";
        if (nextId === this.selectedFolderId) return;
        app.window.menuBar.open(nextId);
    }

    private async clearRecentFiles(): Promise<void> {
        await recent.clear();
        await this.rightViewHandle.reloadRecent?.();
    }

    private getMenuFolderContextMenu(folder: MenuFolder) {
        return getFolderUiEntry(folder).menu(this.folderUiContext(), folder);
    }

    /**
     * Double-click gate for the saved-folder list. `createFolderItemRecord` builds a plain
     * `ListBoxView` record and silently drops `onDoubleClick`; the only listener for it lived in
     * `FolderItemView`, which nothing instantiates. So the gesture never reached
     * `openFolderInTab` -- the `canOpenInTab` check that used to sit beside the discarded prop
     * lives here now, where the event actually arrives.
     */
    private openFolderOnDoubleClick(folder: MenuFolder): void {
        if (!canOpenInTab(folder)) return;
        this.openFolderInTab(folder);
    }

    private openFolderInTab(folder: MenuFolder): void {
        const folderPath = folder.id === scriptLibraryId
            ? settings.get("script-library.path")
            : folder.path;
        this.openFolderPathInTab(folderPath);
    }

    /**
     * Open a folder as an empty page with the Explorer nav panel rooted at it. Shared by the
     * saved-folder list and by a folder double-clicked in the right-hand file tree, so both
     * gestures land on exactly one behaviour.
     */
    private openFolderPathInTab(folderPath: string | undefined): void {
        if (!folderPath) return;
        void pages.lifecycle.addEmptyPageWithNavPanel(folderPath);
        this.props.onClose?.();
    }

    private onLeftPanelContextMenu(event: MouseEvent): void {
        if (event.contextMenuEvent) return;
        const contextEvent = ContextMenuEvent.fromNativeEvent(event, "sidebar-background");
        contextEvent.items.push({
            label: t("shell.addFolder"),
            icon: createIconElement("folder-plus"),
            onClick: () => { void menuFolders.addWithDialog(); },
        });
    }

    private setContentWidth(width: number): void {
        this.contentWidth = width;
        this.content.style.width = `${width}px`;
        this.splitter.update({
            name: "menubar-splitter",
            orientation: "vertical",
            side: "before",
            value: width,
            onChange: (next) => this.setContentWidth(next),
            border: "none",
            background: "dark",
            hoverBackground: "default",
        });
    }

    private updateRightView(): void {
        const key = this.selectedFolderId;
        if (this.rightView && this.rightViewKey === key) {
            const folder = menuFolders.find(key) ?? getMenuBarSourceFolders().find((item) => item.id === key) ?? { id: key, name: "" };
            (this.rightView as VanillaView<object>).update(getFolderUiEntry(folder).props(this.folderUiContext(), this.rightViewKey));
            return;
        }
        this.rightViewHandle = {};
        this.rightView?.dispose();
        this.rightView?.root.remove();
        this.rightView = undefined;
        this.rightViewKey = key;
        const folder = menuFolders.find(key) ?? getMenuBarSourceFolders().find((item) => item.id === key) ?? { id: key, name: "" };
        const entry = getFolderUiEntry(folder);
        const view = createFolderRightView(entry, this.folderUiContext(), key);
        if (!view) return;
        this.rightView = view;
        this.contentPanel.append(view.root);
        this.child(view).mount();
        this.rightViewHandle = entry.capture(view);
    }

    private folderUiContext(): MenuBarFolderUiContext {
        return {
            onClose: this.props.onClose,
            open: this.props.open,
            expandStateMap: this.expandStateMap,
            getProvider: (folderId, folderPath) => this.getProvider(folderId, folderPath),
            openFolderInTab: (folder) => this.openFolderInTab(folder),
            openFolderPathInTab: (folderPath) => this.openFolderPathInTab(folderPath),
            clearRecentFiles: () => this.clearRecentFiles(),
        };
    }

    private getProvider(folderId: string, folderPath: string): FileTreeProvider {
        let provider = this.providerMap.get(folderId);
        if (!provider || provider.sourceUrl !== folderPath) {
            provider = new FileTreeProvider(folderPath);
            this.providerMap.set(folderId, provider);
        }
        return provider;
    }

    private async openFile(): Promise<void> {
        this.props.onClose?.();
        pages.openFileWithDialog();
    }

    private async newWindow(): Promise<void> {
        this.props.onClose?.();
        api.openNewWindow();
    }

    private openSettings(): void {
        pages.standalonePages.show("settings-page").then((): undefined => undefined);
        this.props.onClose?.();
    }

    private openAbout(): void {
        this.props.onClose?.();
        pages.standalonePages.show("about-page").then((): undefined => undefined);
    }

    private onContentKeyDown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this.props.onClose?.();
        } else if (event.ctrlKey && event.code === "KeyF" && this.selectedFolderId !== openTabsId) {
            event.preventDefault();
            this.rightViewHandle.showSearch?.();
        }
    }
}
