// =============================================================================
// MOCKUP — EditorModel base class
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Replaces today's EditorModel at /src/renderer/editors/base/EditorModel.ts.
//
// Updated by walkthrough 01:
//   - A3: isFreshEmpty() default-false getter.
//   - A6: descriptorChanged Subscription for page-level persistence trigger.
//   - A7: three-phase lifecycle — applyRestoreData → switchFrom → restore.
//          Adds findCompatibleEditors() for switch-widget support.
//   - A8: secondaryEditor setter becomes a pure state mutation (no side
//          effects). Page-level membership is owned by PageModel.editors[]
//          (unified-array shape). Visibility criterion is enforced by
//          PageModel via the panels-changed notification (mechanism defers
//          to walkthrough 03).
//
// Updated by walkthrough 08 (T2 / B2):
//   - `contentHost: IContentHost | null` accessor on the base class. Returns
//      null by default; text-bearing subclasses override to return their
//      internal `_host` field. The cross-cutting primitive that
//      `PagesQueryModel.getTextFileHost`, the switch widget (walkthrough 09),
//      and TextChrome (walkthrough 10) all consume.
//
// Updated by walkthrough 04 (P1, P6 / B1, C3):
//   - `abstract readonly editorId: string` — registry key (S10/B1). Each
//      subclass sets it to its registry id ("monaco", "grid-json", …).
//      Replaces the today-pair `IEditorState.type` + `IEditorState.editor`.
//   - `getRestoreData(): EditorDescriptor` — new return type from the
//      unified persistence shape (mockup `PersistenceTypes.ts`).
//   - `applyRestoreData(data: RestoreData<S>)` — accepts a partial state
//      slice + optional `host?: HostDescriptor` + optional ComponentQueue
//      passthroughs (`revealLine`, `highlightText`, …). Text-bearing editors
//      destructure `host` to stash for use in `restore()`.
//   - The shared `IEditorState` type is retired (mockup `PersistenceTypes.ts`).
//      Each subclass defines its own state shape locally; the base class only
//      requires `id`, `title`, `modified`, `secondaryEditor?` (sketched as
//      `EditorStateBase` below).
// =============================================================================

import { TraitSet } from "../../../src/renderer/core/traits/traits";
import { Subscription } from "../../../src/renderer/core/state/events";
import type { PageModel } from "../../../src/renderer/api/pages/PageModel";
import { TDialogModel } from "../../../src/renderer/core/state/model";
import { fs as appFs } from "../../../src/renderer/api/fs";
import { ComponentQueue, ComponentQueueEvent } from "./ComponentQueue";
import type { EditorDescriptor, HostDescriptor } from "./PersistenceTypes";

// -----------------------------------------------------------------------------
// Minimal in-memory state shape every editor implements.
//
// Replaces the today-shared `IEditorState` (which is retired by walkthrough 04
// per P1). Each subclass extends this with its own fields — no shared flat
// shape that mixes editor and host concerns. `pipe` / `content` / `filePath`
// move to the host (TextFileModel); `type` / `editor` are gone (S10).
// -----------------------------------------------------------------------------

export interface EditorStateBase {
    /** Editor instance UUID — the cache-file prefix (C9). On switchFrom,
     *  the new editor copies this from the old editor so cache files survive. */
    id: string;
    title: string;
    modified: boolean;
    /** Panel contributions for the sidebar. See A8 / walkthrough 03. */
    secondaryEditor?: string[];
}

/** Partial state used by `applyRestoreData`. Subclasses widen S with their own
 *  fields; text-bearing editors also accept a `host?: HostDescriptor` and
 *  optional ComponentQueue passthroughs.
 *
 *  Walkthrough 04 / P6 / C3. */
export type RestoreData<S extends EditorStateBase = EditorStateBase> = Partial<S> & {
    host?: HostDescriptor;
    /** ComponentQueue passthroughs (S4 / walkthrough 02). Editors that don't
     *  use the queue ignore these. */
    revealLine?: number;
    highlightText?: string;
};

/**
 * Editor-scoped cache storage. The editor's id is the cache-file prefix;
 * names are role suffixes (e.g. "host", "monaco", "grid", "script-panel").
 * Resulting filenames: `<editor.id>-<name>.<ext>` where the extension is
 * decided by the fs cache helpers.
 */
export interface EditorStateStorage {
    getState(name: string): Promise<string | undefined>;
    setState(name: string, state: string): Promise<void>;
}

export class EditorModel<
    T extends EditorStateBase = EditorStateBase,
    R = unknown,
    E extends ComponentQueueEvent = ComponentQueueEvent,
>
    extends TDialogModel<T, R>
{
    // -------------------------------------------------------------------------
    // Registry identity (B1 — walkthrough 02; C3 — walkthrough 04)
    //
    // Each subclass sets this to its registry id ("monaco", "grid-json",
    // "pdf-view", "browser-view", …). Stable across the editor's lifetime —
    // never mutated. Used by:
    //   - `editorRegistry.createEditor(editorId, instanceId?)` to pick the class
    //   - `PageModel.switchMainEditor` short-circuit (S10)
    //   - the switch widget's "current" highlight
    //   - persistence (`EditorDescriptor.editorId`)
    //   - any runtime "what kind of editor is this" check (replaces today's
    //     `state.type` discriminator)
    // -------------------------------------------------------------------------

    abstract readonly editorId: string;
    // -------------------------------------------------------------------------
    // Component queue (S4 — walkthrough 02)
    //
    // Mailbox for model → view commands that may fire before the React view
    // is mounted. FIFO; no coalescing (sender's responsibility).
    //
    // Subclasses narrow E to their own event union (Monaco: revealLine,
    // highlightText, focus; Grid: scrollToCell; etc.). Editors that don't
    // need imperative view commands ignore the queue entirely.
    //
    // Disposed by EditorModel.dispose() so an editor that closes before its
    // view mounts doesn't leak buffered events. See ComponentQueue.ts.
    // -------------------------------------------------------------------------

    readonly queue: ComponentQueue<E> = new ComponentQueue<E>();

    // -------------------------------------------------------------------------
    // Editor-level traits
    // -------------------------------------------------------------------------

    /**
     * Editor capability bag. Populated by subclass constructors with
     * trait implementations. Owners check `traits.has(KEY)` to decide
     * what is possible:
     *
     *   if (editor.traits.has(CONTENT_HOST_TRAIT)) renderSwitchUI();
     *
     * Today the only editor-side trait is CONTENT_HOST_TRAIT (single-method,
     * see traits.ts). Future capabilities can be added without changing
     * this base class.
     */
    readonly traits = new TraitSet();

    // -------------------------------------------------------------------------
    // Persistence-change signal (A6 — walkthrough 01)
    // -------------------------------------------------------------------------

    /**
     * Fired when this editor's persisted shape (`getRestoreData()` blob) changes.
     * PagesModel subscribes to drive `saveStateDebounced`. Base class auto-fires
     * on every state mutation; subclasses with additional reactive surfaces
     * (e.g., a content host) MUST forward those onto this Subscription.
     */
    readonly descriptorChanged = new Subscription<void>();

    constructor(/* … */) {
        super(/* … */);
        // Default behavior: any state mutation is a persistence-worthy change.
        this.state.subscribe(() => this.descriptorChanged.send());
    }

    // -------------------------------------------------------------------------
    // Cache storage (C9 — walkthrough 01 follow-up)
    //
    // Each editor exposes a stateStorage scoped to its own id. Submodels
    // (host, script panel, view-state) write under `<this.id>-<name>` via
    // this handle. The id is read lazily, so when switchFrom copies an id
    // from an old editor onto this one, future writes use the new (inherited)
    // id automatically.
    //
    // Cache cleanup is NOT done by editor.dispose(). The page tracks
    // "id release" — when an editor goes away without a successor copying
    // its id — and calls `fs.deleteCacheFiles(editor.id)` at that moment.
    // -------------------------------------------------------------------------

    readonly stateStorage: EditorStateStorage = {
        getState: (name: string) => appFs.getCacheFile(this.id, name),
        setState: (name: string, state: string) => appFs.saveCacheFile(this.id, state, name),
    };

    // -------------------------------------------------------------------------
    // Page reference
    // -------------------------------------------------------------------------

    /** Set when this editor is attached to a PageModel (via PageModel.attach). */
    page: PageModel | null = null;

    setPage(page: PageModel | null): void {
        this.page = page;
    }

    // -------------------------------------------------------------------------
    // Lifecycle hooks — Phase 2 (A7 — walkthrough 01)
    //
    // Owners call ONE of applyRestoreData or switchFrom (or neither, for
    // fresh-empty pages) between createEditor and restore.
    // -------------------------------------------------------------------------

    /**
     * Remember persisted / file-open setup data for use in restore(). Sync.
     * Does NOT do I/O. Default just stashes the data; subclasses may parse
     * minimal fields they need before restore().
     *
     * Walkthrough 04 / P6 / C3: the accepted shape is `RestoreData<S>`,
     * which is `Partial<S>` widened with optional `host?: HostDescriptor`
     * and optional ComponentQueue passthroughs (revealLine, highlightText).
     * Text-bearing editors destructure `host` to stash for `restore()`;
     * passthroughs fire onto `this.queue` so the React view picks them up
     * when it mounts.
     */
    applyRestoreData(_data: RestoreData<T>): void {
        // Override in subclasses. Base behavior:
        //   - title / modified / secondaryEditor — update from data
        //   - editorId is NOT here — it's the abstract field set at the class
        //     level and used by the registry to pick the class.
        //   - id is NOT here — it's set at construction via
        //     editorRegistry.createEditor(editorId, instanceId?) (C2).
        //   - host (text-bearing editors only) — stash on _pendingHost for
        //     restore() to consume.
        //   - revealLine / highlightText (Monaco / Grid / …) — translate to
        //     this.queue.send({type: ..., ...}) so the mounted view drains them.
    }

    /**
     * Pull whatever is transferable from `oldEditor`. Text-bearing editors:
     *  (1) copy `oldEditor.id` into this editor's `state.id` so the cache
     *      prefix transfers (C9 — `<id>-host.txt`, `<id>-script-panel.json`
     *      remain valid for the new editor);
     *  (2) extract the host via `oldEditor.traits.get(CONTENT_HOST_TRAIT)`;
     *  (3) call `host.setStorage(this.stateStorage)` so the host writes its
     *      content cache under the (now-shared) id.
     * Throws if the old editor cannot give up what this editor needs.
     */
    switchFrom(_oldEditor: EditorModel): void {
        throw new Error(`${this.constructor.name} does not implement switchFrom`);
    }

    // -------------------------------------------------------------------------
    // Lifecycle hook — Phase 3 (A7 — walkthrough 01)
    // -------------------------------------------------------------------------

    /**
     * Realize the editor. Creates the host (if not already adopted via
     * switchFrom), restores from cache/disk, subscribes to host state for
     * descriptorChanged forwarding, parses content, finalizes UI state.
     *
     * Failure handling is INTERNAL: text-bearing editors wrap host
     * construction/restore in try/catch and fall back to an empty host
     * with `ui.notify("…", "error")`. Data loss is acceptable for this
     * edge case (the failure mode is "construction crashed").
     *
     * After restore() resolves, the editor is fully usable.
     */
    async restore(): Promise<void> {
        // Override in subclasses.
    }

    // -------------------------------------------------------------------------
    // Lifecycle hooks — secondary editor reactions
    // -------------------------------------------------------------------------

    /** Called before this editor is replaced as page.mainEditor. Inspect
     *  newModel.sourceLink to decide whether to keep secondaryEditor set
     *  (survive as a sidebar panel). Base implementation clears it. */
    beforeNavigateAway(_newModel: EditorModel): void {
        this.secondaryEditor = undefined;
    }

    /** Called on every editor in `page.editors[]` (except the new main)
     *  when the page's mainEditor changes. Editors react independently —
     *  e.g., ArchiveEditor self-evicts when the new main wasn't opened
     *  from its archive. */
    onMainEditorChanged(_newMainEditor: EditorModel | null): void { /* override */ }

    /** Called when activePanel changes to one this editor owns. */
    onPanelExpanded(_panelId: string): void { /* override */ }

    // -------------------------------------------------------------------------
    // Panel contribution (A8 — walkthrough 01; details: walkthrough 03)
    //
    // The `secondaryEditor` setter is now a PURE state mutation. The side
    // effects (`page.addSecondaryEditor` / `removeSecondaryEditorWithoutDispose`)
    // are gone — PageModel.editors[] is the single membership array.
    //
    // PageNavigator reads panel contributions on render and per editor
    // notification (mechanism: walkthrough 03). The visibility criterion
    // enforced by PageModel is:
    //
    //   keep in editors[] iff (editor.id === _mainEditorId)
    //                       OR (editor.contributesPanels())
    //
    // `contributesPanels()` is currently defined as
    // `(state.secondaryEditor?.length ?? 0) > 0` — walkthrough 03 may
    // formalize it as a method.
    // -------------------------------------------------------------------------

    get secondaryEditor(): string[] | undefined {
        return this.state.get().secondaryEditor;
    }

    set secondaryEditor(value: string[] | undefined) {
        this.state.update((s) => { s.secondaryEditor = value; });
        // No side effects. PageModel watches for visibility flips and
        // detaches+disposes when the editor becomes invisible.
    }

    /** True if this editor currently contributes panels to the PageNavigator.
     *  Read by PageModel for the visibility criterion. Walkthrough 03 may
     *  formalize the shape. */
    contributesPanels(): boolean {
        return (this.state.get().secondaryEditor?.length ?? 0) > 0;
    }

    // -------------------------------------------------------------------------
    // Switch widget support (A7 — walkthrough 01)
    // -------------------------------------------------------------------------

    /**
     * Editor ids the user can switch to from this editor. Default: empty
     * (no switching). Text-bearing editors return
     * `editorRegistry.findEditorsAccepting(this._host)`.
     *
     * The switch widget (walkthrough 09) renders when this returns non-empty.
     */
    findCompatibleEditors(): string[] {
        return [];
    }

    // -------------------------------------------------------------------------
    // Fresh-empty detection (A3 — walkthrough 01)
    // -------------------------------------------------------------------------

    /**
     * True if this editor wraps a never-touched, never-saved empty document.
     * Used by PagesModel.closeFirstPageIfEmpty to silently replace the
     * auto-created empty page when the user opens their first real file.
     *
     * Default: false. Override on the default-empty editor (Monaco) only.
     */
    isFreshEmpty(): boolean {
        return false;
    }

    // -------------------------------------------------------------------------
    // Standard state getters
    // -------------------------------------------------------------------------

    get id(): string { return this.state.get().id; }
    get title(): string { return this.state.get().title; }
    get modified(): boolean { return this.state.get().modified; }

    // NOTE: `type` getter removed (S10 / walkthrough 02). Runtime classification
    // uses `editorId` (registry key) or `instanceof` / `traits.has(KEY)`.
    //
    // NOTE: filePath and language getters disappear from the BASE.
    // Editors that wrap an IContentHost expose them via the host:
    //   editor.contentHost.state.get().language
    // Editors without a host (PDF, Browser) declare their own.

    // -------------------------------------------------------------------------
    // Content-host accessor (walkthrough 08 / T2 / B2)
    //
    // Returns the IContentHost this editor wraps, or null. Text-bearing
    // editors (Monaco, Grid, Markdown, …) override to return their `_host:
    // TextFileModel` field. Notebook's per-note embedded editors return
    // their `_host: NoteItemEditModel` (walkthrough 29). Non-host editors
    // (PDF, Image, Browser, Settings, …) inherit the null default.
    //
    // Consumers:
    //   - `PagesQueryModel.getTextFileHost(pageId)` — the centralized helper
    //      that wraps `findPage(pageId)?.mainEditor?.contentHost instanceof
    //      TextFileModel`. Used by PageTab (walkthrough 08 / T2), the
    //      page-level toolbar / switch widget (walkthrough 09), and
    //      TextChrome (walkthrough 10) — anywhere a tab strip / toolbar /
    //      chrome needs to read TextFileModel-specific fields or call
    //      TextFileModel-specific methods.
    //   - Switch widget rendering inside the page-level toolbar
    //      (walkthrough 09) calls `editor.contentHost` to check whether to
    //      render at all (null host → no switch widget).
    //   - TextChrome host-instanceof branching (walkthrough 10 / C1).
    //
    // PageTab does NOT call this directly — it routes through the
    // PagesQueryModel helper to keep the host-type check centralized
    // (walkthrough 08 / T2). The accessor is the cross-cutting primitive
    // those helpers wrap.
    // -------------------------------------------------------------------------

    get contentHost(): import("./IContentHost").IContentHost | null {
        return null;
    }

    // -------------------------------------------------------------------------
    // Persistence (each editor implements its own get/set; restore in A7)
    // -------------------------------------------------------------------------

    async saveState(): Promise<void> { /* override */ }

    /**
     * Persisted shape for this editor. Returned to `PagesPersistenceModel`
     * during `saveState` and re-fed (alongside the matching descriptor for
     * each editor) at restore time.
     *
     * Default base implementation: editorId + id + opaque state slice. Text-
     * bearing subclasses override to add `host`:
     *
     *     getRestoreData(): EditorDescriptor {
     *         return {
     *             ...super.getRestoreData(),
     *             host: this._host?.getDescriptor(),
     *         };
     *     }
     *
     * Walkthrough 04 / P1 / C3.
     */
    getRestoreData(): EditorDescriptor {
        const s = this.state.get();
        return {
            editorId: this.editorId,
            id: s.id,
            state: s as unknown as Record<string, unknown>,
        };
    }

    // -------------------------------------------------------------------------
    // Release & dispose
    // -------------------------------------------------------------------------

    async confirmRelease(_closing?: boolean): Promise<boolean> { return true; }

    /** Each editor subclass disposes its own in-memory state. Text-bearing
     *  editors ALSO dispose their IContentHost if-and-only-if it was not
     *  extracted (see CONTENT_HOST_TRAIT.extractContentHost docs).
     *
     *  NOTE: dispose() does NOT clean cache files. The page tracks "id
     *  release" (id not transferred to a successor) and calls
     *  `fs.deleteCacheFiles(editor.id)` at that point. C9.
     *
     *  Subclass overrides MUST call super.dispose() (or `this.queue.dispose()`)
     *  so the component queue drops any pending events. */
    async dispose(): Promise<void> {
        this.queue.dispose();
    }

    // -------------------------------------------------------------------------
    // Script scratch
    // -------------------------------------------------------------------------

    scriptData: Record<string, unknown> = {};

    // -------------------------------------------------------------------------
    // Optional UI hooks
    // -------------------------------------------------------------------------

    getIcon?: () => React.ReactNode;
    noLanguage = false;
    skipSave = false;
}
