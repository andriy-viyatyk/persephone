import { Subscription } from "../../core/state/events";
import { TModel } from "../../core/state/model";
import { TGlobalState } from "../../core/state/state";
import { PageModel } from "../../editors/base";
import { IPageState, PageEditor } from "../../../shared/types";

import { PagesQueryModel } from "./PagesQueryModel";
import { PagesNavigationModel } from "./PagesNavigationModel";
import { PagesPersistenceModel } from "./PagesPersistenceModel";
import { PagesLayoutModel } from "./PagesLayoutModel";
import { PagesLifecycleModel } from "./PagesLifecycleModel";

// ── State ────────────────────────────────────────────────────────────

const defaultOpenFilesState = {
    pages: [] as PageModel[],
    ordered: [] as PageModel[],
    leftRight: new Map<string, string>(),
    rightLeft: new Map<string, string>(),
};

export type OpenFilesState = typeof defaultOpenFilesState;

// ── PagesModel ───────────────────────────────────────────────────────

/**
 * PagesModel — Base model for the page collection.
 *
 * Holds shared state (pages, ordering, groupings) and composes
 * five submodels that each handle one concern.
 *
 * Public methods delegate to submodels for organized, testable code.
 */
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

    constructor() {
        super(new TGlobalState(defaultOpenFilesState));
        this.query = new PagesQueryModel(this);
        this.persistence = new PagesPersistenceModel(this);
        this.layout = new PagesLayoutModel(this);
        this.navigation = new PagesNavigationModel(this);
        this.lifecycle = new PagesLifecycleModel(this);
    }

    // ── Internal methods (shared across submodels) ───────────────────

    attachPage = (page: PageModel) => {
        const pageId = page.id;
        const unsubscribe = page.state.subscribe(() => {
            this.persistence.saveStateDebounced();
        });
        this.pageSubscriptions.set(pageId, unsubscribe);
        page.onClose = () => {
            this.detachPage(page);
            this.removePage(page);
            page.dispose();
        };
    };

    detachPage = (page: PageModel) => {
        const pageId = page.id;
        const unsubscribe = this.pageSubscriptions.get(pageId);
        if (unsubscribe) {
            unsubscribe();
            this.pageSubscriptions.delete(pageId);
        }
        page.onClose = undefined;
    };

    removePage = (page: PageModel) => {
        const isActivePage = this.query.activePage === page;
        this.state.update((s) => {
            s.pages = s.pages.filter((p) => p !== page);
            s.ordered = s.ordered.filter((p) => p !== page);
        });
        this.layout.fixGrouping();
        this.persistence.saveState();
        if (isActivePage) {
            const ordered = this.state.get().ordered;
            if (ordered.length) {
                this.onShow.send(ordered[ordered.length - 1]);
                this.onFocus.send(ordered[ordered.length - 1]);
            }
        }
        this.checkEmptyPage();
    };

    checkEmptyPage = () => {
        setTimeout(() => {
            if (this.state.get().pages.length === 0) {
                this.lifecycle.addEmptyPage();
            }
        }, 0);
    };

    closeFirstPageIfEmpty = () => {
        const pages = this.state.get().pages;
        if (pages.length === 2) {
            const firstPage = pages[0];
            const firstPageState = firstPage.state.get();
            if (
                !firstPageState.pinned &&
                !firstPageState.modified &&
                !(firstPageState as any).content &&
                !firstPageState.filePath &&
                firstPageState.type === "textFile"
            ) {
                firstPage.close(undefined);
            }
        }
    };

    // ── Public API delegates ─────────────────────────────────────────
    // These provide a flat API surface for consumers so they can call
    // pages.openFile() instead of pages.lifecycle.openFile().

    // Query delegates
    get activePage() {
        return this.query.activePage;
    }
    get groupedPage() {
        return this.query.groupedPage;
    }
    findPage = (pageId?: string) => this.query.findPage(pageId);
    getGroupedPage = (withPageId: string) =>
        this.query.getGroupedPage(withPageId);
    getLeftGroupedPage = (withPageId: string) =>
        this.query.getLeftGroupedPage(withPageId);
    isLastPage = (pageId?: string) => this.query.isLastPage(pageId);
    isGrouped = (pageId: string) => this.query.isGrouped(pageId);
    get pages() {
        return this.query.pages;
    }

    // Navigation delegates
    showPage = (pageId?: string) => this.navigation.showPage(pageId);
    showNext = () => this.navigation.showNext();
    showPrevious = () => this.navigation.showPrevious();
    focusPage = (page: PageModel) => this.navigation.focusPage(page);

    // Lifecycle delegates
    addPage = (page: PageModel) => this.lifecycle.addPage(page);
    addEmptyPage = () => this.lifecycle.addEmptyPage();
    addEmptyPageWithNavPanel = (folderPath: string) =>
        this.lifecycle.addEmptyPageWithNavPanel(folderPath);
    addEditorPage = (editor: PageEditor, language: string, title: string, content?: string) =>
        this.lifecycle.addEditorPage(editor, language, title, content);
    addDrawPage = (dataUrl: string, title?: string) =>
        this.lifecycle.addDrawPage(dataUrl, title);
    createPageFromFile = (filePath: string) =>
        this.lifecycle.createPageFromFile(filePath);
    openFile = (filePath?: string) => this.lifecycle.openFile(filePath);
    openFileAsArchive = (filePath: string) =>
        this.lifecycle.openFileAsArchive(filePath);
    closePage = (pageId: string) => this.lifecycle.closePage(pageId);
    openFileWithDialog = () => this.lifecycle.openFileWithDialog();
    openDiff = (
        params: { firstPath: string; secondPath: string } | undefined
    ) => this.lifecycle.openDiff(params);
    navigatePageTo = (
        pageId: string,
        newFilePath: string,
        options?: {
            revealLine?: number;
            highlightText?: string;
            forceTextEditor?: boolean;
        }
    ) => this.lifecycle.navigatePageTo(pageId, newFilePath, options);
    closeToTheRight = (pageId: string) =>
        this.lifecycle.closeToTheRight(pageId);
    closeOtherPages = (pageId: string) =>
        this.lifecycle.closeOtherPages(pageId);
    movePageIn = (data?: {
        page: Partial<IPageState>;
        targetPageId: string | undefined;
    }) => this.lifecycle.movePageIn(data);
    movePageOut = (pageId?: string) => this.lifecycle.movePageOut(pageId);
    duplicatePage = (pageId: string) => this.lifecycle.duplicatePage(pageId);
    handleOpenUrl = (url: string) => this.lifecycle.handleOpenUrl(url);
    handleExternalUrl = (url: string) =>
        this.lifecycle.handleExternalUrl(url);
    openPathInNewWindow = (filePath: string) =>
        this.lifecycle.openPathInNewWindow(filePath);
    requireGroupedText = (pageId: string, suggestedLanguage?: string) =>
        this.lifecycle.requireGroupedText(pageId, suggestedLanguage);
    requireWellKnownPage = (id: string) => this.lifecycle.requireWellKnownPage(id);
    showAboutPage = () => this.lifecycle.showAboutPage();
    showSettingsPage = () => this.lifecycle.showSettingsPage();
    showBrowserPage = (options?: {
        profileName?: string;
        incognito?: boolean;
        url?: string;
    }) => this.lifecycle.showBrowserPage(options);
    showMcpInspectorPage = (options?: { url?: string }) =>
        this.lifecycle.showMcpInspectorPage(options);
    openImageInNewTab = (imageUrl: string) =>
        this.lifecycle.openImageInNewTab(imageUrl);
    openUrlInBrowserTab = (
        url: string,
        options?: {
            incognito?: boolean;
            profileName?: string;
            external?: boolean;
        }
    ) => this.lifecycle.openUrlInBrowserTab(url, options);

    // Layout delegates
    moveTab = (fromId: string, toId: string) =>
        this.layout.moveTab(fromId, toId);
    moveTabByIndex = (fromIndex: number, toIndex: number) =>
        this.layout.moveTabByIndex(fromIndex, toIndex);
    pinTab = (pageId: string) => this.layout.pinTab(pageId);
    unpinTab = (pageId: string) => this.layout.unpinTab(pageId);
    group = (leftPageId: string, rightPageId: string) =>
        this.layout.group(leftPageId, rightPageId);
    ungroup = (pageId: string) => this.layout.ungroup(pageId);
    groupTabs = (
        pageId1: string,
        pageId2: string,
        enforceAdjacency = false
    ) => this.layout.groupTabs(pageId1, pageId2, enforceAdjacency);
    fixGrouping = () => this.layout.fixGrouping();
    fixCompareMode = () => this.layout.fixCompareMode();

    // Persistence delegates
    saveState = () => this.persistence.saveState();
    saveStateDebounced = () => this.persistence.saveStateDebounced();
    onAppQuit = () => this.persistence.onAppQuit();
    init = () => this.persistence.init();
}

