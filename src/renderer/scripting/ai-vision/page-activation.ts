import { pages } from "../../api/pages";
import { logPageActivated } from "./event-log";
import {
    isAgentNavigating,
    isPageAttended,
    prunePageAttention,
    resetPageAttention,
} from "./page-attention";

/**
 * Both halves of a side-by-side group render while either one is active
 * (`AppPageManagerView.applyGrouping` sets `display: flex` for every page in the active group), so
 * moving focus between grouped partners costs the agent nothing: the page it was working with is
 * still on screen and still measurable. Reporting that as a page going away would be a false
 * positive on an ordinary user action.
 */
function staysVisibleBeside(previousPageId: string, activePageId: string): boolean {
    return pages.query.getGroupedPage(activePageId)?.id === previousPageId;
}

/** Watch active-page changes and report switches relevant to the agent. */
export function installPageActivationEvents(): () => void {
    resetPageAttention();
    let rememberedPageId = pages.query.activePage?.id;
    const unsubscribe = pages.onShow.subscribe(() => {
        const activePageId = pages.query.activePage?.id;
        if (activePageId === rememberedPageId) return;

        prunePageAttention(pages.query.pages.map((page) => page.id));
        const previousPageId = rememberedPageId;
        rememberedPageId = activePageId;

        if (
            previousPageId
            && activePageId
            && !isAgentNavigating()
            && !staysVisibleBeside(previousPageId, activePageId)
            && (isPageAttended(previousPageId) || isPageAttended(activePageId))
        ) {
            logPageActivated(previousPageId, activePageId);
        }
    });
    return () => {
        unsubscribe();
        resetPageAttention();
    };
}
