import { api } from "../../../ipc/renderer/api";
import type { PublishedBoardArchive } from "../../../ipc/api-param-types";
import { BoardRoot } from "../../../shared/board/board-root";
import { createLinkData } from "../../../shared/link-data";
import { errMessage } from "../../../shared/utils";
import { getActiveLocale } from "../../../shared/i18n/active-locale";
import { t } from "../../../shared/i18n/t";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { fpBasename, fpDirname, fpJoin } from "../../core/utils/file-path";
import { app } from "../app";
import { editorCategories } from "../editor-categories";
import { fs } from "../fs";
import { pagesModel } from "../pages";
import type { PageModel } from "../pages/PageModel";
import { ui } from "../ui";
import { boardInstallRegistry } from "./board-install-registry";
import { boardRegistry } from "./board-registry";
import { asBoardHostEditor } from "./board-host-editor";
import { isBoardRootBusy } from "./busy-boards";
import { invalidateBoardDisplayText } from "./board-display-text";
import { installVersion, renameReleasedFolder } from "./board-install";
import { readBoardManifest } from "./board-manifest-io";
import { publishedBoardDisplayText } from "./published-board-display-text";
import { publishedBoards } from "./published-boards";

type IdleAction = "updating" | "deleting" | "removing";

const CLOSE_BOARD_AND_CONTINUE = "Close board & continue";
const DELETE = "Delete";
const CANCEL = "Cancel";

const BUSY_KEY = { updating: "api.boardBusyUpdating", deleting: "api.boardBusyDeleting", removing: "api.boardBusyRemoving" } as const;
const OPEN_KEY = { updating: "api.boardOpenUpdating", deleting: "api.boardOpenDeleting", removing: "api.boardOpenRemoving" } as const;

/**
 * Owns operations that stop using a board. Keep their guard, page release, service stop, disk,
 * trust, install-registry, and display-text steps in one place.
 */
class BoardLifecycle {
    /** Take the board at `root` off every page showing it (unsaved content-host changes still get
     *  their prompt). A page left with no editor at all closes; a page that keeps another editor
     *  (an Explorer panel, for example) stays open and shows its empty state. */
    async releasePages(root: string): Promise<boolean> {
        for (const page of pagesModel.boardPageRouter.findPagesByBoardRoot(root)) {
            if (!(await releaseBoardFromPage(page))) return false;
            if (page.editors.length === 0) await page.close();
        }
        return true;
    }

    /** Remove trust. Local boards stay on disk. `consented`: the caller already holds the user's
     *  consent or the documented contract is "no dialog" (`app.boards.unregisterBoard`): no busy
     *  refusal, no page prompt. */
    async unregister(root: string, opts?: { consented?: boolean }): Promise<boolean> {
        await boardRegistry.load();
        if (boardRegistry.isBundled(root)) return true;
        if (!(await this.release(root, "removing", opts?.consented === true))) return false;
        await api.stopModuleService(root);
        await boardRegistry.untrust(root); // this window's untrust makes editorCategories prune the pin
        invalidateBoardDisplayText(root);
        return true;
    }

    /** Delete a board folder (Boards panel). The caller has confirmed. A folder that is already gone skips steps 1-4. */
    async delete(root: string): Promise<boolean> {
        await boardRegistry.load();
        if (boardRegistry.isBundled(root)) return false;
        if (await fs.exists(root)) {
            // Nothing may hold the folder open: on Windows a live handle inside it makes the files delete but the
            // folder itself fail with ENOTEMPTY (US-1407).
            if (!(await this.release(root, "deleting", false))) return false;
            try {
                await api.stopModuleService(root);
                await fs.removeDir(root, true);
            } catch (err) {
                void ui.notify(errMessage(err, t("api.failedToDeleteBoardFolder")), "error");
                return false;
            }
        }
        await boardRegistry.untrust(root);
        await boardInstallRegistry.load();
        const installed = boardInstallRegistry.getByRoot(root);
        if (installed) await boardInstallRegistry.remove(installed.id);
        invalidateBoardDisplayText(root);
        return true;
    }

    /** Catalog uninstall: shared delete confirmation, then the normal delete lifecycle. */
    async uninstall(catalogId: string, fallbackName?: string): Promise<boolean> {
        await boardInstallRegistry.load();
        const installed = boardInstallRegistry.getById(catalogId);
        if (!installed) throw new Error(`Board not installed: "${catalogId}"`);
        const catalogEntry = publishedBoards.getCatalog().find((board) => board.id === catalogId);
        const manifest = await readBoardManifest(installed.root);
        const displayName = catalogEntry
            ? publishedBoardDisplayText(catalogEntry, getActiveLocale()).name
            : fallbackName ?? (manifest?.name?.trim() || fpBasename(installed.root));
        const choice = await ui.confirm(t("api.deleteBoardConfirmation", { name: displayName }), {
            title: t("api.deleteBoardTitle"),
            buttons: [DELETE, CANCEL],
        });
        if (choice !== DELETE) return false;
        return this.delete(installed.root);
    }

    /** Rename the folder in place, carrying trust, pin, install record and open pages. Returns the new root. */
    async rename(boardRoot: string, newName: string): Promise<string> {
        await boardRegistry.load();
        if (boardRegistry.isBundled(boardRoot)) return boardRoot;
        if (isBoardRootBusy(boardRoot)) throw new Error("Cannot rename a board while it is running (busy). Stop it first.");
        const newRoot = fpJoin(fpDirname(boardRoot), newName);
        if (BoardRoot.from(newRoot).equals(boardRoot)) return boardRoot;
        if (await fs.exists(newRoot)) throw new Error(`Cannot rename: "${newRoot}" already exists.`);

        // Capture BEFORE the rename: the install registry's load() prunes entries whose root no longer holds a manifest.
        const wasTrusted = boardRegistry.isTrusted(boardRoot);
        await boardInstallRegistry.load();
        const installEntry = boardInstallRegistry.getByRoot(boardRoot);
        const pages = pagesModel.boardPageRouter.findPagesByBoardRoot(boardRoot);

        await api.stopModuleService(boardRoot);
        await renameReleasedFolder(boardRoot, newRoot);
        // Carry the category membership FIRST (US-1836 D4): `untrust(old)` makes this window's model prune `old`,
        // and with the ref already re-keyed there is nothing left to drop.
        editorCategories.moveBoardRef(boardRoot, newRoot);
        if (wasTrusted) {
            await boardRegistry.untrust(boardRoot);
            await boardRegistry.trust(newRoot);
        }
        if (installEntry) await boardInstallRegistry.record({ ...installEntry, root: newRoot });
        invalidateBoardDisplayText(boardRoot);
        for (const page of pages) {
            const host = asBoardHostEditor(page.mainEditorInstance);
            if (!host?.boardRoot) continue;
            await app.events.openRawLink.sendAsync(createLinkData(encodePersephoneBoardLink(newRoot), {
                pageId: page.id,
                sourceId: "app-api",
                explorerRoot: fpDirname(newRoot),
            }));
        }
        return newRoot;
    }

    /** Swap an installed board to a specific published version (update, rollback, forward). Never throws (toasts). */
    async installVersion(args: {
        root: string; id: string; name: string; archive: PublishedBoardArchive; version: string; minAppVersion: string;
    }): Promise<boolean> {
        if (!publishedBoards.isCompatible(args.minAppVersion)) {
            void ui.notify(t("api.boardVersionRequiresApp", { version: args.minAppVersion }), "warning");
            return false;
        }
        if (!(await this.release(args.root, "updating", false))) return false;
        const catalogEntry = publishedBoards.getCatalog().find((board) => board.id === args.id);
        const displayName = catalogEntry
            ? publishedBoardDisplayText(catalogEntry, getActiveLocale()).name
            : args.name;
        try {
            await ui.showProgress(
                installVersion(args.id, args.archive, args.version, { preSwap: async () => this.isIdle(args.root) }),
                t("api.installingBoard", { name: displayName, version: args.version }),
            );
            void ui.notify(t("api.boardInstalled", { name: displayName, version: args.version }), "success");
            return true;
        } catch (err) {
            void ui.notify(t("api.boardInstallFailed", { error: errMessage(err) }), "error");
            return false;
        }
    }

    /** Guard + page release (steps 1-2). `consented` skips the busy refusal and the page prompt. */
    private async release(root: string, action: IdleAction, consented: boolean): Promise<boolean> {
        if (!consented && isBoardRootBusy(root)) {
            void ui.notify(t(BUSY_KEY[action]), "warning");
            return false;
        }
        const pages = pagesModel.boardPageRouter.findPagesByBoardRoot(root);
        if (pages.length && !consented) {
            const choice = await ui.confirm(t(OPEN_KEY[action], { count: pages.length }), {
                title: t("api.boardOpenTitle"),
                buttons: [CLOSE_BOARD_AND_CONTINUE, CANCEL],
            });
            if (choice !== CLOSE_BOARD_AND_CONTINUE) return false;
        }
        for (const page of pages) {
            if (!(await releaseBoardFromPage(page))) return false;
        }
        return true;
    }

    private isIdle(root: string): boolean {
        return !isBoardRootBusy(root) && pagesModel.boardPageRouter.findPagesByBoardRoot(root).length === 0;
    }
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

export const boardLifecycle = new BoardLifecycle();
