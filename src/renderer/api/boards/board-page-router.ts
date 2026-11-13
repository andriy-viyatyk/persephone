import { EditorModel } from "../../editors/base";
import { fpBasename, fpExtname } from "../../core/utils/file-path";
import { getLanguageByExtension } from "../../core/utils/language-mapping";
import { captureBoardSourceContext } from "../../editors/shared/source-context";
import { cleanForStorage, createLinkData } from "../../../shared/link-data";
import type { ILinkData } from "../../../shared/link-data";
import { matchesFileMask, untitledFileNameForMasks } from "../../../shared/board/board-masks";
import { BoardRoot } from "../../../shared/board/board-root";
import type { NormalizedBoardManifest } from "../../../shared/board/board-manifest-schema";
import { PERSEPHONE_BOARD_PREFIX, decodePersephoneBoardLink, encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { pipeFromSourcePath } from "../../content/rebuild-pipe";
import { buildEditorById } from "../../editors/editor-factory";
import type { IContentPipe } from "../types/io.pipe";
import { customEditorRegistry, resolveEditorIdForFile } from "./custom-editor-registry";
import { boardEditorId, parseBoardEditorId } from "../../../shared/board/board-editor-id";
import { readBoardManifest } from "./board-manifest-io";
import { asBoardHostEditor } from "./board-host-editor";
import type { PageModel } from "../pages/PageModel";
import type { NavigatePageToOptions } from "../pages/PageNavigator";
import type {
    OpenFileOptions,
    OpenInterceptorOutcome,
    PageOpenInterceptor,
} from "../pages/PagesLifecycleModel";
import type { PagesModel } from "../pages/PagesModel";

interface BoardOpenOptions extends OpenFileOptions {
    normalizedManifest?: NormalizedBoardManifest | null;
    preferredPageId?: string;
}

/** Runtime-only ownership data for a board's reusable Browser Run page. */
export interface BoardRunPageOwner {
    boardRoot: string;
    reuseKey: string;
    url: string;
}

/** Owns board-specific routing and board page lookup within a PagesModel. */
export class BoardPageRouter implements PageOpenInterceptor {
    private readonly runPageOwners = new WeakMap<PageModel, BoardRunPageOwner>();

    constructor(private readonly model: PagesModel) {}

    getRunPageOwner(page: PageModel): BoardRunPageOwner | undefined {
        return this.runPageOwners.get(page);
    }

    onOpenFile = async (request: {
        filePath?: string;
        pipe?: IContentPipe;
        options?: OpenFileOptions;
    }): Promise<OpenInterceptorOutcome<OpenFileOptions>> => {
        const page = await this.openSingleInstanceBoard(request.filePath, request.pipe, request.options);
        return page ? { kind: "take", page } : { kind: "continue", options: request.options };
    };

    onNavigatePageTo = async (request: {
        pageId: string;
        newFilePath: string;
        options?: NavigatePageToOptions;
    }): Promise<OpenInterceptorOutcome<NavigatePageToOptions>> => {
        const { pageId, newFilePath, options } = request;
        const resolvedTarget = options?.target ?? (resolveEditorIdForFile(newFilePath) ?? "monaco");
        const boardRoot = parseBoardEditorId(resolvedTarget);
        const board = boardRoot === null ? undefined : customEditorRegistry.findByRoot(boardRoot);
        let sourceContext: Awaited<ReturnType<typeof captureBoardSourceContext>>;
        const sourcePage = this.model.query.findPage(pageId);
        if (board && sourcePage && options?.sourceLink) {
            const sourceLink = options.sourceLink;
            const currentHref = sourceLink.url ?? sourceLink.href ?? newFilePath;
            sourceContext = await captureBoardSourceContext({
                page: sourcePage,
                sourceLink,
                currentHref,
                include: (item) => board.fileMasks.length === 0
                    || board.fileMasks.some((mask) => matchesFileMask(fpBasename(item.href), mask)),
            });
        }
        const routedOptions: (NavigatePageToOptions & Pick<BoardOpenOptions, "preferredPageId">) | undefined = board
            ? {
                ...options,
                target: resolvedTarget,
                preferredPageId: pageId,
                ...(options?.sourceLink
                    ? { sourceLink: { ...options.sourceLink, sourceContext } }
                    : {}),
            }
            : options;
        const page = await this.openSingleInstanceBoard(newFilePath, options?.pipe, routedOptions);
        return page ? { kind: "take", page } : { kind: "continue", options: routedOptions };
    };

    private resolveBoardRootForOpen(target?: string, filePath?: string): string | undefined {
        const boardRoot = target ? parseBoardEditorId(target) : null;
        if (boardRoot !== null) return boardRoot;
        if (target !== "board-view" || !filePath) return undefined;
        return decodePersephoneBoardLink(filePath)?.boardRoot;
    }

    private enqueueBoardSource(
        page: PageModel,
        filePath: string | undefined,
        pipe: IContentPipe | undefined,
        sourceLink: ILinkData | undefined,
        sessionHandle?: string,
    ): void {
        const sourceUrl = sourceLink?.url ?? pipe?.provider.sourceUrl ?? filePath;
        if (!sourceUrl || sourceUrl.startsWith(PERSEPHONE_BOARD_PREFIX)) return;
        page.mainEditor?.acceptOpenContext?.({
            mode: "enqueue-source",
            sourceUrl,
            sessionHandle,
            sourceContext: sourceLink?.sourceContext,
        });
    }

    /** Route an open to an existing single-instance board page in this window. */
    private async openSingleInstanceBoard(
        filePath: string | undefined,
        pipe: IContentPipe | undefined,
        options?: BoardOpenOptions,
    ): Promise<PageModel | undefined> {
        const boardRoot = this.resolveBoardRootForOpen(options?.target, filePath);
        const normalizedManifest = options && Object.prototype.hasOwnProperty.call(options, "normalizedManifest")
            ? options.normalizedManifest
            : boardRoot ? await readBoardManifest(boardRoot) : null;
        if (!boardRoot || normalizedManifest?.singleInstance !== true) return undefined;

        const masks = normalizedManifest.singleInstanceMasks;
        const preferredPage = masks !== undefined && options?.preferredPageId
            ? this.model.query.findPage(options.preferredPageId)
            : undefined;
        const preferredIsFullPlayer = masks !== undefined
            && this.isFullPlayerBoardPage(preferredPage, boardRoot, masks);
        const isBoardOpen = !filePath || filePath.startsWith(PERSEPHONE_BOARD_PREFIX);
        const matchesMask = !!filePath
            && masks?.some((mask) => matchesFileMask(fpBasename(filePath), mask));
        if (masks !== undefined && !isBoardOpen && !matchesMask && !preferredIsFullPlayer) return undefined;

        const existingPage = preferredIsFullPlayer
            ? preferredPage
            : this.findPageByBoardRoot(boardRoot, masks);
        if (!existingPage) return undefined;

        this.model.navigation.showPage(existingPage.id);
        this.enqueueBoardSource(existingPage, filePath, pipe, options?.sourceLink, options?.sessionHandle);
        pipe?.dispose();
        return existingPage;
    }

    addBundledBoardPage = async (
        boardRoot: string,
        options?: { title?: string; onPageCreated?: (page: PageModel) => void },
    ): Promise<PageModel> => {
        const editorId = boardEditorId(boardRoot);
        const normalizedManifest = await readBoardManifest(boardRoot);
        const match = customEditorRegistry.findByRoot(boardRoot);
        if (!match || match.origin !== "bundled" || match.editorKind !== "content-host") {
            throw new Error(`Bundled board is not an enabled content-host editor: ${boardRoot}`);
        }
        const existingPage = await this.openSingleInstanceBoard(undefined, undefined, {
            target: editorId,
            normalizedManifest,
        });
        if (existingPage) return existingPage;

        const fileName = untitledFileNameForMasks(normalizedManifest?.fileMasks);
        const language = getLanguageByExtension(fpExtname(fileName))?.id ?? "plaintext";
        const title = options?.title ?? fileName;
        const editor = await buildEditorById(editorId);
        const host = (editor as EditorModel).contentHost;
        if (!host) throw new Error(`Bundled board did not create a content host: ${boardRoot}`);
        host.state.update((state) => {
            state.language = language;
            state.title = title;
        });
        (editor as EditorModel).state.update((state) => {
            state.title = title;
        });
        await editor.restore();
        return this.model.lifecycle.addPage(editor as EditorModel, undefined, options?.onPageCreated);
    };

    /** Open the trusted capability handler board in this renderer and return its page. */
    openBoardHandlerPage = async (
        boardRoot: string,
        title: string,
        onPageCreated: (page: PageModel) => void,
    ): Promise<PageModel> => {
        const entry = customEditorRegistry.findByRoot(boardRoot);
        const bundledContentHost = entry?.origin === "bundled" && entry.editorKind === "content-host";
        if (bundledContentHost) {
            return this.addBundledBoardPage(boardRoot, { title, onPageCreated });
        }

        const url = encodePersephoneBoardLink(boardRoot);
        const pipe = await pipeFromSourcePath(url);
        const data = createLinkData(url, {
            sourceId: "app-api",
            target: "board-view",
        });
        data.url = url;
        data.pipeDescriptor = pipe.toDescriptor();
        const sourceLink = cleanForStorage(data);
        const page = await this.model.lifecycle.openFile(pipe.provider.sourceUrl, pipe, {
            sourceLink,
            target: "board-view",
            title,
            onPageCreated,
        });
        if (!page) {
            throw new Error(`The capability handler board did not open: ${boardRoot}`);
        }
        return page;
    };

    /** Find the Browser page transiently owned by one board Run key. */
    findBoardRunPage = (boardRoot: string, reuseKey: string): PageModel | undefined => {
        const normalizedRoot = BoardRoot.from(boardRoot);
        return this.model.state.get().pages.find((page) => {
            if (page.mainEditor?.editorId !== "browser-view") return false;
            const owner = this.getRunPageOwner(page);
            return !!owner
                && normalizedRoot.equals(owner.boardRoot)
                && owner.reuseKey === reuseKey;
        });
    };

    private runUrlKey(value: string): string {
        let href = value.trim();
        if (/^[a-zA-Z]:[\\/]/.test(href) || href.startsWith("\\\\")) {
            const { pathToFileURL } = require("url") as typeof import("url");
            href = pathToFileURL(href).href;
        }
        try {
            const url = new URL(href);
            url.protocol = url.protocol.toLowerCase();
            url.hostname = url.hostname.toLowerCase();
            if (url.protocol === "file:") url.pathname = url.pathname.toLowerCase();
            return url.href;
        } catch {
            return href;
        }
    }

    /** Open and reuse a transient Browser page owned by a board and its reuse key. */
    openBoardRunPage = async (boardRoot: string, reuseKey: string, url: string): Promise<void> => {
        const normalizedKey = reuseKey.trim();
        if (!normalizedKey || normalizedKey.length > 256) {
            throw new Error("openRawLink reuseKey must be 1–256 non-whitespace characters.");
        }
        const normalizedRoot = BoardRoot.from(boardRoot).key;
        let page = this.findBoardRunPage(boardRoot, normalizedKey);
        if (!page) {
            page = await this.model.showBrowserPage({ url });
            if (!page) throw new Error("Could not create the board Run page.");
            this.runPageOwners.set(page, { boardRoot: normalizedRoot, reuseKey: normalizedKey, url });
            await page.restore.ready;
        } else {
            await page.restore.ready;
            const { BrowserEditor } = await import("../../editors/browser/BrowserEditor");
            const browser = page.mainEditor;
            if (!(browser instanceof BrowserEditor)) throw new Error("The owned Run page is no longer a Browser page.");
            const browserState = browser.state.get();
            const activeTab = browserState.tabs.find((tab) => tab.id === browserState.activeTabId);
            if (activeTab && this.runUrlKey(activeTab.url) === this.runUrlKey(url)) browser.webview.hardReload();
            else browser.navigate(url);
            this.runPageOwners.set(page, { boardRoot: normalizedRoot, reuseKey: normalizedKey, url });
        }
        this.model.navigation.showPage(page.id);
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
            const editor = page.mainEditor as { boardRoot?: string } | null;
            return !!editor?.boardRoot && BoardRoot.from(editor.boardRoot).equals(boardRoot);
        });
    };

    /** Open pages whose MAIN editor runs a board, in tab order. */
    findPagesByBoardRoot = (boardRoot?: string): PageModel[] => {
        const key = boardRoot === undefined ? undefined : BoardRoot.from(boardRoot).key;
        return this.model.state.get().pages.filter((page) => {
            const host = asBoardHostEditor(page.mainEditor);
            return !!host?.boardRoot && (key === undefined || BoardRoot.from(host.boardRoot).key === key);
        });
    };

    private isFullPlayerBoardPage(
        page: PageModel | undefined,
        boardRoot: string,
        masks: readonly string[],
    ): boolean {
        if (!page) return false;
        const editor = page.mainEditor as { boardRoot?: string; filePath?: string } | null;
        if (!editor?.boardRoot || !BoardRoot.from(editor.boardRoot).equals(boardRoot)) return false;
        const filePath = editor.filePath;
        return !filePath
            || filePath.startsWith(PERSEPHONE_BOARD_PREFIX)
            || masks.some((mask) => matchesFileMask(fpBasename(filePath), mask));
    }
}
