import type { PagesModel } from "./PagesModel";
import type { PageModel } from "./PageModel";
import type { TextFileModel } from "../../editors/text";
import { fpBasename, fpNormalizeForCompare } from "../../core/utils/file-path";
import { PERSEPHONE_BOARD_PREFIX } from "../../content/persephone-board-link";
import { matchesFileMask } from "../../editors/board/board-manifest";

/**
 * PagesQueryModel — Read-only queries on the page collection.
 */
export class PagesQueryModel {
    constructor(private model: PagesModel) {}

    /**
     * Find a page by any associated ID: page ID OR any of its editor IDs.
     * All IDs are unique, so this is safe and prevents page/editor ID confusion bugs.
     */
    findPage = (id?: string): PageModel | undefined => {
        if (!id) return undefined;
        return this.model.state.get().pages.find((p) =>
            p.id === id || p.editors.some((e) => e.id === id),
        );
    };

    isRightPinned = (id: string): boolean => this.findPage(id)?.pinSide === "right";

    getFirstRightPinnedIndex = (): number => {
        const pages = this.model.state.get().pages;
        const index = pages.findIndex((page) => this.isRightPinned(page.id));
        return index < 0 ? pages.length : index;
    };

    /** Find the page whose MAIN editor carries this filePath (the "is this
     *  file already open in a tab?" dedupe used by open/diff flows). */
    findPageByFilePath = (filePath?: string): PageModel | undefined => {
        if (!filePath) return undefined;
        const identity = filePath.includes("://") || filePath.startsWith("data:")
            ? filePath
            : fpNormalizeForCompare(filePath);
        return this.model.state.get().pages.find((p) => {
            const main = p.mainEditor as { filePath?: string } | null;
            if (!main?.filePath) return false;
            const mainIdentity = main.filePath.includes("://") || main.filePath.startsWith("data:")
                ? main.filePath
                : fpNormalizeForCompare(main.filePath);
            return mainIdentity === identity;
        });
    };

    /** Find the Browser page transiently owned by one board Run key. */
    findBoardRunPage = (boardRoot: string, reuseKey: string): PageModel | undefined => {
        const normalizedRoot = fpNormalizeForCompare(boardRoot);
        return this.model.state.get().pages.find((page) => {
            if (page.mainEditorInstance?.editorId !== "browser-view") return false;
            const owner = page.getBoardRunOwner();
            return !!owner
                && fpNormalizeForCompare(owner.boardRoot) === normalizedRoot
                && owner.reuseKey === reuseKey;
        });
    };

    /** Find every page whose main editor belongs to the given board root. */
    findPagesByBoardRoot = (boardRoot?: string): PageModel[] => {
        if (!boardRoot) return [];
        const normalizedRoot = fpNormalizeForCompare(boardRoot);
        return this.model.state.get().pages.filter((page) => {
            const editor = page.mainEditorInstance as { boardRoot?: string } | null;
            return !!editor?.boardRoot
                && fpNormalizeForCompare(editor.boardRoot) === normalizedRoot;
        });
    };

    /** Find the most recently shown page for a board in this renderer window. */
    findPageByBoardRoot = (
        boardRoot?: string,
        singleInstanceMasks?: readonly string[],
    ): PageModel | undefined => {
        if (!boardRoot) return undefined;
        const { ordered } = this.model.state.get();
        return [...ordered].reverse().find((page) => {
            if (singleInstanceMasks !== undefined) {
                return this.isFullPlayerBoardPage(page, boardRoot, singleInstanceMasks);
            }
            const editor = page.mainEditorInstance as { boardRoot?: string } | null;
            return !!editor?.boardRoot
                && fpNormalizeForCompare(editor.boardRoot) === fpNormalizeForCompare(boardRoot);
        });
    };

    isFullPlayerBoardPage = (
        page: PageModel | undefined,
        boardRoot: string,
        masks: readonly string[],
    ): boolean => {
        if (!page) return false;
        const editor = page.mainEditorInstance as { boardRoot?: string; filePath?: string } | null;
        if (!editor?.boardRoot
            || fpNormalizeForCompare(editor.boardRoot) !== fpNormalizeForCompare(boardRoot)) return false;
        const filePath = editor.filePath;
        return !filePath
            || filePath.startsWith(PERSEPHONE_BOARD_PREFIX)
            || masks.some((mask) => matchesFileMask(fpBasename(filePath), mask));
    };

    get activePage(): PageModel | undefined {
        const { ordered } = this.model.state.get();
        return ordered.length ? ordered[ordered.length - 1] : undefined;
    }

    get focusedPage(): PageModel | undefined {
        const popoverPageId = this.model.popoverPageId;
        return (popoverPageId ? this.findPage(popoverPageId) : undefined) ?? this.activePage;
    }

    isPageVisible = (pageId: string): boolean => {
        const activePage = this.activePage;
        return pageId === activePage?.id
            || pageId === this.getGroupedPage(activePage?.id ?? "")?.id
            || pageId === this.model.popoverPageId;
    };

    get groupedPage(): PageModel | undefined {
        const activePage = this.activePage;
        if (!activePage) return undefined;
        return this.getGroupedPage(activePage.id);
    }

    getGroupedPage = (withId: string): PageModel | undefined => {
        const state = this.model.state.get();
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

    // ── Compare-mode helpers (walkthrough 06 / CK3, CK5, GK2) ──────────

    /**
     * Returns the page's TextFileModel host (the actual content-bearing model
     * for text editors), or null. Reads the editor's `contentHost` and
     * returns it when structurally a TextFileModel.
     */
    getTextFileHost = (pageId: string): TextFileModel | null => {
        const page = this.findPage(pageId);
        const main = page?.mainEditorInstance;
        if (!main) return null;
        const host = main.contentHost as unknown as { type?: string } | null;
        if (host && host.type === "textFile") {
            return host as unknown as TextFileModel;
        }
        return null;
    };

    /** True if both pages exist, are grouped together, and both have a TextFileModel host. */
    canCompare = (leftId: string, rightId: string): boolean => {
        const left = this.findPage(leftId);
        const right = this.findPage(rightId);
        if (!left || !right) return false;
        const state = this.model.state.get();
        const groupedRight = state.leftRight.get(left.id);
        if (groupedRight !== right.id) return false;
        return this.getTextFileHost(left.id) !== null
            && this.getTextFileHost(right.id) !== null;
    };

    /**
     * Compare-mode lookup. Accepts either left or right page id; resolves the
     * leftId via leftRight/rightLeft. Returns { active, leftId, rightId } when
     * the pair is in compareGroups; { active: false } otherwise.
     */
    isInCompareMode = (pageId: string): {
        active: boolean;
        leftId?: string;
        rightId?: string;
    } => {
        const state = this.model.state.get();
        const resolvedPageId = this.findPage(pageId)?.id ?? pageId;
        // Is this the left side?
        const right = state.leftRight.get(resolvedPageId);
        if (right && state.compareGroups.has(resolvedPageId)) {
            return { active: true, leftId: resolvedPageId, rightId: right };
        }
        // Is this the right side?
        const left = state.rightLeft.get(resolvedPageId);
        if (left && state.compareGroups.has(left)) {
            return { active: true, leftId: left, rightId: resolvedPageId };
        }
        return { active: false };
    };
}
