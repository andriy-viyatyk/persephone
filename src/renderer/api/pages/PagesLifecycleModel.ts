import type { PagesModel } from "./PagesModel";
import { EditorModel } from "../../editors/base";
import { EditorView, PageDescriptor } from "../../../shared/types";
import { t } from "../../../shared/i18n/t";
import { cleanForStorage } from "../../../shared/link-data";
import type { ILinkData } from "../../../shared/link-data";
import type { ILinkDiffRevision } from "../types/io.link-data";
import { newTextFileModel } from "../../editors/text";
import { ExplorerEditor, getDefaultExplorerEditorState } from "../../editors/explorer";
import { TComponentState } from "../../core/state/state";
import { api } from "../../../ipc/renderer/api";
import { recent } from "../recent";
import { editorRegistry, isExplicitHostTarget } from "../../editors/base/editorRegistry";
import { PageModel } from "./PageModel";
import { navigatePageTo, type NavigatePageToOptions } from "./PageNavigator";
import { guard } from "../../core/utils/guard";
import { errMessage } from "../../../shared/utils";
import { RestoreFailedEditor } from "../../editors/restore-failed/RestoreFailedEditor";
import { fpBasename } from "../../core/utils/file-path";

import type { ILink } from "../../api/types/io.tree";
import { buildLinkEditorContent } from "../../editors/link-editor/link-open";
import type { IContentPipe } from "../../api/types/io.pipe";
import { pipeFromPersistedSource, pipeFromSourcePath } from "../../content/rebuild-pipe";
import { openImageForEdit } from "../capability-feedback";
import {
    attachEditorToPage,
    constructEditorFromFile,
    createEditorFromFile,
    createEditorFromFolder,
} from "../../editors/editor-factory";

export interface OpenFileOptions {
    sourceLink?: ILinkData;
    target?: string;
    folderPath?: string;
    diffFrom?: ILinkDiffRevision;
    diffTo?: ILinkDiffRevision;
    revealLine?: number;
    highlightText?: string;
    fragment?: string;
    onPageCreated?: (page: PageModel) => void;
    sessionHandle?: string;
}

export type OpenInterceptorOutcome<TOptions> =
    | { kind: "take"; page: PageModel }
    | { kind: "continue"; options?: TOptions };

export interface PageOpenInterceptor {
    onOpenFile?(request: {
        filePath?: string;
        pipe?: IContentPipe;
        options?: OpenFileOptions;
    }): Promise<OpenInterceptorOutcome<OpenFileOptions>>;
    onNavigatePageTo?(request: {
        pageId: string;
        newFilePath: string;
        options?: NavigatePageToOptions;
    }): Promise<OpenInterceptorOutcome<NavigatePageToOptions>>;
}

export class PagesLifecycleModel {
    private readonly openInterceptors: PageOpenInterceptor[] = [];

    constructor(private model: PagesModel) {}

    registerOpenInterceptor(interceptor: PageOpenInterceptor): () => void {
        this.openInterceptors.push(interceptor);
        return () => {
            const index = this.openInterceptors.indexOf(interceptor);
            if (index !== -1) this.openInterceptors.splice(index, 1);
        };
    }

    private async interceptOpenFile(request: {
        filePath?: string;
        pipe?: IContentPipe;
        options?: OpenFileOptions;
    }): Promise<OpenInterceptorOutcome<OpenFileOptions>> {
        let options = request.options;
        for (const interceptor of this.openInterceptors) {
            if (!interceptor.onOpenFile) continue;
            const outcome = await interceptor.onOpenFile({ ...request, options });
            if (outcome.kind === "take") return outcome;
            options = outcome.options ?? options;
        }
        return { kind: "continue", options };
    }

    private async interceptNavigatePageTo(request: {
        pageId: string;
        newFilePath: string;
        options?: NavigatePageToOptions;
    }): Promise<OpenInterceptorOutcome<NavigatePageToOptions>> {
        let options = request.options;
        for (const interceptor of this.openInterceptors) {
            if (!interceptor.onNavigatePageTo) continue;
            const outcome = await interceptor.onNavigatePageTo({ ...request, options });
            if (outcome.kind === "take") return outcome;
            options = outcome.options ?? options;
        }
        return { kind: "continue", options };
    }

    // ── Pipe helpers ──────────────────────────────────────────────────

    // Core page operations

    /**
     * Add an editor to the page collection.
     *
     * @param editor — the EditorModel to add (null for empty pages with sidebar only)
     * @param existingPage — optional pre-created PageModel
     */
    addPage = (
        editor: EditorModel | null,
        existingPage?: PageModel,
        onPageCreated?: (page: PageModel) => void,
    ): PageModel => {
        const page = existingPage ?? new PageModel();
        if (editor && !page.mainEditor) {
            page.attach(editor);
            page.setMainEditorId(editor.id);
        }

        // Callbacks can inspect the attached editor identity synchronously. Content-dependent
        // callback work must await page.ready when an editor opted into deferred restore.
        onPageCreated?.(page);

        const existingById = this.model.query.findPage(page.id);
        if (existingById) {
            this.model.navigation.showPage(existingById.id);
            return existingById;
        }

        this.model.attachPage(page);

        this.model.insertPage(page);
        this.model.persistence.saveState();

        return page;
    };

    retryPageRestore = async (
        page: PageModel,
        options?: {
            filePath?: string;
            target?: string;
            sourceLink?: ILinkData;
            sessionHandle?: string;
        },
    ): Promise<void> => {
        if (page.retainedDescriptor) return;
        const failedEditor = page.mainEditorInstance;
        const filePath = options?.filePath ?? failedEditor?.filePath;
        const host = failedEditor?.contentHost;
        const sourceLink = options?.sourceLink
            ?? host?.state.get().sourceLink as ILinkData | undefined
            ?? failedEditor?.state.get().sourceLink as ILinkData | undefined;
        const target = options?.target ?? failedEditor?.editorId;
        const title = failedEditor?.title;
        if (failedEditor) {
            page.detach(failedEditor);
            await failedEditor.dispose();
        }
        await page.setMainEditor(null);

        try {
            const retrySource = sourceLink?.pipeDescriptor && options?.sessionHandle
                ? {
                    ...sourceLink,
                    pipeDescriptor: {
                        ...sourceLink.pipeDescriptor,
                        provider: {
                            ...sourceLink.pipeDescriptor.provider,
                            config: {
                                ...sourceLink.pipeDescriptor.provider.config,
                                sessionHandle: options.sessionHandle,
                            },
                        },
                    },
                }
                : sourceLink;
            const pipe = await pipeFromPersistedSource(retrySource, filePath, {
                unknownScheme: "file",
                sessionHandle: options?.sessionHandle,
            });
            const editorOrHost = await constructEditorFromFile(filePath ?? "", pipe, target, title);
            if (sourceLink) editorOrHost.state.update((state) => { state.sourceLink = sourceLink; });
            const editor = attachEditorToPage(editorOrHost);
            await page.setMainEditor(editor);
            page.startRestore((signal) => editor.restore({ signal }));
            const applyHints = page.getTransient<() => void>("applyOpenHints");
            if (applyHints) void page.ready.then(applyHints, (): void => {});
        } catch (error) {
            page.startRestore(async () => { throw error; });
        }
    };

    addEmptyPage = (): PageModel => {
        const emptyFile = newTextFileModel("");
        emptyFile.restore();
        return this.addPage(attachEditorToPage(emptyFile));
    };

    addEmptyPageWithNavPanel = async (folderPath: string): Promise<PageModel> => {
        const page = new PageModel();
        const state = new TComponentState({
            ...getDefaultExplorerEditorState(),
            rootPath: folderPath,
        });
        const explorer = new ExplorerEditor(state);
        page.attach(explorer);
        await explorer.restore();
        page.ensureSecondaryViewsModel();
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
                `addEditorPage() expects positional arguments: (editor, language, title, content?). Got ${typeof editor} for editor. Example: addEditorPage("monaco", "plaintext", "My Page", "content")`,
            );
        }
        editorRegistry.assertKnownLanguage(language);
        const editorDef = editorRegistry.getById(editor);
        if (!editorDef && editor !== "monaco") {
            throw new Error(
                `Editor '${editor}' is not registered. Available editors: ${editorRegistry.getAll().map((e) => e.id).join(", ")}`,
            );
        }
        if (editorDef && !editorDef.hasContentHost) {
            throw new Error(
                `Cannot create '${editor}' with addEditorPage() — it is a standalone editor that requires a specialized model. Use the dedicated method instead (e.g., showBrowserPage(), showAboutPage(), openFile()).`,
            );
        }
        const editorModel = newTextFileModel("");
        editorModel.state.update((s) => {
            s.title = title;
            s.language = language;
            s.editor = editorRegistry.validateForLanguage(editor, language) as EditorView;
        });
        if (content) {
            editorModel.changeContent(content);
        }
        editorModel.restore();
        return this.addPage(attachEditorToPage(editorModel));
    };

    addDrawPage = async (dataUrl: string, title?: string): Promise<PageModel> => {
        const { pageId } = await openImageForEdit({ dataUrl, title: title ?? "untitled" });
        const page = this.model.query.findPage(pageId);
        if (!page) throw new Error(`Drawing page was not found after opening: ${pageId}`);
        return page;
    };

    openLinks = (
        links: (ILink | string)[],
        title?: string,
    ): PageModel => {
        const { title: normalizedTitle, content } = buildLinkEditorContent(links, title);

        const editorModel = newTextFileModel("");
        editorModel.state.update((s) => {
            s.title = normalizedTitle;
            s.language = "json";
            s.editor = editorRegistry.validateForLanguage("link-view", "json") as EditorView;
        });
        editorModel.restore();
        editorModel.changeContent(content);

        const page = new PageModel();
        const adapter = attachEditorToPage(editorModel);
        adapter.secondaryView = ["link-category"];
        page.addSecondaryView(adapter);
        page.ensureSecondaryViewsModel();
        page.expandPanel("link-category");

        this.addPage(null, page);
        this.model.closeFirstPageIfEmpty();
        return page;
    };

    // ── File opening ─────────────────────────────────────────────────

    openFile = async (
        filePath?: string,
        pipe?: IContentPipe,
        options?: OpenFileOptions,
    ): Promise<PageModel | undefined> => {
        if (!filePath && options?.folderPath === undefined) return undefined;
        const intercepted = await this.interceptOpenFile({ filePath, pipe, options });
        if (intercepted.kind === "take") return intercepted.page;
        options = intercepted.options ?? options;
        // Existing-page dedupe is deliberately left intact: an already-
        // open file just activates its page and the diff metadata is dropped.
        // "Open in new Tab" preselection therefore applies only on a fresh open.
        const existingPage = filePath
            ? this.model.query.findPageByFilePath(filePath)
            : undefined;
        if (existingPage) {
            this.model.navigation.showPage(existingPage.id);
            if (existingPage.state.get().restoreStatus !== "ready") {
                pipe?.dispose();
            } else {
                const adopted = existingPage.mainEditorInstance?.onReopen?.(pipe) === true;
                if (!adopted) pipe?.dispose();
            }
            // The document is already open — an anchor link into it is still a jump
            // request, so honor the fragment on the live editor.
            if (options?.fragment) {
                const reveal: () => void = () => existingPage.mainEditorInstance?.revealFragment?.(options.fragment as string);
                if (existingPage.isRestoring) void existingPage.ready.then(reveal, (): void => {});
                else reveal();
            }
            if (options?.revealLine || options?.highlightText) {
                await navigatePageTo(this.model, existingPage.id, filePath as string, {
                    revealLine: options.revealLine,
                    highlightText: options.highlightText,
                    forceTextEditor: true,
                });
            }
            return existingPage;
        }

        const requestedTarget = options?.revealLine || options?.highlightText
            ? "monaco"
            : options?.target;

        // A failed editor-module load rejects out of the editor factory's `createEditorFromFile`, and every
        // caller here reaches it from a user action (explorer click, link, drop). Left
        // unguarded the rejection escaped into an un-awaited promise and the click did
        // nothing at all — shape, one path over. `undefined` is already this
        // method's "did not open" answer, so no caller changes.
        const editor = await guard(
            t("api.failedToOpenNamedFile", { name: fpBasename(filePath ?? options?.folderPath ?? "folder") }),
            async () => {
                if (options?.folderPath !== undefined) {
                    return createEditorFromFolder(options.target ?? "", options.folderPath);
                }
                const constructed = await constructEditorFromFile(
                    filePath as string,
                    pipe,
                    requestedTarget,
                    options?.sourceLink?.title,
                );
                // TextFileModel is adapted into a TextHostEditorModel below; its file-open path
                // opts in there. Every standalone model preserves restore-before-add and the
                // guard's existing user-facing error handling.
                const defersRestore = constructed instanceof EditorModel
                    ? constructed.deferRestoreOnOpen
                    : true;
                if (!defersRestore) await constructed.restore();
                return constructed;
            },
        );
        if (!editor) {
            // The factory's `createEditorFromFile` assigns the pipe to the editor it builds; that
            // editor is being discarded, so the pipe would otherwise leak.
            pipe?.dispose();
            return undefined;
        }
        if (options?.folderPath !== undefined) pipe?.dispose();
        if (options?.sourceLink) {
            const sourceLink = cleanForStorage({
                ...options.sourceLink,
                pipeDescriptor: options.sourceLink.pipeDescriptor ?? pipe?.toDescriptor(),
            });
            editor.state.update((s) => { s.sourceLink = sourceLink; });
        }
        // Honor an explicit content-host target (e.g. "file-diff") that isn't the
        // file's natural editor, so a new-tab open lands on the requested editor —
        // mirrors navigatePageTo's isExplicitHostTarget handling.
        const explicitTarget = requestedTarget;
        if (
            editor.state.get().type === "textFile" &&
            filePath !== undefined && isExplicitHostTarget(explicitTarget, filePath)
        ) {
            editor.state.update((s) => { s.editor = explicitTarget as EditorView; });
        }
        const adapter = attachEditorToPage(editor);
        if (options?.sessionHandle) {
            const sourceUrl = options.sourceLink?.url ?? filePath;
            if (sourceUrl) {
                adapter.acceptOpenContext?.({
                    mode: "register-session",
                    sourceUrl,
                    sessionHandle: options.sessionHandle,
                });
            }
        }
        const page = adapter.deferRestoreOnOpen ? new PageModel() : undefined;
        if (page && adapter.deferRestoreOnOpen) {
            // Start the attempt synchronously so the inserted page is never rendered as an editor
            // before PageContentView observes its loading shell state. The async restore body runs
            // in the next microtask, after addPage attaches the editor and inserts the page.
            const retryOptions = {
                filePath,
                target: requestedTarget,
                sourceLink: editor.state.get().sourceLink as ILinkData | undefined,
                sessionHandle: options?.sessionHandle,
            };
            page.startRestore((signal) => adapter.restore({ signal }));
            page.setTransient("retryRestore", () => this.retryPageRestore(page, retryOptions));
        }
        const addedPage = this.addPage(adapter, page, options?.onPageCreated);
        const currentPage = addedPage;
        // Apply caller-chosen diff revisions to a freshly-built File Diff editor
        // (no-op for any other editor type / when no revisions given).
        const applyOpenHints = (): void => {
            if (this.model.query.findPage(currentPage.id) !== currentPage) return;
            const currentEditor = currentPage.mainEditorInstance;
            if (!currentEditor) return;
            (currentEditor as { applyDiffRevisions?: (f?: ILinkDiffRevision, t?: ILinkDiffRevision) => void })
                .applyDiffRevisions?.(options?.diffFrom, options?.diffTo);
            // The editor's view may not be mounted yet; implementations queue the anchor request.
            if (options?.fragment) currentEditor.revealFragment?.(options.fragment);
            const textHost = currentEditor.contentHost;
            if (options?.revealLine) textHost?.revealLine(options.revealLine);
            if (options?.highlightText) textHost?.setHighlightText(options.highlightText);
            // A preselected comparison is a File Diff; expand its registered first panel instead
            // of hardcoding the panel id here.
            if (options?.diffFrom || options?.diffTo) {
                const panelId = currentEditor.secondaryView?.[0];
                if (panelId) currentPage.expandPanel(panelId);
            }
        };
        if (adapter.deferRestoreOnOpen) {
            currentPage.setTransient("applyOpenHints", applyOpenHints);
            void currentPage.ready.then(applyOpenHints, (): void => {});
        }
        else applyOpenHints();
        if (filePath) recent.add(filePath);

        this.model.closeFirstPageIfEmpty();
        return currentPage;
    };

    closePage = async (pageId: string): Promise<boolean> => {
        const page = this.model.query.findPage(pageId);
        if (!page) return false;
        return await page.close();
    };

    /**
     * Open two files side-by-side in compare mode by grouping the pages and
     * entering compare mode.
     */
    openDiff = async (
        params: { firstPath: string; secondPath: string } | undefined,
    ) => {
        if (!params) return;
        const { firstPath, secondPath } = params;
        if (!firstPath || !secondPath) return;
        let existingFirst = this.model.query.findPageByFilePath(firstPath);
        let existingSecond = this.model.query.findPageByFilePath(secondPath);

        // Either side can fail to build; report and abort rather than grouping a
        // half-built comparison state.
        if (!existingFirst) {
            const pipe = await pipeFromSourcePath(firstPath);
            const editor = await guard(t("api.failedToOpenNamedFile", { name: fpBasename(firstPath) }), () =>
                createEditorFromFile(firstPath, pipe));
            if (!editor) { pipe?.dispose(); return; }
            existingFirst = this.addPage(attachEditorToPage(editor));
        }
        if (!existingSecond) {
            const pipe = await pipeFromSourcePath(secondPath);
            const editor = await guard(t("api.failedToOpenNamedFile", { name: fpBasename(secondPath) }), () =>
                createEditorFromFile(secondPath, pipe));
            if (!editor) { pipe?.dispose(); return; }
            existingSecond = this.addPage(attachEditorToPage(editor));
        }

        this.model.layout.groupTabs(existingFirst.id, existingSecond.id, true);
        this.model.layout.enterCompareMode(existingFirst.id);
        this.model.navigation.showPage(existingFirst.id);
    };

    // ── Navigation within a page ─────────────────────────────────────

    /** Delegates to the named-steps implementation in ./PageNavigator.ts. */
    navigatePageTo = async (
        pageId: string,
        newFilePath: string,
        options?: NavigatePageToOptions,
    ): Promise<boolean> => {
        const intercepted = await this.interceptNavigatePageTo({ pageId, newFilePath, options });
        if (intercepted.kind === "take") return true;
        return navigatePageTo(this.model, pageId, newFilePath, intercepted.options ?? options);
    }

    // ── Closing ──────────────────────────────────────────────────────

    private closePages = async (predicate: (page: PageModel, index: number) => boolean) => {
        const { pages } = this.model.state.get();
        const pagesToClose = pages.filter(predicate).reverse();
        for (const page of pagesToClose) {
            if (!(await page.close())) break;
        }
    };

    closeToTheRight = async (pageId: string) => {
        const { pages } = this.model.state.get();
        const anchorIndex = pages.findIndex((page) => page.id === pageId);
        return this.closePages((page, index) =>
            index > anchorIndex && !page.isLockedBoardPage && page.pinSide === undefined,
        );
    };

    closeOtherPages = async (pageId: string) => this.closePages((page) =>
        page.id !== pageId && !page.isLockedBoardPage && page.pinSide === undefined,
    );

    // ── Multi-window operations ──────────────────────────────────────

    retryRestore = async (pageId: string): Promise<void> => {
        const placeholder = this.model.query.findPage(pageId);
        const descriptor = placeholder?.retainedDescriptor;
        const editor = placeholder?.mainEditorInstance;
        if (!placeholder || !descriptor || !(editor instanceof RestoreFailedEditor) || editor.state.get().retrying || placeholder.recoveryInvalidated) return;
        editor.state.update((state) => { state.retrying = true; });
        const attempt = async (): Promise<void> => {
            try {
                const result = await this.model.persistence.constructPage(descriptor);
                if (result.kind !== "restored") {
                    editor.state.update((state) => {
                        state.error = result.kind === "failed"
                            ? errMessage(result.error, t("editors.restoreFailedTitle"))
                            : t("editors.restoreFailedTitle");
                    });
                    return;
                }
                const recovered = result.page;
                if (placeholder.recoveryInvalidated || this.model.query.findPage(pageId) !== placeholder) {
                    await recovered.dispose();
                    return;
                }
                const active = this.model.query.activePage === placeholder;
                this.model.detachPage(placeholder);
                this.model.attachPage(recovered);
                this.model.replacePage(placeholder, recovered);
                placeholder.releaseRecoveryProtection();
                placeholder.recoveryRetry = undefined;
                await placeholder.dispose();
                this.model.persistence.saveStateDebounced();
                if (active) {
                    this.model.onShow.send(recovered);
                    this.model.onFocus.send(recovered);
                }
            } catch (error) {
                editor.state.update((state) => { state.error = errMessage(error, t("editors.restoreFailedTitle")); });
            } finally {
                editor.state.update((state) => { state.retrying = false; });
            }
        };
        const promise = attempt();
        placeholder.recoveryRetry = promise;
        try { await promise; } finally { if (placeholder.recoveryRetry === promise) placeholder.recoveryRetry = undefined; }
    };

    movePageIn = async (data?: {
        page: PageDescriptor;
        targetPageId: string | undefined;
    }) => {
        if (!data?.page) return;
        if (data.page.pinSide === "right") {
            throw new Error("Right-pinned pages cannot be moved between windows.");
        }

        const page = await this.model.persistence.restorePage(data.page);
        if (!page) return;

        let targetIndex = data.targetPageId
            ? this.model.state.get().pages.findIndex((p) => p.id === data.targetPageId)
            : -1;
        if (targetIndex >= 0 && this.model.state.get().pages[targetIndex]?.isLockedBoardPage) targetIndex++;

        if (targetIndex === -1) {
            this.addPage(page.mainEditorInstance, page);
            this.model.closeFirstPageIfEmpty();
        } else {
            this.model.attachPage(page);
            const insertionIndex = Math.min(
                targetIndex,
                this.model.query.getFirstRightPinnedIndex(),
            );
            this.model.insertPage(page, { at: insertionIndex });
            this.model.layout.fixGrouping();
            this.model.persistence.saveStateDebounced();
        }
    };

    movePageOut = async (pageId?: string) => {
        const page = this.model.query.findPage(pageId);
        if (!page) return;
        if (page.isLockedBoardPage) return;
        // Recovery descriptors own cache protection in this renderer. Until the
        // destination acknowledges ownership, transferring one could expose its
        // cache to source-window cleanup.
        if (page.retainedDescriptor) return;
        if (this.model.popoverPageId === page.id) this.model.closePopover();
        if (this.model.query.isRightPinned(page.id)) {
            throw new Error("Right-pinned pages cannot be moved between windows.");
        }

        await page.saveState();
        const closeWindow = this.model.state.get().pages.length === 1;

        if (closeWindow) {
            this.model.removePage(page, { save: "debounced", ensureActivePage: false });
            api.closeWindow();
        } else {
            this.model.detachPage(page);
            this.model.removePage(page);
            // Keep-alive editors (busy Board) never transfer their
            // processes to the target window: the page is re-created there from
            // its descriptor, so the source-side model would otherwise leak —
            // and with it the jobs main keeps alive for it. Dispose them here
            // (reaps the jobs); a cross-window move thus KILLS a busy board's
            // processes — the documented limitation. (The closeWindow branch
            // needs no equivalent: the dying webContents triggers main's
            // reapHost backstop.)
            for (const editor of [...page.editors]) {
                if (editor.keepAliveOnNavigation()) void editor.dispose();
            }
            this.model.checkEmptyPage();
        }
    };

    // ── Duplication ──────────────────────────────────────────────────

    /**
     * Build a fresh-id descriptor before routing through `restorePage` for
     * symmetric construction.
     */
    duplicatePage = async (pageId: string) => {
        const page = this.model.query.findPage(pageId);
        if (page && this.model.query.isRightPinned(page.id)) {
            throw new Error("Right-pinned pages cannot be duplicated.");
        }
        if (!page?.mainEditor || page.retainedDescriptor) return;

        const sourceDesc = page.getDescriptor();
        // Fresh ids: page + each editor. Re-point mainEditorId to the new editor id.
        const editorsWithFreshIds = sourceDesc.editors.map((e) => ({
            ...e,
            id: crypto.randomUUID(),
        }));
        const oldMainIndex = sourceDesc.editors.findIndex(
            (e) => e.id === sourceDesc.mainEditorId,
        );
        const newMainEditorId = oldMainIndex >= 0
            ? editorsWithFreshIds[oldMainIndex].id
            : null;

        const desc: PageDescriptor = {
            id: crypto.randomUUID(),
            pinned: false,
            pinSide: undefined,
            modified: sourceDesc.modified,
            mainEditorId: newMainEditorId,
            editors: editorsWithFreshIds,
            sidebar: undefined,
        };

        const newPage = await this.model.persistence.restorePage(desc, {
            seedSecondaryViewsWidth: true,
        });
        if (newPage) {
            this.model.attachPage(newPage);
            this.model.insertPage(newPage);
            this.model.layout.groupTabs(pageId, newPage.id, false);
        }
    };

    // ── URL handling ─────────────────────────────────────────────────

    openPathInNewWindow = (filePath: string) => {
        if (!filePath) return;
        api.openNewWindow(filePath);
    };

    // ── Grouped text helper ──────────────────────────────────────────

}
