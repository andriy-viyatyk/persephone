import { pagesModel } from "../../api/pages";
import { TraitTypeId, getTraitDragData } from "../../core/traits";
import { KeyedList } from "../../uikit/shared/keyed-list";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { PageModel } from "../../api/pages/PageModel";
import { PageTabView } from "./PageTabView";
import "./PageTabs.css";

export class RightPageTabsView extends VanillaView<object> {
    private readonly tabViews = new WeakMap<HTMLElement, PageTabView>();
    private readonly tabs: KeyedList<PageModel, string, HTMLElement>;

    public constructor(props: object) {
        super(props);
        this.tabs = new KeyedList<PageModel, string, HTMLElement>(this.root, {
            keyOf: (page) => page.id,
            create: (page) => this.createTab(page),
            update: (element, page) => this.updateTab(element, page),
            remove: (element) => this.removeTab(element),
        });
    }

    protected onMount(): void {
        this.root.dataset.type = "page-tabs";
        this.root.dataset.name = "right-page-tabs";
        this.root.dataset.mode = "right";
        this.root.className = "page-tabs right-page-tabs";
        this.listen(this.root, "drop", (event) => this.handleDrop(event));
        this.listen(this.root, "dragover", (event) => this.handleDragOver(event));
        this.own(() => this.tabs.dispose());
        this.bind(
            pagesModel.state,
            (state) => state.pages,
            (pages) => this.tabs.update(pages.filter((page) => pagesModel.query.isRightPinned(page.id))),
        );
    }

    private createTab(page: PageModel): HTMLElement {
        const view = new PageTabView({ model: page, mode: "right" });
        this.tabViews.set(view.root, view);
        this.child(view).mount();
        return view.root;
    }

    private updateTab(element: HTMLElement, page: PageModel): void {
        this.tabViews.get(element)?.update({ model: page, mode: "right" });
    }

    private removeTab(element: HTMLElement): void {
        const view = this.tabViews.get(element);
        if (!view) return;
        view.dispose();
        this.tabViews.delete(element);
    }

    private handleDragOver(event: DragEvent): void {
        const payload = getTraitDragData(event.dataTransfer);
        if (payload?.typeId !== TraitTypeId.PageTab) return;
        const sourceId = (payload.data as { key: string }).key;
        if (!pagesModel.query.isRightPinned(sourceId)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    }

    private handleDrop(event: DragEvent): void {
        const payload = getTraitDragData(event.dataTransfer);
        if (payload?.typeId !== TraitTypeId.PageTab) return;
        const sourceId = (payload.data as { key: string }).key;
        if (pagesModel.query.isRightPinned(sourceId)) {
            const target = this.root.querySelector<HTMLElement>("[data-type=\"page-tab\"]:last-child");
            const targetId = target?.dataset.pageId;
            if (targetId && targetId !== sourceId) pagesModel.moveTab(sourceId, targetId);
        }
        event.preventDefault();
        event.stopPropagation();
    }
}
