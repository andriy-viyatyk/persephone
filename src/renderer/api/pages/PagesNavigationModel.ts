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
        const page = this.model.query.findPage(pageId);
        if (page && this.model.query.isRightPinned(page.id)) {
            this.model.openPopover(page.id);
            return;
        }
        if (page && page !== ordered[ordered.length - 1]) {
            this.model.setPageArrays({ ordered: [...ordered.filter((p) => p !== page), page] });
            this.model.persistence.saveStateDebounced();
            this.model.onShow.send(page);
            this.model.onFocus.send(page);
        }
    };

    showNext = () => this.showAdjacent(1);

    showPrevious = () => this.showAdjacent(-1);

    /** Ctrl+Tab order is the visible tab-strip order (`pages`), not the activation order (`ordered`,
     *  whose last entry is the active page). Right-pinned pages sit outside the strip and are skipped. */
    private showAdjacent(step: 1 | -1): void {
        const pages = this.model.state.get().pages.filter((p) => !this.model.query.isRightPinned(p.id));
        if (!pages.length) return;
        const index = pages.indexOf(this.model.query.activePage as PageModel);
        const next = index < 0
            ? (step > 0 ? 0 : pages.length - 1)
            : (index + step + pages.length) % pages.length;
        this.showPage(pages[next].id);
    }

    focusPage = (page: PageModel) => {
        this.model.onFocus.send(page);
    };
}
