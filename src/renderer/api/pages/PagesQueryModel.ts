import type { PagesModel } from "./PagesModel";
import type { PageModel } from "./PageModel";

/**
 * PagesQueryModel — Read-only queries on the page collection.
 */
export class PagesQueryModel {
    constructor(private model: PagesModel) {}

    /**
     * Find a page by any associated ID: page ID, mainEditor ID, or secondaryEditor ID.
     * All IDs are unique, so this is safe and prevents page/editor ID confusion bugs.
     */
    findPage = (id?: string): PageModel | undefined => {
        if (!id) return undefined;
        return this.model.state.get().pages.find((p) =>
            p.id === id
            || p.mainEditor?.id === id
            || p.secondaryEditors.some((se) => se.id === id)
        );
    };

    get activePage(): PageModel | undefined {
        const { ordered } = this.model.state.get();
        return ordered.length ? ordered[ordered.length - 1] : undefined;
    }

    get groupedPage(): PageModel | undefined {
        const activePage = this.activePage;
        if (!activePage) return undefined;
        return this.getGroupedPage(activePage.id);
    }

    getGroupedPage = (withId: string): PageModel | undefined => {
        const state = this.model.state.get();
        // Resolve to page ID if an editor ID was passed
        const pageId = this.findPage(withId)?.id ?? withId;
        const groupedWithId =
            state.leftRight.get(pageId) || state.rightLeft.get(pageId);
        if (groupedWithId) {
            return this.findPage(groupedWithId);
        }
        return undefined;
    };

    getLeftGroupedPage = (withId: string): PageModel | undefined => {
        const state = this.model.state.get();
        // Resolve to page ID if an editor ID was passed
        const pageId = this.findPage(withId)?.id ?? withId;
        const groupedWithId = state.rightLeft.get(pageId);
        if (groupedWithId) {
            return this.findPage(groupedWithId);
        }
        return undefined;
    };

    isLastPage = (id?: string): boolean => {
        if (!id) return false;
        const { pages } = this.model.state.get();
        const pageId = this.findPage(id)?.id ?? id;
        return !!(pages.length && pages[pages.length - 1].id === pageId);
    };

    isGrouped = (id: string): boolean => {
        const state = this.model.state.get();
        const pageId = this.findPage(id)?.id ?? id;
        return state.leftRight.has(pageId) || state.rightLeft.has(pageId);
    };

    get pages(): PageModel[] {
        return this.model.state.get().pages;
    }
}
