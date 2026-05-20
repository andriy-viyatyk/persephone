// =============================================================================
// MOCKUP — IContentHost (simplified)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Updated by walkthrough 10 (TC9 / B2) — added optional `handleKeyDown?` so
// `<TextChrome>` can delegate root-level keystrokes (Ctrl+S, F5, F2, …) to
// the host without an instanceof cast.
//
// Replaces today's `IContentHost` at /src/renderer/editors/base/IContentHost.ts.
// Strips out the content-view-model ref-counting (acquireViewModel,
// releaseViewModel, prepareViewModel, acquireViewModelSync) and the `editor`
// field on the state — both belonged to the old content-view subsystem that
// goes away with this epic.
//
// What stays:
//   - id, content, language, changeContent, changeLanguage, stateStorage.
//
// What's new:
//   - dispose() on the interface (editors call it when they own the host and
//     have not extracted it).
//   - getDescriptor() (walkthrough 04 / P4, C4) — serialize the host into a
//     HostDescriptor for inclusion in the editor's EditorDescriptor blob.
//   - Static factory contract `fromDescriptor(desc)` — each host class exposes
//     a sync static factory that reconstructs the host from its descriptor.
//     Sync only (no I/O); async restore happens later via `host.restore()`
//     triggered by the editor's own restore() call. Interface can't enforce
//     statics; convention-only.
//
// Two concrete implementations in the codebase:
//   - TextFileModel       (file-backed; owns I/O, encryption, script, pipe)
//   - NoteItemEditModel   (notebook-note-backed; lighter, no file I/O)
//
// Future implementations are free to plug in without changing editor code.
// =============================================================================

import type { IState } from "../../../src/renderer/core/state/state";
import type { EditorStateStorage } from "../../../src/renderer/editors/base/EditorStateStorageContext";
import type { HostDescriptor } from "./PersistenceTypes";

/** Minimal reactive state every host exposes. */
export interface IContentHostState {
    /** UTF-8 string. Editors parse/serialize as needed. */
    content: string;

    /** Monaco language id (e.g. "json", "markdown", "plaintext"). */
    language?: string;

    // NOTE: `editor` field intentionally removed. The active editor is the
    // EditorModel that currently wraps this host, not a property of the host.
}

export interface IContentHost {
    /** Stable identifier for the host itself. NOT the cache-file key — cache
     *  files are keyed by the wrapping editor's id (which transfers on switch).
     *  This id is for host-internal identification only (e.g. linking a
     *  NoteItemEditModel back to its note in NotebookEditor's data). */
    readonly id: string;

    readonly state: IState<IContentHostState>;

    /** Mutate content. `byUser` differentiates user edits from programmatic
     *  changes (e.g. script writes, auto-formatting, content reload). */
    changeContent(content: string, byUser?: boolean): void;

    /** Change the language. Triggers downstream re-evaluation
     *  (e.g. the page's available-editors list refreshes). */
    changeLanguage(language: string | undefined): void;

    /**
     * Receive the cache-storage handle from the wrapping editor.
     *
     * Called by the editor when it adopts this host (initial open, switchFrom,
     * setContentHost). The storage is keyed by the editor's id; the host uses
     * it to write its own cache files (e.g. `<editor.id>-host.txt` for the
     * content cache).
     *
     * Hosts that don't need persistent cache (e.g. NoteItemEditModel — its
     * content is owned by the parent NotebookEditor) may ignore the call.
     */
    setStorage(storage: EditorStateStorage): void;

    /** Release host-owned resources. Called by the owning editor's dispose()
     *  ONLY IF the host was not extracted (i.e. the editor still owns it).
     *  A switched-out host is owned by its new editor and disposed by that
     *  editor's lifecycle, not the old one's.
     *
     *  Note: dispose() does NOT clean cache files. Cache cleanup is the
     *  page's responsibility, triggered when an editor's id is finally
     *  released (no successor via switchFrom). See C9. */
    dispose(): Promise<void>;

    /** Serialize the host into a HostDescriptor for persistence. Returned
     *  as the `host` field of the wrapping editor's `EditorDescriptor`.
     *
     *  - `kind` matches the host class discriminator (TextFileModel returns
     *    `"textFile"`; future hosts add their own).
     *  - `state` is the host's own state slice (content, filePath, modified,
     *    encoding, sourceLink, etc.). Opaque to the persistence layer.
     *  - `pipe` is the serialized content pipe (host owns pipe lifecycle).
     *
     *  Walkthrough 04 / P4, C4. */
    getDescriptor(): HostDescriptor;

    /** Optional root-level keystroke handler. Called by `<TextChrome>`'s
     *  outer panel `onKeyDown` (walkthrough 10 / TC9). Hosts implement what
     *  they care about; the chrome doesn't know the host class.
     *
     *  TextFileModel implements (delegates to TextFileActionsModel.handleKeyDown):
     *    - Ctrl+S       → saveFile
     *    - Ctrl+Shift+S → saveFileAs
     *    - F5           → runScript
     *    - F2           → renameFile
     *
     *  NoteItemEditModel may implement its own subset (walkthrough 29). */
    handleKeyDown?(e: React.KeyboardEvent): void;
}

// -----------------------------------------------------------------------------
// Static factory contract (convention — TypeScript interfaces cannot
// declare static methods)
// -----------------------------------------------------------------------------
//
// Each concrete IContentHost class exposes a static factory:
//
//   static fromDescriptor(desc: HostDescriptor): Promise<IContentHost>
//
// Contract:
//   - Sync construction — does NOT do I/O. Async loading (pipe.readText,
//     decryption, etc.) is deferred to `host.restore()`, which the editor's
//     own `restore()` calls after stashing the descriptor.
//   - Throws on incompatible `desc.kind` — the editor's restore catches and
//     falls back to an empty host (A7 internal error-path).
//
// Wrapped editors typically do:
//
//   class MonacoEditor extends EditorModel {
//       async restore() {
//           if (!this._host) {
//               this._host = this._pendingHost
//                   ? await TextFileModel.fromDescriptor(this._pendingHost)
//                   : new TextFileModel();
//           }
//           if (!this._host.restored) await this._host.restore();
//           // ... editor-specific restore ...
//       }
//   }
//
// Walkthrough 04 / P6 / C4.

// =============================================================================
// Open design questions (see ../concerns.md)
// =============================================================================

// C1 — RESOLVED 2026-05-19. Host-capability discovery uses `instanceof`
//      checks, not sub-traits. `TextChrome` (walkthrough 10) branches on
//        - host instanceof TextFileModel → full chrome (save indicator,
//          encryption padlock, script panel, language picker)
//        - host instanceof NoteItemEditModel → minimal chrome (content area,
//          maybe a language picker)
//      A new host type adds a new branch + a new chrome variant. Sub-traits
//      (IFileBacked, IEncryptable, IScriptable) were considered but rejected
//      as YAGNI — we only have two host types, and a future third would
//      simply add a branch. The trait machinery only pays off with several
//      independently-composable hosts; we don't have that.

// C9 — RESOLVED 2026-05-19. stateStorage moved to EditorModel; the wrapping
//      editor's id is the cache-file prefix. The host receives a storage
//      handle via setStorage() when the editor adopts it. On switch, the new
//      editor copies the old editor's id, so cache files (host content,
//      script panel state, etc.) keep working. Editor dispose does NOT clean
//      cache files; the page decides cleanup at the "id release" moment
//      (id not transferred to a successor). See concerns.md C9.
