import { EditorId } from "../../../shared/editor-ids";
import { pages } from "../pages";
import type { IPageHost } from "../pages/IPageHost";
import { PageModel } from "../pages/PageModel";

export type PageHistoryDirection = "back" | "forward";

/** Shared owner for user initiated page-history actions. Script calls use PageHistory directly. */
export class PageHistoryControls {
    /** A page whose history the user can drive: it has one, and it is not a Browser page
     *  (the Browser keeps its own webview history). */
    isEligiblePage(page: IPageHost | undefined = pages.query.activePage): boolean {
        return !!page?.history
            && (!(page instanceof PageModel) || page.restore.state.get().status === "ready")
            && page.mainEditor?.editorId !== EditorId.browserView;
    }

    /** Moves `page` (the active page for shortcuts and mouse buttons) one step in its history. */
    go(direction: PageHistoryDirection, page: IPageHost | undefined = pages.query.activePage): void {
        if (!page || !this.isEligiblePage(page)) return;
        const history = page.history;
        if (!history) return;
        if (direction === "back" ? !history.canGoBack : !history.canGoForward) return;

        const move = direction === "back" ? history.back() : history.forward();
        void move.catch((error: unknown) => {
            console.error(`Failed to navigate page history ${direction}:`, error);
        });
    }
}

export const pageHistoryControls = new PageHistoryControls();
