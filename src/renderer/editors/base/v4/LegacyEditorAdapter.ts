import {
    EditorModel as V4EditorModel,
    type EditorStateBase,
    type RestoreData,
} from "./EditorModel";
import type { IContentHost } from "./IContentHost";
import { CONTENT_HOST_TRAIT } from "./editor-traits";
import type { EditorDescriptor } from "../../../../shared/persistence-v4";
import type { IEditorState, EditorView } from "../../../../shared/types";
import type { EditorModel as LegacyEditorModel } from "../EditorModel";
import type { PageModel } from "../../../api/pages/PageModel";
import type { IContentPipe } from "../../../api/types/io.pipe";
import { editorRegistry as legacyRegistry } from "../../registry";

/**
 * Strangler-fig adapter for EPIC-028. Presents a legacy `EditorModel` (file at
 * [`../EditorModel.ts`](../EditorModel.ts)) through the v4 `EditorModel` surface
 * defined in US-547. The wrapped legacy editor is `this.legacy`; its `state` is
 * adopted as the adapter's `state` so descriptorChanged forwarding works
 * without copying.
 *
 * Per-editor migrations (US-551 onward) replace adapter-wrapped registrations
 * with native v4 editors; US-559 deletes the adapter and the v3 dual-read path.
 */
export type LegacyEditorState = EditorStateBase & IEditorState;

export class LegacyEditorAdapter extends V4EditorModel<LegacyEditorState> {
    legacy: LegacyEditorModel;

    /** US-551 — target editorId passed to the constructor. Consumed by
     *  `switchFrom` to mutate the adopted host's `state.editor` discriminator
     *  so the legacy `<ActiveEditor>` renders the correct content-view
     *  (grid-json / md-view / etc.) after a cross-camp swap from a v4-native
     *  editor (e.g., MonacoEditor). */
    private readonly _pendingEditorId: string | null;

    /** US-551 — set to true once `CONTENT_HOST_TRAIT.extractContentHost` runs.
     *  `dispose()` checks this flag and skips `legacy.dispose()` because the
     *  new editor now owns the host. */
    private _hostExtracted = false;

    constructor(legacy: LegacyEditorModel, editorId?: string) {
        // Pass legacy.state directly — single source of truth. The v4 base
        // ctor wires this.state.subscribe to fire descriptorChanged on every
        // mutation, which covers every legacy mutation path.
        super(legacy.state as unknown as import("../../../core/state/state").IState<LegacyEditorState>);
        this.legacy = legacy;
        this._pendingEditorId = editorId ?? null;
        // Mirror legacy editor fields onto this adapter so v4-shaped reads
        // see them. The legacy editor mutates these directly (e.g.,
        // `editor.pipe = X`); the adapter mirrors via getters/setters below.
        this.pipe = legacy.pipe;
        this.scriptData = legacy.scriptData as Record<string, unknown>;
        this.noLanguage = legacy.noLanguage;
        this.getIcon = legacy.getIcon;
        this.skipSave = legacy.skipSave;

        // US-551 — register CONTENT_HOST_TRAIT when the wrapped legacy editor
        // is a TextFileModel. The legacy class already exposes the v4
        // IContentHost contract (content/language/changeContent/etc.); we
        // cast through unknown to satisfy the type system without forcing a
        // structural import here.
        if ((legacy as unknown as { type?: string }).type === "textFile") {
            this.traits.add(CONTENT_HOST_TRAIT, {
                extractContentHost: (): IContentHost => {
                    this._hostExtracted = true;
                    return this.legacy as unknown as IContentHost;
                },
            });
        }
    }

    /** Re-derived on every read so view switches (legacy
     *  `model.changeEditor(view)` mutates `state.editor`) immediately
     *  reflect in the switch widget's selected segment. */
    get editorId(): string {
        return deriveEditorId(this.legacy.state.get());
    }

    /** Forward v4 setPage to legacy.setPage so legacy editor setter side
     *  effects (`secondaryEditor` setter → `page.addSecondaryEditor(this)`)
     *  still flow into the page. PageModel keeps compat shims to receive these.
     *
     *  EPIC-028 / US-551 — once `CONTENT_HOST_TRAIT.extractContentHost` ran,
     *  the host's page reference is owned by its new wrapping editor. Don't
     *  forward setPage here or we'd clobber the new editor's page wiring when
     *  PageModel.detach calls setPage(null) on us during the swap. */
    setPage(page: PageModel | null): void {
        super.setPage(page);
        if (!this._hostExtracted) {
            this.legacy.setPage(page);
        }
    }

    // ── Three-phase lifecycle ─────────────────────────────────────────

    applyRestoreData(data: RestoreData<LegacyEditorState>): void {
        // Strip v4-only RestoreData fields (host, revealLine, highlightText)
        // before forwarding. Legacy editors don't use ComponentQueue
        // passthroughs — Monaco rev/highlight migrate to queue events
        // in US-551.
        const rest = { ...(data as Record<string, unknown>) };
        delete rest.host;
        delete rest.revealLine;
        delete rest.highlightText;
        this.legacy.applyRestoreData(rest as Partial<IEditorState>);
    }

    /**
     * EPIC-028 / US-551 — host adoption for cross-camp switches from a
     * v4-native editor (e.g., MonacoEditor → Grid). The bridge factory in
     * register-editors.ts constructed us with a placeholder legacy
     * TextFileModel; here we extract the real host from `oldEditor` via
     * CONTENT_HOST_TRAIT, swap `this.legacy` to point at it, rewire the
     * state pointer + descriptorChanged auto-sub onto the host's state, and
     * mutate `state.editor` so the legacy `<ActiveEditor>` renders the
     * target content-view.
     */
    switchFrom(oldEditor: V4EditorModel): void {
        const trait = oldEditor.traits.get(CONTENT_HOST_TRAIT);
        if (!trait) {
            throw new Error(
                `LegacyEditorAdapter.switchFrom: ${oldEditor.editorId} has no CONTENT_HOST_TRAIT`,
            );
        }
        const host = trait.extractContentHost() as unknown as LegacyEditorModel;
        if ((host as unknown as { type?: string }).type !== "textFile") {
            throw new Error(
                "LegacyEditorAdapter.switchFrom: extracted host is not a TextFileModel",
            );
        }

        // Dispose the placeholder legacy we were constructed with. The host
        // we just adopted is the real, restored TextFileModel.
        const placeholder = this.legacy;

        // Swap legacy and state pointers. `state` is declared `readonly` on
        // TModel; cast through unknown to mutate.
        this.legacy = host;
        (this as unknown as {
            state: import("../../../core/state/state").IState<LegacyEditorState>;
        }).state = host.state as unknown as import("../../../core/state/state").IState<LegacyEditorState>;

        // Rewire descriptorChanged auto-sub from placeholder.state → host.state.
        this._stateAutoUnsub?.();
        this._stateAutoUnsub = host.state.subscribe(() =>
            this.descriptorChanged.send(undefined),
        );

        // Mutate host.state.editor so legacy <ActiveEditor> picks the right
        // content-view (grid-json / md-view / mermaid-view / etc.). editorId
        // getter (re-derives on every read) automatically reflects this.
        if (this._pendingEditorId) {
            host.state.update((s) => {
                s.editor = this._pendingEditorId as EditorView;
            });
        }

        // Mirror page reference + carry pipe over. The host's `page` was set
        // by its previous v4 owner; PageModel.setMainEditor will call setPage
        // on us next, which forwards to legacy.setPage — keeping the
        // back-reference current.
        this.pipe = host.pipe;

        // Discard the placeholder. It was never wired to a page or pipe; its
        // dispose() drains the IO submodel (no-op since no pipe) and clears
        // the ScriptPanel debounce timer.
        void placeholder.dispose().catch((): void => undefined);
    }

    async restore(): Promise<void> {
        // EPIC-028 / US-551 — when this adapter adopted a host via switchFrom
        // (cross-camp swap from v4-native MonacoEditor → legacy content-view),
        // the host is already restored. Re-running legacy.restore() would
        // re-read pipe content + recreate cachePipe + reset ScriptPanel state,
        // which silently breaks the swap (the markdown view ends up blank).
        // Skip when restored=true. Per-editor migrations (US-552+) replace
        // this whole adapter; US-559 deletes it.
        const alreadyRestored = (this.legacy.state.get() as { restored?: boolean }).restored === true;
        if (alreadyRestored) return;
        await this.legacy.restore();
    }

    // ── Reaction hooks — delegate to legacy ────────────────────────────

    beforeNavigateAway(newModel: V4EditorModel): void {
        const newLegacy = newModel instanceof LegacyEditorAdapter
            ? newModel.legacy
            : (newModel as unknown as LegacyEditorModel);
        this.legacy.beforeNavigateAway(newLegacy);
    }

    onMainEditorChanged(newMain: V4EditorModel | null): void {
        const newLegacy = newMain instanceof LegacyEditorAdapter
            ? newMain.legacy
            : (newMain as unknown as LegacyEditorModel | null);
        this.legacy.onMainEditorChanged(newLegacy);
    }

    onPanelExpanded(panelId: string): void {
        this.legacy.onPanelExpanded(panelId);
    }

    contributesPanels(): boolean {
        const se = (this.legacy.state.get() as IEditorState).secondaryEditor;
        return (se?.length ?? 0) > 0;
    }

    // ── secondaryEditor — delegate to legacy (with side effects intact) ─

    get secondaryEditor(): string[] | undefined {
        return this.legacy.secondaryEditor;
    }

    set secondaryEditor(value: string[] | undefined) {
        this.legacy.secondaryEditor = value;
    }

    // ── Fresh-empty (replaces hardcoded check in closeFirstPageIfEmpty) ─

    isFreshEmpty(): boolean {
        const s = this.legacy.state.get() as IEditorState & { content?: string };
        return s.type === "textFile"
            && !s.modified
            && !s.filePath
            && !s.content;
    }

    // ── Switch widget support ─────────────────────────────────────────

    findCompatibleEditors(): string[] {
        const s = this.legacy.state.get() as IEditorState;
        const opts = legacyRegistry.getSwitchOptions(s.language ?? "", s.filePath);
        return opts.options;
    }

    // ── Content-host accessor (US-549) ────────────────────────────────

    /** Duck-typed cast: TextFileModel exposes everything `<TextChrome>` reads
     *  (state, script, runScript, handleKeyDown, encoding, language,
     *  setEditorToolbarRefFirst/Last, setFooterRefLast, setEditorOverlayRef).
     *  Per-editor migration US-551 turns this into a real
     *  `TextFileModel implements IContentHost`. */
    get contentHost(): IContentHost | null {
        const type = (this.legacy.state.get() as { type?: string }).type;
        if (type === "textFile") {
            return this.legacy as unknown as IContentHost;
        }
        return null;
    }

    // ── Navigator-target accessor (US-549 / PT5 / B3) ─────────────────

    getNavigatorTarget(): { pipe?: IContentPipe | null; filePath?: string | null } | null {
        const legacyState = this.legacy.state.get() as {
            filePath?: string;
            type?: string;
        };
        const filePath = legacyState.filePath ?? null;
        const pipe = (this.legacy.pipe as IContentPipe | null | undefined) ?? null;
        const type = legacyState.type;

        switch (type) {
            case "textFile":
                if (!pipe && !filePath) return {};
                return { pipe, filePath };
            case "pdf":
            case "image":
                return { pipe, filePath };
            case "video":
                return { pipe: null, filePath };
            case "archive":
            case "category":
                return {};
            default:
                return null;
        }
    }

    // ── Selection probe (US-549 / PT7 / B2) ───────────────────────────

    /** True if the wrapped legacy editor surfaces a non-empty selection.
     *  Monaco's TextViewModel exposes `hasSelection` on its state; non-Monaco
     *  views don't have one — `getTextViewModel()` returns null. */
    hasTextSelection(): boolean {
        const legacy = this.legacy as unknown as {
            getTextViewModel?: () => { state: { get(): { hasSelection?: boolean } } } | null | undefined;
        };
        const vm = legacy.getTextViewModel?.();
        return vm?.state.get().hasSelection === true;
    }

    // ── Legacy-method delegation ──────────────────────────────────────

    changeLanguage(language: string | undefined): void {
        this.legacy.changeLanguage(language);
    }

    // ── Persistence ───────────────────────────────────────────────────

    getRestoreData(): EditorDescriptor {
        const legacyState = this.legacy.getRestoreData() as IEditorState;
        return {
            editorId: this.editorId,
            id: legacyState.id,
            state: legacyState as unknown as Record<string, unknown>,
            host: undefined,
        };
    }

    async confirmRelease(closing?: boolean): Promise<boolean> {
        return this.legacy.confirmRelease(closing);
    }

    async saveState(): Promise<void> {
        await this.legacy.saveState?.();
    }

    async dispose(): Promise<void> {
        // Dispose v4 base first so the queue drains; then dispose legacy
        // (which handles pipe disposal + fs.deleteCacheFiles). Skip the
        // legacy dispose when CONTENT_HOST_TRAIT.extractContentHost ran —
        // the new editor (e.g., MonacoEditor) now owns the host.
        await super.dispose();
        if (!this._hostExtracted) {
            await this.legacy.dispose();
        }
    }
}

/**
 * Resolve the v4 editorId for a legacy editor's persisted state.
 *
 *   - text-bearing editors (type="textFile") use `state.editor` (e.g., "monaco",
 *     "grid-json", "link-view") as the view discriminator.
 *   - non-text editors use the legacy registry def whose editorType matches.
 *   - fallback "monaco" handles the bare new empty-page case (state.editor undefined).
 */
export function deriveEditorId(legacyState: Partial<IEditorState>): string {
    if (legacyState.type === "textFile" && legacyState.editor) {
        return legacyState.editor;
    }
    if (legacyState.type) {
        const def = legacyRegistry.getAll().find((e) => e.editorType === legacyState.type);
        if (def) return def.id;
    }
    return "monaco";
}
