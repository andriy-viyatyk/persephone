import type React from "react";
import type { IState } from "../../../core/state/state";
import type { EditorStateStorage } from "./EditorStateStorage";
import type { HostDescriptor } from "../../../../shared/persistence-v4";

/**
 * v4 content-host interface. Slimmed shape replacing the legacy one at
 * [`../IContentHost.ts`](../IContentHost.ts):
 *
 * Removed: `editor` field, `changeEditor`, `acquireViewModel*`,
 *          `prepareViewModel`, `releaseViewModel` (the content-view subsystem
 *          dies in EPIC-028).
 * Added:   `dispose()`, `getDescriptor()`, `setStorage()`, optional
 *          `handleKeyDown` for `TextChrome` keystroke delegation.
 *
 * Two concrete implementations land in later phases:
 *   - `TextFileModel` (file-backed; owns I/O, encryption, script, pipe) — US-551
 *   - `NoteItemEditModel` (notebook-note-backed; lighter, no file I/O) — US-557
 *
 * Static factory contract (TS interfaces can't enforce statics):
 *   static fromDescriptor(desc: HostDescriptor): Promise<IContentHost>
 *
 *   - Sync construction; async loading deferred to `host.restore()`.
 *   - Throws on incompatible `desc.kind`; the editor's restore catches and
 *     falls back to an empty host.
 *
 * See [`doc/epics/EPIC-028-editor-architecture/mockups/IContentHost.ts`](../../../../../doc/epics/EPIC-028-editor-architecture/mockups/IContentHost.ts).
 */

/** Minimal reactive state every host exposes. */
export interface IContentHostState {
    /** UTF-8 string. Editors parse/serialize as needed. */
    content: string;
    /** Monaco language id (e.g. "json", "markdown", "plaintext"). */
    language?: string;
}

export interface IContentHost {
    /** Stable identifier for the host itself. NOT the cache-file key — cache
     *  files are keyed by the wrapping editor's id (which transfers on switch).
     *  This id is for host-internal identification only. */
    readonly id: string;

    readonly state: IState<IContentHostState>;

    /** Mutate content. `byUser` differentiates user edits from programmatic
     *  changes (script writes, auto-formatting, reload). */
    changeContent(content: string, byUser?: boolean): void;

    changeLanguage(language: string | undefined): void;

    /**
     * Receive the cache-storage handle from the wrapping editor. Called when
     * the editor adopts this host (initial open, switchFrom, setContentHost).
     * Hosts that don't need persistent cache (e.g., `NoteItemEditModel`) may
     * ignore the call.
     */
    setStorage(storage: EditorStateStorage): void;

    /** Release host-owned resources. Called by the owning editor's dispose()
     *  ONLY IF the host was not extracted. A switched-out host is owned by
     *  its new editor.
     *
     *  Does NOT clean cache files — that's the page's responsibility,
     *  triggered when an editor's id is finally released (no successor). */
    dispose(): Promise<void>;

    /** Serialize the host into a `HostDescriptor` for persistence. Returned
     *  as the `host` field of the wrapping editor's `EditorDescriptor`. */
    getDescriptor(): HostDescriptor;

    /** Optional root-level keystroke handler. Called by `<TextChrome>`'s
     *  outer panel `onKeyDown` so the chrome doesn't need to know the host
     *  class. `TextFileModel` will delegate Ctrl+S / Ctrl+Shift+S / F5 / F2
     *  to its actions submodel; `NoteItemEditModel` may implement a subset. */
    handleKeyDown?(e: React.KeyboardEvent): void;
}
