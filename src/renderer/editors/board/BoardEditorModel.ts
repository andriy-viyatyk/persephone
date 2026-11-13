import { EditorModel, type EditorOpenContext, type EditorStateBase } from "../base/EditorModel";
import { editorRegistry } from "../base/editorRegistry";
import { api } from "../../../ipc/renderer/api";
import { BOARD_CDP_TAB } from "../../../ipc/api-types";
import { fpBasename, fpExtname, fpJoin, fpNormalizeForCompare, isPlainLocalPath } from "../../core/utils/file-path";
import { BoardRoot } from "../../../shared/board/board-root";
import { getLanguageByExtension } from "../../core/utils/language-mapping";
import { toClipboard } from "../../core/utils/utils";
import { fs as appFs } from "../../api/fs";
import { boardRegistry } from "../../api/boards/board-registry";
import { BoardGrant } from "../../../shared/board/board-grant";
import { requestBoardTrust } from "../../api/boards/request-board-trust";
import { queueLegacyBoardDeprecationNotice } from "./legacy-board-deprecation-notice";
import { cleanForStorage } from "../../../shared/link-data";
import { pipeFromPersistedSource } from "../../content/rebuild-pipe";
import { decodePersephoneBoardLink } from "../../content/persephone-board-link";
import { customEditorRegistry } from "../../api/boards/custom-editor-registry";
import { boardEditorId } from "../../../shared/board/board-editor-id";
import { hostOwnsPipe } from "../../../shared/board/board-manifest-queries";
import { isBoardFolder, readBoardManifest } from "../../api/boards/board-manifest-io";
import {
    normalizeSecondaryViews,
    type BoardEditorKind,
    type NormalizedBoardManifest,
    type SecondaryViewDecl,
} from "../../../shared/board/board-manifest-schema";
import { BoardFrameRegistry } from "./model/BoardFrameRegistry";
import { BoardAiVisionChannel } from "./model/BoardAiVisionChannel";
import { BoardTargetModel } from "./BoardTargetModel";
import { createBoardGlyphElement } from "./board-glyph-element";
import { createIconElement } from "../../uikit/shared/slots";
import { app } from "../../api/app";
import { ui } from "../../api/ui";
import { DialogButton } from "../../ui/dialogs/dialog-buttons";
import { pages } from "../../api/pages";
import { errMessage } from "../../../shared/utils";
import { englishMessage, t } from "../../../shared/i18n/t";
import type { MenuItem } from "../../uikit/Menu/index";
import { invalidateBoardIcon } from "./board-icon-cache";
import { createBoardShortcut } from "./board-shortcut";
import { markBoardBusy } from "../../api/boards/busy-boards";
import type { IBoardHostEditor } from "../../api/boards/board-host-editor";
import type { IState } from "../../core/state/state";
import { BoardFrameChrome } from "./model/BoardFrameChrome";
import { BoardSourceInbox } from "./model/BoardSourceInbox";
import { BoardPageStateStore } from "./model/BoardPageStateStore";
import { BoardContentResources } from "./model/BoardContentResources";
import { boardSecondaryPanelId } from "./board-secondary";
import type { IContentPipe } from "../../api/types/io.pipe";
import type { BoardSourceContext } from "../../../shared/board-source-context";
import type { ILink } from "../../api/types/io.tree";
import { findSourceProvider, navigateToSourceItem } from "../shared/source-context";

export interface BoardEditorState extends EditorStateBase {
    /** State-type discriminator. */
    /** EditorView id. */
    editor: "board-view";
    /** The board's OWN absolute root path — the folder that directly contains
     *  `index.html`, `board-manifest.json`, `ui.log`, and the optional icon.
     *  Always set for a live board; absent only in legacy persisted state, which
     *  `restore()` drops. */
    boardRoot?: string;
    /** Display title — the board folder name. */
    title: string;
    /** The title last taken from the manifest's `name` (plain boards only). Lets restore and
     *  reload retitle the page after the manifest is renamed, without overwriting a title some
     *  other caller set. Persisted with the page. */
    manifestTitle?: string;
    /** The board's name (folder basename) when it resolves on disk, or undefined
     *  when the board folder/manifest is missing (drives `BoardNotFoundView`).
     *  Re-validated on open/restore by `refreshBoards`. */
    selectedBoard?: string;
    /** Bumped to force a remount of the board's webview — by the manual Reload
     *  action and the `pages[i].editor.reload()` call path. */
    reloadToken: number;
    /** Busy retention flag: set via `persephone.setBoardBusy(true)` when the
     *  board spawned processes that must outlive it. While busy, this model survives
     *  page navigation as an invisible ownership handle (its jobs in main are kept);
     *  page close / dispose kills them. TRANSIENT — cleared on restore (processes
     *  never survive an app restart). */
    busy?: boolean;
    /** The file this board edits as a custom editor. Set on the SWITCH path
     *   via `initFromBoardRoot`; on the openRawLink path the file rides
     *  `state.sourceLink.filePath` instead. Read both via `currentFilePath()`. Served to the
     *  board via `persephone.getFilePath()`. Undefined for a plain board. */
    filePath?: string;
    /** The absolute folder claimed by this board; distinct from the installed board root. */
    folderPath?: string;
    /** A readable LOCAL path holding this board's content — what `persephone.getFilePath()`
     *  actually hands the board. Equals `filePath` for a plain local file; for a non-local source
     *  (archive entry / `http(s)` URL) it is a cache file materialized from the content pipe, so
     *  the board reads any source as an ordinary local file. Resolved on demand by
     *  `ensureContentPath()` and memoized here. TRANSIENT — stripped in `getRestoreData()` and
     *  cleared in `restore()`, since a persisted temp path may point at a GC'd cache file. */
    contentPath?: string;
    /** True once a cache file was materialized for this board's content (non-local sources only).
     *  Gates the `dispose()` cleanup. PERSISTED, unlike `contentPath`: the path is recomputed but the
     *  *fact* that a cache folder exists must survive a restore, or a page restored and then closed
     *  without ever re-materializing would orphan its folder. Cleanup targets
     *  `<cache>/<editor id>/`, which is derived from the stable id, so it needs no path. */
    contentCached?: boolean;
    /** Sidebar panel contributions — DERIVED from `secondaryViewDefs`
     *  (`board-secondary:<id>` per declared view). Read by `contributesPanels()`. */
    secondaryView?: string[];
    /** Declared secondary views: seeded from the manifest on first load
     *  A persisted set takes precedence; otherwise values come from `setSecondaryViews`.
     *  `secondaryView` is derived from this. Persists as part of the board state. */
    secondaryViewDefs?: SecondaryViewDecl[];
    /** Shared-state channel store — the in-memory state object mirrored into every
     *  board frame through `persephone.state.*`. Only keys in
     *  `sharedStateRestorableKeys` are persisted through `getRestoreData`.
     */
    sharedState?: Record<string, unknown>;
    /** Keys of `sharedState` declared persistable through `persephone.state.init`.
     *  Populated during board initialization. */
    sharedStateRestorableKeys?: string[];
    /** Content-host boards only: set when the content HOST fails to restore (file
     *  missing / unreadable), so the view shows a distinct empty state rather than a blank board. */
    contentHostError?: string;
    /** Prevents a restored board from handing a private claimed HTTP source back to the board. */
    sourceRestoreBlocked?: boolean;
    /** Muted state the board reported with `persephone.page.setMuted()`; the page tab draws its
     *  mute button from it (the same field the Video Player and Browser use). TRANSIENT. */
    pageMuted?: boolean;
}

export const getDefaultBoardEditorState = (): BoardEditorState => ({
    // Per-instance UUID — keys this editor in `page.editors[]`.
    id: crypto.randomUUID(),
    title: englishMessage("board.editor"),
    modified: false,
    editor: "board-view",
    selectedBoard: undefined,
    reloadToken: 0,
});

/**
 * Board editor.
 *
 * Renders a single standalone board: the folder at `boardRoot` (carrying
 * `board-manifest.json`). Opened by a `persephone-board://` link — from the
 * Explorer Boards panel, the manifest-row "Open Board" button, or the
 * MCP `openBoard` tool. Rendering and `execute()` are gated by the per-board
 * trust gate: an untrusted board shows a placeholder + "Trust board" button
 * instead of rendering; a board whose folder is gone shows "Board not found".
 *
 * A board does NOT survive navigation — it is a plain main editor, re-opened from
 * the Boards panel or the in-board toolbar.
 */
export class BoardEditorModel extends EditorModel<BoardEditorState> implements IBoardHostEditor {
    private boardDisplayNameEnglish: string | undefined;
    /** Virtual `board-editor:<root>` when acting as a custom editor for a file (so the
     *  switch widget shows/highlights it and `switchMainEditor` routes correctly), else
     *  the constant `"board-view"` for a plain board page. Persistence pins `"board-view"`
     *  regardless (see `getRestoreData`) so restore keys on the stable id. */
    get editorId(): string {
        const root = this.state.get().boardRoot;
        return root && (this.currentFilePath() || this.state.get().folderPath)
            ? boardEditorId(root)
            : "board-view";
    }

    /** Apply content written by a board frame when this board owns a content host. */
    applyBoardContent(_content: string): void { }

    /** Save content owned by a board frame when this board owns a content host. */
    saveBoardContent(): void { }

    /** Subscribe to content-host changes without exposing the concrete board model to the frame. */
    subscribeBoardContent(_handler: (content: string) => void): (() => void) | undefined {
        return undefined;
    }

    noLanguage = true;
    skipSave = true;
    showBackgroundOrnament = true;

    /** Automation adapter for the `browser_*` MCP tools. Commands run in the host
     *  window and target the board through its `<iframe>`. */
    readonly frameRegistry = new BoardFrameRegistry(() => this.state.get().secondaryViewDefs);
    readonly target = new BoardTargetModel(this, this.frameRegistry);
    readonly aiVision = new BoardAiVisionChannel({
        frameRegistry: this.frameRegistry,
        boardRoot: () => this.state.get().boardRoot,
        ensureReady: (tabId) => this.target.ensureReady(tabId),
    });
    private disposed = false;
    readonly chrome: BoardFrameChrome;
    readonly contentResources: BoardContentResources;
    readonly sourceInbox: BoardSourceInbox;
    readonly pageStateStore: BoardPageStateStore;
    private releaseCancelled = false;
    private releaseError: string | undefined;
    private chromeViewsAvailable = false;

    /** Track the theme overlay generation owned by one mounted board frame. */
    recordBoardThemePreview(boardId: string, generation: number): void {
        this.chrome.recordBoardThemePreview(boardId, generation);
    }

    constructor(modelState: IState<BoardEditorState>) {
        super(modelState);
        this.sourceInbox = new BoardSourceInbox({
            getSource: () => ({ url: this.state.get().sourceLink?.url, filePath: this.state.get().filePath }),
            blockRestore: () => this.state.update((state) => { state.sourceRestoreBlocked = true; }),
        });
        this.pageStateStore = new BoardPageStateStore({
            editorId: this.id,
            boardRoot: () => this.state.get().boardRoot,
        });
        this.contentResources = new BoardContentResources({
            boardRoot: () => this.state.get().boardRoot,
            inbox: this.sourceInbox,
        });
        this.chrome = new BoardFrameChrome({
            canExposeDeclarations: () => {
                const boardRoot = this.state.get().boardRoot;
                return this.chromeViewsAvailable && !!this.page && this.page.mainEditor === this && !!boardRoot
                    && boardRegistry.isPermitted(boardRoot) && this.frameRegistry.hasFrame(BOARD_CDP_TAB);
            },
            setPageMuted: (muted) => this.setPageMutedProjection(muted),
        });
        this.own(boardRegistry.subscribeMembership(() => {
            const boardRoot = this.state.get().boardRoot;
            if (boardRoot && !boardRegistry.isPermitted(boardRoot)) this.aiVision.clearRegistration();
        }));
    }

    setChromeViewsAvailable(available: boolean): void {
        this.chromeViewsAvailable = available;
    }

    private setPageMutedProjection(muted: boolean | undefined): void {
        const previous = this.state.get().pageMuted;
        this.state.update((state) => { state.pageMuted = muted; });
        if (previous === muted) this.state.set({ ...this.state.get() });
    }

    acceptOpenContext(context: EditorOpenContext): void {
        if (context.mode === "register-session") {
            this.sourceInbox.registerSession(context.sourceUrl, context.sessionHandle);
            return;
        }
        this.sourceInbox.enqueue(context.sourceUrl, context.sessionHandle, context.sourceContext);
    }

    /** Initial sibling context persisted with the board's source link. */
    initialSourceContext(): BoardSourceContext | undefined {
        return this.state.get().sourceLink?.sourceContext;
    }

    /** Navigate only to items included in this board page's initial source snapshot. */
    async navigateSource(href: string): Promise<void> {
        const sourceLink = this.state.get().sourceLink;
        const sourceId = sourceLink?.sourceId;
        const context = sourceLink?.sourceContext;
        const supportedSource = sourceId === "explorer"
            || sourceId === "link-category"
            || sourceId === "link-tag";
        const item = typeof href === "string" ? context?.items.find((candidate) => {
            if (isPlainLocalPath(href) && isPlainLocalPath(candidate.href)) {
                return fpNormalizeForCompare(href) === fpNormalizeForCompare(candidate.href);
            }
            return href === candidate.href;
        }) : undefined;
        if (!sourceLink || !supportedSource || !item) {
            throw new Error("The href must match an item in this page's initial source context.");
        }
        const page = this.page;
        if (!page) throw new Error("The board page is unavailable.");
        if (!findSourceProvider(page, sourceId)) {
            throw new Error("The source panel for this board page is unavailable.");
        }
        const link: ILink = {
            id: item.id,
            title: item.title,
            href: item.href,
            category: item.category ?? sourceLink?.category ?? "",
            tags: item.tags ?? [],
            isDirectory: false,
            target: item.target,
        };
        await navigateToSourceItem(page, sourceLink, link);
    }

    setIframe(el: HTMLIFrameElement, tab: string = BOARD_CDP_TAB): void {
        if (this.frameRegistry.setFrame(tab, el)) this.aiVision.detach(tab);
    }

    /** Clear only if it still matches — guards against a remount setting the new
     *  element before the old one's cleanup runs. Also drops the tab's ready flag and,
     *  if it was the active automation tab, falls back to the main frame so a stray
     *  command can't target a dead frame (a fresh switch/ensureReady re-mounts). */
    clearIframe(el: HTMLIFrameElement, tab: string = BOARD_CDP_TAB): void {
        if (!this.frameRegistry.clearFrame(tab, el)) return;
        this.aiVision.detach(tab);
    }

    /** Folder of the currently-shown board, or undefined when none is resolved. */
    private currentBoardRoot(): string | undefined {
        const s = this.state.get();
        return s.selectedBoard ? s.boardRoot : undefined;
    }

    getIconElement = (): Element => createBoardGlyphElement(this.currentBoardRoot(), 16);

    /** Page-tab context-menu items for a board page: copy the board's own folder path, and
     *  open that folder as a workspace page — the same two actions the Boards sidebar panel
     *  and the Registered boards tab offer on a board row. Appended AFTER `super` so a
     *  content-host board keeps the text-file items its host contributes, in their own group.
     *  Uses `boardRoot` rather than `currentBoardRoot()`: a board whose folder is missing
     *  still has a path worth copying — that is the path the user wants to go look at. */
    override onGetMenuItems(): MenuItem[] {
        const boardRoot = this.state.get().boardRoot;
        return [
            ...super.onGetMenuItems(),
            {
                id: "copy-board-path",
                label: t("shell.copyBoardPath"),
                icon: createIconElement("copy"),
                onClick: () => { toClipboard(boardRoot ?? ""); },
                disabled: !boardRoot,
                startGroup: true,
            },
            {
                id: "open-board-folder",
                label: t("shell.openBoardFolder"),
                icon: createIconElement("folder-open"),
                onClick: () => { if (boardRoot) void app.pages.openPath(boardRoot); },
                disabled: !boardRoot,
            },
            {
                id: "create-board-shortcut",
                label: t("shell.createBoardShortcut"),
                onClick: () => { if (boardRoot) void createBoardShortcut(boardRoot); },
                disabled: !boardRoot,
                startGroup: true,
            },
        ];
    }

    // ── Busy retention ─────────────────────────

    /** Authoritative renderer-side busy holder. Set from the shim's `board:busy`
     *  post (via BoardWebview). Updates the reactive state (panel indicator),
     *  the window-level busy-roots registry, and mirrors the flag to main so a
     *  busy owner's jobs survive port disposal. */
    setBusy(busy: boolean): void {
        const s = this.state.get();
        if (!!s.busy === busy) return;
        this.state.update((st) => { st.busy = busy; });
        markBoardBusy(this.id, s.boardRoot, busy);
        void api.setBoardBusy(this.id, busy);
    }

    /** Board-declared transient visual activity; independent of process retention. */
    setWorking(working: boolean): void {
        this.workingState.set(working);
    }

    // ── Shared state ───────────────────────────

    /** Monotonic shared-state version — stamped on every `state:sync` push so a
     *  frame ignores stale/out-of-order deliveries (seed-on-load vs init/set/merge). Instance
     *  property, kept OFF the reactive state: never persisted, resets to 0 each session. */
    sharedStateSeq = 0;

    /** Replace the shared state (`persephone.state.set`). Bump seq BEFORE `state.update` so the
     *  synchronous subscription fires with the new seq already visible. */
    setSharedState(next: Record<string, unknown>): void {
        this.sharedStateSeq++;
        this.state.update((s) => { s.sharedState = next && typeof next === "object" ? next : {}; });
    }

    /** Shallow-merge into the shared state (`persephone.state.merge`). */
    mergeSharedState(partial: Record<string, unknown>): void {
        if (!partial || typeof partial !== "object") return;
        this.sharedStateSeq++;
        this.state.update((s) => { s.sharedState = { ...(s.sharedState ?? {}), ...partial }; });
    }

    /** Seed defaults (fill-missing — existing/restored values win) + record the restorable
     *  keys passed to `persephone.state.init`. Initialization is idempotent; the last call wins for
     *  the key set. */
    initSharedState(defaults: Record<string, unknown>, restorableKeys?: string[]): void {
        this.sharedStateSeq++;
        this.state.update((s) => {
            s.sharedState = {
                ...(defaults && typeof defaults === "object" ? defaults : {}),
                ...(s.sharedState ?? {}),
            };
            if (Array.isArray(restorableKeys)) {
                s.sharedStateRestorableKeys = restorableKeys.filter((k) => typeof k === "string");
            }
        });
    }

    /** While busy, survive `setMainEditor` as an invisible ownership handle —
     *  the processes' lifetime stays tied to this page ("page closed → kill"). */
    override keepAliveOnNavigation(): boolean {
        return !!this.state.get().busy;
    }

    /** While busy, navigation away is non-destructive (this model survives) —
     *  skip the release prompt. Boards are never `modified`, so this is
     *  semantic hygiene rather than a behavior change. */
    override survivesNavigation(): boolean {
        return !!this.state.get().busy && !this.modified;
    }

    /** Read by the page tab: present only while the board has asked for the mute button. */
    get toggleMuteAll(): (() => void) | undefined {
        return this.chrome.toggleMuteAll;
    }

    setBoardModified(modified: boolean): void {
        if (this.state.get().modified === modified) return;
        this.state.update((state) => { state.modified = modified; });
    }

    override async confirmRelease(_closing?: boolean): Promise<boolean> {
        this.releaseCancelled = false;
        this.releaseError = undefined;
        if (!this.modified) return true;
        const pageId = this.page?.id;
        if (pageId) pages.navigation.showPage(pageId);
        const choice = await ui.confirm(
            t("board.saveChangesConfirmation", { name: this.title }),
            {
                title: t("board.saveChangesTitle"),
                buttons: [DialogButton.save, DialogButton.dontSave, DialogButton.cancel],
            },
        );
        if (choice === DialogButton.dontSave) {
            // Best effort: let the board drop page-scoped drafts it keeps for app restarts before teardown.
            const saveRequest = this.chrome.saveRequest;
            if (saveRequest) await saveRequest(true);
            this.setBoardModified(false);
            return true;
        }
        if (choice !== DialogButton.save) {
            this.releaseCancelled = true;
            return false;
        }

        try {
            const saveRequest = this.chrome.saveRequest;
            if (!saveRequest) {
                throw new Error(
                    "The board has no active Save handler. Reload the board to restore it, or choose Don't Save.",
                );
            }
            const result = await saveRequest();
            if (!result.success) throw new Error(result.error || "The board reported that saving failed.");
            this.setBoardModified(false);
            return true;
        } catch (error: unknown) {
            this.releaseError = errMessage(error, "The board did not finish saving.");
            void ui.notify(t("board.saveChangesFailed", { error: this.releaseError }), "error");
            return false;
        }
    }

    /** Per-page singleton: re-navigating to the SAME board reuses this instance
     *  (promote back to main) rather than stacking a duplicate. Matches the
     *  `persephone-board://` link for this board's root. */
    matchesNavigationTarget(target: string | undefined, filePath: string): boolean {
        if (target !== "board-view") return false;
        const boardRoot = this.state.get().boardRoot;
        if (!boardRoot) return false;
        const boardLink = decodePersephoneBoardLink(filePath);
        return !!boardLink
            && BoardRoot.from(boardLink.boardRoot).equals(boardRoot);
    }

    /** Absolute root of the board this editor runs (undefined for a plain, path-less board).
     *  `BoardContentEditorModel` inherits this, so content-host board pages are covered too. */
    get boardRoot(): string | undefined {
        return this.state.get().boardRoot;
    }

    get displayNameEnglish(): string | undefined {
        return this.boardDisplayNameEnglish;
    }

    /** Absolute folder claimed by this board, or undefined for plain/file-only boards. */
    get folderPath(): string | undefined {
        return this.state.get().folderPath;
    }

    /** Folder identity shared by folder-aware editor switch consumers. */
    override get folderAnchor(): string | undefined {
        return this.folderPath;
    }

    /** The file path this board edits, from either entry point (switch → `state.filePath`;
     *  openRawLink → `sourceLink.filePath`). Undefined for a plain, non-custom-editor board. */
    currentFilePath(): string | undefined {
        const s = this.state.get();
        return s.filePath ?? s.sourceLink?.filePath;
    }

    /** The raw persisted source identity for this board. Open-link boards use `sourceLink.url`;
     * switch-style opens fall back to their ordinary file path. This accessor never materializes
     * a source or reads through the board file-path bridge.
     *
     * A board opened PLAINLY still carries a `sourceLink.url` — the `persephone-board://` link
     * that opened the board itself — and that is the board's own address, not a source it was
     * given. Returning it made the torrent board feed its own page URL to its resolver and raise
     * "Invalid torrent identifier" on every plain open, so that one scheme is filtered out here
     * rather than in each board. */
    /** Manifest editor kind for this board's trusted association. */
    get editorKind(): BoardEditorKind {
        return "simple";
    }

    /** Whether the board bridge may address this page's platform-owned pipe by URL. */
    get pipeUrlEnabled(): boolean {
        return hostOwnsPipe(this.editorKind);
    }

    get isStreamHost(): boolean {
        return this.editorKind === "stream-host";
    }

    /** Resolve the pipe used by `board://…/__pipe/…`. A live first-open pipe always wins;
     * only a restored stream-host without one is rebuilt from persisted source state. */
    async resolveStreamPipe(): Promise<IContentPipe> {
        const host = this.contentHost;
        if (host?.pipe) return host.pipe;
        if (this.pipe) return this.pipe;
        throw new Error("The content-host board has no live content pipe.");
    }

    /**
     * Resolve a readable LOCAL path holding this board's content — what `getFilePath()` returns to
     * the board. Plain local file → the source path itself, untouched and with no I/O. Any other
     * source (archive entry, `http(s)` URL, transformed pipe) → a cache file materialized from the
     * content pipe, so a board reads every source as an ordinary local file and needs no awareness
     * of where the bytes came from.
     *
     * Read-only: the cache file is never written back through the pipe. (`ImageEditor` does the same
     * job for itself; this is the generalized, board-facing version of that pattern.)
     *
     * Memoized for the model's lifetime — the cache file outlives the iframe, so a board reload
     * or an in-board reload re-resolves for free. Materializes UNCONDITIONALLY on the first call
     * rather than trusting a same-named cache file from a previous session, whose source may have
     * changed since. Throws when the source cannot be read, so the caller can surface a real error
     * instead of a silent "no file".
     */
    async ensureContentPath(): Promise<string | undefined> {
        const existing = this.state.get().contentPath;
        if (existing) return existing;
        const source = this.currentFilePath();
        if (!source) return undefined; // plain board — no file to resolve

        if (!this.pipe) {
            // Prefer the PERSISTED pipe descriptor: it carries the true provider (e.g. HttpProvider
            // with its method/headers), which a path-shape guess cannot reconstruct. Falls back to
            // the path-derived pipe for the switch path, which has no sourceLink.
            this.pipe = await pipeFromPersistedSource(
                this.state.get().sourceLink,
                source,
                { unknownScheme: "file" },
            );
        }

        // A plain file pipe already points at a real local file — hand over the source path
        // itself. No copy, no read: the overwhelmingly common case stays free.
        if (this.pipe.provider.type === "file" && this.pipe.transformers.length === 0) {
            const local = this.pipe.provider.sourceUrl;
            this.state.update((s) => { s.contentPath = local; });
            return local;
        }

        const buffer = await this.pipe.readBinary();
        // Cache as `<cache>/<editorId>/<sourceBaseName>` — the per-editor subfolder keeps the file
        // collision-free across tabs while PRESERVING THE SOURCE'S BASE NAME, which boards show as
        // their file-name label. Keying the file itself on the editor id would make every board
        // display a UUID for an archive/remote file. `fs.writeBinary` creates the folder.
        const cachePath = appFs.resolveCachePath(fpJoin(this.id, fpBasename(source)));
        await appFs.writeBinary(cachePath, buffer);
        this.state.update((s) => {
            s.contentPath = cachePath;
            s.contentCached = true;
        });
        return cachePath;
    }

    /** Merge both filePath sources so host-less consumers (the switch widget, the
     *  `switchMainEditor` board-boundary extraction) read a single value. */
    override get filePath(): string | undefined {
        return this.currentFilePath();
    }

    /** Switch options while ON the board (base returns []): the file's BUILT-IN editors
     *  (so the user can switch back) plus this board. Board peers claiming the same file
     *  are appended by the switch widget. Empty for a plain board / non-local file.
     *
     *  The built-in editors compute their list from the live content host's language
     *  (`findEditorsAccepting`), but a simple board never loads the file — so derive the
     *  language from the extension and take the registry's language-based switch options
     *  too. Otherwise language-only editors (md-view "Preview" et al.) would vanish from
     *  the widget while the board is active. */
    override findCompatibleEditors(): string[] {
        const filePath = this.currentFilePath();
        const root = this.state.get().boardRoot;
        if (!filePath || !root || !isPlainLocalPath(filePath)) return [];
        const language = getLanguageByExtension(fpExtname(filePath).toLowerCase())?.id ?? "";
        const builtins = editorRegistry.getSwitchOptions(language, filePath).options;
        const builtinId = editorRegistry.resolveId(filePath) ?? "monaco";
        if (!builtins.includes(builtinId)) builtins.push(builtinId);
        return [...builtins, boardEditorId(root)];
    }

    /** Persist the STABLE `"board-view"` id so restore + cross-window keys on it
     *  (`NO_HOST_EDITOR_IDS` + the zombie guard); the virtual `board-editor:<root>` id is
     *  re-derived from the persisted file/folder path and `state.boardRoot` on restore. */
    override getRestoreData() {
        const data = super.getRestoreData();
        data.editorId = "board-view";
        //: persist ONLY the board-declared restorable subset of sharedState —
        // undeclared/transient state must never bloat the open-pages file. Shallow-clone so
        // we don't mutate the live `state` object `super` returned by reference.
        const s = this.state.get();
        const keys = s.sharedStateRestorableKeys;
        let sharedState: Record<string, unknown> | undefined;
        if (keys?.length && s.sharedState) {
            sharedState = {};
            for (const k of keys) {
                if (Object.prototype.hasOwnProperty.call(s.sharedState, k)) {
                    sharedState[k] = s.sharedState[k];
                }
            }
        }
        // `contentPath` is transient too: a persisted cache path would point at a file the cache may
        // have GC'd, and the source could have changed — `ensureContentPath` re-materializes.
        // `boardRoot` and `folderPath` are independent durable fields. Copy the claimed folder
        // exactly as persisted; never derive it from the installed board root.
        data.state = {
            ...(data.state as Record<string, unknown>),
            boardRoot: s.boardRoot,
            folderPath: s.folderPath,
            sourceLink: s.sourceLink ? cleanForStorage(s.sourceLink) : undefined,
            sharedState,
            pageMuted: undefined,
            contentPath: undefined,
            sourceRestoreBlocked: s.sourceRestoreBlocked === true ? true : undefined,
            modified: false,
        };
        return data;
    }

    /** Single-board init — opened by a `persephone-board://` link or the
     *  MCP `openBoard`. `filePath` is passed only on the custom-editor SWITCH path
     *; on the openRawLink path it rides `state.sourceLink` instead. */
    initFromBoardRoot(boardRoot: string, filePath?: string, folderPath?: string): void {
        const name = fpBasename(boardRoot);
        this.boardDisplayNameEnglish = name;
        this.state.update((s) => {
            s.boardRoot = boardRoot;
            s.filePath = filePath;
            s.folderPath = folderPath;
            // Custom-editor mode → show the file name in the tab (the board's own
            // name isn't useful when it's editing a file); folder mode shows the claimed
            // folder name; plain board → board name.
            s.title = filePath
                ? fpBasename(filePath)
                : folderPath
                    ? fpBasename(folderPath)
                    : name;
        });
        void boardRegistry.load();
        this.selectBoard(name);
        void this.refreshBoards();
        // A plain board page is titled by the manifest's display name, as a link-opened page
        // already is (custom-editor-registry's scheme hook); the folder name is only the fallback
        // until the manifest is read, or when it declares no name.
        if (!filePath && !folderPath) void this.applyManifestTitle(boardRoot, name);
    }

    private async applyManifestTitle(boardRoot: string, fallbackTitle: string): Promise<void> {
        const manifestName = (await readBoardManifest(boardRoot))?.name?.trim();
        this.boardDisplayNameEnglish = manifestName || fallbackTitle;
        if (!manifestName || this.disposed) return;
        const s = this.state.get();
        // Only replace a title this method owns — the fallback, or the manifest name it applied
        // earlier (the manifest may have been renamed since): a caller may have retitled the page.
        // A page saved before `manifestTitle` existed carries the then-current manifest name, so
        // it counts as owned too (plain board pages get no title from anywhere else).
        const owned = s.title === fallbackTitle || s.manifestTitle === undefined || s.title === s.manifestTitle;
        if (s.boardRoot !== boardRoot || !owned) return;
        if (s.title === manifestName && s.manifestTitle === manifestName) return;
        this.state.update((st) => { st.title = manifestName; st.manifestTitle = manifestName; });
    }

    /** A plain board page (no file, no claimed folder) is titled by its manifest; re-read it so a
     *  renamed manifest shows after Reload board, as it does after a restart. */
    private refreshManifestTitle(): void {
        const s = this.state.get();
        if (!s.boardRoot || this.currentFilePath() || s.folderPath) return;
        void this.applyManifestTitle(s.boardRoot, fpBasename(s.boardRoot));
    }

    /** Persistence restore (app restart + cross-window). `boardRoot` rides the
     *  persisted state; re-load trust + re-validate the board. Legacy `.persephone`
     *  project-mode state (had `boardsDir`, no `boardRoot`) is no longer supported —
     *  throw so PagesPersistenceModel's catch drops the editor rather than restoring
     * a broken empty board tab. */
    async restore(): Promise<void> {
        const s = this.state.get();
        if (!s.boardRoot) throw new Error("legacy project-mode board editor — dropped on restore");
        if (s.modified) this.state.update((state) => { state.modified = false; });
        this.sourceInbox.restore(s.sourceRestoreBlocked === true);
        // Busy is transient: processes never survive an app restart
        // (`will-quit` kills every child), so a persisted flag is always stale.
        if (s.busy) this.state.update((st) => { st.busy = false; });
        // The tab mute button belongs to a live frame; the board asks for it again after loading.
        if (s.pageMuted !== undefined) this.state.update((st) => { st.pageMuted = undefined; });
        // Same for a materialized content path carried in from a pre-fix persisted blob: the cache
        // file is gone (or stale), so force a re-resolve on the next `ensureContentPath()`.
        if (s.contentPath) this.state.update((st) => { st.contentPath = undefined; });
        void boardRegistry.load();
        await this.refreshBoards();
        const matchingEntry = customEditorRegistry.findByRoot(s.boardRoot);
        if (matchingEntry && matchingEntry.boardRoot !== s.boardRoot) {
            this.state.update((state) => { state.boardRoot = matchingEntry.boardRoot; });
        }
        const restoredRoot = this.state.get().boardRoot;
        if (restoredRoot && await isBoardFolder(restoredRoot)) {
            await boardRegistry.reload();
            const snapshot = boardRegistry.permissionSnapshot(restoredRoot);
            if (boardRegistry.isTrusted(restoredRoot)
                && snapshot && BoardGrant.from(snapshot.manifestPermissions).isLegacy()) {
                const manifest = await readBoardManifest(restoredRoot);
                const boardName = manifest?.name?.trim() || fpBasename(restoredRoot);
                queueLegacyBoardDeprecationNotice(s.id, restoredRoot, boardName);
            }
        }
        // A plain board page persisted under its folder name (before pages took the manifest name,
        // or when the manifest was renamed) is retitled; a page carrying a file or folder is not.
        if (!this.currentFilePath() && !s.folderPath) {
            const currentRoot = this.state.get().boardRoot ?? s.boardRoot;
            void this.applyManifestTitle(currentRoot, fpBasename(currentRoot));
        }
    }

    /** Re-validate the single board: clear the selection (→ BoardNotFoundView) when
     *  the board folder no longer carries a manifest, and re-probe its icon so a
     *  freshly added icon.* shows after a refresh without an app restart. */
    async refreshBoards(): Promise<void> {
        const boardRoot = this.state.get().boardRoot;
        if (!boardRoot) return;
        invalidateBoardIcon(boardRoot);
        let valid = false;
        try {
            valid = await isBoardFolder(boardRoot);
        } catch {
            valid = false;
        }
        this.state.update((s) => {
            if (!valid) s.selectedBoard = undefined;
        });
        // Seed/derive the declared secondary views. Only when the board
        // resolves; a missing board contributes no panels.
        if (valid) {
            await this.seedSecondaryViews();
        } else {
            this.state.update((s) => { s.secondaryView = undefined; });
        }
    }

    /** Seed `secondaryViewDefs` from the manifest on FIRST load only — a persisted /
     *  restored set takes precedence; otherwise derive the panel-id list.
     *  Idempotent: once `secondaryViewDefs` is defined it is never re-seeded here. */
    private async seedSecondaryViews(): Promise<void> {
        const boardRoot = this.state.get().boardRoot;
        if (!boardRoot) return;
        if (this.state.get().secondaryViewDefs === undefined) {
            const manifest = await readBoardManifest(boardRoot);
            const defs = manifest?.secondaryViews ?? [];
            this.state.update((s) => { s.secondaryViewDefs = defs; });
        }
        this.deriveSecondaryPanels();
    }

    /** Recompute `state.secondaryView` (the derived panel-id list `contributesPanels()`
     *  reads) from `state.secondaryViewDefs`. Undefined when there are no defs. */
    protected deriveSecondaryPanels(): void {
        this.state.update((s) => {
            const defs = s.secondaryViewDefs ?? [];
            s.secondaryView = defs.length ? defs.map((d) => boardSecondaryPanelId(d.id)) : undefined;
        });
    }

    /** Replace the declared secondary views at runtime (`persephone.setSecondaryViews`).
     *  Writes `state.secondaryViewDefs` (validated) then recomputes `state.secondaryView`; the
     *  page's slice subscription reconciles the sidebar panels live. `[]` removes them all. */
    setSecondaryViews(views: unknown): void {
        const defs = normalizeSecondaryViews(views);
        this.state.update((s) => { s.secondaryViewDefs = defs; });
        this.deriveSecondaryPanels();
    }

    /** A busy board that survived navigate-away had its derived `secondaryView`
     *  cleared by the base `beforeNavigateAway` while demoted — which is all the Pattern-A
     *  disposal of a NON-busy board needs (with no derived panels `contributesPanels()` is
     *  false, so `setMainEditor` disposes it; the board never lingers as a sidebar contributor.
     *  `secondaryViewDefs` (the source of truth) is deliberately retained, so on
     *  re-promotion — when `PagesLifecycleModel` reuses this surviving instance via
     *  `matchesNavigationTarget` — we simply re-derive the panel-id list from it: the board comes
     *  back with exactly the views it had (manifest- or runtime-declared), synchronously, with no
     *  manifest re-read and no race against the remounting frame's own `setSecondaryViews`. */
    override onNavigationReuse(): void {
        this.deriveSecondaryPanels();
    }

    /** Select the board (its folder name) so it renders, or `undefined` to deselect
     *  (→ not-found). Single board, so `name` is always this board's own name. */
    selectBoard(name: string | undefined): void {
        if (this.state.get().selectedBoard !== name) this.aiVision.resetReload();
        // `iconKey` drives the tab's icon refresh (it observes iconKey, not
        // selectedBoard) so the tab shows the board's icon.
        this.state.update((s) => {
            s.selectedBoard = name;
            s.iconKey = name ?? "";
            s.reloadToken = 0;
        });
    }

    /** Manual Reload — remount the board's webview to pick up edited files
     *  (`index.html` / `app.js` / CSS). Re-probes the board icon so a mid-session
     *  `icon.*` change shows on demand (no folder watcher — live refresh is
     *  intentionally dropped). Also invoked by the board editor's reload path. */
    reloadBoard = (): void => { void this.runReloadAndWait(false); };

    /** Wait for the next attachable main board frame after a model-owned reload. */
    reloadAndWait(): Promise<{ frameReady: boolean; cancelled?: boolean }> {
        return this.runReloadAndWait(true);
    }

    private async runReloadAndWait(reportReleaseError: boolean): Promise<{ frameReady: boolean; cancelled?: boolean }> {
        const released = await this.confirmRelease();
        if (!released) {
            if (reportReleaseError && this.releaseError) throw new Error(this.releaseError);
            return {
                frameReady: this.frameRegistry.isFrameReady(BOARD_CDP_TAB),
                cancelled: this.releaseCancelled || this.modified,
            };
        }
        const boardRoot = this.state.get().boardRoot;
        if (boardRoot && !(await requestBoardTrust(boardRoot))) return { frameReady: false };
        const frameReady = this.frameRegistry.waitForFrameLoad(BOARD_CDP_TAB);
        if (boardRoot) invalidateBoardIcon(boardRoot);
        this.aiVision.beginReload();
        this.state.update((s) => { s.reloadToken++; });
        this.refreshManifestTitle();
        return { frameReady: await frameReady };
    }

    /** Read the current board manifest through the board model's path authority. */
    readManifestForFacade(): Promise<NormalizedBoardManifest | null> {
        const boardRoot = this.state.get().boardRoot;
        return boardRoot ? readBoardManifest(boardRoot) : Promise.resolve(null);
    }

    /** Resolve the main-owned board log path, or undefined when no board is resolved. */
    async getSelectedBoardLogPath(): Promise<string | undefined> {
        const root = this.currentBoardRoot();
        return root ? api.getBoardLogPath(root) : undefined;
    }

    /** Drop the live `<iframe>` reference and the board frame's CDP registration on
     *  teardown. `BoardWebview`'s unmount normally unregisters the frame, but `dispose()`
     *  can run without the normal board-frame teardown (forced close / window teardown), so clear
     * it here too — both are idempotent. Also the FINAL job teardown:
     *  `reapBoardOwner` tree-kills every job this board owner kept alive while busy —
     *  page close overrides busy ("page closed → kill anyway"). */
    override async dispose(): Promise<void> {
        this.sourceInbox.dispose();
        this.chrome.dispose();
        this.disposed = true;
        this.aiVision.beginDispose();
        this.setWorking(false);
        this.contentResources.dispose();
        // A custom-editor board opened via openRawLink is handed a FileProvider pipe by the
        // open-handler — dispose it for hygiene. `ensureContentPath` may have read
        // it since; disposing is correct either way.
        (this as { pipe?: { dispose?: () => void } }).pipe?.dispose?.();
        // Drop the materialized content cache (non-local sources only). The whole per-editor
        // subfolder goes, since the cache file lives inside one.
        if (this.state.get().contentCached && !appFs.isCacheIdProtected(this.id)) {
            try {
                await appFs.removeDir(appFs.resolveCachePath(this.id), true);
            } catch { /* best-effort cleanup — never block teardown */ }
        }
        markBoardBusy(this.id, undefined, false);
        void api.reapBoardOwner(this.id);
        this.aiVision.dispose();
        this.frameRegistry.dispose();
        void api.unregisterBoardFrame(this.id);
        await super.dispose();
    }
}
