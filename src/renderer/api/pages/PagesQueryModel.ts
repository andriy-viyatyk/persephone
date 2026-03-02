import type { PagesModel } from "./PagesModel";
import { PageModel } from "../../editors/base";

/**
 * PagesQueryModel — Read-only queries on the page collection.
 */
export class PagesQueryModel {
    constructor(private model: PagesModel) {}

    findPage = (pageId?: string): PageModel | undefined => {
        return pageId
            ? this.model.state.get().pages.find((p) => p.state.get().id === pageId)
            : undefined;
    };

    get activePage(): PageModel | undefined {
        const { ordered } = this.model.state.get();
        return ordered.length ? ordered[ordered.length - 1] : undefined;
    }

    get groupedPage(): PageModel | undefined {
        const activePage = this.activePage;
        if (!activePage) return undefined;
        return this.getGroupedPage(activePage.state.get().id);
    }

    getGroupedPage = (withPageId: string): PageModel | undefined => {
        const state = this.model.state.get();
        const groupedWithId =
            state.leftRight.get(withPageId) || state.rightLeft.get(withPageId);
        if (groupedWithId) {
            return this.findPage(groupedWithId);
        }
        return undefined;
    };

    getLeftGroupedPage = (withPageId: string): PageModel | undefined => {
        const state = this.model.state.get();
        const groupedWithId = state.rightLeft.get(withPageId);
        if (groupedWithId) {
            return this.findPage(groupedWithId);
        }
        return undefined;
    };

    isLastPage = (pageId?: string): boolean => {
        const { pages } = this.model.state.get();
        return !!(
            pages.length && pages[pages.length - 1].state.get().id === pageId
        );
    };

    isGrouped = (pageId: string): boolean => {
        const state = this.model.state.get();
        return state.leftRight.has(pageId) || state.rightLeft.has(pageId);
    };

    canGroupWithLeft = (rightPageId: string): boolean => {
        const pageIndex = this.model.state
            .get()
            .pages.findIndex((p) => p.id === rightPageId);
        return pageIndex > 0;
    };

    canGroupWithRight = (leftPageId: string): boolean => {
        const state = this.model.state.get();
        const pageIndex = state.pages.findIndex((p) => p.id === leftPageId);
        return pageIndex >= 0 && pageIndex < state.pages.length - 1;
    };
}
