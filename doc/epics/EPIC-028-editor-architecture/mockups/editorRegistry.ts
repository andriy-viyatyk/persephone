// =============================================================================
// MOCKUP — editorRegistry (simplified)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Replaces today's registry at /src/renderer/editors/registry.ts.
//
// The current registry has a tangle of branches because it serves two
// different concepts: standalone page editors with their own EditorType,
// and content-view editors that re-use TextFileModel. After this epic
// there is one concept — every entry is an EditorDefinition; the
// distinction "does this editor accept a content host?" is read from the
// definition rather than encoded in a `category` flag.
//
// Updated by walkthrough 01 (A7): `createEditorFromFile` is gone. The open-
// file flow now does the three-phase editor lifecycle directly at the call
// site: `createEditor(resolveForFile(path)) → applyRestoreData({filePath,
// pipe}) → restore()`. The registry's only file-aware job is `resolveForFile`.
//
// Updated by walkthrough 04 (P6 / C2): `createEditor(id, instanceId?)` accepts
// an optional instance UUID. Used by session-restore to preserve the editor's
// cache-file id across app restarts (per C9). Other call sites (new page,
// switch widget, open-file) omit it; a fresh UUID is allocated.
//
// Updated by walkthrough 05 (M5 / C1): the `instanceId` parameter is also the
// mechanism for cache-file id preservation across multi-window transfer. When
// a tab is dragged between windows, the source serializes the editor into an
// `EditorDescriptor` (id included); the target window's `restorePage` calls
// `createEditor(editorId, desc.id)` to instantiate the editor with the
// original id, so per-editor cache files (`<editor.id>-host.txt`, etc.)
// continue to be read by the same key on disk. Single mechanism, two consumers
// (bootstrap restore + IPC transfer).
// =============================================================================

import type { EditorModel } from "./EditorModel";
import type { IContentHost } from "./IContentHost";
import type { IContentPipe } from "../../../src/renderer/api/types/io.pipe";
import { CONTENT_HOST_TRAIT } from "./traits";
import { TextFileModel } from "./TextFileModel";

// -----------------------------------------------------------------------------
// Definition + module shape
// -----------------------------------------------------------------------------

export interface EditorDefinition {
    /** Unique editor ID. Examples: "monaco", "grid-json", "link-view", "pdf". */
    id: string;

    /** Display name shown in switch UI. */
    name: string;

    /**
     * Single acceptance predicate replacing today's `acceptFile`,
     * `validForLanguage`, `switchOption`, AND `detectedContentEditor`.
     *
     * @returns priority (higher wins) or -1 if not applicable.
     *
     * The page evaluates this against the current host (for switch UI) and
     * the registry evaluates it against file metadata (for open-file flow).
     *
     * For editors without a content host (PDF, Image, Browser), this is
     * called with file metadata only.
     *
     * Content-based detection (today's `detectedContentEditor`) is absorbed:
     * editors that recognize their format by content marker can peek at the
     * host content. Example:
     *
     *   // Notebook editor
     *   accepts({ host, fileName, language }) {
     *       if (fileName?.toLowerCase().endsWith(".note.json")) return 100;
     *       if (language === "json" && host) {
     *           const content = host.state.get().content;
     *           if (content.startsWith('{"type":"notebook"')) return 80;
     *       }
     *       return -1;
     *   }
     *
     * Renaming `mynote.note.json` → `mynote.json` drops the strong (100)
     * match to the content-based weak (80) match; the switch widget still
     * offers Notebook.
     */
    accepts(input: AcceptanceInput): number;

    /**
     * Whether this editor wraps an IContentHost. Drives the open-file flow:
     * if true, the registry creates a TextFileModel (or whichever host the
     * caller requested) and inherits it into the new editor.
     *
     * Determined by trait introspection at module-load time — we don't
     * actually need this as a separate field. Keep mockup explicit for now,
     * collapse during implementation.
     */
    readonly hasContentHost: boolean;

    /** Async loader of the editor module. */
    loadModule(): Promise<EditorModule>;
}

export interface AcceptanceInput {
    fileName?: string;                  // for resolve-from-path
    language?: string;                  // for switch UI when host has set a language
    host?: IContentHost;                // for switch UI (preferred when available)
    /**
     * Resolution mode (walkthrough 02 / S5). Scales editor priority:
     *   - "edit": prefer Monaco for any text content; preview editors fall back
     *   - "view": prefer dedicated viewers (markdown-view, mermaid-view, …); Monaco falls back
     * Mode-agnostic editors (PDF, Image, Notebook for .note.json) ignore it.
     *
     * The boolean "can this editor handle the input?" must NOT depend on mode —
     * accepts() returns -1 only when truly incompatible. Mode only scales the
     * non-negative priority. This keeps findEditorsAccepting() mode-free.
     *
     * Default at call sites: "edit" (matches pre-EPIC-028 behavior of Monaco-first
     * for openFile / openRawLink). Explorer panel overrides to "view".
     */
    mode?: "edit" | "view";
}

export interface EditorModule {
    /** Factory for a new editor instance. */
    createEditor(): EditorModel;

    /** The React component that renders this editor. Receives `model`. */
    Component: React.ComponentType<{ model: EditorModel }>;
}

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

class EditorRegistry {
    private definitions = new Map<string, EditorDefinition>();
    private modules     = new Map<string, EditorModule>();   // module cache

    register(def: EditorDefinition): void {
        this.definitions.set(def.id, def);
    }

    getById(id: string): EditorDefinition | undefined {
        return this.definitions.get(id);
    }

    /** Resolve the best editor id for opening a file. Used when the user
     *  opens a file and we don't have a host yet.
     *
     *  Mode controls preference between edit-oriented (Monaco) and view-oriented
     *  (markdown-view, mermaid-view, …) editors when both accept the file —
     *  see AcceptanceInput.mode. Defaults to "edit". (S5 — walkthrough 02) */
    resolveForFile(fileName: string, language?: string, mode: "edit" | "view" = "edit"): string {
        let bestId = "monaco";
        let bestPriority = 0;
        for (const def of this.definitions.values()) {
            const p = def.accepts({ fileName, language, mode });
            if (p > bestPriority) { bestPriority = p; bestId = def.id; }
        }
        return bestId;
    }

    /** All editor ids that accept the current host. Used by the page-level
     *  switch widget to render the SegmentedControl options.
     *
     *  Mode-agnostic by design — the switch widget's job is "show options",
     *  not "rank by current mode". Each editor's accepts() returns -1 only
     *  when truly incompatible (mode-independent); any non-negative priority
     *  here means the editor is a valid switch target. (S5 — walkthrough 02) */
    findEditorsAccepting(host: IContentHost): string[] {
        const out: { id: string; p: number }[] = [];
        const language = host.state.get().language;
        // TODO: lift filePath onto IFileBacked sub-trait or check
        // `host instanceof TextFileModel` here. C1.
        const fileName = (host as TextFileModel).filePath;
        for (const def of this.definitions.values()) {
            if (!def.hasContentHost) continue;
            // mode left undefined — see method doc above.
            const p = def.accepts({ host, language, fileName });
            if (p >= 0) out.push({ id: def.id, p });
        }
        return out.sort((a, b) => b.p - a.p).map((x) => x.id);
    }

    /** Instantiate a new editor by id. Lazy-loads the module on first use.
     *  Returns a bare editor — no host. The caller drives the three-phase
     *  lifecycle (walkthrough 01 / A7):
     *
     *      const editor = await editorRegistry.createEditor(id);
     *      editor.applyRestoreData(data);   // OR editor.switchFrom(oldEditor)
     *      await editor.restore();          // host built inside if needed
     *
     *  For no-host editors (PDF, Browser, About, …) the same flow applies;
     *  applyRestoreData / restore are no-host-aware.
     *
     *  `instanceId` (walkthrough 04 / P6 / C2 + walkthrough 05 / M5 / C1):
     *  when provided, the editor's instance UUID is set at construction
     *  (instead of allocating a fresh one). Two consumers:
     *    - **Session restore** preserves cache-file id continuity across app
     *      restarts so `<editor.id>-host.txt`, `<editor.id>-monaco.json`, etc.
     *      survive the restart.
     *    - **Multi-window transfer** preserves cache-file id continuity across
     *      `movePageOut` / `movePageIn` so the target window's `editor.restore()`
     *      reads the same cache files the source flushed before detach.
     *  Both routes pull the id from `EditorDescriptor.id`. Omit `instanceId`
     *  for any other call path (new page, switch widget, open-file). */
    async createEditor(id: string, instanceId?: string): Promise<EditorModel> {
        const module = await this.loadModule(id);
        const editor = module.createEditor();
        if (instanceId !== undefined) {
            // Identity is set at construction; no post-construction mutation
            // of an identity field. See walkthrough 04 / P6 rationale.
            editor.state.update((s) => { s.id = instanceId; });
        }
        return editor;
    }

    // createEditorFromFile dropped — the open-file flow does the three-phase
    // lifecycle directly:
    //
    //   const editor = await editorRegistry.createEditor(
    //       editorRegistry.resolveForFile(filePath),
    //   );
    //   editor.applyRestoreData({ filePath, pipe });
    //   await editor.restore();

    /** Load (and cache) the module for an editor id. */
    private async loadModule(id: string): Promise<EditorModule> {
        let module = this.modules.get(id);
        if (module) return module;
        const def = this.definitions.get(id);
        if (!def) throw new Error(`No editor registered for id: ${id}`);
        module = await def.loadModule();
        this.modules.set(id, module);
        return module;
    }
}

export const editorRegistry = new EditorRegistry();

// =============================================================================
// What's gone vs. today's registry
// =============================================================================
//
// REMOVED FIELDS on EditorDefinition:
//   - category ("standalone" | "content-view") — distinction collapses
//   - editorType — every editor has its own id; types like "textFile",
//      "pdfFile" disappear as a separate concept
//   - acceptFile / validForLanguage / switchOption / isEditorContent —
//      collapsed into a single accepts() predicate
//   - createViewModel — content-view system deleted
//
// REMOVED METHODS:
//   - getViewModelFactory / loadViewModelFactory / validateForHost —
//      content-view system deleted
//   - getSwitchOptions — replaced by findEditorsAccepting
//   - detectContentEditor / getPreviewEditor — detection machinery deleted
//   - createEditorFromFile — superseded by the three-phase editor lifecycle
//      driven at call sites (walkthrough 01 / A7)
//
// NEW:
//   - createEditor(id, instanceId?) — direct factory, returns bare editor
//      (no host). Callers drive the three-phase lifecycle: applyRestoreData
//      / switchFrom then restore(). Optional `instanceId` preserves cache-
//      file ids for both session-restore (walkthrough 04 / P6 / C2) and
//      multi-window transfer (walkthrough 05 / M5 / C1).
//   - findEditorsAccepting(host) — for switch widget (called by editor's
//      own findCompatibleEditors())
//
// =============================================================================
