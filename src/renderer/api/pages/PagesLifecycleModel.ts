import type { PagesModel } from "./PagesModel";
import { EditorModel } from "../../editors/base";
import { IEditorState, ISourceLink, EditorView, EditorType } from "../../../shared/types";
import {
    isTextFileModel,
    newTextFileModel,
    TextFileModel,
} from "../../editors/text";
import { api } from "../../../ipc/renderer/api";
import { recent } from "../recent";
import { ui } from "../ui";
import { settings } from "../settings";
import { editorRegistry } from "../../editors/registry";
import { getLanguageByExtension } from "../../core/utils/language-mapping";
import { NavigationData } from "../../ui/navigation/NavigationData";

import { fpBasename, fpExtname } from "../../core/utils/file-path";
import { fs as appFs } from "../fs";
import { getWellKnownPageDef } from "./well-known-pages";
import type { IContentPipe } from "../../api/types/io.pipe";
import { ContentPipe } from "../../content/ContentPipe";
import { FileProvider } from "../../content/providers/FileProvider";
import { HttpProvider } from "../../content/providers/HttpProvider";
import { ZipTransformer } from "../../content/transformers/ZipTransformer";

/**
 * PagesLifecycleModel — Page creation, opening, closing, and navigation.
 */
export class PagesLifecycleModel {
    constructor(private model: PagesModel) {}

    // ── Pipe helpers ──────────────────────────────────────────────────

    /** Create a content pipe from a path string (file, archive, or HTTP). */
    private createPipeFromPath(path: string): IContentPipe {
        if (path.startsWith("http://") || path.startsWith("https://")) {
            return new ContentPipe(new HttpProvider(path));
        }
        const bangIndex = path.indexOf("!");
        if (bangIndex >= 0) {
            const archivePath = path.slice(0, bangIndex);
            const entryPath = path.slice(bangIndex + 1);
            return new ContentPipe(
                new FileProvider(archivePath),
                [new ZipTransformer(entryPath)],
            );
        }
        return new ContentPipe(new FileProvider(path));
    }

    // ── Page factory helpers ─────────────────────────────────────────

    private newPageModel = async (filePath?: string): Promise<EditorModel> => {
        const editorDef = editorRegistry.resolve(filePath);
        if (editorDef) {
            const module = await editorDef.loadModule();
            return module.newPageModel(filePath);
        }
        const def = editorRegistry.getById("monaco");
        if (!def) throw new Error("Monaco editor not registered");
        const module = await def.loadModule();
        return module.newPageModel(filePath);
    };

    /** Legacy page type migration: maps old renamed page types to current names. */
    private static PAGE_TYPE_MIGRATIONS: Record<string, EditorType> = {
        mcpBrowserPage: "mcpInspectorPage",
    };

    newPageModelFromState = async (
        state: Partial<IEditorState>
    ): Promise<EditorModel> => {
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

    createPageFromFile = async (filePath: string, pipe?: IContentPipe): Promise<EditorModel> => {
        const pageModel = await this.newPageModel(filePath);
        if (pipe) {
            pageModel.pipe = pipe;
        }
        pageModel.state.update((s) => {
            s.language = "";
        });
        await pageModel.restore();
        return pageModel;
    };

    addPage = (page: EditorModel): EditorModel => {
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

    addEmptyPage = (): EditorModel => {
        const emptyFile = newTextFileModel("");
        emptyFile.restore();
        return this.addPage(emptyFile as unknown as EditorModel);
    };

    addEmptyPageWithNavPanel = (folderPath: string): EditorModel => {
        // Create page directly without calling restore(), which would
        // asynchronously overwrite our NavigationData (it sees hasNavigator=true
        // and creates a new NavigationData with empty rootPath).
        const emptyFile = newTextFileModel("");
        const page = this.addPage(emptyFile as unknown as EditorModel);
        const navData = new NavigationData(folderPath);
        navData.ensurePageNavigatorModel();
        navData.updateId(page.state.get().id);
        navData.flushSave();
        page.navigationData = navData;
        navData.setOwnerModel(page);
        page.state.update((s) => {
            s.hasNavigator = true;
        });
        return page;
    };

    addEditorPage = (
        editor: EditorView,
        language: string,
        title: string,
        content?: string,
    ): EditorModel => {
        if (typeof editor !== "string") {
            throw new Error(
                `addEditorPage() expects positional arguments: (editor, language, title, content?). Got ${typeof editor} for editor. Example: addEditorPage("monaco", "plaintext", "My Page", "content")`
            );
        }
        const editorDef = editorRegistry.getById(editor);
        if (!editorDef && editor !== "monaco") {
            throw new Error(
                `Editor '${editor}' is not registered. Available editors: ${editorRegistry.getAll().map((e) => e.id).join(", ")}`
            );
        }
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
        }
        page.restore();
        return this.addPage(page as unknown as EditorModel);
    };

    /**
     * Get or create a well-known page by predefined ID.
     * If a page with this ID exists, focuses and returns it.
     * If not, creates a new page with the predefined editor/language/title.
     */
    requireWellKnownPage = async (id: string): Promise<EditorModel> => {
        const existing = this.model.query.findPage(id);
        if (existing) {
            this.model.navigation.showPage(id);
            return existing;
        }

        const def = getWellKnownPageDef(id);
        if (!def) throw new Error(`Unknown well-known page ID: "${id}"`);

        await editorRegistry.loadViewModelFactory(def.editor as EditorView);
        const page = newTextFileModel("");
        page.state.update((s) => {
            s.id = id;
            s.title = def.title;
            s.language = def.language;
            s.editor = editorRegistry.validateForLanguage(
                def.editor as EditorView,
                def.language,
            );
        });
        page.restore();
        return this.addPage(page as unknown as EditorModel);
    };

    /** Create a new drawing page with an embedded image. */
    addDrawPage = async (dataUrl: string, title?: string): Promise<EditorModel> => {
        const { getImageDimensions, buildExcalidrawJsonWithImage } =
            await import("../../editors/draw/drawExport");
        const dims = await getImageDimensions(dataUrl);
        const json = buildExcalidrawJsonWithImage(dataUrl, "image/png", dims.width, dims.height);
        return this.addEditorPage("draw-view", "json", title ?? "untitled.excalidraw", json);
    };

    replacePage = (oldModel: EditorModel, newModel: EditorModel) => {
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

    openFile = async (
        filePath?: string,
        pipe?: IContentPipe,
        options?: { sourceLink?: ISourceLink },
    ): Promise<EditorModel | undefined> => {
        if (!filePath) return undefined;
        const existingPage = this.model.state
            .get()
            .pages.find((p) => p.state.get().filePath === filePath);
        if (existingPage) {
            pipe?.dispose(); // Dispose unused pipe if page already open
            this.model.navigation.showPage(existingPage.state.get().id);
            return existingPage;
        }

        const pageModel = await this.createPageFromFile(filePath, pipe);
        if (options?.sourceLink) {
            pageModel.state.update((s) => { s.sourceLink = options.sourceLink; });
        }
        this.addPage(pageModel);
        recent.add(filePath);

        this.model.closeFirstPageIfEmpty();
        return pageModel;
    };

    openFileAsArchive = async (filePath: string): Promise<EditorModel> => {
        // .asar: Electron native fs — use simple nav panel (no ZipTreeProvider)
        if (filePath.toLowerCase().endsWith(".asar")) {
            return this._openAsarArchive(filePath);
        }
        // ZIP-based archives: use ZipPageModel
        return this._openZipArchive(filePath);
    };

    private _openAsarArchive(filePath: string): EditorModel {
        const archiveRoot = filePath;
        const existing = this.model.state.get().pages.find(
            (p) => p.navigationData?.pageNavigatorModel?.state.get().rootPath === archiveRoot
        );
        if (existing) {
            this.model.navigation.showPage(existing.state.get().id);
            return existing;
        }
        const page = this.addEmptyPageWithNavPanel(archiveRoot);
        page.state.update((s) => { s.title = fpBasename(filePath); });
        this.model.closeFirstPageIfEmpty();
        return page;
    }

    private async _openZipArchive(filePath: string): Promise<EditorModel> {
        // Check if already open as archive (by archiveUrl on ZipPageModel)
        const existing = this.model.state.get().pages.find(
            (p) => p.state.get().type === "zipFile"
                && (p.state.get() as any).archiveUrl === filePath // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        if (existing) {
            this.model.navigation.showPage(existing.state.get().id);
            return existing;
        }

        // Create ZipPageModel via editor registry (dynamic import)
        const editorDef = editorRegistry.getById("zip-view");
        if (!editorDef) throw new Error("zip-view editor not registered");
        const module = await editorDef.loadModule();
        const page = await module.newPageModel(filePath);

        // Create NavigationData with archive root for explorer sidebar
        const archiveRoot = filePath + "!";
        const navData = new NavigationData(archiveRoot);
        navData.ensurePageNavigatorModel();
        navData.updateId(page.state.get().id);
        navData.flushSave();
        page.navigationData = navData;
        navData.setOwnerModel(page);
        page.state.update((s) => { s.hasNavigator = true; });

        // Set secondaryEditor after NavigationData is attached
        // (the setter calls navigationData.addSecondaryModel)
        (page as any).secondaryEditor = "zip-tree"; // eslint-disable-line @typescript-eslint/no-explicit-any

        this.addPage(page);
        this.model.closeFirstPageIfEmpty();
        return page;
    }

    closePage = async (pageId: string): Promise<boolean> => {
        const page = this.model.query.findPage(pageId);
        if (!page) return false;
        return await page.close(undefined) !== false;
    };

    openFileWithDialog = async () => {
        const { showOpenUrlDialog } = await import("../../ui/dialogs/OpenUrlDialog");
        const result = await showOpenUrlDialog();
        if (!result) return;

        if (result.type === "url") {
            // User entered a raw link (file path, URL, cURL) — route through pipeline
            const { app: appInstance } = await import("../app");
            const { RawLinkEvent } = await import("../events/events");
            await appInstance.events.openRawLink.sendAsync(new RawLinkEvent(result.value));
        } else if (result.type === "file") {
            // User clicked "Open File" — show OS file dialog
            const filePaths = await api.showOpenFileDialog({
                title: "Open File",
                multiSelections: false,
            });
            if (filePaths && filePaths.length > 0) {
                const { app: appInstance } = await import("../app");
                const { RawLinkEvent } = await import("../events/events");
                await appInstance.events.openRawLink.sendAsync(new RawLinkEvent(filePaths[0]));
            }
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
            const pipe = this.createPipeFromPath(firstPath);
            existingFirst = await this.createPageFromFile(firstPath, pipe);
            this.addPage(existingFirst);
        }
        if (!existingSecond) {
            const pipe = this.createPipeFromPath(secondPath);
            existingSecond = await this.createPageFromFile(secondPath, pipe);
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
            sourceLink?: ISourceLink;
        }
    ): Promise<boolean> => {
        const oldModel = this.model.query.findPage(pageId);
        if (!oldModel) return false;

        const released = await oldModel.confirmRelease();
        if (!released) return false;

        // Preserve pinned state and NavPanel across navigation
        const wasPinned = oldModel.state.get().pinned;
        const navigationData = oldModel.navigationData;

        // Create new model BEFORE beforeNavigateAway so old model can inspect it
        let newModel: EditorModel;
        // Virtual paths (tree-category://, etc.) skip file existence check
        const isVirtualPath = newFilePath.includes("://");
        if (!isVirtualPath && !(await appFs.exists(newFilePath))) {
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

        // Set sourceLink on new model early — beforeNavigateAway inspects it
        if (options?.sourceLink) {
            newModel.state.update((s) => { s.sourceLink = options.sourceLink; });
        }

        // Give old model a chance to keep/clear its secondary editor status
        oldModel.beforeNavigateAway(newModel);

        // If oldModel kept itself in secondaryModels[], detach it from the page
        // collection WITHOUT disposing (it lives on in NavigationData).
        // If oldModel cleared its secondaryEditor, dispose normally.
        const survivesAsSecondary = navigationData?.secondaryModels.includes(oldModel);
        oldModel.navigationData = null;
        if (!survivesAsSecondary) {
            await oldModel.dispose();
        }
        this.model.detachPage(oldModel);

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
            newModel.state.update((s) => { s.pinned = true; });
        }

        this.model.attachPage(newModel);
        this.replacePage(oldModel, newModel);
        this.model.onShow.send(newModel);
        this.model.onFocus.send(newModel);

        // Transfer NavigationData from old page to new page
        if (navigationData) {
            newModel.navigationData = navigationData;
            newModel.state.update((s) => {
                s.hasNavigator = true;
            });
            navigationData.updateId(newModel.id);
            navigationData.setOwnerModel(newModel);

            // If the new model declared itself as a secondary editor, register it now
            // (model may have set secondaryEditor in state before NavigationData was attached)
            const se = newModel.state.get().secondaryEditor;
            if (se) {
                navigationData.addSecondaryModel(newModel);
            }
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
        page: Partial<IEditorState>;
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

        const pageData: Partial<IEditorState> = page.getRestoreData();
        pageData.id = crypto.randomUUID();
        pageData.hasNavigator = false;
        pageData.pinned = false;
        const newPage = await this.model.persistence.restoreModel(pageData);
        if (newPage) {
            this.addPage(newPage);
        }
        this.model.layout.groupTabs(pageId, pageData.id!, false);
    };

    // ── URL handling ─────────────────────────────────────────────────

    handleOpenUrl = async (url: string) => {
        // Route through the link pipeline — HTTP resolver decides content vs browser
        const { app: appInstance } = await import("../app");
        const { RawLinkEvent } = await import("../events/events");
        await appInstance.events.openRawLink.sendAsync(new RawLinkEvent(url));
    };

    handleExternalUrl = async (url: string) => {
        // Route through pipeline — HTTP resolver decides content vs browser based on extension
        const { app: appInstance } = await import("../app");
        const { RawLinkEvent } = await import("../events/events");
        await appInstance.events.openRawLink.sendAsync(new RawLinkEvent(url));
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
            groupedPage = this.addEmptyPage() as unknown as EditorModel;
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
        tor?: boolean;
        url?: string;
    }): Promise<void> => {
        // Validate Tor configuration before creating the page
        if (options?.tor) {
            const torPath = settings.get("tor.exe-path");
            if (!torPath) {
                ui.notify(
                    "Browser (Tor) requires tor.exe path. Configure it in Settings → tor.exe-path",
                    "error",
                );
                return;
            }
            if (!(await appFs.exists(torPath))) {
                ui.notify(`tor.exe not found at: ${torPath}`, "error");
                return;
            }
        }

        const browserModule = await import(
            "../../editors/browser/BrowserPageView"
        );
        const model =
            await browserModule.default.newEmptyPageModel("browserPage");
        if (model) {
            if (options?.profileName || options?.incognito || options?.tor) {
                model.state.update((s: any) => {
                    if (options.profileName) s.profileName = options.profileName;
                    if (options.incognito) s.isIncognito = true;
                    if (options.tor) s.isTor = true;
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

            // Start Tor proxy after page is visible (overlay shows progress)
            if (options?.tor) {
                (model as any).initTorProxy();
            }
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
            // For HTTP(S) URLs, create a pipe so the image can be re-fetched on restart
            if (/^https?:\/\//i.test(imageUrl)) {
                imgModel.pipe = new ContentPipe(new HttpProvider(imageUrl));
            }
            await imgModel.restore();
            this.addPage(imgModel);

            // For blob URLs, cache binary to disk for restart recovery
            if (imageUrl.startsWith("blob:") && imgModel instanceof imgModule.ImageViewerModel) {
                imgModel.cacheBlobUrl(imageUrl);
            }
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
            // Check active page first, then search outward
            if (activeIndex >= 0 && matchesBrowser(pages[activeIndex].state.get())) {
                addTabToPage(activeIndex);
                return;
            }
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
