import type { PagesModel } from "./PagesModel";
import { PageModel } from "../../editors/base";
import { IPageState, PageEditor, PageType } from "../../../shared/types";
import {
    isTextFileModel,
    newTextFileModel,
    TextFileModel,
} from "../../editors/text";
import { api } from "../../../ipc/renderer/api";
import { recent } from "../recent";
import { ui } from "../ui";
import { shell } from "../shell";
import { settings } from "../settings";
import { editorRegistry } from "../../editors/registry";
import { getLanguageByExtension } from "../../core/utils/language-mapping";
import { NavPanelModel } from "../../ui/navigation/nav-panel-store";

import { fpBasename, fpExtname, isArchivePath } from "../../core/utils/file-path";
import { fs as appFs } from "../fs";
import { getWellKnownPageDef } from "./well-known-pages";

/**
 * PagesLifecycleModel — Page creation, opening, closing, and navigation.
 */
export class PagesLifecycleModel {
    constructor(private model: PagesModel) {}

    // ── Page factory helpers ─────────────────────────────────────────

    private newPageModel = async (filePath?: string): Promise<PageModel> => {
        const editorDef = editorRegistry.resolve(filePath);
        // Archive inner paths can't use page-editors (image, pdf) — they need real file paths
        if (editorDef && !(filePath && isArchivePath(filePath) && editorDef.category === "page-editor")) {
            const module = await editorDef.loadModule();
            return module.newPageModel(filePath);
        }
        const def = editorRegistry.getById("monaco");
        if (!def) throw new Error("Monaco editor not registered");
        const module = await def.loadModule();
        return module.newPageModel(filePath);
    };

    /** Legacy page type migration: maps old renamed page types to current names. */
    private static PAGE_TYPE_MIGRATIONS: Record<string, PageType> = {
        mcpBrowserPage: "mcpInspectorPage",
    };

    private newPageModelFromState = async (
        state: Partial<IPageState>
    ): Promise<PageModel> => {
        if (state.type && PagesLifecycleModel.PAGE_TYPE_MIGRATIONS[state.type]) {
            state = { ...state, type: PagesLifecycleModel.PAGE_TYPE_MIGRATIONS[state.type] };
        }
        const editors = editorRegistry.getAll();
        const editorDef = editors.find((e) => e.pageType === state.type);
        if (editorDef) {
            const module = await editorDef.loadModule();
            return module.newPageModelFromState(state);
        }
        const def = editorRegistry.getById("monaco");
        if (!def) throw new Error("Monaco editor not registered");
        const module = await def.loadModule();
        return module.newPageModelFromState(state);
    };

    // ── Core page operations ─────────────────────────────────────────

    createPageFromFile = async (filePath: string): Promise<PageModel> => {
        const pageModel = await this.newPageModel(filePath);
        pageModel.state.update((s) => {
            s.language = "";
        });
        await pageModel.restore();
        return pageModel;
    };

    addPage = (page: PageModel): PageModel => {
        const pageId = page.state.get().id;
        const existingPage = this.model.query.findPage(pageId);
        if (existingPage) {
            this.model.navigation.showPage(pageId);
            return existingPage;
        }

        this.model.attachPage(page);

        this.model.state.update((s) => {
            s.pages.push(page);
            s.ordered.push(page);
        });
        this.model.persistence.saveState();

        return page;
    };

    addEmptyPage = (): PageModel => {
        const emptyFile = newTextFileModel("");
        emptyFile.restore();
        return this.addPage(emptyFile as unknown as PageModel);
    };

    addEmptyPageWithNavPanel = (folderPath: string): PageModel => {
        // Create page directly without calling restore(), which would
        // asynchronously overwrite our NavPanel (it sees hasNavPanel=true
        // and creates a new NavPanelModel with empty rootFilePath).
        const emptyFile = newTextFileModel("");
        const page = this.addPage(emptyFile as unknown as PageModel);
        const navPanel = new NavPanelModel(folderPath);
        navPanel.id = page.state.get().id;
        navPanel.flushSave();
        page.navPanel = navPanel;
        page.state.update((s) => {
            s.hasNavPanel = true;
        });
        return page;
    };

    addEditorPage = (
        editor: PageEditor,
        language: string,
        title: string,
        content?: string,
    ): PageModel => {
        const editorDef = editorRegistry.getById(editor);
        if (editorDef?.category === "page-editor") {
            throw new Error(
                `Cannot create '${editor}' with addEditorPage() — it is a page-editor that requires a specialized model. Use the dedicated method instead (e.g., showBrowserPage(), showAboutPage(), openFile()).`
            );
        }
        const page = newTextFileModel("");
        page.state.update((s) => {
            s.title = title;
            s.language = language;
            // Validate editor is compatible with language (e.g., md-view requires markdown)
            s.editor = editorRegistry.validateForLanguage(editor, language);
        });
        if (content) {
            page.changeContent(content);
            page.state.update((s) => { s.modified = false; });
        }
        page.restore();
        return this.addPage(page as unknown as PageModel);
    };

    /**
     * Get or create a well-known page by predefined ID.
     * If a page with this ID exists, focuses and returns it.
     * If not, creates a new page with the predefined editor/language/title.
     */
    requireWellKnownPage = async (id: string): Promise<PageModel> => {
        const existing = this.model.query.findPage(id);
        if (existing) {
            this.model.navigation.showPage(id);
            return existing;
        }

        const def = getWellKnownPageDef(id);
        if (!def) throw new Error(`Unknown well-known page ID: "${id}"`);

        await editorRegistry.loadViewModelFactory(def.editor as PageEditor);
        const page = newTextFileModel("");
        page.state.update((s) => {
            s.id = id;
            s.title = def.title;
            s.language = def.language;
            s.editor = editorRegistry.validateForLanguage(
                def.editor as PageEditor,
                def.language,
            );
        });
        page.restore();
        return this.addPage(page as unknown as PageModel);
    };

    /** Create a new drawing page with an embedded image. */
    addDrawPage = async (dataUrl: string, title?: string): Promise<PageModel> => {
        const { getImageDimensions, buildExcalidrawJsonWithImage } =
            await import("../../editors/draw/drawExport");
        const dims = await getImageDimensions(dataUrl);
        const json = buildExcalidrawJsonWithImage(dataUrl, "image/png", dims.width, dims.height);
        return this.addEditorPage("draw-view", "json", title ?? "untitled.excalidraw", json);
    };

    replacePage = (oldModel: PageModel, newModel: PageModel) => {
        const state = this.model.state.get();
        const rightId = state.leftRight.get(oldModel.id);
        const leftId = state.rightLeft.get(oldModel.id);

        this.model.state.update((s) => {
            const pIdx = s.pages.indexOf(oldModel);
            if (pIdx !== -1) s.pages[pIdx] = newModel;
            const oIdx = s.ordered.indexOf(oldModel);
            if (oIdx !== -1) s.ordered[oIdx] = newModel;
        });

        if (rightId) {
            this.model.layout.ungroup(oldModel.id);
            this.model.layout.group(newModel.id, rightId);
        } else if (leftId) {
            this.model.layout.ungroup(oldModel.id);
            this.model.layout.group(leftId, newModel.id);
        }

        this.model.persistence.saveState();
    };

    // ── File opening ─────────────────────────────────────────────────

    openFile = async (filePath?: string): Promise<PageModel | undefined> => {
        if (!filePath) return undefined;
        const existingPage = this.model.state
            .get()
            .pages.find((p) => p.state.get().filePath === filePath);
        if (existingPage) {
            this.model.navigation.showPage(existingPage.state.get().id);
            return existingPage;
        }

        const pageModel = await this.createPageFromFile(filePath);
        this.addPage(pageModel);
        recent.add(filePath);

        this.model.closeFirstPageIfEmpty();
        return pageModel;
    };

    openFileAsArchive = (filePath: string): PageModel => {
        // .asar uses regular path (Electron native fs); ZIP archives use "!" convention
        const isAsar = filePath.toLowerCase().endsWith(".asar");
        const archiveRoot = isAsar ? filePath : filePath + "!";
        // Check if already open as archive
        const existing = this.model.state.get().pages.find(
            (p) => p.navPanel?.state.get().rootFilePath === archiveRoot
        );
        if (existing) {
            this.model.navigation.showPage(existing.state.get().id);
            return existing;
        }

        const page = this.addEmptyPageWithNavPanel(archiveRoot);
        page.state.update((s) => {
            s.title = fpBasename(filePath);
        });
        this.model.closeFirstPageIfEmpty();
        return page;
    };

    closePage = async (pageId: string): Promise<boolean> => {
        const page = this.model.query.findPage(pageId);
        if (!page) return false;
        return await page.close(undefined) !== false;
    };

    openFileWithDialog = async () => {
        const filePaths = await api.showOpenFileDialog({
            title: "Open File",
            multiSelections: false,
        });
        if (filePaths && filePaths.length > 0) {
            await this.openFile(filePaths[0]);
        }
    };

    openDiff = async (
        params: { firstPath: string; secondPath: string } | undefined
    ) => {
        if (!params) return;
        const { firstPath, secondPath } = params;
        if (!firstPath || !secondPath) return;
        let existingFirst = this.model.state
            .get()
            .pages.find((p) => p.state.get().filePath === firstPath);
        let existingSecond = this.model.state
            .get()
            .pages.find((p) => p.state.get().filePath === secondPath);

        if (!existingFirst) {
            existingFirst = await this.createPageFromFile(firstPath);
            this.addPage(existingFirst);
        }
        if (!existingSecond) {
            existingSecond = await this.createPageFromFile(secondPath);
            this.addPage(existingSecond);
        }

        this.model.layout.groupTabs(existingFirst.id, existingSecond.id, true);
        this.model.layout.fixCompareMode();
        if (
            isTextFileModel(existingFirst) &&
            isTextFileModel(existingSecond)
        ) {
            existingFirst.state.update((s) => {
                s.compareMode = true;
            });
            existingSecond.state.update((s) => {
                s.compareMode = true;
            });
        }
        this.model.navigation.showPage(existingFirst.id);
    };

    // ── Navigation within a page ─────────────────────────────────────

    navigatePageTo = async (
        pageId: string,
        newFilePath: string,
        options?: {
            revealLine?: number;
            highlightText?: string;
            forceTextEditor?: boolean;
        }
    ): Promise<boolean> => {
        const oldModel = this.model.query.findPage(pageId);
        if (!oldModel) return false;

        const released = await oldModel.confirmRelease();
        if (!released) return false;

        // Preserve pinned state and NavPanel across navigation
        const wasPinned = oldModel.state.get().pinned;
        const navPanel = oldModel.navPanel;
        oldModel.navPanel = null;

        await oldModel.dispose();
        this.model.detachPage(oldModel);

        let newModel: PageModel;
        if (!(await appFs.exists(newFilePath))) {
            ui.notify(
                `File not found: ${fpBasename(newFilePath)}`,
                "error"
            );
            newModel = newTextFileModel("");
            newModel.state.update((s) => {
                s.title = fpBasename(newFilePath);
            });
            await newModel.restore();
        } else {
            try {
                newModel = await this.createPageFromFile(newFilePath);
            } catch (err) {
                ui.notify(
                    `Failed to open ${fpBasename(newFilePath)}: ${(err as Error).message}`,
                    "error"
                );
                newModel = newTextFileModel("");
                await newModel.restore();
            }
        }

        // Auto-select preview editor for navigated files
        if (newModel.state.get().type === "textFile") {
            if (
                options?.forceTextEditor ||
                options?.revealLine ||
                options?.highlightText
            ) {
                if (options.revealLine) {
                    (newModel as TextFileModel).revealLine(
                        options.revealLine
                    );
                }
                if (options.highlightText) {
                    (newModel as TextFileModel).setHighlightText(
                        options.highlightText
                    );
                }
            } else {
                const ext = fpExtname(newFilePath).toLowerCase();
                const lang = getLanguageByExtension(ext);
                const languageId = lang?.id || "plaintext";
                const previewEditor = editorRegistry.getPreviewEditor(
                    languageId,
                    newFilePath
                );
                if (previewEditor) {
                    newModel.state.update((s) => {
                        s.editor = previewEditor;
                    });
                }
            }
        }

        // Restore pinned state on the new model
        if (wasPinned) {
            newModel.state.update((s) => {
                s.pinned = true;
            });
        }

        this.model.attachPage(newModel);
        this.replacePage(oldModel, newModel);
        this.model.onShow.send(newModel);
        this.model.onFocus.send(newModel);

        // Transfer NavPanel from old page to new page
        if (navPanel) {
            newModel.navPanel = navPanel;
            newModel.state.update((s) => {
                s.hasNavPanel = true;
            });
            navPanel.setCurrentFilePath(newFilePath);
            navPanel.updateId(newModel.id);
        }

        return true;
    };

    // ── Closing ──────────────────────────────────────────────────────

    closeToTheRight = async (pageId: string) => {
        const { pages } = this.model.state.get();
        const pagesToClose = [];
        for (let i = pages.length - 1; i >= 0; i--) {
            if (pages[i].state.get().id === pageId) {
                break;
            }
            if (!pages[i].state.get().pinned) {
                pagesToClose.push(pages[i]);
            }
        }
        for (const page of pagesToClose) {
            const closed = await page.close(undefined);
            if (!closed) {
                break;
            }
        }
    };

    closeOtherPages = async (pageId: string) => {
        const { pages } = this.model.state.get();
        const pagesToClose = [];
        for (let i = pages.length - 1; i >= 0; i--) {
            if (
                pages[i].state.get().id !== pageId &&
                !pages[i].state.get().pinned
            ) {
                pagesToClose.push(pages[i]);
            }
        }
        for (const page of pagesToClose) {
            const closed = await page.close(undefined);
            if (!closed) {
                break;
            }
        }
    };

    // ── Multi-window operations ──────────────────────────────────────

    movePageIn = async (data?: {
        page: Partial<IPageState>;
        targetPageId: string | undefined;
    }) => {
        if (!data || !data.page) {
            return;
        }
        const pageModel = await this.newPageModelFromState(data.page);
        await pageModel.restore();
        const targetIndex = data.targetPageId
            ? this.model.state
                  .get()
                  .pages.findIndex(
                      (p) => p.state.get().id === data.targetPageId
                  )
            : -1;
        if (targetIndex === -1) {
            this.addPage(pageModel);
            this.model.closeFirstPageIfEmpty();
        } else {
            this.model.attachPage(pageModel);
            this.model.state.update((s) => {
                s.pages.splice(targetIndex, 0, pageModel);
                s.ordered.push(pageModel);
            });
            this.model.layout.fixGrouping();
            this.model.persistence.saveStateDebounced();
        }
    };

    movePageOut = async (pageId?: string) => {
        const page = this.model.query.findPage(pageId);
        if (!page) {
            return;
        }
        await page.saveState();
        const closeWindow = this.model.state.get().pages.length === 1;
        page.skipSave = true;
        if (closeWindow) {
            this.model.state.update((s) => {
                s.pages = s.pages.filter((p) => p !== page);
                s.ordered = s.ordered.filter((p) => p !== page);
            });
            this.model.persistence.saveStateDebounced();
            api.closeWindow();
        } else {
            // Detach first to prevent dispose — the page is being transferred, not closed.
            this.model.detachPage(page);
            this.model.removePage(page);
        }
    };

    // ── Duplication ──────────────────────────────────────────────────

    duplicatePage = async (pageId: string) => {
        const page = this.model.query.findPage(pageId);
        if (!page) {
            return;
        }

        const pageData: Partial<IPageState> = page.getRestoreData();
        pageData.id = crypto.randomUUID();
        pageData.hasNavPanel = false;
        pageData.pinned = false;
        const newPage = await this.model.persistence.restoreModel(pageData);
        if (newPage) {
            this.addPage(newPage);
        }
        this.model.layout.groupTabs(pageId, pageData.id!, false);
    };

    // ── URL handling ─────────────────────────────────────────────────

    handleOpenUrl = async (url: string) => {
        const behavior = settings.get("link-open-behavior");
        if (behavior === "internal-browser") {
            await this.openUrlInBrowserTab(url);
        } else {
            shell.openExternal(url);
        }
    };

    handleExternalUrl = async (url: string) => {
        await this.openUrlInBrowserTab(url, { external: true });
    };

    openPathInNewWindow = (filePath: string) => {
        if (!filePath) {
            return;
        }
        api.openNewWindow(filePath);
    };

    // ── Grouped text helper ──────────────────────────────────────────

    requireGroupedText = (
        pageId: string,
        suggestedLanguage?: string
    ): TextFileModel => {
        let groupedPage = this.model.query.getGroupedPage(pageId);
        if (groupedPage && !(groupedPage.state.get().type === "textFile")) {
            this.model.layout.ungroup(pageId);
            groupedPage = undefined;
        }

        if (!groupedPage) {
            groupedPage = this.addEmptyPage() as unknown as PageModel;
            this.model.layout.groupTabs(
                pageId,
                groupedPage.state.get().id,
                false
            );
            groupedPage.changeLanguage(suggestedLanguage);
        }

        return groupedPage as unknown as TextFileModel;
    };

    // ── Page-actions (from old page-actions.ts) ──────────────────────

    showAboutPage = async (): Promise<void> => {
        const aboutModule = await import("../../editors/about/AboutPage");
        const model = await aboutModule.default.newEmptyPageModel("aboutPage");
        if (model) {
            this.addPage(model);
        }
    };

    showSettingsPage = async (): Promise<void> => {
        const settingsModule = await import(
            "../../editors/settings/SettingsPage"
        );
        const model =
            await settingsModule.default.newEmptyPageModel("settingsPage");
        if (model) {
            this.addPage(model);
        }
    };

    showBrowserPage = async (options?: {
        profileName?: string;
        incognito?: boolean;
        url?: string;
    }): Promise<void> => {
        const browserModule = await import(
            "../../editors/browser/BrowserPageView"
        );
        const model =
            await browserModule.default.newEmptyPageModel("browserPage");
        if (model) {
            if (options?.profileName || options?.incognito) {
                model.state.update((s: any) => {
                    if (options.profileName) s.profileName = options.profileName;
                    if (options.incognito) s.isIncognito = true;
                });
            }
            if (options?.url) {
                model.state.update((s: any) => {
                    s.url = options.url;
                    const tab = s.tabs?.[0];
                    if (tab) {
                        tab.url = options.url;
                        tab.homeUrl = options.url;
                    }
                });
            }
            await model.restore();
            this.addPage(model);
        }
    };

    showMcpInspectorPage = async (options?: { url?: string }): Promise<void> => {
        const mcpModule = await import(
            "../../editors/mcp-inspector/McpInspectorView"
        );
        const model =
            await mcpModule.default.newEmptyPageModel("mcpInspectorPage");
        if (model) {
            if (options?.url) {
                model.state.update((s: any) => { s.url = options.url; });
            }
            this.addPage(model);
        }
    };

    openImageInNewTab = async (imageUrl: string): Promise<void> => {
        const imgModule = await import("../../editors/image/ImageViewer");
        const imgModel =
            await imgModule.default.newEmptyPageModel("imageFile");
        if (imgModel) {
            imgModel.state.update(
                (s: { title: string; url?: string }) => {
                    s.title =
                        imageUrl.split("/").pop()?.split("?")[0] || "Image";
                    s.url = imageUrl;
                }
            );
            await imgModel.restore();
            this.addPage(imgModel);
        }
    };

    openUrlInBrowserTab = async (
        url: string,
        options?: {
            incognito?: boolean;
            profileName?: string;
            external?: boolean;
        }
    ): Promise<void> => {
        const pages = this.model.state.get().pages;
        const activePage = this.model.query.activePage;
        const activeIndex = activePage ? pages.indexOf(activePage) : -1;

        const matchesBrowser = (pageState: any) => {
            if (pageState.type !== "browserPage") return false;
            if (options?.incognito) return !!pageState.isIncognito;
            const targetProfile =
                options?.profileName !== undefined
                    ? options.profileName || ""
                    : options?.external
                      ? settings.get("browser-default-profile") || ""
                      : undefined;
            return (
                !pageState.isIncognito &&
                (targetProfile === undefined ||
                    (pageState.profileName ?? "") === targetProfile)
            );
        };

        const addTabToPage = (index: number) => {
            const pageState = pages[index].state.get();
            const page = pages[index] as any;
            // If the browser has only one empty tab, navigate it instead of adding a new one
            const tabs = (pageState as any).tabs;
            if (tabs?.length === 1 && tabs[0].url === "about:blank") {
                page.navigate(url);
            } else {
                page.addTab(url);
            }
            this.model.navigation.showPage(pageState.id);
        };

        if (options?.external) {
            // Prefer the active page if it's a matching browser
            if (activeIndex >= 0 && matchesBrowser(pages[activeIndex].state.get())) {
                addTabToPage(activeIndex);
                return;
            }
            for (let i = 0; i < pages.length; i++) {
                if (matchesBrowser(pages[i].state.get())) {
                    addTabToPage(i);
                    return;
                }
            }
        } else {
            for (let i = activeIndex + 1; i < pages.length; i++) {
                if (matchesBrowser(pages[i].state.get())) {
                    addTabToPage(i);
                    return;
                }
            }
            for (let i = activeIndex - 1; i >= 0; i--) {
                if (matchesBrowser(pages[i].state.get())) {
                    addTabToPage(i);
                    return;
                }
            }
        }

        const profileName = options?.incognito
            ? undefined
            : (options?.profileName ??
                  settings.get("browser-default-profile")) || undefined;
        const showOptions = {
            url,
            ...(options?.incognito
                ? { incognito: true }
                : profileName
                  ? { profileName }
                  : {}),
        };
        await this.showBrowserPage(showOptions);
    };
}
