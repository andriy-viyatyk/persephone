import { Subscription } from "../../core/state/events";
import { afterDispatch } from "../../core/state/dispatch";
import { TModel } from "../../core/state/model";
import { TGlobalState } from "../../core/state/state";
import { createLinkData } from "../../../shared/link-data";
import { fpIsAbsolute, fpResolve, isPlainLocalPath } from "../../core/utils/file-path";
import { PageModel } from "./PageModel";

import { PagesQueryModel } from "./PagesQueryModel";
import { PagesNavigationModel } from "./PagesNavigationModel";
import { PagesPersistenceModel } from "./PagesPersistenceModel";
import { PagesLayoutModel } from "./PagesLayoutModel";
import { PagesLifecycleModel } from "./PagesLifecycleModel";
import { StandalonePages } from "./standalone-pages";
import { BoardPageRouter } from "../boards/board-page-router";
import { api } from "../../../ipc/renderer/api";
import { invalidatePagePipe } from "../../content/pipe-resource-server";
import { FRESH_EMPTY_TRAIT } from "../../editors/base/editor-traits";

// ── State ────────────────────────────────────────────────────────────

const defaultOpenFilesState = {
    pages: [] as PageModel[],
    ordered: [] as PageModel[],
    leftRight: new Map<string, string>(),
    rightLeft: new Map<string, string>(),
    /** Compare-mode flag set keyed by left page id. */
    compareGroups: new Set<string>(),
    /** Transient page currently shown by the right-pin popover. */
    popoverPageId: undefined as string | undefined,
};

export type OpenFilesState = typeof defaultOpenFilesState;

// ── PagesModel ───────────────────────────────────────────────────────

export class PagesModel extends TModel<OpenFilesState> {
    onShow = new Subscription<PageModel>();
    onFocus = new Subscription<PageModel>();
    pageSubscriptions = new Map<string, () => void>();

    // ── Submodels (internal implementation) ──────────────────────────

    readonly query: PagesQueryModel;
    readonly navigation: PagesNavigationModel;
    readonly persistence: PagesPersistenceModel;
    readonly layout: PagesLayoutModel;
    readonly lifecycle: PagesLifecycleModel;
    readonly boardPageRouter: BoardPageRouter;
    readonly standalonePages: StandalonePages;

    constructor() {
        super(new TGlobalState(defaultOpenFilesState));
        // PagesModel owns every page/editor subscription until the page is detached;
        // this final sweep also covers application shutdown with pages still open.
        this.own(() => {
            for (const unsubscribe of this.pageSubscriptions.values()) unsubscribe();
            this.pageSubscriptions.clear();
        });
        this.query = new PagesQueryModel(this);
        this.persistence = new PagesPersistenceModel(this);
        this.disposables.add(this.persistence.saveStateDebounced.cancel);
        this.layout = new PagesLayoutModel(this);
        this.navigation = new PagesNavigationModel(this);
        this.lifecycle = new PagesLifecycleModel(this);
        this.standalonePages = new StandalonePages(this, (id) => new PageModel(id));
        this.boardPageRouter = new BoardPageRouter(this);
        this.lifecycle.registerOpenInterceptor(this.boardPageRouter);
    }

    // ── Internal methods (shared across submodels) ───────────────────

    attachPage = (page: PageModel) => {
        const pageId = page.id;
        const editorSubs = new Map<string, () => void>();

        const reconcileEditorSubs = () => {
            const present = new Set(page.editors.map((e) => e.id));
            for (const [id, unsub] of editorSubs) {
                if (!present.has(id)) {
                    unsub();
                    editorSubs.delete(id);
                }
            }
            for (const editor of page.editors) {
                if (editorSubs.has(editor.id)) continue;
                const sub = editor.descriptorChanged.subscribe(() => {
                    this.persistence.saveStateDebounced();
                });
                editorSubs.set(editor.id, sub);
            }
        };

        reconcileEditorSubs();
        const pageUnsub = page.state.subscribe(() => {
            reconcileEditorSubs();
            this.persistence.saveStateDebounced();
        });
        const mainEditorChangedUnsub = page.mainEditorChanged.subscribe(() => {
            this.layout.onMainEditorChanged(page);
        });

        this.pageSubscriptions.set(pageId, () => {
            for (const unsub of editorSubs.values()) unsub();
            editorSubs.clear();
            pageUnsub();
            mainEditorChangedUnsub();
        });

        page.onClose = () => {
            this.detachPage(page);
            this.removePage(page);
            void page.dispose().finally(() => this.checkEmptyPage());
        };
    };

    detachPage = (page: PageModel) => {
        const pageId = page.id;
        void api.unregisterBoardPipePage(pageId);
        void api.deleteVideoStreamSessionsByPage(pageId);
        invalidatePagePipe(pageId);
        const unsubscribe = this.pageSubscriptions.get(pageId);
        if (unsubscribe) {
            unsubscribe();
            this.pageSubscriptions.delete(pageId);
        }
        page.onClose = undefined;
    };

    /**
     * Remove a page from collection state and repair grouping. Does not dispose the page;
     * callers own detachment and disposal. By default, persist immediately and replace the
     * active page when needed.
     */
    removePage = (
        page: PageModel,
        options?: { save?: "immediate" | "debounced"; ensureActivePage?: boolean },
    ) => {
        const isActivePage = this.query.activePage === page;
        // Identify the leftId of the pair (if any) before removal.
        const state = this.state.get();
        const pairLeftId = state.leftRight.has(page.id)
            ? page.id
            : state.rightLeft.get(page.id);

        this.state.update((s) => {
            s.pages = s.pages.filter((p) => p !== page);
            s.ordered = s.ordered.filter((p) => p !== page);
            if (s.popoverPageId === page.id) s.popoverPageId = undefined;
            // Read `compareGroups` off the pre-update snapshot, never off the draft.
            // `TOneState.update` runs immer `produce` and this repository deliberately
            // does not call `enableMapSet()`, so *reading* a Set/Map property
            // on a draft makes immer try to proxy it and throw "The plugin for 'MapSet'
            // has not been loaded". Assigning one is fine, which is why every other
            // `compareGroups`/`leftRight`/`rightLeft` write in PagesLayoutModel is safe.
            // This path only ran when closing a page that was half of a grouped pair,
            // which is why it survived: `detachPage` had already cleared `page.onClose`,
            // so the throw left the page detached but still in `pages[]` — orphaned and
            // impossible to close again.
            if (pairLeftId && state.compareGroups.has(pairLeftId)) {
                const next = new Set(state.compareGroups);
                next.delete(pairLeftId);
                s.compareGroups = next;
            }
        });
        this.layout.fixGrouping();
        if (options?.save === "debounced") this.persistence.saveStateDebounced();
        else this.persistence.saveState();
        if (options?.ensureActivePage !== false) this.handleActivePageRemoved(isActivePage);
    };

    insertPage = (page: PageModel, options?: { at?: number }): void => {
        const pages = this.state.get().pages;
        const firstRightPinnedIndex = this.query.getFirstRightPinnedIndex();
        const requestedIndex = options?.at ?? firstRightPinnedIndex;
        const insertionIndex = Math.max(0, Math.min(requestedIndex, firstRightPinnedIndex, pages.length));

        this.state.update((state) => {
            state.pages.splice(insertionIndex, 0, page);
            if (page.pinSide !== "right") state.ordered.push(page);
        });
    };

    replacePage = (old: PageModel, recovered: PageModel): void => {
        this.state.update((state) => {
            const pageIndex = state.pages.indexOf(old);
            if (pageIndex !== -1) state.pages[pageIndex] = recovered;

            const orderedIndex = state.ordered.indexOf(old);
            if (orderedIndex !== -1) state.ordered[orderedIndex] = recovered;
        });
    };

    setPageArrays = (next: { pages?: PageModel[]; ordered?: PageModel[] }): void => {
        this.state.update((state) => {
            if (next.pages !== undefined) state.pages = next.pages;
            if (next.ordered !== undefined) state.ordered = next.ordered;
        });
    };

    handleActivePageRemoved = (wasActive: boolean) => {
        if (!wasActive) return;
        if (!this.query.activePage) this.lifecycle.addEmptyPage();
        const activePage = this.query.activePage;
        if (!activePage) return;
        this.onShow.send(activePage);
        if (!this.popoverPageId) this.onFocus.send(activePage);
    };

    get popoverPageId(): string | undefined {
        return this.state.get().popoverPageId;
    }

    openPopover = (pageId: string) => {
        const page = this.query.findPage(pageId);
        if (!page || page.id !== pageId || !this.query.isRightPinned(pageId)) {
            throw new Error(`Cannot open popover for non-attached right-pinned page: ${pageId}`);
        }
        this.state.update((s) => { s.popoverPageId = pageId; });
    };

    closePopover = () => {
        if (this.state.get().popoverPageId === undefined) return;
        this.state.update((s) => { s.popoverPageId = undefined; });
    };

    togglePopover = (pageId: string) => {
        if (this.state.get().popoverPageId === pageId) this.closePopover();
        else this.openPopover(pageId);
    };

    checkEmptyPage = () => {
        afterDispatch(() => {
            if (this.state.get().ordered.length === 0) {
                this.lifecycle.addEmptyPage();
            }
        });
    };

    /**
     * Close the first page if it's a fresh empty Monaco page and there are
     * exactly two pages total. Delegate to the editor's `isFreshEmpty()` so the
     * exactly-two-pages invariant stays in PagesModel.
     */
    closeFirstPageIfEmpty = () => {
        const pages = this.state.get().pages;
        if (pages.length !== 2) return;
        const firstPage = pages[0];
        if (firstPage.pinSide !== undefined) return;
        if (firstPage.mainEditor?.traits.get(FRESH_EMPTY_TRAIT)?.isFreshEmpty() === true) {
            firstPage.close();
        }
    };

    // ── Lazy-loading entrypoints ─────────────────────────────────────

    openPath = async (filePath?: string) => {
        if (!filePath) return undefined;
        const { app } = await import("../app");
        const normalizedPath = isPlainLocalPath(filePath) && fpIsAbsolute(filePath) ? fpResolve(filePath) : filePath;
        const data = createLinkData(normalizedPath);
        await app.events.openRawLink.sendAsync(data);
        // A folder opens an empty page carrying an Explorer panel rooted at it, which is not
        // bound to the folder as a file path — so the lookup below misses and this returned
        // `undefined` for an open that had in fact succeeded. The handler hands that page's
        // id back through `openedPageId`; prefer the path lookup, which is the normal case.
        const page = this.query.findPageByFilePath(normalizedPath)
            ?? (data.openedPageId
                ? this.query.findPage(data.openedPageId)
                : undefined);
        await page?.restore.ready;
        return page;
    };
    openFileWithDialog = async () => (await import("../../ui/dialogs/OpenFileCommands")).openFileWithDialog();
    openFileFromDialog = async () => (await import("../../ui/dialogs/OpenFileCommands")).openFileFromDialog();
    showBrowserPage = (options?: {
        profileName?: string;
        incognito?: boolean;
        tor?: boolean;
        url?: string;
        openedByAgent?: boolean;
    }) => import("../../editors/browser/browser-pages").then(({ showBrowserPage }) => showBrowserPage(this, options));
    showMcpInspectorPage = (options?: { url?: string; name?: string; autoConnect?: boolean }) => import("../../editors/mcp-inspector/mcp-inspector-pages").then(({ showMcpInspectorPage }): Promise<void> => showMcpInspectorPage(this, options));
    openSiteActionVideo = (request: import("../../core/utils/curl-parser").ParsedHttpRequest, isCurrent: () => boolean) => import("../../editors/video/video-pages").then(({ openSiteActionVideo }): Promise<boolean> => openSiteActionVideo(this, request, isCurrent));
    openImageInNewTab = (imageUrl: string, title?: string, sessionHandle?: string) => import("../../editors/image/image-pages").then(({ openImageInNewTab }): Promise<void> => openImageInNewTab(this, imageUrl, title, sessionHandle));
    openUrlInBrowserTab = (
        url: string,
        options?: {
            incognito?: boolean;
            profileName?: string;
            external?: boolean;
            openedByAgent?: boolean;
        }
    ) => import("../../editors/browser/browser-pages").then(({ openUrlInBrowserTab }) => openUrlInBrowserTab(this, url, options));

}
