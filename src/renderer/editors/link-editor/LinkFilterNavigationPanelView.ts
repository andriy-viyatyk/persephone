import type { ILink } from "../../api/types/io.tree";
import type { GridModelCapability } from "../../uikit/DataGrid";
import { createPanelElement, applyPanelAttributes, resolvePanelAttributes } from "../../uikit/Panel/panel-style";
import { SplitterView } from "../../uikit/Splitter/SplitterView";
import type { SplitterProps } from "../../uikit/Splitter/SplitterView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { LinksListView } from "./LinksListView";
import type { LinksListProps } from "./LinksList";
import { LinkEditor, type LinkEditorState } from "./LinkEditor";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Splitter/Splitter.css";

interface NavigationTopViewHandle {
    root: HTMLElement;
    mount(): void;
    dispose(): void;
}

interface NavigationTopViewAdapter {
    create(): NavigationTopViewHandle;
    update(): void;
}

export interface LinkFilterNavigationStrategy {
    name: "tags" | "hostnames";
    topView(editor: LinkEditor): NavigationTopViewAdapter;
    selectedKey(state: LinkEditorState): string;
    itemsFor(editor: LinkEditor, key: string): ILink[];
    sourceId: "link-tag" | "link-hostname";
}

interface NavigationState {
    selectedKey: string;
    links: ILink[];
    selectedLinkId: string;
    allTags: string[];
}

interface LinkFilterNavigationPanelProps {
    editor: LinkEditor;
    strategy: LinkFilterNavigationStrategy;
}

export class LinkFilterNavigationPanelView extends VanillaView<LinkFilterNavigationPanelProps> {
    private readonly topPanel: HTMLDivElement;
    private topView: NavigationTopViewHandle | undefined;
    private topViewAdapter: NavigationTopViewAdapter | undefined;
    private splitter: SplitterView | undefined;
    private bottomPanel: HTMLDivElement | undefined;
    private linksList: LinksListView | undefined;
    private gridModel: GridModelCapability | undefined;
    private bottomHeight: number | undefined;
    private editorBinding: (() => void) | undefined;
    private boundEditor: LinkEditor | undefined;

    public constructor(props: LinkFilterNavigationPanelProps) {
        const { name } = props.strategy;
        super(props, createPanelElement({
            name: `link-${name}-navigation`,
            direction: "column",
            flex: 1,
            overflow: "hidden",
            width: "100%",
        }));
        this.topPanel = createPanelElement({
            name: `link-${name}-navigation-top`,
            direction: "column",
            flex: 1,
            overflow: "hidden",
            minHeight: 40,
        });
    }

    protected onMount(): void {
        this.topViewAdapter = this.props.strategy.topView(this.props.editor);
        this.topView = this.topViewAdapter.create();
        this.topPanel.append(this.topView.root);
        this.root.append(this.topPanel);
        this.topView.mount();
        this.bindEditorState(this.props.editor);
        this.seedDefaultSplit();
    }

    protected onUpdate(props: LinkFilterNavigationPanelProps): void {
        if (props.editor !== this.boundEditor) {
            this.topView?.dispose();
            this.topView?.root.remove();
            this.topViewAdapter = props.strategy.topView(props.editor);
            this.topView = this.topViewAdapter.create();
            this.topPanel.append(this.topView.root);
            this.topView.mount();
            this.bindEditorState(props.editor);
        } else {
            this.topViewAdapter?.update();
        }
        this.applyState(this.snapshot(props.editor));
    }

    private bindEditorState(editor: LinkEditor): void {
        this.editorBinding?.();
        this.boundEditor = editor;
        this.editorBinding = this.bind(
            editor.state,
            (state) => ({
                selectedKey: this.props.strategy.selectedKey(state),
                links: state.data.links,
                selectedLinkId: state.selectedLinkId,
                allTags: state.tags,
            }),
            (state) => {
                if (this.boundEditor !== editor) return;
                this.applyState(state);
            },
        );
    }

    protected onDispose(): void {
        this.gridModel = undefined;
        this.topView?.dispose();
        this.topView = undefined;
        this.topViewAdapter = undefined;
    }

    private snapshot(editor: LinkEditor): NavigationState {
        const state = editor.state.get();
        return {
            selectedKey: this.props.strategy.selectedKey(state),
            links: state.data.links,
            selectedLinkId: state.selectedLinkId,
            allTags: state.tags,
        };
    }

    private readonly applyState = (state: NavigationState): void => {
        const items = state.selectedKey
            ? this.props.strategy.itemsFor(this.props.editor, state.selectedKey)
            : state.links.filter((item) => !item.isDirectory);
        this.syncBottom(items, state.selectedLinkId, state.allTags);
        this.scrollSelected(items, state.selectedLinkId);
    };

    private syncBottom(items: ILink[], selectedLinkId: string, allTags: string[]): void {
        if (items.length === 0) {
            this.removeBottom();
            return;
        }

        const height = this.bottomHeight ?? 150;
        if (!this.linksList) {
            this.splitter = this.child(new SplitterView(this.splitterProps(height)));
            this.bottomPanel = createPanelElement({
                name: `link-${this.props.strategy.name}-navigation-bottom`,
                direction: "column",
                overflow: "hidden",
                shrink: false,
                height,
            });
            this.linksList = this.child(new LinksListView(this.linksListProps(items, selectedLinkId, allTags)));
            this.root.append(this.splitter.root, this.bottomPanel);
            this.bottomPanel.append(this.linksList.root);
            this.splitter.mount();
            this.linksList.mount();
            return;
        }

        this.applyBottomHeight(height);
        this.splitter?.update(this.splitterProps(height));
        this.linksList.update(this.linksListProps(items, selectedLinkId, allTags));
    }

    private removeBottom(): void {
        if (this.linksList) {
            this.releaseChild(this.linksList);
            this.linksList = undefined;
        }
        if (this.splitter) {
            this.releaseChild(this.splitter);
            this.splitter = undefined;
        }
        this.bottomPanel?.remove();
        this.bottomPanel = undefined;
        this.gridModel = undefined;
    }

    private linksListProps(items: ILink[], selectedLinkId: string, allTags: string[]): LinksListProps {
        return {
            links: items,
            selectedId: selectedLinkId || undefined,
            onSelect: this.handleSelect,
            onDoubleClick: this.handleSelect,
            allTags,
            onToggleTag: this.handleToggleTag,
            onGridModel: (grid) => {
                this.gridModel = grid ?? undefined;
                this.scrollSelected(items, selectedLinkId);
            },
        };
    }

    private splitterProps(value: number): SplitterProps {
        return {
            name: `link-${this.props.strategy.name}-bottom-splitter`,
            orientation: "horizontal",
            value,
            onChange: this.handleChangeHeight,
            side: "after",
            border: "before",
        };
    }

    private readonly handleSelect = (item: ILink): void => {
        this.props.editor.openLinkFromPanel(item, this.props.strategy.sourceId);
    };

    private readonly handleToggleTag = (item: ILink, tag: string): void => {
        if (!item.id) return;
        this.props.editor.toggleTag(item.id, tag);
    };

    private readonly handleChangeHeight = (height: number): void => {
        const maxHeight = this.root.clientHeight * 0.8;
        this.bottomHeight = Math.max(40, Math.min(height, maxHeight));
        this.applyBottomHeight(this.bottomHeight);
        this.splitter?.update(this.splitterProps(this.bottomHeight));
    };

    private applyBottomHeight(height: number): void {
        if (!this.bottomPanel) return;
        applyPanelAttributes(this.bottomPanel, resolvePanelAttributes({
            name: `link-${this.props.strategy.name}-navigation-bottom`,
            direction: "column",
            overflow: "hidden",
            shrink: false,
            height,
        }));
    }

    private seedDefaultSplit(): void {
        this.schedule.settledLayout(this.root, () => {
            const height = this.root.clientHeight;
            if (height <= 0 || this.bottomHeight !== undefined) return;
            this.bottomHeight = Math.max(40, height * 0.5);
            this.applyBottomHeight(this.bottomHeight);
            this.splitter?.update(this.splitterProps(this.bottomHeight));
        });
    }

    private scrollSelected(items: ILink[], selectedLinkId: string): void {
        if (!selectedLinkId || !this.gridModel) return;
        const row = items.findIndex((item) => (item.id ?? item.href) === selectedLinkId);
        if (row >= 0) void this.gridModel.scrollToRow(row, "nearest");
    }
}
