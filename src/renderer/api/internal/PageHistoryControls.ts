import { EditorId } from "../../../shared/editor-ids";
import { pages } from "../pages";

export type PageHistoryDirection = "back" | "forward";

/** Shared owner for user initiated page-history actions. Script calls use PageHistory directly. */
export class PageHistoryControls {
    isEligiblePage(): boolean {
        const page = pages.query.activePage;
        return !!page && page.mainEditor?.editorId !== EditorId.browserView;
    }

    go(direction: PageHistoryDirection): void {
        const page = pages.query.activePage;
        if (!page || page.mainEditor?.editorId === EditorId.browserView) return;
        if (direction === "back" ? !page.history.canGoBack : !page.history.canGoForward) return;

        const action = direction === "back" ? page.history.back : page.history.forward;
        void action().catch((error: unknown) => {
            console.error(`Failed to navigate page history ${direction}:`, error);
        });
    }
}

export const pageHistoryControls = new PageHistoryControls();
