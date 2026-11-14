import type { ILink } from "../../api/types/io.tree";
import { getTraitDragData, hasTraitDragData, LINK, resolveTraits } from "../../core/traits";
import { createPanelElement, applyPanelAttributes, resolvePanelAttributes } from "../../uikit/Panel/panel-style";
import { SplitterView } from "../../uikit/Splitter/SplitterView";
import { createTextElement } from "../../uikit/Text/text-style";
import type { SplitterProps } from "../../uikit/Splitter/SplitterView";
import type { GridModelCapability } from "../../uikit/DataGrid";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { LinkItem, LinkViewMode } from "./linkTypes";
import { LinkEditor, type LinkEditorState } from "./LinkEditor";
import { LinksListView } from "./LinksListView";
import { createLinksItemsView } from "./LinksItemsView";
import type { LinksListProps } from "./LinksList";
import { LinksTilesView } from "./LinksTilesView";
import type { LinksTilesProps } from "./LinksTiles";
import { PinnedLinksPanelView } from "./PinnedLinksPanelView";
import { t } from "../../../shared/i18n/t";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Splitter/Splitter.css";
import "../../uikit/Text/Text.css";

import { buildLinkContextMenu, openLinkItem } from "./link-item-actions";

interface BodyProjection {
    searchText: string;
    selectedLinkId: string;
    error: string | undefined;
    filteredLinks: LinkItem[];
    allLinks: LinkItem[];
    pinnedLinks: LinkItem[];
    pinnedPanelWidth: number;
    viewMode: LinkViewMode;
    pinnedLinkIds: Set<string>;
    allTags: string[];
}

function selectBody(state: LinkEditorState, model: LinkEditor): BodyProjection {
    const pinnedLinksRaw = state.data.state.pinnedLinks ?? [];
    return {
        searchText: state.searchText,
        selectedLinkId: state.selectedLinkId,
        error: state.error,
        filteredLinks: state.filteredLinks,
        allLinks: state.data.links,
        pinnedLinks: model.getPinnedLinks(),
        pinnedPanelWidth: state.data.state.pinnedPanelWidth ?? 100,
        viewMode: model.getViewMode(state),
        pinnedLinkIds: new Set(pinnedLinksRaw),
        allTags: state.tags,
    };
}

type ActiveBodyView = LinksListView | LinksTilesView;

export class LinkBodyView extends VanillaView<{ model: LinkEditor }> {
    private model: LinkEditor;
    private readonly centerPanel: HTMLDivElement;
    private activeBody: ActiveBodyView | undefined;
    private activeMode: LinkViewMode | undefined;
    private emptyRoot: HTMLDivElement | undefined;
    private splitter: SplitterView | undefined;
    private pinnedPanel: PinnedLinksPanelView | undefined;
    private centerDragCount = 0;
    private centerDragOver = false;
    private stateSubscription: (() => void) | undefined;
    private queueSubscription: (() => void) | undefined;
    private inert = false;

    public constructor(props: { model: LinkEditor }) {
        const root = createPanelElement({
            name: "link-editor-root",
            direction: "row",
            overflow: "hidden",
            flex: 1,
        });
        super(props, root);
        this.model = props.model;
        this.root.tabIndex = -1;
        this.centerPanel = createPanelElement({
            name: "link-editor-center",
            direction: "column",
            flex: 1,
            width: 0,
            overflow: "hidden",
            position: "relative",
        });
        this.root.append(this.centerPanel);
    }

    protected onMount(): void {
        this.model.containerElement = this.root;
        this.listen(this.centerPanel, "dragenter", this.handleCenterDragEnter);
        this.listen(this.centerPanel, "dragover", this.handleCenterDragOver);
        this.listen(this.centerPanel, "dragleave", this.handleCenterDragLeave);
        this.listen(this.centerPanel, "drop", this.handleCenterDrop);
        this.queueSubscription = this.ownSubscription(this.model.queue.subscribe(this.handleQueueEvent));
        this.stateSubscription = this.ownSubscription(this.model.state.subscribe(this.handleStateChange));
        this.own(() => { this.inert = true; });
        this.applyProjection(selectBody(this.model.state.get(), this.model));
    }

    protected onUpdate(props: { model: LinkEditor }): void {
        if (props.model !== this.model) {
            this.model.containerElement = null;
            this.stateSubscription?.();
            this.queueSubscription?.();
            this.model = props.model;
            this.model.containerElement = this.root;
            this.queueSubscription = this.ownSubscription(this.model.queue.subscribe(this.handleQueueEvent));
            this.stateSubscription = this.ownSubscription(this.model.state.subscribe(this.handleStateChange));
        }
        this.applyProjection(selectBody(this.model.state.get(), this.model));
    }

    protected onDispose(): void {
        if (this.model.containerElement === this.root) this.model.containerElement = null;
        this.model.gridModel = null;
        this.activeBody = undefined;
        this.emptyRoot = undefined;
        this.splitter = undefined;
        this.pinnedPanel = undefined;
    }

    private readonly handleQueueEvent = (event: { type: string }): void => {
        if (event.type === "focus") this.model.refocus();
    };

    private readonly handleStateChange = (): void => {
        if (this.inert) return;
        this.applyProjection(selectBody(this.model.state.get(), this.model));
    };

    private applyProjection(projection: BodyProjection): void {
        this.syncCenter(projection);
        this.syncPinnedPanel(projection);
    }

    private syncCenter(projection: BodyProjection): void {
        if (projection.error) {
            this.clearCenterBranch();
            const errorRoot = createPanelElement({
                name: "link-editor-error-root",
                flex: 1,
                overflow: "hidden",
            });
            const error = createPanelElement({
                name: "editor-error",
                flex: true,
                justify: "center",
                align: "center",
                padding: "xxl",
            });
            error.append(createTextElement(projection.error, { color: "warning", preWrap: true }));
            errorRoot.append(error);
            this.centerPanel.append(errorRoot);
            this.emptyRoot = errorRoot;
            return;
        }

        if (projection.allLinks.length === 0) {
            this.showEmpty("link-editor-empty", [
                createTextElement(t("links.linksHeading"), { size: "xxl", color: "default" }),
                createTextElement(t("links.noLinksYet"), { color: "light" }),
                createTextElement(t("links.addFirstLink"), { color: "light" }),
            ]);
            return;
        }
        if (projection.filteredLinks.length === 0) {
            this.showEmpty("link-editor-empty-filtered", [
                createTextElement(t("links.noLinksMatchFilter"), { color: "light" }),
            ]);
            return;
        }

        if (this.emptyRoot) {
            this.emptyRoot.remove();
            this.emptyRoot = undefined;
        }
        if (this.activeBody && this.activeMode === projection.viewMode) {
            if (projection.viewMode === "list" && this.activeBody instanceof LinksListView) {
                this.activeBody.update(this.listProps(projection));
            } else if (projection.viewMode !== "list" && this.activeBody instanceof LinksTilesView) {
                this.activeBody.update(this.tilesProps(projection, projection.viewMode));
            }
            this.syncCenterDragState();
            return;
        }

        this.clearActiveBody();
        if (projection.viewMode === "list") {
            const view = this.child(createLinksItemsView("list", this.listProps(projection)));
            this.activeBody = view;
            this.activeMode = projection.viewMode;
            this.centerPanel.append(view.root);
            view.mount();
        } else {
            const view = this.child(createLinksItemsView(
                projection.viewMode,
                this.tilesProps(projection, projection.viewMode),
            ));
            this.activeBody = view;
            this.activeMode = projection.viewMode;
            this.centerPanel.append(view.root);
            view.mount();
        }
        this.syncCenterDragState();
    }

    private showEmpty(name: string, children: Node[]): void {
        this.clearActiveBody();
        if (!this.emptyRoot || this.emptyRoot.dataset.name !== name) {
            this.emptyRoot?.remove();
            this.emptyRoot = createPanelElement({
                name,
                direction: "column",
                flex: 1,
                align: "center",
                justify: "center",
                gap: "xl",
                padding: "xl",
            });
            this.centerPanel.append(this.emptyRoot);
        }
        this.emptyRoot.replaceChildren(...children);
    }

    private clearCenterBranch(): void {
        this.clearActiveBody();
        this.emptyRoot?.remove();
        this.emptyRoot = undefined;
    }

    private clearActiveBody(): void {
        if (!this.activeBody) return;
        this.model.gridModel = null;
        this.releaseChild(this.activeBody);
        this.activeBody = undefined;
        this.activeMode = undefined;
    }

    private syncPinnedPanel(projection: BodyProjection): void {
        if (projection.error || projection.pinnedLinks.length === 0) {
            if (this.pinnedPanel) {
                this.releaseChild(this.pinnedPanel);
                this.pinnedPanel = undefined;
            }
            if (this.splitter) {
                this.releaseChild(this.splitter);
                this.splitter = undefined;
            }
            return;
        }

        if (!this.splitter || !this.pinnedPanel) {
            this.pinnedPanel && this.releaseChild(this.pinnedPanel);
            this.splitter && this.releaseChild(this.splitter);
            this.splitter = this.child(new SplitterView(this.splitterProps(projection.pinnedPanelWidth)));
            this.pinnedPanel = this.child(new PinnedLinksPanelView({
                pinnedLinks: projection.pinnedLinks,
                model: this.model,
                selectedLinkId: projection.selectedLinkId,
                width: projection.pinnedPanelWidth,
            }));
            this.root.append(this.splitter.root, this.pinnedPanel.root);
            this.splitter.mount();
            this.pinnedPanel.mount();
            return;
        }

        this.splitter.update(this.splitterProps(projection.pinnedPanelWidth));
        this.pinnedPanel.update({
            pinnedLinks: projection.pinnedLinks,
            model: this.model,
            selectedLinkId: projection.selectedLinkId,
            width: projection.pinnedPanelWidth,
        });
    }

    private splitterProps(width: number): SplitterProps {
        return {
            name: "link-editor-pinned-splitter",
            orientation: "vertical",
            value: width,
            onChange: this.model.setPinnedPanelWidth,
            side: "after",
            border: "before",
        };
    }

    private listProps(projection: BodyProjection): LinksListProps {
        return {
            ...this.sharedItemsProps(projection),
            searchText: projection.searchText,
            allTags: projection.allTags,
            onToggleTag: this.handleListToggleTag,
        };
    }

    private tilesProps(
        projection: BodyProjection,
        viewMode: Exclude<LinkViewMode, "list">,
    ): LinksTilesProps {
        return {
            ...this.sharedItemsProps(projection),
            viewMode,
        };
    }

    private sharedItemsProps(projection: BodyProjection) {
        return {
            links: projection.filteredLinks,
            selectedId: projection.selectedLinkId,
            onSelect: this.handleSelect,
            onDoubleClick: this.handleOpen,
            onEdit: this.handleEdit,
            onDelete: this.handleDelete,
            onContextMenu: this.handleContextMenu,
            getAdditionalIcon: (link: ILink) => this.getAdditionalIcon(link, projection.pinnedLinkIds),
            dragSourceId: this.model.treeProvider?.sourceUrl,
            imageProxy: this.model.imageProxy,
            onGridModel: this.handleGridModel,
        };
    }

    private syncCenterDragState(): void {
        applyPanelAttributes(this.centerPanel, resolvePanelAttributes({
            name: "link-editor-center",
            direction: "column",
            flex: 1,
            width: 0,
            overflow: "hidden",
            position: "relative",
            border: this.centerDragOver,
            borderColor: this.centerDragOver ? "active" : undefined,
        }));
    }

    private readonly handleCenterDragEnter = (event: DragEvent): void => {
        this.centerDragCount++;
        if (!hasTraitDragData(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        this.centerDragOver = true;
        this.syncCenterDragState();
    };

    private readonly handleCenterDragOver = (event: DragEvent): void => {
        if (!hasTraitDragData(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    };

    private readonly handleCenterDragLeave = (): void => {
        this.centerDragCount--;
        if (this.centerDragCount > 0) return;
        this.centerDragCount = 0;
        this.centerDragOver = false;
        this.syncCenterDragState();
    };

    private readonly handleCenterDrop = (event: DragEvent): void => {
        event.preventDefault();
        this.centerDragCount = 0;
        this.centerDragOver = false;
        this.syncCenterDragState();
        const payload = getTraitDragData(event.dataTransfer);
        if (!payload) return;
        const linkTrait = resolveTraits(payload.typeId)?.get(LINK);
        if (!linkTrait) return;
        const items = linkTrait.getItems(payload.data);
        if (items.length) void this.model.importLinks(items);
    };

    private readonly handleListToggleTag = (link: ILink, tag: string): void => {
        if (!link.id) return;
        this.model.toggleTag(link.id, tag);
    };

    private readonly handleGridModel = (gridModel: GridModelCapability | null): void => {
        this.model.gridModel = gridModel;
    };

    private readonly handleSelect = (link: ILink): void => this.model.selectLink(link.id);
    private readonly handleOpen = (link: ILink): void => openLinkItem(this.model, link);
    private readonly handleEdit = (link: ILink): void => { void this.model.showLinkDialog(link.id); };
    private readonly handleDelete = (link: ILink, skipConfirm: boolean): void => {
        void this.model.deleteLink(link.id, skipConfirm);
    };

    private readonly handleContextMenu = (event: MouseEvent, link: ILink): void => {
        buildLinkContextMenu(this.model, link as LinkItem, { pinned: false })(event);
    };

    private getAdditionalIcon(link: ILink, pinnedLinkIds: Set<string>) {
        return pinnedLinkIds.has(link.id) ? "pin-filled" as const : undefined;
    }

}
