import type { TComponentState } from "../../core/state/state";
import { EditorModel } from "../base/EditorModel";
import type { EditorRestoreOptions } from "../base/EditorModel";
import type { EditorDescriptor, HostDescriptor } from "../../../shared/persistence";
import { CONTENT_HOST_TRAIT, type IContentHostTrait } from "../base/editor-traits";
import { editorRegistry } from "../base/editorRegistry";
import { fpBasename } from "../../core/utils/file-path";
import { ui } from "../../api/ui";
import { TextFileModel, newTextFileModel } from "../text/TextEditorModel";
import { BoardEditorModel, type BoardEditorState } from "./BoardEditorModel";
import { boardEditorId } from "./custom-editor-registry";
import { errMessage } from "../../../shared/utils";

/**
 * Content-host board. A board that edits a file through Persephone's content host —
 * the same `TextFileModel` (`IContentHost`) that backs Monaco / Grid. Persephone owns
 * the pipe, encoding, encryption, auto-save cache, and dirty state; the board works with the
 * content over the `persephone.host.*` bridge. It switches with the built-in editors by
 * TRANSFERRING the shared host (no reload / no data loss), via `CONTENT_HOST_TRAIT`.
 *
 * Subclass of `BoardEditorModel`: inherits the iframe / trust / toolbar / automation / icon
 * machinery unchanged, and adds only the host composition (template: `MonacoEditor`). Built in the
 * `board-editor:<root>` construction branch when the manifest declares `editorKind: "content-host"`.
 */
export class BoardContentEditorModel extends BoardEditorModel {
    override readonly deferRestoreOnOpen = true;
    /** A real editor whose dirty state Persephone tracks (base board is `true`). */
    override skipSave = false;

    private _host: TextFileModel | null = null;
    private _hostStateUnsub: (() => void) | null = null;
    private _pendingHost: HostDescriptor | undefined = undefined;

    constructor(state: TComponentState<BoardEditorState>) {
        super(state);
        this.own(() => this._hostStateUnsub?.());
        const trait: IContentHostTrait = {
            extractContentHost: (): TextFileModel => {
                const host = this._host;
                if (!host) {
                    throw new Error("Host already extracted from BoardContentEditorModel");
                }
                this._hostStateUnsub?.();
                this._hostStateUnsub = null;
                this._host = null;
                return host;
            },
        };
        this.traits.add(CONTENT_HOST_TRAIT, trait);
    }

    // ── Host accessors ──────────────────────────────────────────────────

    override get contentHost(): TextFileModel | null {
        return this._host;
    }

    /** A content-host board is ALWAYS a custom file editor (it owns a content host) — even on an
     *  untitled page with no file path yet. So it keeps the virtual `board-editor:<root>` id
     *  (never the plain `board-view`), which both lets the switch widget highlight it and lets
     *  `switchMainEditor` recognize the board boundary when switching back to a built-in editor.
     *  Persistence still pins `"board-view"` via `getRestoreData`, so restore is unaffected. */
    override get editorId(): string {
        const root = this.state.get().boardRoot;
        return root ? boardEditorId(root) : "board-view";
    }

    /** While on the board, offer every built-in editor that accepts the host, plus this board.
     *  This uses the same `findEditorsAccepting(host)` call as built-in editors, so the options
     *  match theirs; for example, a `*.todo.json` board offers `Text Editor`, `ToDo`, and `Todo`.
     *  Content-host boards can edit HTTP, archive, and encrypted files because they do not use
     *  the base board's `isPlainLocalPath` check. `findEditorsAccepting` reads `filePath ?? title`
     *  so untitled pages stay resolvable. Before the host is adopted during window restore,
     *  this falls back to the single natural built-in editor. */
    override findCompatibleEditors(): string[] {
        const root = this.state.get().boardRoot;
        if (!root) return [];
        const builtins = this._host
            ? editorRegistry.findEditorsAccepting(this._host)
            : [editorRegistry.resolveId(this.currentFilePath() ?? this.title) ?? "monaco"];
        return [...builtins, boardEditorId(root)];
    }

    // ── Host transfer on editor switch (template: MonacoEditor.switchFrom) ──

    override switchFrom(oldEditor: EditorModel): void {
        const trait = oldEditor.traits.get(CONTENT_HOST_TRAIT);
        if (!trait) {
            throw new Error(
                `BoardContentEditorModel.switchFrom: ${oldEditor.editorId} has no CONTENT_HOST_TRAIT`,
            );
        }
        const host = trait.extractContentHost();

        // Preserve the editor id across the host swap so editor-owned cache files remain associated.
        this.state.update((s) => { s.id = oldEditor.id; });
        // `host.state.editor` is stamped "board-view" inside `adoptHost` (Concern ).
        this.adoptHost(host);
    }

    /** Adopt a host (from `switchFrom`, from construction, or from `restore`). Wires host
     *  state → `descriptorChanged` for persistence, copies title/id, forwards `page`. */
    adoptHost(host: TextFileModel): void {
        this._host = host;
        this._hostStateUnsub?.();
        this._hostStateUnsub = host.state.subscribe(() => {
            const { filePath, title } = host.state.get();
            const hostTitle = title || (filePath ? fpBasename(filePath) : this.state.get().title);
            if (this.state.get().title !== hostTitle) {
                this.state.update((s) => { s.title = hostTitle; });
            }
            this.descriptorChanged.send(undefined);
            if (!host.io.providerError && this.state.get().contentHostError) {
                this.state.update((s) => { s.contentHostError = undefined; });
            }
        });
        const { filePath, title, id } = host.state.get();
        this.state.update((s) => {
            // Tab shows the FILE name; the board's own icon remains state-derived.
            s.title = title || (filePath ? fpBasename(filePath) : s.title);
            if (id) s.id = id;
        });
        // Mark the host as board-rendered for introspection consistency (Concern ).
        // "board-view" is the valid EditorView token (there is no "board"); it is never
        // persisted (`getDescriptor` omits `editor`) and is overwritten by the receiving
        // built-in's `switchFrom` on a switch away.
        host.state.update((s) => {
            if (s.editor !== "board-view") s.editor = "board-view";
        });
        if (this.page) host.setPage(this.page);
    }

    override setPage(page: Parameters<EditorModel["setPage"]>[0]): void {
        super.setPage(page);
        this._host?.setPage(page);
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    /** Board validation (trust, refreshBoards, legacy-throw) via `super.restore()`, THEN ensure
     * the content host. Prefers an already-adopted host and pre-builds the pipe for non-local
     *  files); otherwise builds a fallback from `_pendingHost` or the local file path. */
    override async restore(options?: EditorRestoreOptions): Promise<void> {
        await super.restore();
        try {
            if (!this._host) {
                this._host = this._pendingHost
                    ? await TextFileModel.fromDescriptor(this._pendingHost)
                    : newTextFileModel(this.currentFilePath() ?? "");
            }
            if (!this._host.state.get().restored) {
                await this._host.restore(options);
            }
            this.adoptHost(this._host);
            this.state.update((s) => { s.contentHostError = this._host?.io.providerError; });
        } catch (err) {
            const message = errMessage(err, "Failed to restore board content.");
            ui.notify(message, "error");
            // Drives the host-restore-failure empty state in the view.
            this.state.update((s) => { s.contentHostError = message; });
        }
        this._pendingHost = undefined;
    }

    // ── Persistence ─────────────────────────────────────────────────────

    /** Base board pins `editorId: "board-view"` + the full board state; we add the host
     *  descriptor. `d.host` present on a `board-view` descriptor is the content-host-vs-plain
     *  discriminator at restore in the `restorePage` branch. */
    override getRestoreData(): EditorDescriptor {
        const data = super.getRestoreData();
        data.host = this._host?.getDescriptor();
        return data;
    }

    override applyRestoreData(
        data: Parameters<EditorModel<BoardEditorState>["applyRestoreData"]>[0],
    ): void {
        super.applyRestoreData(data);
        if (data.host) this._pendingHost = data.host;
    }

    // ── Save / dirty (delegate to host) ─────────────────────────────────

    /** Dirty lives on the composed host, not on this editor's own state (which never
     *  sets `modified`). Without this override, `PageModel.modified` — which aggregates
     *  the raw editor instances, not their unwrapped hosts — reports false for a dirty
     *  content-host board (the tab dot was right, the `pages` summary was wrong). */
    override get modified(): boolean {
        return this._host?.modified ?? false;
    }

    override async saveState(): Promise<void> {
        await this._host?.io.saveState();
    }

    override async confirmRelease(closing?: boolean): Promise<boolean> {
        return this._host ? this._host.confirmRelease(closing) : true;
    }

    // ── Content bridge  — the view (`BoardWebview`) owns the echo-guard ──

    /** Apply content the board wrote (`persephone.host.setContent`). `byUser` true → marks the file
     *  modified + schedules the autosave cache, exactly like a Monaco/Grid user edit. */
    hostChangeContent(content: string): void {
        this._host?.changeContent(content, true);
    }

    /** Save through the pipe (Ctrl+S fallback or `persephone.host.save()`). */
    hostSave(): void {
        void this._host?.saveFile();
    }

    // ── No busy for content-host boards (CH7) ───────────────────────────

    /** The host TRANSFERS OUT on switch, so a surviving host-less board is a broken zombie, and
     *  duplicating the host would give two unsynchronized writers of the same file. So no busy. */
    override setBusy(_busy: boolean): void {
        console.warn(
            "[BoardContentEditorModel] setBoardBusy is not supported for content-host boards — ignoring.",
        );
    }

    override keepAliveOnNavigation(): boolean {
        return false;
    }

    override survivesNavigation(): boolean {
        return false;
    }

    // ── Dispose (host first, then board teardown) ───────────────────────

    override async dispose(): Promise<void> {
        this._hostStateUnsub?.();
        this._hostStateUnsub = null;
        if (this._host) {
            await this._host.dispose();
            this._host = null;
        }
        await super.dispose();
    }
}
