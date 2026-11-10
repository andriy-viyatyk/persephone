import { BoardRoot } from "../../../shared/board/board-root";
import type { PageModel } from "../pages/PageModel";
import { app } from "../app";
import { ui } from "../ui";
import { isBoardRootBusy } from "./busy-boards";
import { asBoardHostEditor } from "./board-host-editor";
import { DialogButton, dialogButton } from "../../ui/dialogs/dialog-buttons";
import { t } from "../../../shared/i18n/t";

const CLOSE_BOARD_AND_CONTINUE = "Close board & continue";

/** Open pages whose MAIN editor runs a board (or the board at `root` when supplied). */
export function boardPagesForRoot(root?: string): PageModel[] {
    const key = root === undefined ? undefined : BoardRoot.from(root).key;
    return app.pages.pages.filter((page) => {
        const host = asBoardHostEditor(page.mainEditorInstance);
        return !!host?.boardRoot
            && (key === undefined || BoardRoot.from(host.boardRoot).key === key);
    });
}

/** True when the board at `root` has no running processes AND no open pages. */
export function isBoardIdle(root: string): boolean {
    return !isBoardRootBusy(root) && boardPagesForRoot(root).length === 0;
}

/**
 * Take the board off a page without closing the tab: confirm any unsaved content-host changes
 * (exactly what `page.close()` would have asked), then detach and dispose the board editor.
 * `detach` nulls the page's `mainEditorId`, so the tab stays open and renders the empty-page
 * state — the user keeps their tab and can reopen the board into it.
 *
 * Detaching explicitly rather than calling `setMainEditor(null)` is deliberate: that path only
 * disposes an old main that fails its survival criteria, and it skips `beforeNavigateAway` when
 * the new main is null — so a board declaring secondary views would still count as a panel
 * contributor and live on in the sidebar, webview and all. The whole point here is that nothing
 * of the board survives, because its folder is about to be renamed or deleted.
 *
 * Returns false only when the user cancels the unsaved-changes prompt.
 */
async function releaseBoardFromPage(page: PageModel): Promise<boolean> {
    const editor = page.mainEditorInstance;
    if (!editor) return true;
    if (editor.modified && !(await editor.confirmRelease())) return false;
    page.detach(editor);
    await editor.dispose();
    return true;
}

/** Take the board at `root` off every page showing it (unsaved content-host changes still get
 *  their prompt). A page left with no editor at all closes; a page that keeps another editor
 *  (an Explorer panel, for example) stays open and shows its empty state. */
export async function removeBoardFromPages(root: string): Promise<void> {
    for (const page of boardPagesForRoot(root)) {
        if (!(await releaseBoardFromPage(page))) continue;
        if (page.editors.length === 0) await page.close();
    }
}

/**
 * Ensure the board is idle, taking it off its open pages with the user's consent. A busy board
 * is a hard stop — we never auto-kill running processes. Returns true when clear to swap.
 *
 * `action` only words the prompts. Both callers need the same guarantee: no live board editor
 * may hold the folder, because an update renames it and a delete removes it. On Windows a file
 * still open anywhere under the folder is only marked for deletion rather than removed, which
 * is what left an empty folder behind after "Delete board".
 */
export async function ensureBoardIdle(
    root: string,
    action: "updating" | "deleting" = "updating",
): Promise<boolean> {
    if (isBoardRootBusy(root)) {
        void ui.notify(t(action === "deleting" ? "api.boardBusyDeleting" : "api.boardBusyUpdating"), "warning");
        return false;
    }
    const pages = boardPagesForRoot(root);
    if (pages.length) {
        const { showConfirmationDialog } = await import("../../ui/dialogs/ConfirmationDialog");
        const choice = await showConfirmationDialog({
            title: t("api.boardOpenTitle"),
            message: t(action === "deleting" ? "api.boardOpenDeleting" : "api.boardOpenUpdating", { count: pages.length }),
            buttons: [dialogButton(CLOSE_BOARD_AND_CONTINUE), dialogButton(DialogButton.cancel)],
        });
        if (choice !== CLOSE_BOARD_AND_CONTINUE) return false;
        // A content-host board's unsaved-changes prompt still gets its say, and a cancelled
        // prompt aborts the whole operation — same contract the old `page.close()` loop had.
        for (const page of pages) {
            if (!(await releaseBoardFromPage(page))) return false;
        }
    }
    return true;
}
