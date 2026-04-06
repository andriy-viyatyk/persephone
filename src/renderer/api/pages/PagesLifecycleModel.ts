import type { PagesModel } from "./PagesModel";
import { EditorModel } from "../../editors/base";
import { IEditorState, ISourceLink, EditorView, EditorType, PageDescriptor } from "../../../shared/types";
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
import { PageModel } from "./PageModel";

import type { ILink } from "../../api/types/io.tree";
import type { LinkItem, LinkEditorData } from "../../editors/link-editor/linkTypes";
import { fpBasename, fpExtname } from "../../core/utils/file-path";
import { fs as appFs } from "../fs";
import { getWellKnownPageDef } from "./well-known-pages";
import type { IContentPipe } from "../../api/types/io.pipe";
import { ContentPipe } from "../../content/ContentPipe";
import { FileProvider } from "../../content/providers/FileProvider";
import { HttpProvider } from "../../content/providers/HttpProvider";
import { ArchiveTransformer } from "../../content/transformers/ArchiveTransformer";

function normalizeLinksTitle(title?: string): string {
    if (!title) return "untitled.link.json";
    if (/\.link\.json$/i.test(title)) return title;
    return title + ".link.json";
}

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
                [new ArchiveTransformer(archivePath, entryPath)],
            );
        }
        return new ContentPipe(new FileProvider(path));
    }

    // ── Editor factory helpers ───────────────────────────────────────

    private newEditorModel = async (filePath?: string): Promise<EditorModel> => {
        const editorDef = editorRegistry.resolve(filePath);
        if (editorDef) {
            const module = await editorDef.loadModule();
            return module.newEditorModel(filePath);
        }
        const def = editorRegistry.getById("monaco");
        if (!def) throw new Error("Monaco editor not registered");
        const module = await def.loadModule();
        return module.newEditorModel(filePath);
    };

    /** Legacy page type migration: maps old renamed page types to current names. */
    private static PAGE_TYPE_MIGRATIONS: Record<string, EditorType> = {
        mcpBrowserPage: "mcpInspectorPage",
    };

    newEditorModelFromState = async (
        state: Partial<IEditorState>
    ): Promise<EditorModel> => {
        if (state.type && PagesLifecycleModel.PAGE_TYPE_MIGRATIONS[state.type]) {
            state = { ...state, type: PagesLifecycleModel.PAGE_TYPE_MIGRATIONS[state.type] };
        }
        // ExplorerEditorModel — not in editor registry (secondary-only)
        if (state.type === "fileExplorer") {
            const { ExplorerEditorModel } = await import("../../editors/explorer");
            return new ExplorerEditorModel();
        }
        const editors = editorRegistry.getAll();
        const editorDef = editors.find((e) => e.editorType === state.type);
        if (editorDef) {
            const module = await editorDef.loadModule();
            return module.newEditorModelFromState(state);
        }
        const def = editorRegistry.getById("monaco");
        if (!def) throw new Error("Monaco editor not registered");
        const module = await def.loadModule();
        return module.newEditorModelFromState(state);
    };

    // ── Core page operations ─────────────────────────────────────────

    createEditorFromFile = async (filePath: string, pipe?: IContentPipe, target?: string, title?: string): Promise<EditorModel> => {
        const editor = target
            ? await this.newEditorModelByTarget(filePath, target)
            : await this.newEditorModel(filePath);
        if (pipe) {
            editor.pipe = pipe;
        }
        editor.state.update((s) => {
            s.language = "";
            if (title) s.title = title;
        });
        await editor.restore();
        return editor;
    };

    /** Create an editor by target ID (e.g., "image-view"), falling back to path-based resolution. */
    private newEditorModelByTarget = async (filePath: string, target: string): Promise<EditorModel> => {
        const editorDef = editorRegistry.getById(target as EditorView);
        if (editorDef) {
            const module = await editorDef.loadModule();
            return module.newEditorModel(filePath);
        }
        return this.newEditorModel(filePath);
    };

    /**
     * Add an editor to the page collection, wrapping it in a PageModel.
     * @param editor — the EditorModel to add (null for empty pages with sidebar only)
     * @param existingPage — optional pre-created PageModel (for sidebar pages, archives, etc.)
     * @returns The PageModel wrapping the editor
     */
    addPage = (editor: EditorModel | null, existingPage?: PageModel): PageModel => {
        const page = existingPage ?? new PageModel();
        if (editor && !page.mainEditor) {
            page.mainEditor = editor;
            editor.setPage(page);
        }

        // Check duplicate by page ID
        const existingById = this.model.query.findPage(page.id);
        if (existingById) {
            this.model.navigation.showPage(existingById.id);
            return existingById;
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
        return this.addPage(emptyFile as unknown as EditorModel);
    };

    addEmptyPageWithNavPanel = async (folderPath: string): Promise<PageModel> => {
        const page = new PageModel();
        await page.createExplorer(folderPath);
        page.ensurePageNavigatorModel();
        return this.addPage(null, page);
    };

    addEditorPage = (
        editor: EditorView,
        language: string,
        title: string,
        content?: string,
    ): PageModel => {
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
        if (editorDef?.category === "standalone") {
            throw new Error(
                `Cannot create '${editor}' with addEditorPage() — it is a standalone editor that requires a specialized model. Use the dedicated method instead (e.g., showBrowserPage(), showAboutPage(), openFile()).`
            );
        }
        const editorModel = newTextFileModel("");
        editorModel.state.update((s) => {
            s.title = title;
            s.language = language;
            s.editor = editorRegistry.validateForLanguage(editor, language);
        });
        if (content) {
            editorModel.changeContent(content);
        }
        editorModel.restore();
        return this.addPage(editorModel as unknown as EditorModel);
    };

    requireWellKnownPage = async (id: string): Promise<PageModel> => {
        const existing = this.model.query.findPage(id);
        if (existing) {
            this.model.navigation.showPage(id);
            return existing;
        }

        const def = getWellKnownPageDef(id);
        if (!def) throw new Error(`Unknown well-known page ID: "${id}"`);

        await editorRegistry.loadViewModelFactory(def.editor as EditorView);
        const editorModel = newTextFileModel("");
        editorModel.state.update((s) => {
            s.id = id;
            s.title = def.title;
            s.language = def.language;
            s.editor = editorRegistry.validateForLanguage(
                def.editor as EditorView,
                def.language,
            );
        });
        editorModel.restore();
        // Use the well-known ID as both page ID and editor ID
        const page = new PageModel(id);
        return this.addPage(editorModel as unknown as EditorModel, page);
    };

    addDrawPage = async (dataUrl: string, title?: string): Promise<PageModel> => {
        const { getImageDimensions, buildExcalidrawJsonWithImage } =
            await import("../../editors/draw/drawExport");
        const dims = await getImageDimensions(dataUrl);
        const json = buildExcalidrawJsonWithImage(dataUrl, "image/png", dims.width, dims.height);
        return this.addEditorPage("draw-view", "json", title ?? "untitled.excalidraw", json);
    };

    openLinks = (
        links: (ILink | string)[],
        title?: string,
    ): PageModel => {
        const normalizedTitle = normalizeLinksTitle(title);

        // Convert input to LinkItem[]
        const linkItems: LinkItem[] = links.map((item) => {
            if (typeof item === "string") {
                return {
                    id: crypto.randomUUID(),
                    title: fpBasename(item) || item,
                    href: item,
                    category: "",
                    tags: [],
                    isDirectory: false,
                };
            }
            return {
                ...item,
                id: item.id || crypto.randomUUID(),
                category: item.category ?? "",
                tags: item.tags ?? [],
                isDirectory: item.isDirectory ?? false,
            };
        });

        // Build content JSON
        const data: LinkEditorData = { links: linkItems, state: {} };
        const content = JSON.stringify({ type: "link-editor", ...data }, null, 4);

        // Create TextFileModel with link-view content
        const editorModel = newTextFileModel("");
        editorModel.state.update((s) => {
            s.title = normalizedTitle;
            s.language = "json";
            s.editor = editorRegistry.validateForLanguage("link-view", "json");
            s.secondaryEditor = ["link-category"];
        });
        editorModel.restore();
        editorModel.changeContent(content);

        // Create page with the model as secondary editor (not mainEditor)
        const page = new PageModel();
        page.addSecondaryEditor(editorModel as unknown as EditorModel);
        page.ensurePageNavigatorModel();
        page.expandPanel("link-category");

        this.addPage(null, page);
        this.model.closeFirstPageIfEmpty();
        return page;
    };

    // ── File opening ─────────────────────────────────────────────────

    openFile = async (
        filePath?: string,
        pipe?: IContentPipe,
        options?: { sourceLink?: ISourceLink },
    ): Promise<PageModel | undefined> => {
        if (!filePath) return undefined;
        const existingPage = this.model.state
            .get()
            .pages.find((p) => p.mainEditor?.filePath === filePath);
        if (existingPage) {
            pipe?.dispose();
            this.model.navigation.showPage(existingPage.id);
            return existingPage;
        }

        const editor = await this.createEditorFromFile(filePath, pipe);
        if (options?.sourceLink) {
            editor.state.update((s) => { s.sourceLink = options.sourceLink; });
        }
        const page = this.addPage(editor);
        recent.add(filePath);

        this.model.closeFirstPageIfEmpty();
        return page;
    };

    openFileAsArchive = async (filePath: string): Promise<PageModel> => {
        if (filePath.toLowerCase().endsWith(".asar")) {
            return this._openAsarArchive(filePath);
        }
        return this._openZipArchive(filePath);
    };

    private async _openAsarArchive(filePath: string): Promise<PageModel> {
        const archiveRoot = filePath;
        const existing = this.model.state.get().pages.find(
            (p) => p.findExplorer()?.state.get().type === "fileExplorer"
                && (p.findExplorer()?.state.get() as any)?.rootPath === archiveRoot // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        if (existing) {
            this.model.navigation.showPage(existing.id);
            return existing;
        }
        const page = await this.addEmptyPageWithNavPanel(archiveRoot);
        this.model.closeFirstPageIfEmpty();
        return page;
    }

    private async _openZipArchive(filePath: string): Promise<PageModel> {
        const existing = this.model.state.get().pages.find(
            (p) => p.mainEditor?.state.get().type === "archiveFile"
                && (p.mainEditor?.state.get() as any).archiveUrl === filePath // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        if (existing) {
            this.model.navigation.showPage(existing.id);
            return existing;
        }

        const editorDef = editorRegistry.getById("archive-view");
        if (!editorDef) throw new Error("archive-view editor not registered");
        const module = await editorDef.loadModule();
        const editor = await module.newEditorModel(filePath);

        // Create PageModel with sidebar for archive browsing
        const page = new PageModel();
        page.mainEditor = editor;
        editor.setPage(page);
        page.ensurePageNavigatorModel();

        // Set secondaryEditor after page is set up
        // (the setter calls page.addSecondaryEditor)
        (editor as any).secondaryEditor = ["archive-tree"]; // eslint-disable-line @typescript-eslint/no-explicit-any

        this.addPage(editor, page);
        this.model.closeFirstPageIfEmpty();
        return page;
    }

    closePage = async (pageId: string): Promise<boolean> => {
        const page = this.model.query.findPage(pageId);
        if (!page) return false;
        return await page.close();
    };

    openFileWithDialog = async () => {
        const { showOpenUrlDialog } = await import("../../ui/dialogs/OpenUrlDialog");
        const result = await showOpenUrlDialog();
        if (!result) return;

        if (result.type === "url") {
            const { app: appInstance } = await import("../app");
            const { RawLinkEvent } = await import("../events/events");
            await appInstance.events.openRawLink.sendAsync(new RawLinkEvent(result.value));
        } else if (result.type === "file") {
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
            .pages.find((p) => p.mainEditor?.filePath === firstPath);
        let existingSecond = this.model.state
            .get()
            .pages.find((p) => p.mainEditor?.filePath === secondPath);

        if (!existingFirst) {
            const pipe = this.createPipeFromPath(firstPath);
            const editor = await this.createEditorFromFile(firstPath, pipe);
            existingFirst = this.addPage(editor);
        }
        if (!existingSecond) {
            const pipe = this.createPipeFromPath(secondPath);
            const editor = await this.createEditorFromFile(secondPath, pipe);
            existingSecond = this.addPage(editor);
        }

        this.model.layout.groupTabs(existingFirst.id, existingSecond.id, true);
        this.model.layout.fixCompareMode();
        const firstEditor = existingFirst.mainEditor;
        const secondEditor = existingSecond.mainEditor;
        if (
            firstEditor && isTextFileModel(firstEditor) &&
            secondEditor && isTextFileModel(secondEditor)
        ) {
            firstEditor.state.update((s) => {
                (s as any).compareMode = true;
            });
            secondEditor.state.update((s) => {
                (s as any).compareMode = true;
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
            pipe?: IContentPipe;
            /** Editor target from the link pipeline (e.g., "image-view", "monaco"). */
            target?: string;
            /** Page title override (from link metadata). */
            title?: string;
        }
    ): Promise<boolean> => {
        const page = this.model.query.findPage(pageId);
        if (!page) return false;

        const oldEditor = page.mainEditor;
        if (oldEditor) {
            const released = await oldEditor.confirmRelease();
            if (!released) return false;
        }

        // Create new editor
        let newEditor: EditorModel;
        const isVirtualPath = newFilePath.includes("://") || newFilePath.startsWith("data:");
        if (!isVirtualPath && !(await appFs.exists(newFilePath))) {
            ui.notify(
                `File not found: ${fpBasename(newFilePath)}`,
                "error"
            );
            newEditor = newTextFileModel("") as unknown as EditorModel;
            newEditor.state.update((s) => {
                s.title = fpBasename(newFilePath);
            });
            await newEditor.restore();
        } else {
            try {
                newEditor = await this.createEditorFromFile(newFilePath, options?.pipe, options?.target, options?.title);
            } catch (err) {
                ui.notify(
                    `Failed to open ${fpBasename(newFilePath)}: ${(err as Error).message}`,
                    "error"
                );
                newEditor = newTextFileModel("") as unknown as EditorModel;
                await newEditor.restore();
            }
        }

        // Set sourceLink and title on new editor early — beforeNavigateAway inspects sourceLink
        if (options?.sourceLink || options?.title) {
            newEditor.state.update((s) => {
                if (options.sourceLink) s.sourceLink = options.sourceLink;
                if (options.title) s.title = options.title;
            });
        }

        // Swap main editor — handles beforeNavigateAway, dispose, notifications
        await page.setMainEditor(newEditor);

        // Re-subscribe to new editor's state changes
        this.model.resubscribeEditor(page);

        // Auto-select preview editor for navigated files
        if (newEditor.state.get().type === "textFile") {
            if (
                options?.forceTextEditor ||
                options?.revealLine ||
                options?.highlightText
            ) {
                if (options.revealLine) {
                    (newEditor as unknown as TextFileModel).revealLine(
                        options.revealLine
                    );
                }
                if (options.highlightText) {
                    (newEditor as unknown as TextFileModel).setHighlightText(
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
                    newEditor.state.update((s) => {
                        s.editor = previewEditor;
                    });
                }
            }
        }

        this.model.onShow.send(page);
        this.model.onFocus.send(page);
        this.model.persistence.saveState();
        return true;
    };

    // ── Closing ──────────────────────────────────────────────────────

    closeToTheRight = async (pageId: string) => {
        const { pages } = this.model.state.get();
        const pagesToClose = [];
        for (let i = pages.length - 1; i >= 0; i--) {
            if (pages[i].id === pageId) {
                break;
            }
            if (!pages[i].pinned) {
                pagesToClose.push(pages[i]);
            }
        }
        for (const page of pagesToClose) {
            const closed = await page.close();
            if (!closed) {
                break;
            }
        }
    };

    closeOtherPages = async (pageId: string) => {
        const { pages } = this.model.state.get();
        const pagesToClose = [];
        for (let i = pages.length - 1; i >= 0; i--) {
            if (pages[i].id !== pageId && !pages[i].pinned) {
                pagesToClose.push(pages[i]);
            }
        }
        for (const page of pagesToClose) {
            const closed = await page.close();
            if (!closed) {
                break;
            }
        }
    };

    // ── Multi-window operations ──────────────────────────────────────

    movePageIn = async (data?: {
        page: PageDescriptor;
        targetPageId: string | undefined;
    }) => {
        if (!data?.page) return;

        const desc = data.page;
        const page = new PageModel(desc.id);
        page.pinned = desc.pinned ?? false;

        // Restore editor if present
        if (desc.editor && Object.keys(desc.editor).length > 0) {
            const editor = await this.newEditorModelFromState(desc.editor);
            editor.applyRestoreData(desc.editor);
            await editor.restore();
            page.mainEditor = editor;
            editor.setPage(page);
        }

        // Restore sidebar from cache (keyed by page ID — saved before movePageOut)
        if (desc.hasSidebar) {
            await page.restoreSidebar();
            await page.restoreSecondaryEditors(page.mainEditor ?? null);
        }

        const targetIndex = data.targetPageId
            ? this.model.state.get().pages.findIndex((p) => p.id === data.targetPageId)
            : -1;

        if (targetIndex === -1) {
            this.addPage(page.mainEditor, page);
            this.model.closeFirstPageIfEmpty();
        } else {
            this.model.attachPage(page);
            this.model.state.update((s) => {
                s.pages.splice(targetIndex, 0, page);
                s.ordered.push(page);
            });
            this.model.layout.fixGrouping();
            this.model.persistence.saveStateDebounced();
        }
    };

    movePageOut = async (pageId?: string) => {
        const page = this.model.query.findPage(pageId);
        if (!page) return;

        await page.saveState();
        const closeWindow = this.model.state.get().pages.length === 1;

        if (closeWindow) {
            this.model.state.update((s) => {
                s.pages = s.pages.filter((p) => p !== page);
                s.ordered = s.ordered.filter((p) => p !== page);
            });
            this.model.persistence.saveStateDebounced();
            api.closeWindow();
        } else {
            this.model.detachPage(page);
            this.model.removePage(page);
        }
    };

    // ── Duplication ──────────────────────────────────────────────────

    duplicatePage = async (pageId: string) => {
        const page = this.model.query.findPage(pageId);
        if (!page?.mainEditor) return;

        const editorData: Partial<IEditorState> = page.mainEditor.getRestoreData();
        editorData.id = crypto.randomUUID();
        const newEditor = await this.model.persistence.restoreModel(editorData);
        if (newEditor) {
            const newPage = this.addPage(newEditor);
            this.model.layout.groupTabs(pageId, newPage.id, false);
        }
    };

    // ── URL handling ─────────────────────────────────────────────────

    handleOpenUrl = async (url: string) => {
        const { app: appInstance } = await import("../app");
        const { RawLinkEvent } = await import("../events/events");
        await appInstance.events.openRawLink.sendAsync(new RawLinkEvent(url));
    };

    handleExternalUrl = async (url: string) => {
        const { app: appInstance } = await import("../app");
        const { RawLinkEvent } = await import("../events/events");
        await appInstance.events.openRawLink.sendAsync(new RawLinkEvent(url));
    };

    openPathInNewWindow = (filePath: string) => {
        if (!filePath) return;
        api.openNewWindow(filePath);
    };

    // ── Grouped text helper ──────────────────────────────────────────

    requireGroupedText = (
        pageId: string,
        suggestedLanguage?: string
    ): TextFileModel => {
        let groupedPage = this.model.query.getGroupedPage(pageId);
        if (groupedPage && groupedPage.mainEditor?.type !== "textFile") {
            this.model.layout.ungroup(pageId);
            groupedPage = undefined;
        }

        if (!groupedPage) {
            groupedPage = this.addEmptyPage();
            this.model.layout.groupTabs(
                pageId,
                groupedPage.id,
                false
            );
            groupedPage.mainEditor?.changeLanguage(suggestedLanguage);
        }

        return groupedPage.mainEditor as unknown as TextFileModel;
    };

    // ── Page-actions (from old page-actions.ts) ──────────────────────

    showAboutPage = async (): Promise<void> => {
        const aboutModule = await import("../../editors/about/AboutPage");
        const model = await aboutModule.default.newEmptyEditorModel("aboutPage");
        if (model) {
            const page = new PageModel(aboutModule.ABOUT_PAGE_ID);
            this.addPage(model, page);
        }
    };

    showSettingsPage = async (): Promise<void> => {
        const settingsModule = await import(
            "../../editors/settings/SettingsPage"
        );
        const model =
            await settingsModule.default.newEmptyEditorModel("settingsPage");
        if (model) {
            const page = new PageModel(settingsModule.SETTINGS_PAGE_ID);
            this.addPage(model, page);
        }
    };

    showBrowserPage = async (options?: {
        profileName?: string;
        incognito?: boolean;
        tor?: boolean;
        url?: string;
    }): Promise<void> => {
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
            "../../editors/browser/BrowserEditorView"
        );
        const model =
            await browserModule.default.newEmptyEditorModel("browserPage");
        if (model) {
            if (options?.profileName || options?.incognito || options?.tor) {
                model.state.update((s: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                    if (options.profileName) s.profileName = options.profileName;
                    if (options.incognito) s.isIncognito = true;
                    if (options.tor) s.isTor = true;
                });
            }
            if (options?.url) {
                model.state.update((s: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
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

            if (options?.tor) {
                (model as any).initTorProxy(); // eslint-disable-line @typescript-eslint/no-explicit-any
            }
        }
    };

    showMcpInspectorPage = async (options?: { url?: string }): Promise<void> => {
        const mcpModule = await import(
            "../../editors/mcp-inspector/McpInspectorView"
        );
        const model =
            await mcpModule.default.newEmptyEditorModel("mcpInspectorPage");
        if (model) {
            if (options?.url) {
                model.state.update((s: any) => { s.url = options.url; }); // eslint-disable-line @typescript-eslint/no-explicit-any
            }
            this.addPage(model);
        }
    };

    openImageInNewTab = async (imageUrl: string): Promise<void> => {
        const imgModule = await import("../../editors/image/ImageViewer");
        const imgModel =
            await imgModule.default.newEmptyEditorModel("imageFile");
        if (imgModel) {
            imgModel.state.update(
                (s: { title: string; url?: string }) => {
                    s.title =
                        imageUrl.split("/").pop()?.split("?")[0] || "Image";
                    s.url = imageUrl;
                }
            );
            if (/^https?:\/\//i.test(imageUrl)) {
                imgModel.pipe = new ContentPipe(new HttpProvider(imageUrl));
            }
            await imgModel.restore();
            this.addPage(imgModel);

            if (imageUrl.startsWith("blob:") && imgModel instanceof imgModule.ImageEditorModel) {
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

        const matchesBrowser = (page: PageModel) => {
            const editor = page.mainEditor;
            if (!editor) return false;
            const pageState = editor.state.get() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
                !pageState.isTor &&
                (targetProfile === undefined ||
                    (pageState.profileName ?? "") === targetProfile)
            );
        };

        const addTabToPage = (index: number) => {
            const page = pages[index];
            const editor = page.mainEditor as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            const tabs = editor?.state.get().tabs;
            if (tabs?.length === 1 && tabs[0].url === "about:blank") {
                editor.navigate(url);
            } else {
                editor.addTab(url);
            }
            this.model.navigation.showPage(page.id);
        };

        if (options?.external) {
            if (activeIndex >= 0 && matchesBrowser(pages[activeIndex])) {
                addTabToPage(activeIndex);
                return;
            }
            for (let i = 0; i < pages.length; i++) {
                if (matchesBrowser(pages[i])) {
                    addTabToPage(i);
                    return;
                }
            }
        } else {
            if (activeIndex >= 0 && matchesBrowser(pages[activeIndex])) {
                addTabToPage(activeIndex);
                return;
            }
            for (let i = activeIndex + 1; i < pages.length; i++) {
                if (matchesBrowser(pages[i])) {
                    addTabToPage(i);
                    return;
                }
            }
            for (let i = activeIndex - 1; i >= 0; i--) {
                if (matchesBrowser(pages[i])) {
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
