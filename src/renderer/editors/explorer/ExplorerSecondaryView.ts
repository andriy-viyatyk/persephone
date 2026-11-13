import { ContextMenuEvent } from "../../api/events/events";
import { settings } from "../../api/settings";
import { TOOLS_MANIFEST_FILE } from "../../api/tools/tools-manifest";
import { openWithDefaultApp } from "../../content/open-with-default-app";
import type { FileTreeProvider } from "../../content/tree-providers/FileTreeProvider";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { SecondaryViewProps } from "../../ui/secondary-views/secondary-view-registry";
import {
    createSideBarPanelHeader,
    type SideBarPanelHeaderHandle,
} from "../../ui/secondary-views/SideBarPanelHeaderView";
import { TreeProviderViewImpl } from "../../components/tree-provider/TreeProviderViewImpl";
import type {
    TreeProviderViewModel,
    TreeProviderViewSavedState,
} from "../../components/tree-provider/TreeProviderViewModel";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import type { IconButtonProps } from "../../uikit/IconButton/IconButtonView";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { Cleanup } from "../../core/utils/DisposableStore";
import { createIconElement } from "../../uikit/shared/slots";
import { fpBasename, fpDirname } from "../../core/utils/file-path";
import { BOARD_MANIFEST_FILE } from "../../../shared/board/board-manifest-schema";
import type { ExplorerEditor } from "./ExplorerEditorModel";
import { openBoardsPanel, openClipboardPanel } from "./page-explorer";
import { openBoardForPage, openToolsetForPage } from "../board/BoardsPanelEditorModel";
import type { PageModel } from "../../api/pages/PageModel";
import { TreeRevealController } from "../base/tree-provider-host";
import "../../uikit/IconButton/IconButton.css";
import { t } from "../../../shared/i18n/t";

export default class ExplorerSecondaryView extends VanillaView<SecondaryViewProps<ExplorerEditor>> {
    private model: ExplorerEditor;
    private provider: FileTreeProvider | undefined;
    private treeProviderView: TreeProviderViewImpl | undefined;
    private treeProviderModel: TreeProviderViewModel | undefined;
    private header: SideBarPanelHeaderHandle | undefined;
    private headerActions: HTMLDivElement | undefined;
    private upButton: IconButtonView | undefined;
    private searchButton: IconButtonView | undefined;
    private boardsButton: IconButtonView | undefined;
    private clipboardButton: IconButtonView | undefined;
    private collapseButton: IconButtonView | undefined;
    private closeButton: IconButtonView | undefined;
    private readonly trailingButtons = new Map<string, IconButtonView>();
    private providerBinding: Cleanup | undefined;
    private selectionBinding: Cleanup | undefined;
    private treeRevealController: TreeRevealController | undefined;
    private treeRevealCleanup: Cleanup | undefined;

    public constructor(props: SecondaryViewProps<ExplorerEditor>) {
        super(props, createPanelElement({
            name: "explorer-secondary-view",
            direction: "column",
            flex: true,
            minHeight: 0,
            overflow: "hidden",
        }));
        this.model = props.model;
    }

    protected onMount(): void {
        this.createHeaderActions();
        this.header = createSideBarPanelHeader({
            headerHost: this.props.headerHost,
            icon: this.props.iconElement,
            title: t("shell.explorer"),
            actions: this.headerActions,
        });
        this.own(() => this.header?.dispose());

        this.bindModel(this.model);
        this.setClipboardButton(settings.get("clipboard.enabled"));
        this.own(settings.watch("clipboard.enabled", (enabled) => {
            this.setClipboardButton(enabled === true);
            this.updateHeader(this.props);
        }));
        this.updateHeader(this.props);
    }

    protected onUpdate(props: SecondaryViewProps<ExplorerEditor>): void {
        const model = props.model;
        if (model !== this.model) {
            this.providerBinding?.();
            this.selectionBinding?.();
            this.releaseTree();
            this.model = model;
            this.bindModel(model);
        }
        this.updateHeader(props);
    }

    protected onDispose(): void {
        this.providerBinding?.();
        this.selectionBinding?.();
        this.treeRevealCleanup?.();
        this.treeRevealController = undefined;
        this.model.treeProviderViewModel = undefined;
        this.treeProviderModel = undefined;
        this.treeProviderView = undefined;
        this.provider = undefined;
        this.header = undefined;
        this.headerActions = undefined;
        this.upButton = undefined;
        this.searchButton = undefined;
        this.boardsButton = undefined;
        this.clipboardButton = undefined;
        this.collapseButton = undefined;
        this.closeButton = undefined;
        this.trailingButtons.clear();
    }

    private createHeaderActions(): void {
        this.headerActions = createPanelElement({
            name: "explorer-header-actions",
            direction: "row",
            align: "center",
            gap: "xs",
            shrink: false,
        });
        this.upButton = this.child(new IconButtonView({
            name: "explorer-up",
            size: "sm",
            title: t("explorer.alreadyAtRoot"),
            icon: "folder-up",
            onClick: (event) => {
                event.stopPropagation();
                this.model.navigateUp();
            },
        }));
        this.searchButton = this.child(new IconButtonView({
            name: "explorer-search",
            size: "sm",
            title: t("shell.search"),
            icon: "search",
            onClick: (event) => {
                event.stopPropagation();
                this.model.openSearch();
            },
        }));
        this.boardsButton = this.child(new IconButtonView({
            name: "explorer-boards",
            size: "sm",
            title: t("shell.boards"),
            icon: "board",
            onClick: (event) => {
                event.stopPropagation();
                if (this.model.page) openBoardsPanel(this.model.page as PageModel);
            },
        }));
        this.collapseButton = this.child(new IconButtonView({
            name: "explorer-collapse-all",
            size: "sm",
            title: t("explorer.collapseAll"),
            icon: "collapse-all",
            onClick: (event) => {
                event.stopPropagation();
                this.treeProviderModel?.collapseAll();
            },
        }));
        this.closeButton = this.child(new IconButtonView({
            name: "explorer-close",
            size: "sm",
            title: t("explorer.closePanel"),
            icon: "close",
            onClick: (event) => {
                event.stopPropagation();
                this.model.page?.setSecondaryViewsState({ open: false });
            },
        }));
        this.upButton.mount();
        this.searchButton.mount();
        this.boardsButton.mount();
        this.collapseButton.mount();
        this.closeButton.mount();
    }

    private setClipboardButton(enabled: boolean): void {
        if (enabled) {
            if (this.clipboardButton) return;
            this.clipboardButton = this.child(new IconButtonView({
                name: "explorer-clipboard",
                size: "sm",
                title: t("shell.clipboard"),
                icon: "paste",
                onClick: (event) => {
                    event.stopPropagation();
                    if (this.model.page) openClipboardPanel(this.model.page as PageModel);
                },
            }));
            this.clipboardButton.mount();
            return;
        }
        if (this.clipboardButton) {
            this.releaseChild(this.clipboardButton);
            this.clipboardButton = undefined;
        }
    }

    private bindModel(model: ExplorerEditor): void {
        this.providerBinding = this.bind(
            model.treeProviderHost.providerState,
            (provider) => provider,
            (provider) => this.replaceProvider(provider, model.rootPath),
        );
        this.selectionBinding = this.bind(
            model.selectionState,
            (state) => state.selectedHref,
            (selectedHref) => {
                if (this.provider && this.treeProviderView) {
                    this.treeProviderView.update(this.treeProps(this.provider, selectedHref ?? undefined));
                }
            },
        );
    }

    private replaceProvider(provider: FileTreeProvider | null, rootPath: string): void {
        if (this.provider?.sourceUrl === rootPath) {
            if (this.provider && this.treeProviderView) {
                this.treeProviderView.update(this.treeProps(
                    this.provider,
                    this.model.selectionState.get().selectedHref ?? undefined,
                ));
            }
            this.updateHeader(this.props);
            return;
        }

        this.releaseTree();
        this.provider = provider ?? undefined;

        if (provider) {
            const tree = this.child(new TreeProviderViewImpl(this.treeProps(
                provider,
                this.model.selectionState.get().selectedHref ?? undefined,
            )));
            this.treeProviderView = tree;
            this.root.append(tree.root);
            tree.mount();
            this.treeProviderModel = tree.model;
            this.model.treeProviderViewModel = tree.model;
            this.treeRevealController = new TreeRevealController(this.model.treeProviderHost.revealSignal, {
                getSelectedHref: () => this.model.treeProviderHost.selectionState.get().selectedHref,
                scheduleFrame: (callback) => this.schedule.raf(callback),
                reveal: (href) => { void this.treeProviderModel?.revealItem(href); },
            });
            this.treeRevealCleanup = this.disposables.add(() => this.treeRevealController?.dispose());
        }
        this.updateHeader(this.props);
    }

    private releaseTree(): void {
        this.treeRevealCleanup?.();
        this.treeRevealCleanup = undefined;
        this.treeRevealController = undefined;
        const oldTree = this.treeProviderView;
        this.treeProviderView = undefined;
        this.treeProviderModel = undefined;
        this.model.treeProviderViewModel = undefined;
        if (oldTree) this.releaseChild(oldTree);
    }

    private treeProps(provider: FileTreeProvider, selectedHref?: string) {
        return {
            provider,
            multiSelect: true,
            selectedHref,
            initialState: this.model.treeState,
            onStateChange: this.handleStateChange,
            onItemClick: this.handleItemClick,
            onItemDoubleClick: this.handleItemDoubleClick,
            onContextMenu: this.handleContextMenu,
            getSecondaryLabel: this.getSecondaryLabel,
            renderTrailing: this.renderTrailingAction,
        };
    }

    private readonly getSecondaryLabel = (_item: ITreeProviderItem, level: number): Node | undefined => {
        if (level !== 0) return undefined;
        const pathWithDisplayMarks = `\u200E${this.model.rootPath}\u200E`;
        // Keep the path smaller than the row name; createTextElement pins its size.
        const pathElement = createTextElement(pathWithDisplayMarks, {
            truncate: true,
            color: "light",
            size: "md",
        });
        pathElement.dir = "rtl";
        pathElement.dataset.name = "explorer-root-path";
        return pathElement;
    };

    private readonly handleStateChange = (state: TreeProviderViewSavedState): void => {
        this.model.setTreeState(state);
    };

    private readonly handleItemClick = (item: ITreeProviderItem): void => {
        // openItem owns the selection guard so the selected href still opens.
        void this.model.openItem(item);
    };

    private readonly handleItemDoubleClick = (item: ITreeProviderItem): void => {
        void openWithDefaultApp(item.href);
    };

    private readonly renderTrailingAction = (item: ITreeProviderItem): Node | undefined => {
        let icon: "board" | "tools" | undefined;
        let name = "";
        let title = "";
        let onClick: IconButtonProps["onClick"] | undefined;
        if (!item.isDirectory) {
            const base = fpBasename(item.href).toLowerCase();
            if (base === BOARD_MANIFEST_FILE) {
                icon = "board";
                name = "explorer-open-board";
                title = t("explorer.openBoardTitle");
                onClick = (event) => {
                    event.stopPropagation();
                    const boardRoot = fpDirname(item.href);
                    if (this.model.page) openBoardForPage(this.model.page, boardRoot, this.model.rootPath);
                };
            } else if (base === TOOLS_MANIFEST_FILE) {
                icon = "tools";
                name = "explorer-open-toolset";
                title = t("explorer.openToolsetTitle");
                onClick = (event) => {
                    event.stopPropagation();
                    if (this.model.page) void openToolsetForPage(this.model.page, fpDirname(item.href));
                };
            }
        }
        return icon && onClick
            ? this.getTrailingButton(item.href, name, title, icon, onClick)
            : undefined;
    };

    private getTrailingButton(
        href: string,
        name: string,
        title: string,
        icon: "board" | "tools",
        onClick: NonNullable<IconButtonProps["onClick"]>,
    ): Node {
        let button = this.trailingButtons.get(href);
        const props = { name, size: "sm" as const, title, icon, onClick };
        if (!button) {
            button = this.child(new IconButtonView(props));
            this.trailingButtons.set(href, button);
            button.mount();
        } else {
            button.update(props);
        }
        return button.root;
    }

    private readonly handleContextMenu = (
        event: ContextMenuEvent<ITreeProviderItem>,
        selection: ITreeProviderItem[],
    ): void => {
        if (selection.length > 1) return;
        const item = event.target;
        const provider = this.provider;
        if (!item?.isDirectory || !provider?.navigable) return;
        const rootPath = this.model.rootPath;
        if (item.href.toLowerCase() !== rootPath.toLowerCase()) {
            event.items.push({
                startGroup: true,
                id: "make-root",
                label: t("explorer.makeRoot"),
                onClick: () => this.model.makeRoot(item.href),
            });
        }
        event.items.push({
            id: "search-in-folder",
            label: t("explorer.searchInFolder"),
            icon: createIconElement("search", { width: 14, height: 14 }),
            onClick: () => this.model.openSearch(item.href),
        });
    };

    private updateHeader(props: SecondaryViewProps<ExplorerEditor>): void {
        const provider = this.provider;
        const rootPath = this.model.rootPath;
        const parentPath = fpDirname(rootPath);
        const canNavigateUp = parentPath !== rootPath && rootPath !== "";
        this.upButton?.update({
            name: "explorer-up",
            size: "sm",
        title: canNavigateUp ? t("explorer.upToFolder", { folder: fpBasename(parentPath) }) : t("explorer.alreadyAtRoot"),
            icon: "folder-up",
            disabled: !canNavigateUp,
            onClick: (event) => {
                event.stopPropagation();
                this.model.navigateUp();
            },
        });
        this.headerActions?.replaceChildren(
            ...(provider?.navigable && this.upButton ? [this.upButton.root] : []),
            ...(this.searchButton ? [this.searchButton.root] : []),
            ...(this.boardsButton ? [this.boardsButton.root] : []),
            ...(this.clipboardButton ? [this.clipboardButton.root] : []),
            ...(this.collapseButton ? [this.collapseButton.root] : []),
            ...(this.model.page?.sidebarMandatory || !this.closeButton ? [] : [this.closeButton.root]),
        );
        this.header?.update({
            headerHost: props.headerHost,
            icon: props.iconElement,
            title: t("shell.explorer"),
            actions: this.headerActions,
        });
    }
}
