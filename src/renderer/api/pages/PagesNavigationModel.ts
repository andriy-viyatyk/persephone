import type { PagesModel } from "./PagesModel";
import type { PageModel } from "./PageModel";

/**
 * PagesNavigationModel — Manage which page is visible/focused.
 */
export class PagesNavigationModel {
    constructor(private model: PagesModel) {}

    showPage = (pageId?: string) => {
        if (!pageId) return;
        const { ordered } = this.model.state.get();
        const page = ordered.find((p) => p.id === pageId);
        if (page && page !== ordered[ordered.length - 1]) {
            this.model.state.update((s) => {
                s.ordered = [...s.ordered.filter((p) => p !== page), page];
            });
            this.model.persistence.saveStateDebounced();
            this.model.onShow.send(page);
            this.model.onFocus.send(page);
        }
    };

    showNext = () => {
        const pages = this.model.state.get().pages;
        if (!pages.length) return;
        const activePage = this.model.query.activePage;
        let nextIndex = pages.findIndex((p) => p === activePage) + 1;
        if (nextIndex >= pages.length) {
            nextIndex = 0;
        }
        this.showPage(pages[nextIndex].id);
    };

    showPrevious = () => {
        const pages = this.model.state.get().pages;
        if (!pages.length) return;
        const activePage = this.model.query.activePage;
        let prevIndex = pages.findIndex((p) => p === activePage) - 1;
        if (prevIndex < 0) {
            prevIndex = pages.length - 1;
        }
        this.showPage(pages[prevIndex].id);
    };

    focusPage = (page: PageModel) => {
        this.model.onFocus.send(page);
    };
}
