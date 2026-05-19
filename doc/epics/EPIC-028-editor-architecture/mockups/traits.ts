// =============================================================================
// MOCKUP — Editor traits
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Lives at /src/renderer/editors/base/traits.ts (new file).
//
// Reuses the existing trait system primitives (TraitKey, TraitSet) from
// /src/renderer/core/traits/traits.ts. The CONTENT_HOST_TRAIT is the
// editor-side capability marker that signals: "this editor wraps an
// IContentHost and can give that host up to another editor."
//
// Updated by walkthrough 01 (L4 / A1) — trait shrunk to one method.
// Previously also had `inheritContentHost` and `getContentHost`; both
// are now editor-private and live inside the editor's own implementation
// (typically as private methods of the editor class).
// =============================================================================

import { TraitKey } from "../../../src/renderer/core/traits/traits";
import type { IContentHost } from "./IContentHost";

// -----------------------------------------------------------------------------
// CONTENT_HOST_TRAIT — host-ownership transfer capability marker
// -----------------------------------------------------------------------------

/**
 * Editor-side contract for giving up a content host.
 *
 * Implemented by every text-bearing editor (Monaco, Grid, Markdown, Log,
 * Link, Notebook, Todo, RestClient, Graph, Draw, …). NOT implemented by
 * PDF, Image, Archive, Video, Browser, Settings, About, etc.
 *
 * Used internally by the NEW editor's `switchFrom(oldEditor)` (walkthrough
 * 01 / A7) to extract the host from the old editor:
 *
 *   class MonacoEditor extends EditorModel {
 *       switchFrom(oldEditor: EditorModel): void {
 *           const trait = oldEditor.traits.get(CONTENT_HOST_TRAIT);
 *           if (!trait) throw new Error("Cannot switchFrom: no CONTENT_HOST_TRAIT");
 *           this._host = trait.extractContentHost() as TextFileModel;
 *       }
 *   }
 *
 * Note: this is the ONLY method the trait exposes externally.
 * `inheritContentHost` is editor-private (the new editor stores the host
 * directly in its own field). `getContentHost` is editor-private (used
 * inside `findCompatibleEditors()` to query the editor's own host).
 */
export interface IContentHostTrait {
    /**
     * Detach and return the host. The new editor calls this on the OLD
     * editor's trait inside its own `switchFrom()`.
     *
     * After this call:
     *  - The editor's internal host reference is null.
     *  - The editor unsubscribes from host state changes.
     *  - The editor's `dispose()` will NOT call `host.dispose()`.
     *  - Calling `extractContentHost()` again throws (host already gone).
     */
    extractContentHost(): IContentHost;
}

export const CONTENT_HOST_TRAIT = new TraitKey<IContentHostTrait>("content-host");

// -----------------------------------------------------------------------------
// Host capability discovery — C1 resolved (2026-05-19): instanceof, not traits
// -----------------------------------------------------------------------------

// `TextChrome` (walkthrough 10) and other host-capability consumers use
// `instanceof TextFileModel` / `instanceof NoteItemEditModel` checks rather
// than host-side traits. Sub-traits (IFileBacked, IEncryptable, IScriptable)
// were considered but rejected as YAGNI — the trait machinery only pays off
// with several independently-composable hosts, and we have two.
//
// Host-side traits are NOT introduced. If a third host type lands later,
// TextChrome adds a new branch and (if its capability mix overlaps with
// existing variants in a messy way) we revisit C1 at that point.

// -----------------------------------------------------------------------------
// Style note: editor-level traits use TraitKey<T> directly, NOT TraitRegistry.
// TraitRegistry (TraitTypeId.ILink, etc.) is for cross-window drag/drop where
// payloads carry a serializable string id. Editor traits are in-process only;
// the TraitKey instances themselves are the lookup keys.
// -----------------------------------------------------------------------------
