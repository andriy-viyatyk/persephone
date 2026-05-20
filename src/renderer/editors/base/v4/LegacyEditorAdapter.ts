import {
    EditorModel as V4EditorModel,
    type EditorStateBase,
    type RestoreData,
} from "./EditorModel";
import type { EditorDescriptor } from "../../../../shared/persistence-v4";
import type { IEditorState } from "../../../../shared/types";
import type { EditorModel as LegacyEditorModel } from "../EditorModel";
import type { PageModel } from "../../../api/pages/PageModel";
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
    readonly editorId: string;
    readonly legacy: LegacyEditorModel;

    constructor(legacy: LegacyEditorModel, editorId: string) {
        // Pass legacy.state directly — single source of truth. The v4 base
        // ctor wires this.state.subscribe to fire descriptorChanged on every
        // mutation, which covers every legacy mutation path.
        super(legacy.state as unknown as import("../../../core/state/state").IState<LegacyEditorState>);
        this.legacy = legacy;
        this.editorId = editorId;
        // Mirror legacy editor fields onto this adapter so v4-shaped reads
        // see them. The legacy editor mutates these directly (e.g.,
        // `editor.pipe = X`); the adapter mirrors via getters/setters below.
        this.pipe = legacy.pipe;
        this.scriptData = legacy.scriptData as Record<string, unknown>;
        this.noLanguage = legacy.noLanguage;
        this.getIcon = legacy.getIcon;
        this.skipSave = legacy.skipSave;
    }

    /** Forward v4 setPage to legacy.setPage so legacy editor setter side
     *  effects (`secondaryEditor` setter → `page.addSecondaryEditor(this)`)
     *  still flow into the page. PageModel keeps compat shims to receive these. */
    setPage(page: PageModel | null): void {
        super.setPage(page);
        this.legacy.setPage(page);
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

    switchFrom(_oldEditor: V4EditorModel): void {
        // Legacy editors don't support host-preserving switch via switchFrom.
        // The page-level switch widget calls legacy `model.changeEditor(view)`
        // directly (host stays the same TextFileModel instance). Per-editor
        // migrations US-551+ replace this throw with a real host extraction.
        throw new Error(
            "LegacyEditorAdapter does not implement switchFrom — view-switch uses legacy model.changeEditor() until per-editor migrations (US-551+).",
        );
    }

    async restore(): Promise<void> {
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
        // (which handles pipe disposal + fs.deleteCacheFiles).
        await super.dispose();
        await this.legacy.dispose();
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
