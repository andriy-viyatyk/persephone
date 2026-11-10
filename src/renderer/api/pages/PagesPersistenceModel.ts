import type { PagesModel } from "./PagesModel";
import { IEditorState } from "../../../shared/types";
import type {
    PageDescriptor,
    WindowState,
} from "../../../shared/persistence";
import { openFilesNameTemplate } from "../../../shared/constants";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce, errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { editorRegistry } from "../../editors/base/editorRegistry";
import type { EditorModel } from "../../editors/base/EditorModel";
import { RestoreFailedEditor } from "../../editors/restore-failed/RestoreFailedEditor";
import {
    ExplorerEditor,
    getDefaultExplorerEditorState,
    type ExplorerEditorState,
} from "../../editors/explorer";
import { TComponentState } from "../../core/state/state";
import { appWindow } from "../window";
import { fs as appFs } from "../fs";
import { panelKey, parsePanelKey } from "../../ui/secondary-views/panel-key";
import type { BoardEditorState } from "../../editors/board";
import {
    customEditorRegistry,
    resolveBoardEditorId,
} from "../boards/custom-editor-registry";
import { bundledBoardRegistry } from "../boards/bundled-board-registry";
import {
    decodePersephoneBoardLink,
    encodePersephoneBoardLink,
} from "../../content/persephone-board-link";
import { fpBasename } from "../../core/utils/file-path";
import { BoardRoot } from "../../../shared/board/board-root";
import { PageModel } from "./PageModel";
import { BOARD_INFO_EDITOR_ID } from "../../editors/board-info/board-info-id";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function repairBoardLink(value: unknown): Promise<unknown> {
    if (typeof value !== "string") return value;
    const decoded = decodePersephoneBoardLink(value);
    if (!decoded) return value;

    const currentRoot = await bundledBoardRegistry.resolvePersistedRoot(decoded.boardRoot);
    return currentRoot === undefined ? value : encodePersephoneBoardLink(currentRoot);
}

async function normalizeEditorDescriptor(
    descriptor: PageDescriptor["editors"][number],
): Promise<PageDescriptor["editors"][number]> {
    const state = { ...descriptor.state };
    const persistedBoardRoot = typeof state.boardRoot === "string"
        ? state.boardRoot
        : undefined;
    const currentBoardRoot = persistedBoardRoot === undefined
        ? undefined
        : await bundledBoardRegistry.resolvePersistedRoot(persistedBoardRoot);
    if (currentBoardRoot !== undefined) state.boardRoot = currentBoardRoot;

    const sourceLink = state.sourceLink;
    if (isRecord(sourceLink)) {
        const normalizedSourceLink = { ...sourceLink };
        if ("href" in sourceLink) {
            normalizedSourceLink.href = await repairBoardLink(sourceLink.href);
        }
        if ("url" in sourceLink) {
            normalizedSourceLink.url = await repairBoardLink(sourceLink.url);
        }
        state.sourceLink = normalizedSourceLink;
    }

    if (typeof state.editor === "string") {
        state.editor = await resolveBoardEditorId(state.editor);
    }

    let editorId = await resolveBoardEditorId(descriptor.editorId);
    if (descriptor.editorId === "draw-view") {
        await bundledBoardRegistry.ensureInitialized();
        const excalidrawBoard = bundledBoardRegistry.list().find(
            (board) => board.id === "excalidraw",
        );
        const association = excalidrawBoard
            ? excalidrawBoard.manifest.association
            : undefined;
        if (excalidrawBoard && association?.editorKind === "content-host") {
            // `BoardEditorModel.restore()` does NOT re-derive the selection from `boardRoot` —
            // `refreshBoards()` only ever CLEARS it — and `BoardEditorView` renders the
            // not-found branch whenever `selectedBoard` is unset. So a descriptor carrying only
            // `boardRoot` restores as an empty "board not found" tab holding the user's drawing.
            // Seed exactly what `selectBoard()` writes on the live path: the board folder name,
            // in `selectedBoard` (renders) and `iconKey` (tab icon).
            const boardName = fpBasename(excalidrawBoard.root);
            editorId = "board-view";
            state.boardRoot = excalidrawBoard.root;
            state.selectedBoard = boardName;
            state.iconKey = boardName;
        }
    }

    return {
        ...descriptor,
        editorId,
        state,
    };
}

async function normalizePageDescriptor(desc: PageDescriptor): Promise<PageDescriptor> {
    return {
        ...desc,
        editors: await Promise.all(desc.editors.map(normalizeEditorDescriptor)),
        navBack: desc.navBack
            ? await Promise.all(desc.navBack.map(async (entry) => ({
                ...entry,
                href: String(await repairBoardLink(entry.href)),
            })))
            : undefined,
    };
}

function sameBoardRoot(left: string, right: string): boolean {
    return BoardRoot.from(left).equals(right);
}

/**
 * EditorIds of NO-HOST editors that restore via
 * `editorRegistry.createEditor` + `Object.assign(state, d.state)` (no host
 * descriptor). Editors with a host take the `if (d.host)` branch; Explorer
 * is constructed directly (not in `editorRegistry`).
 */
const NO_HOST_EDITOR_IDS = new Set([
    "browser-view",       "image-view",       "archive-view",       "video-view",         "settings-view",      "about-view",         "mcp-view",           "mneme-config",       "mneme-root",         "storybook-view",     "category-view",      "git-tree",           "board-view",         "toolset-view",       "tools-hub-view",  ]);

type RestoreAttempt = { kind: "restored"; page: PageModel } | { kind: "invalid" } | { kind: "failed"; error: unknown };

export class PagesPersistenceModel {
    constructor(private model: PagesModel) {}

    /**
     * False until `restoreState()` has finished. Restore attaches pages one at a
     * time — and `attachPage` subscribes each one to `saveStateDebounced` — so
     * until the final `state.update` commits, a save would serialise an empty or
     * partial page list over the real session.
     *
     * The flag tracks *restore in progress* and nothing else. A descriptor that
     * fails to restore is an expected outcome (a `schemaVersion` bump discards
     * every page by design), and persistence must keep working afterwards, so
     * nothing in `restorePage`/`applyState` may clear it and `init()` sets it in
     * a `finally`.
     */
    private restored = false;

    saveState = async (): Promise<void> => {
        if (!this.restored || appWindow.isBoardMode) return;

        const { pages, leftRight } = this.model.state.get();
        const pageDescriptors: PageDescriptor[] = pages.map((p) => p.getDescriptor());
        const storedState: WindowState = {
            schemaVersion: 4,
            pages: pageDescriptors,
            groupings: Array.from(leftRight.entries()),
            activePageId: this.model.query.activePage?.id,
        };

        await appFs.saveDataFile(
            openFilesNameTemplate,
            JSON.stringify(storedState, null, 4),
        );
    };

    // The `canRun` gate re-schedules rather than drops, so a save suppressed
    // during restore still runs once restore completes.
    saveStateDebounced = debounce(this.saveState, 500, () => this.restored);

    restoreState = async () => {
        if (appWindow.isBoardMode) return;
        const data = parseObject(
            await appFs.getDataFile(openFilesNameTemplate),
        ) as Partial<WindowState> | undefined;
        if (!data || !Array.isArray(data.pages)) return;
        if (data.schemaVersion !== 4) return;
        await this.applyState(data as WindowState);
    };

    createRestoreFailedPage = (descriptor: PageDescriptor, error: unknown): PageModel => {
        const page = new PageModel(descriptor.id);
        page.pinSide = descriptor.pinSide === "left" || descriptor.pinSide === "right" ? descriptor.pinSide : descriptor.pinned ? "left" : undefined;
        const main = descriptor.editors.find((editor) => editor.id === descriptor.mainEditorId);
        const candidate = main?.host?.state.title ?? main?.state.title;
        const title = typeof candidate === "string" && candidate ? candidate : t("editors.restoreFailedTitle");
        const originalIds = new Set(descriptor.editors.map((editor) => editor.id.toLowerCase()));
        let id = crypto.randomUUID();
        while (originalIds.has(id.toLowerCase())) id = crypto.randomUUID();
        const editor = new RestoreFailedEditor(id, title, errMessage(error, t("editors.restoreFailedTitle")));
        editor.retry = () => this.model.lifecycle.retryRestore(page.id);
        editor.closePage = () => page.close();
        page.attach(editor);
        page.mainEditor = editor;
        page.retainDescriptor(descriptor);
        return page;
    };

    restorePage = async (descriptor: PageDescriptor, options: { seedSecondaryViewsWidth?: boolean } = {}): Promise<PageModel | null> => {
        const ids = descriptor.editors.map((editor) => editor.id);
        appFs.protectCacheIds(ids);
        let transferred = false;
        try {
            const result = await this.constructPage(descriptor, options);
            if (result.kind === "restored") return result.page;
            if (result.kind === "invalid") return null;
            const page = this.createRestoreFailedPage(descriptor, result.error);
            transferred = true;
            return page;
        } finally {
            if (!transferred) appFs.releaseCacheIds(ids);
        }
    };

    constructPage = async (descriptor: PageDescriptor, options: { seedSecondaryViewsWidth?: boolean } = {}): Promise<RestoreAttempt> => {
        const constructed: EditorModel[] = [];
        let page: PageModel | undefined;
        let failure: unknown;
        let failed = false;
        try {
        const desc = await normalizePageDescriptor(descriptor);
        page = new PageModel(desc.id, {
            seedSecondaryViewsWidth: options.seedSecondaryViewsWidth ?? false,
        });
        page.pinSide = desc.pinSide === "left" || desc.pinSide === "right"
            ? desc.pinSide
            : desc.pinned ? "left" : undefined;
        // Pixel sizes only; a value of 1 or less is a fraction saved by an earlier build and is dropped.
        const popoverSize = desc.popoverSize;
        page.popoverSize = popoverSize
            && Number.isFinite(popoverSize.width)
            && Number.isFinite(popoverSize.height)
            && popoverSize.width > 1 && popoverSize.height > 1
            ? { width: popoverSize.width, height: popoverSize.height, ...(popoverSize.fullHeight === true ? { fullHeight: true } : {}) }
            : undefined;
        page.seedNavBack(desc.navBack);
        let invalidFolderBoard: { editorId: string; folderPath: string } | undefined;

        const editors = await Promise.all(
            desc.editors.map(async (d) => {
                try {
                    // A demoted busy Board persisted at shutdown must not resurrect
                    //: busy is transient (its processes died with the app),
                    // so a non-main board descriptor would restore as an invisible
                    // zombie handle. Boards restore only as the main editor.
                    if (d.editorId === "board-view" && d.id !== desc.mainEditorId) {
                        return null;
                    }
                    const boardState = d.state as Partial<BoardEditorState>;
                    const folderPath = boardState.folderPath;
                    const hasPersistedFolderClaim =
                        d.editorId === "board-view" && folderPath !== undefined;
                    if (hasPersistedFolderClaim && typeof folderPath === "string") {
                        invalidFolderBoard = { editorId: d.id, folderPath };
                        await customEditorRegistry.ensureInitialized();
                        const boardRoot = boardState.boardRoot;
                        const current = boardRoot && folderPath
                            ? customEditorRegistry.entries.find((entry) =>
                                sameBoardRoot(entry.boardRoot, boardRoot)
                                && customEditorRegistry.getBoardsForFolder(folderPath)
                                    .some((folderEntry) =>
                                        folderEntry.boardRoot === entry.boardRoot,
                                    ))
                            : undefined;
                        if (!current) return null;
                        invalidFolderBoard = undefined;
                    }
                    // Content-host board: persisted `board-view` + a host
                    // descriptor. Rebuild the subclass, apply the board state (boardRoot /
                    // filePath live in `d.state`, NOT the host descriptor), reconstruct the
                    // host from `d.host`, then restore. MUST precede the generic `if (d.host)`
                    // branch, which would else build a plain BoardEditorModel that throws
                    // "legacy project-mode board editor" on restore.
                    if (d.editorId === "board-view" && d.host && !hasPersistedFolderClaim) {
                        const { getDefaultBoardEditorState } = await import(
                            "../../editors/board"
                        );
                        const { BoardContentEditorModel } = await import(
                            "../../editors/board/BoardContentEditorModel"
                        );
                        const model = new BoardContentEditorModel(
                            new TComponentState({
                                ...getDefaultBoardEditorState(),
                                ...(d.state as Partial<BoardEditorState>),
                                id: d.id,
                            }),
                        );
                        constructed.push(model);
                        model.applyRestoreData(
                            d as unknown as Parameters<typeof model.applyRestoreData>[0],
                        );
                        await model.restore();
                        return model;
                    }
                    if (d.editorId === BOARD_INFO_EDITOR_ID) {
                        const { editorRegistry } = await import(
                            "../../editors/base"
                        );
                        const editor = await editorRegistry.createEditor(d.editorId, d.id);
                        constructed.push(editor);
                        editor.applyRestoreData(
                            d as unknown as Parameters<typeof editor.applyRestoreData>[0],
                        );
                        await editor.restore();
                        return editor;
                    }
                    if (d.editorId === "restore-failed") return null;
                    if (d.host && !editorRegistry.getById(d.editorId)) return null;
                    if (d.host) {
                        const { editorRegistry } = await import(
                            "../../editors/base"
                        );
                        const editor = await editorRegistry.createEditor(d.editorId, d.id);
                        constructed.push(editor);
                        editor.applyRestoreData(d as unknown as Parameters<typeof editor.applyRestoreData>[0]);
                        await editor.restore();
                        return editor;
                    }
                    if (
                        d.editorId === "explorer"
                        || (d.state as { type?: string }).type === "fileExplorer"
                    ) {
                        const explorerState = new TComponentState({
                            ...getDefaultExplorerEditorState(),
                            ...(d.state as Partial<ExplorerEditorState>),
                            id: d.id,
                        });
                        const explorer = new ExplorerEditor(explorerState);
                        constructed.push(explorer);
                        explorer.applyRestoreData(d.state as unknown as Parameters<typeof explorer.applyRestoreData>[0]);
                        await explorer.restore();
                        return explorer;
                    }
                    if (NO_HOST_EDITOR_IDS.has(d.editorId)) {
                        const { editorRegistry } = await import(
                            "../../editors/base"
                        );
                        const editor = await editorRegistry.createEditor(d.editorId, d.id);
                        constructed.push(editor);
                        editor.state.update((s) => {
                            Object.assign(s as object, d.state);
                            // Guarantee a non-empty id. A blank id (from a
                            // previously-corrupted descriptor) breaks id-based
                            // dedup and lets duplicate editors/panels accumulate
                            // This preserves the regression fix.
                            (s as { id: string }).id =
                                d.id || (s as { id?: string }).id || crypto.randomUUID();
                        });
                        editor.applyRestoreData(
                            d.state as unknown as Parameters<typeof editor.applyRestoreData>[0],
                        );
                        await editor.restore();
                        return editor;
                    }
                    console.warn(
                        `[restore] unrecognized editor descriptor for "${d.editorId}" in page ${desc.id}: ` +
                        `no host field, not in NO_HOST_EDITOR_IDS, not Explorer.`,
                    );
                    return null;
                } catch (err) {
                    console.warn(
                        `[restore] editor ${d.editorId} in page ${desc.id}:`,
                        err,
                    );
                    failed = true;
                    failure = err;
                    return null;
                }
            }),
        );

        if (failed) throw failure;
        for (const editor of editors) {
            if (editor) page.attach(editor);
        }

        if (invalidFolderBoard) {
            if (!page.findExplorer()) {
                const explorer = new ExplorerEditor(new TComponentState({
                    ...getDefaultExplorerEditorState(),
                    rootPath: invalidFolderBoard.folderPath,
                }));
                constructed.push(explorer);
                page.attach(explorer);
                await explorer.restore();
            }

            const { editorRegistry } = await import("../../editors/base/editorRegistry");
            const { buildFolderCategoryLink, CategoryEditorModel } = await import(
                "../../editors/category/CategoryEditorModel"
            );
            const category = await editorRegistry.createEditor(
                "category-view",
                invalidFolderBoard.editorId,
            );
            constructed.push(category);
            if (!(category instanceof CategoryEditorModel)) {
                throw new Error("Folder View fallback created an unexpected editor.");
            }
            category.initFromLink(
                buildFolderCategoryLink(page, invalidFolderBoard.folderPath),
            );
            await category.restore();
            page.attach(category);
        }

        if (
            desc.mainEditorId &&
            page.editors.some((e) => e.id === desc.mainEditorId)
        ) {
            page.setMainEditorId(desc.mainEditorId);
        }

        if (desc.sidebar) {
            const nav = page.ensureSecondaryViewsModel();
            nav.setStateQuiet({
                open: desc.sidebar.open,
                width: desc.sidebar.width,
            });
             // `activePanel` may be composite (`${editorId}:${panelId}`)
            // or a bare seed/legacy id. Validate by the parsed panel id, and —
            // when composite — require the named editor to still exist.
            const panel = desc.sidebar.activePanel;
            const { editorId, panelId } = parsePanelKey(panel);
            const composedPanels = page.panelEditors.flatMap((editor) =>
                (editor.secondaryView ?? []).map((id) => ({ key: panelKey(editor.id, id), panelId: id }))
            );
            const valid = editorId
                ? composedPanels.some((p) => p.key === panel)
                : composedPanels.some((p) => p.panelId === panelId);
            const firstPanel = composedPanels[0]?.key ?? "";
            page.activePanel = firstPanel ? (valid ? panel : firstPanel) : "";
            if (!firstPanel) nav.setStateQuiet({ open: false, activePanel: "" });
        }

        if (page.editors.length === 0) {
            await page.dispose();
            return { kind: "invalid" };
        }
        return { kind: "restored", page };
        } catch (error) {
            const attached = new Set(page?.editors ?? []);
            if (page) {
                try { await page.dispose(); } catch (disposeError) { console.warn("[restore] page cleanup:", disposeError); }
            }
            for (const editor of constructed) {
                if (attached.has(editor)) continue;
                try { await editor.dispose(); } catch (disposeError) { console.warn("[restore] editor cleanup:", disposeError); }
            }
            return { kind: "failed", error };
        }
    };

    private applyState = async (data: WindowState): Promise<void> => {
        const results = await Promise.all(
            data.pages.map(async (d) => {
                try {
                    return await this.restorePage(d);
                } catch (err) {
                    console.warn(`[restore] page ${d.id}:`, err);
                    const ids = d.editors.map((editor) => editor.id);
                    appFs.protectCacheIds(ids);
                    try { return this.createRestoreFailedPage(d, err); }
                    catch (placeholderError) { appFs.releaseCacheIds(ids); throw placeholderError; }
                }
            }),
        );

        const models: PageModel[] = results.filter(
            (p): p is PageModel => p !== null,
        );
        for (const p of models) this.model.attachPage(p);

        const pagesByZone = this.model.layout.sortByPinSide(models);
        this.model.state.update((s) => {
            s.pages = pagesByZone;
            s.ordered = [];
        });

        const nonRight = pagesByZone.filter((page) => !this.model.query.isRightPinned(page.id));
        const normal = nonRight.filter((page) => page.pinSide === undefined);
        const requested = nonRight.find((page) => page.id === data.activePageId);
        const active = requested ?? normal.at(-1) ?? nonRight.at(-1);
        const orderedModels = active
            ? [...nonRight.filter((page) => page !== active), active]
            : [];
        this.model.state.update((s) => { s.ordered = orderedModels; });

        if (data.groupings && Array.isArray(data.groupings)) {
            data.groupings.forEach((el) => {
                if (Array.isArray(el) && el.length === 2) {
                    if (this.model.query.isRightPinned(el[0]) || this.model.query.isRightPinned(el[1])) return;
                    this.model.layout.group(el[0], el[1]);
                }
            });
            this.model.layout.fixGrouping();
        }
        if (!nonRight.length) this.model.lifecycle.addEmptyPage();
    };

    /**
     * Initialize pages: restore from storage. Called from app.initPages() during bootstrap.
     * Launch inputs are opened later by the app bootstrap after event registration.
     */
    init = async () => {
        try {
            if (!appWindow.isBoardMode) await this.restoreState();
        } finally {
            this.restored = true;
        }
    };
}

// Re-export IEditorState so existing barrel-importers stay green.
export type { IEditorState };
