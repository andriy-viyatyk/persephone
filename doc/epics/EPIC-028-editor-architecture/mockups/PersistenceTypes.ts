// =============================================================================
// MOCKUP — Persistence types (new on-disk descriptor shape)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Replaces the legacy types in /src/shared/types.ts:
//   - EditorType         (string-literal union over class discriminators)
//   - EditorView         (string-literal union over view sub-discriminators)
//   - IEditorState       (flat editor+host record, mixed layers)
//   - PageDescriptor     (today's flat editor reference)
//   - WindowState        (no version field)
//
// New on-disk shape (walkthrough 04 / P1, P2, P4, P10):
//   - EditorDescriptor   { editorId, id, state, host? }
//   - HostDescriptor     { kind, state, pipe? }
//   - PipeDescriptor     unchanged from today's IEditorState.pipe
//   - PageDescriptor     { id, pinned, modified, mainEditorId, editors[], sidebar? }
//   - WindowState        { schemaVersion: 4, pages[], groupings?, activePageId? }
//
// Major version bump (3.x → 4.x) — no migration shim per C2. Restore detects
// a version mismatch (schemaVersion !== 4) and starts empty with a console
// warning; per-page failures stay non-fatal (console.warn + continue) per P7.
// =============================================================================

import type { ILinkData } from "../../../src/renderer/api/types/io.link-data";

// -----------------------------------------------------------------------------
// Pipe descriptor — unchanged from today
// -----------------------------------------------------------------------------

/** Serialized content pipe (provider + persistent transformers + encoding).
 *  Identical shape to today's IEditorState.pipe; relocated under HostDescriptor
 *  per walkthrough 04 / P4 (pipe is host-owned, not editor-owned). */
export type PipeDescriptor = {
    provider: { type: string; config: Record<string, unknown> };
    transformers: { type: string; config: Record<string, unknown> }[];
    encoding?: string;
};

// -----------------------------------------------------------------------------
// Host descriptor (P4)
// -----------------------------------------------------------------------------

/** Persisted state for an IContentHost. Text-bearing editors carry one;
 *  no-host editors (PDF, Browser, …) don't.
 *
 *  - `kind` discriminates the host class (only "textFile" exists today).
 *    Future host types add cases here.
 *  - `state` is the host's own state slice (content, filePath, modified,
 *    encoding, sourceLink, etc.). Opaque to the persistence layer — the
 *    host's `getDescriptor` / `fromDescriptor` are the only readers.
 *  - `pipe` is the serialized content pipe (host owns pipe lifecycle).
 *
 *  Production: `state` is whatever the host's `getDescriptor()` returns.
 *  Restore: `TextFileModel.fromDescriptor(desc)` reconstructs the host
 *  (sync; async I/O deferred to `host.restore()` triggered by editor.restore()). */
export interface HostDescriptor {
    kind: "textFile";
    state: Record<string, unknown>;
    pipe?: PipeDescriptor;
}

// -----------------------------------------------------------------------------
// Editor descriptor (P1)
// -----------------------------------------------------------------------------

/** Persisted state for an EditorModel. One per editor in PageDescriptor.editors[].
 *
 *  - `editorId` is the registry key (S10 / B1 — replaces IEditorState.type +
 *    IEditorState.editor). Used by editorRegistry.createEditor to pick the
 *    subclass at restore time.
 *  - `id` is the editor instance UUID (cache-file prefix). Restore passes this
 *    to `editorRegistry.createEditor(editorId, instanceId)` so cache files
 *    keyed on `<id>-*` survive the restart (C9).
 *  - `state` is the editor-specific state slice (subclass-defined shape;
 *    opaque to the persistence layer).
 *  - `host` is the host descriptor (text-bearing editors only). */
export interface EditorDescriptor {
    editorId: string;
    id: string;
    state: Record<string, unknown>;
    host?: HostDescriptor;
}

// -----------------------------------------------------------------------------
// Page descriptor (P1, P3, P8)
// -----------------------------------------------------------------------------

/** Persisted state for a PageModel.
 *
 *  - `mainEditorId` references one editor.id in `editors[]`, or null for
 *    sidebar-only pages (Explorer-only, Archive-root, Link-collection).
 *  - `editors[]` is the unified array — both main and panel-contributors
 *    live here (mirrors PageModel.editors[] from A8).
 *  - `sidebar?` carries page-level sidebar metadata (open/width/activePanel).
 *    Folded in from today's `<pageId>-nav-panel.txt` cache file per P3.
 *    Present iff the page has a PageNavigatorModel.
 *
 *  Removed vs. today:
 *  - `editor: Partial<IEditorState>`          → `editors[]` + `mainEditorId`
 *  - `hasSidebar: boolean`                    → presence of `sidebar?`
 *  - `<pageId>-nav-panel.txt` cache file      → `sidebar?` block (P3) */
export interface PageDescriptor {
    id: string;
    pinned: boolean;
    modified: boolean;
    mainEditorId: string | null;
    editors: EditorDescriptor[];
    sidebar?: {
        open: boolean;
        width: number;
        /** Values: "explorer", "search", or a panel id from one of `editors[]`. */
        activePanel: string;
    };
}

// -----------------------------------------------------------------------------
// Window state (P2, P10)
// -----------------------------------------------------------------------------

/** Top-level shape persisted to `<userData>/openFiles.txt`.
 *
 *  - `schemaVersion: 4` is the single discriminator at restore time (P2).
 *    Mismatch → console.warn + start empty. No migration shim (C2).
 *  - `pages[]` is the per-page descriptor list.
 *  - `groupings?` are page-id pairs for side-by-side groupings.
 *  - `activePageId?` is moved to the end of `state.ordered` on restore so
 *    the focus lands there on bootstrap.
 *
 *  Contract for future schema bumps: shape-incompatible changes to
 *  EditorDescriptor / HostDescriptor / PageDescriptor / this interface bump
 *  the integer. Additive optional fields don't. */
export interface WindowState {
    schemaVersion: 4;
    pages: PageDescriptor[];
    groupings?: [string, string][];
    activePageId?: string;
}

// =============================================================================
// What's gone vs. today's shared/types.ts
// =============================================================================
//
// REMOVED TYPES:
//   - EditorType         (16-value union over class discriminators)
//   - EditorView         (24-value union over view sub-discriminators)
//   - IEditorState       (flat editor+host record)
//
// REMOVED FIELDS on PageDescriptor:
//   - editor: Partial<IEditorState>    → editors: EditorDescriptor[] + mainEditorId
//   - hasSidebar: boolean              → presence of sidebar?
//
// REMOVED FILES:
//   - <userData>/cache/<pageId>-nav-panel.txt — folded into PageDescriptor.sidebar (P3)
//
// SURVIVING TYPES (in this file or elsewhere):
//   - PipeDescriptor (relocated under HostDescriptor per P4)
//   - WindowPages, PageDragData, FileStats (unchanged; not shown here)
//   - ILinkData (unchanged; lives inside HostDescriptor.state for text-bearing
//     editors, since the host owns sourceLink)
//
// =============================================================================
//
// Cross-references:
//   - editorRegistry.ts — `createEditor(id, instanceId?)` consumes EditorDescriptor.id (C2)
//   - EditorModel.ts    — `getRestoreData(): EditorDescriptor` (C3)
//                         `applyRestoreData(data: RestoreData<S>)` (C3)
//                         `abstract readonly editorId: string` (B1)
//   - IContentHost.ts   — `getDescriptor(): HostDescriptor` + static
//                         `fromDescriptor(desc)` (C4)
//   - PageModel.ts      — `saveState()` iterates editors[]; `dispose()` no
//                         longer calls fs.deleteCacheFiles(this.id) (C7 / P3)
//
// =============================================================================
