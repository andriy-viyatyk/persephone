// =============================================================================
// MOCKUP — TOneState (selective subscribe)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Enhances today's TOneState at /src/renderer/core/state/state.ts. Only the
// `subscribe` method changes (new selector overload). All other methods
// (get / set / use / update / clear / defaultState) keep today's shape.
//
// Motivation (walkthrough 03 / N1):
//   PageModel needs to know when an attached editor's panel-list changes so
//   it can re-evaluate the visibility criterion and re-render PageNavigator.
//   Today's `subscribe(listener)` fires on every state mutation (title flips,
//   modified flag, cursor position, language change, etc.) — too noisy. The
//   `use` hook already supports a selector via `useStoreWithEqualityFn` +
//   `compareSelection` for component re-renders, but pure models can't use
//   hooks.
//
// This enhancement gives pure models the same precision: subscribe to a
// SLICE of state, fire only when that slice actually changes (per the same
// `compareSelection` the hook uses).
//
// Backward-compatible: existing `subscribe(() => …)` callers keep working.
// Adding the selector is opt-in.
// =============================================================================

import type React from "react";

// -----------------------------------------------------------------------------
// Today's IState (unchanged shape — kept here for reference)
// -----------------------------------------------------------------------------

interface IUse<T> {
    (): T;
    <R>(selector: (state: T) => R): R;
}

export interface IState<T> {
    get(): T;
    set(setter: React.SetStateAction<T>): void;
    use: IUse<T>;
    update(updateDraft: (state: T) => void): void;
    clear(): void;

    // ── ENHANCED — see below ───────────────────────────────────────────────

    /**
     * Subscribe to state changes. Two forms:
     *
     *   1. No selector — listener fires on EVERY state change.
     *      (Backward-compatible with today's `subscribe(listener)`.)
     *
     *   2. With selector — listener fires only when the SELECTED slice
     *      actually changed, as determined by `compareSelection` (the same
     *      equality function the `use` hook uses for re-render gating).
     *
     * Returns an unsubscribe function. Idempotent — calling it twice is safe.
     *
     * Does NOT fire on subscribe (matches today). If the caller needs an
     * initial value, they should call `selector(state.get())` themselves.
     *
     * Equality detail: `compareSelection` does one-level structural equality
     * for plain objects and reference equality for arrays / Date / RegExp /
     * Map / Set. So a selector returning `s.someArray` fires when Immer's
     * `update()` produces a new array reference (which it does on any
     * structural mutation), but NOT when the array is mutated in place.
     * `update()` uses Immer and always produces new references for changed
     * slices — in-place mutation outside `update()` is not supported.
     */
    subscribe(listener: () => void): () => void;
    subscribe<R>(
        listener: (value: R) => void,
        selector: (state: T) => R,
    ): () => void;
}

// -----------------------------------------------------------------------------
// Enhanced subscribe — implementation sketch
// -----------------------------------------------------------------------------

declare const compareSelection: (a: unknown, b: unknown) => boolean; // already in state.ts

class TOneState<T> implements IState<T> {
    // …get/set/use/update/clear/defaultState all unchanged from today…

    private listeners: Array<() => void> = [];
    private readonly store: { getState: () => T };

    // Today's signature: `subscribe = (listener: () => void) => () => void;`
    //
    // The enhanced version overloads on (listener) vs (listener, selector).
    // When a selector is provided, the listener is wrapped: each store change
    // re-runs the selector, compares old vs new with compareSelection, and
    // only invokes the user's listener when the slice actually differs.

    subscribe(listener: () => void): () => void;
    subscribe<R>(
        listener: (value: R) => void,
        selector: (state: T) => R,
    ): () => void;
    subscribe<R>(
        listener: ((value: R) => void) | (() => void),
        selector?: (state: T) => R,
    ): () => void {
        let wrapped: () => void;

        if (selector) {
            let last = selector(this.store.getState());
            wrapped = () => {
                const next = selector(this.store.getState());
                if (!compareSelection(last, next)) {
                    last = next;
                    (listener as (v: R) => void)(next);
                }
            };
        } else {
            // Fast path — no selector, fire on every state change.
            wrapped = listener as () => void;
        }

        this.listeners.push(wrapped);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== wrapped);
        };
    }

    // …rest of TOneState unchanged…
    get!: () => T;
    set!: (setter: React.SetStateAction<T>) => void;
    use!: IUse<T>;
    update!: (updateDraft: (state: T) => void) => void;
    clear!: () => void;
}

// -----------------------------------------------------------------------------
// Usage example — PageModel subscribes per-editor to the secondaryEditor slice
//
// (Detailed walkthrough: 03 — Secondary editors & PageNavigator, N1.)
// -----------------------------------------------------------------------------
//
//   // PageModel
//   private _editorSubs = new Map<string, () => void>();
//
//   attach(editor: EditorModel): void {
//       if (this.editors.includes(editor)) return;
//       this.editors.push(editor);
//       editor.setPage(this);
//       const unsub = editor.state.subscribe(
//           () => this.onEditorPanelsChanged(editor),
//           (s) => s.secondaryEditor,
//       );
//       this._editorSubs.set(editor.id, unsub);
//       this.state.update((s) => { s.version++; });
//   }
//
//   detach(editor: EditorModel): void {
//       const idx = this.editors.indexOf(editor);
//       if (idx < 0) return;
//       this.editors.splice(idx, 1);
//       this._editorSubs.get(editor.id)?.();
//       this._editorSubs.delete(editor.id);
//       editor.setPage(null);
//       if (this._mainEditorId === editor.id) {
//           this._mainEditorId = null;
//           this.state.update((s) => { s.mainEditorId = null; });
//       }
//       this.state.update((s) => { s.version++; });
//   }
//
// Effect: PageModel hears only when an editor's panel list slice actually
// differs. Title flips, cursor moves, modified-flag toggles do not trigger
// onEditorPanelsChanged. The editor's secondaryEditor setter stays a fully
// pure state mutation (no editor → page callback).

// =============================================================================
// What does NOT change
// =============================================================================
//
// - The zustand `store` field, `set`, `update`, `clear` — all unchanged.
// - The `use` hook — already selector-aware via useStoreWithEqualityFn.
// - The `listeners[]` array shape — still `() => void`. The wrapping happens
//   inside `subscribe`, transparent to the array.
// - `compareSelection` (state.ts:34-52) — reused, same equality semantics
//   the hook uses. No duplication.
// - `TGlobalState` / `TComponentState` subclasses, `useOptionalState`,
//   `useComponentState` — all unaffected.
//
// Effort to land: ~20 lines in state.ts plus type overloads. No call-site
// migrations required — this is purely additive.
//
// =============================================================================
