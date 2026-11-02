import type { EditorModel } from "../base/EditorModel";
import { ToolsHubEditor, type HubTab } from "./ToolsHubEditor";
import { SearchBoardsTabView } from "./SearchBoardsTab";
import { SiteExtensionsTabView } from "./SiteExtensionsTab";
import { EditorsTreeView } from "../../ui/sidebar/EditorsTreeView";
import { EditorCategoriesView } from "../../ui/sidebar/EditorCategoriesView";
import { TrustedToolsListView } from "../../ui/sidebar/TrustedToolsListView";
import { SplitterView } from "../../uikit/Splitter/SplitterView";
import { InputView } from "../../uikit/Input/InputView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { SegmentedControlView } from "../../uikit/SegmentedControl/SegmentedControlView";
import { VanillaView, type IOwnedView } from "../../uikit/shared/vanilla-view";
import { t } from "../../../shared/i18n/t";
import "../../uikit/Panel/Panel.css";
import "../../uikit/SegmentedControl/SegmentedControl.css";
import "./ToolsHubView.css";

function requireToolsHubModel(model: EditorModel): ToolsHubEditor {
    if (!(model instanceof ToolsHubEditor)) throw new Error("Tools hub view received an invalid model.");
    return model;
}

export class ToolsHubEditorView extends VanillaView<{ model: EditorModel }> {
    private model: ToolsHubEditor;
    private tabs: SegmentedControlView | undefined;
    private body: HTMLDivElement | undefined;
    private activeViews: IOwnedView[] = [];
    private activeTab: HubTab | undefined;
    private filterView: InputView | undefined;
    private filterText = "";
    private editorsTree: EditorsTreeView | undefined;
    private modelSubscription: (() => void) | undefined;

    public constructor(props: { model: EditorModel }) {
        const root = createPanelElement({ name: "tools-hub", direction: "column", width: "100%", height: "100%", minHeight: 0 });
        root.dataset.type = "tools-hub";
        super(props, root);
        this.model = requireToolsHubModel(props.model);
    }

    protected onMount(): void {
        const tabsHost = createPanelElement({ direction: "row", paddingX: "lg", paddingY: "md", shrink: false });
        this.body = createPanelElement({ direction: "column", flex: 1, minHeight: 0 });
        this.body.dataset.part = "body";
        this.tabs = this.child(new SegmentedControlView(this.tabProps()));
        tabsHost.dataset.part = "tabs-row";
        const filterView = this.child(new InputView(this.filterProps()));
        this.filterView = filterView;
        filterView.mount();
        filterView.root.dataset.part = "editors-filter";
        tabsHost.append(this.tabs.root, filterView.root);
        this.root.append(tabsHost, this.body);
        this.tabs.mount();
        this.mountBody(this.model.state.get().tab);
        this.modelSubscription = this.model.state.subscribe<HubTab>((tab) => this.applyTab(tab), (state) => state.tab);
        this.own(() => { this.modelSubscription?.(); this.modelSubscription = undefined; });
    }

    protected onUpdate(props: { model: EditorModel }): void {
        const model = requireToolsHubModel(props.model);
        if (model !== this.model) {
            this.modelSubscription?.();
            this.model = model;
            this.modelSubscription = this.model.state.subscribe<HubTab>((tab) => this.applyTab(tab), (state) => state.tab);
        }
        this.applyTab(this.model.state.get().tab);
    }

    protected onDispose(): void { this.clearBody(); }

    private readonly onFilterChange = (value: string): void => {
        this.filterText = value;
        this.filterView?.update(this.filterProps());
        this.editorsTree?.setFilter(value);
    };

    private filterProps(): ConstructorParameters<typeof InputView>[0] {
        return {
            name: "editors-tree-filter",
            size: "sm",
            value: this.filterText,
            placeholder: t("shell.editorCategoryFilterPlaceholder"),
            onChange: this.onFilterChange,
        };
    }

    private tabProps() {
        return {
            name: "tools-hub-tabs",
            value: this.model.state.get().tab,
            onChange: (value: string) => this.model.setTab(value as HubTab),
            items: [
                { value: "editors", label: t("shell.editorCategoryEditorsTab") },
                { value: "search", label: t("tools.hubSearchBoards") },
                { value: "tools", label: t("tools.hubTools") },
                { value: "site-extensions", label: t("tools.hubSiteExtensions") },
            ],
        };
    }

    private applyTab(tab: HubTab): void {
        this.tabs?.update({ ...this.tabProps(), value: tab });
        if (tab !== this.activeTab) this.mountBody(tab);
    }

    private clearBody(): void {
        this.editorsTree = undefined;
        for (const view of this.activeViews) this.releaseChild(view);
        this.activeViews = [];
        this.body?.replaceChildren();
    }

    private mountBody(tab: HubTab): void {
        this.clearBody();
        if (!this.body) return;
        if (tab === "editors") {
            this.body.dataset.layout = "editors";
            const categories = this.child(new EditorCategoriesView({}));
            // The splitter works in pixels; the Categories width is kept within 30-70% of the body.
            const body = this.body;
            const clampWidth = (px: number): number => {
                const total = body.clientWidth;
                return total > 0 ? Math.min(Math.max(px, total * 0.3), total * 0.7) : px;
            };
            const splitterProps = {
                name: "editor-categories-splitter",
                orientation: "vertical" as const,
                side: "after" as const,
                value: 0,
                onChange: (value: number) => {
                    const width = clampWidth(value);
                    body.style.setProperty("--categories-width", `${width}px`);
                    splitterProps.value = width;
                    splitter.update({ ...splitterProps });
                },
            };
            const splitter = this.child(new SplitterView(splitterProps));
            // Seed the drag origin from the rendered width (50% by default) on first press.
            splitter.root.addEventListener("pointerdown", () => {
                if (splitterProps.value === 0) {
                    splitterProps.value = categories.root.offsetWidth;
                    splitter.update({ ...splitterProps });
                }
            }, { capture: true });
            const tree = this.child(new EditorsTreeView({ onNewCategory: (categoryId) => categories.startRename(categoryId) }));
            this.editorsTree = tree;
            // Tree left, Categories right; `side: "after"` makes the splitter size the pane after it.
            this.activeViews = [tree, splitter, categories];
            this.body.append(tree.root, splitter.root, categories.root);
            categories.mount();
            splitter.mount();
            tree.mount();
            tree.setFilter(this.filterText);
        } else {
            this.body.dataset.layout = "single";
            const view = tab === "search" ? new SearchBoardsTabView({})
                : tab === "site-extensions" ? new SiteExtensionsTabView({})
                    : new TrustedToolsListView({});
            this.activeViews = [this.child(view)];
            this.body.append(view.root);
            view.mount();
        }
        // The tree filter sits on the tab row and applies to the Editors tab only.
        if (this.filterView) this.filterView.root.hidden = tab !== "editors";
        this.activeTab = tab;
    }
}
