# 03 — Secondary editors & PageNavigator walkthrough

Scope: panel registration; `beforeNavigateAway` / `onMainEditorChanged`; Pattern A vs. Pattern B after the unified-array redesign; how PageNavigator iterates and re-renders; how panel-list changes (without attach/detach) reach the page and the UI; where `activePanel` and the secondary-editor cache live.

**Out of scope:**
- Restore of secondary editors from session — defers to walkthrough 04 (Persistence). This walkthrough only commits to "the new arch must support sidebar restore"; on-disk shape stays in 04.
- The duck-typed `treeProvider` / `selectionState` interface CategoryEditor uses to discover sibling secondary editors — defers to walkthrough 24 (Link) where CategoryEditor lives.
- Specific editor-level panel implementations (LinkEditor's three-panel set, ArchiveEditor's `archive-tree`, RestClient's collection panel) — defer to their walkthroughs (24, 30, 26).

**Status:** Done (2026-05-19). All concerns N1–N7 resolved. Mockups updated: `TOneState.ts` (new foundation primitive), `PageModel.ts` (slice-subscribe in `attach`/`detach`, `onEditorPanelsChanged` handler, `close()` panel-first ordering, defensive sub-drain in `dispose`). `EditorModel.ts` unchanged — A8's pure setter already correct.

---

## What exists today

### Two arrays on PageModel

`src/renderer/api/pages/PageModel.ts:60-83` keeps two distinct editor collections:
- `_mainEditor: EditorModel | null` — the content-area editor.
- `secondaryEditors: EditorModel[]` — plain array (not reactive; EditorModels can't go through Immer).

Plus a counter `secondaryEditorsVersion: TOneState<{ version }>` whose only job is "bump me when the array changed so PageNavigator re-renders." Pure side-channel reactivity.

### Membership API

Three primitives (PageModel.ts:324-368):
- `addSecondaryEditor(model)` — push + `setPage(this)` + bump version + `_notifyMainEditorOfSecondaryChange()` + debounced save.
- `removeSecondaryEditor(model)` — splice + adjust `activePanel` + `setPage(null)` + `dispose()` + bump + notify + save. **Disposes**.
- `removeSecondaryEditorWithoutDispose(model)` — same minus dispose. Has a Pattern B guard: `if (this._mainEditor !== model) model.setPage(null);` so the model doesn't lose its page reference if it's also the main editor.

### The setter side-effect channel

`EditorModel.secondaryEditor` getter/setter (EditorModel.ts:80-91):
```typescript
get secondaryEditor(): string[] | undefined {
    return this.state.get().secondaryEditor;
}

set secondaryEditor(value: string[] | undefined) {
    this.state.update((s) => { s.secondaryEditor = value; });
    if (value?.length) {
        this.page?.addSecondaryEditor(this);
    } else {
        this.page?.removeSecondaryEditorWithoutDispose(this);
    }
}
```

This is the **only** way editor code registers/unregisters its own sidebar panels. Setting a non-empty array enrolls the editor in `secondaryEditors[]`; clearing it removes the editor (without disposal).

### Panel-set changes within the same membership

A subtlety the docs call out (`secondary-editors.md` §9 / addSecondaryEditor): if the model is **already** in `secondaryEditors[]` and the setter is called again with a different panel list (e.g., LinkEditor goes from `["link-category"]` to `["link-category", "link-tags"]`), `addSecondaryEditor` short-circuits the push but **still bumps the version** so PageNavigator re-renders with the updated panel list:
```typescript
addSecondaryEditor(model: EditorModel): void {
    if (this.secondaryEditors.includes(model)) {
        // Already registered — bump version so PageNavigator re-renders
        // to pick up panel list changes (model.state.secondaryEditor may differ).
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        return;
    }
    // …push, setPage, bump, notify
}
```

### Reactions to mainEditor change

Two hooks fire on every navigation (`setMainEditor`):
- `oldEditor.beforeNavigateAway(newEditor)` (PageModel.ts:144). Base clears `secondaryEditor`; ArchiveEditor overrides to keep when `newEditor.sourceLink?.sourceId === this.id`.
- After the swap, `notifyMainEditorChanged()` (PageModel.ts:446-464) iterates `secondaryEditors[]` and calls `m.onMainEditorChanged(newMain)` on each. Models that cleared themselves during the call are detected after the loop (`filter(m => !m.secondaryEditor?.length)`) and disposed.

### PageNavigator render

`src/renderer/ui/navigation/PageNavigator.tsx:15-84`:
- Subscribes via `page.secondaryEditorsVersion.use()` → re-renders on any version bump.
- Outer loop `secondaryEditors.flatMap(model)` × inner loop `model.state.get().secondaryEditor` → one `<CollapsiblePanel>` per (model, panelId) pair.
- Each panel is rendered via `<LazySecondaryEditor>` which looks up the React component in `secondary-editor-registry` and dynamic-imports it.
- `headerRef` is a portal target — panel components render their own header into it via `createPortal`.

`secondary-editor-registry.ts` is a tiny `id → { label, loadComponent }` map registered alongside main editors in `register-editors.ts`. No traits, no acceptance, no host concept — just panel-id → component.

### PageNavigatorModel

`src/renderer/ui/navigation/PageNavigatorModel.ts` — pure sidebar layout. Two fields (`open`, `width`), two methods (`toggle`, `close`), one event (`pageNavigatorToggled`). Independent of editors entirely.

### Active panel

`PageModel.activePanel: string` — a regular field, not in `state`. Holds `"explorer"`, `"search"`, or any secondary panel ID. `setActivePanel(panel)` (PageModel.ts:226-237) updates the field, bumps version, calls `onPanelExpanded(panel)` on the owning editor, and broadcasts the global `panelExpanded` event.

`expandPanel(panelId)` is a convenience that calls `setActivePanel` if the panel id exists in any secondary editor's array.

### Persistence

`PageModel._saveState` (PageModel.ts:568-582) writes `PageSidebarSavedState` to `<pageId>-nav-panel.txt`:
- `open`, `width` from `pageNavigatorModel.state`.
- `activePanel`.
- `secondaryModelDescriptors: { pageState: model.getRestoreData() }[]` for every secondary.

Restore (PageModel.ts:518-565) reads this, calls `pendingSecondaryDescriptors`. Actual model creation deferred to `restoreSecondaryEditors(ownerEditor)` (PageModel.ts:472-513) which:
- Dedupes against `ownerEditor` (Pattern B: same id → reuse the mainEditor instance).
- For each remaining descriptor: `newEditorModelFromState → applyRestoreData → restore` → push.
- Activates the previously-active panel if it now exists.

### CategoryEditor duck-type hook

`PageModel._notifyMainEditorOfSecondaryChange()` (PageModel.ts:419-424) checks if the main editor has a `onSecondaryEditorsChanged` method (ad-hoc duck-type, not on the base class) and calls it. Used by `CategoryEditorModel` to re-scan `secondaryEditors[]` for a matching `treeProvider`. Fired by add/remove/withoutDispose.

---

## What the new architecture needs to support

After walkthroughs 01 (unified-array PageModel) and 02 (main-editor swap), the foundation already commits to:

- **One editor membership array** — `editors: EditorModel[]` on PageModel. No separate `secondaryEditors[]`.
- **Pattern B inexpressible** — an editor has exactly one entry in `editors[]`, flagged as main by `_mainEditorId`.
- **Pure `secondaryEditor` setter** — no side-effects; visibility criterion is enforced by PageModel.
- **Visibility criterion** — `keep iff (editor.id === _mainEditorId) || editor.contributesPanels()`. Else PageModel detaches + disposes.
- **`reconcileVisibility()`** — page-level reconciler, fired by `setMainEditor` and by the panels-changed notification mechanism *(this walkthrough)*.

What still needs design:

1. **Trigger for `reconcileVisibility`** — when an editor's panel list changes outside `setMainEditor` (e.g., LinkEditor adds `link-tags` reactively, ExplorerEditorModel adds `search` on user action, archive's `beforeNavigateAway` clears the list to opt out of surviving), the page needs to know. This is N1's explicit deferred item from walkthrough 01.
2. **PageNavigator re-render signal** — today's `secondaryEditorsVersion` counter is gone. PageNavigator subscribes to *something*. What?
3. **Replacement for `onSecondaryEditorsChanged` duck-type hook** — CategoryEditor (and possibly future editors) need a model-layer trigger when sibling editors join/leave `editors[]`. Today's ad-hoc method check is fragile.
4. **Panel iteration order** — today's `secondaryEditors[]` is insertion order. With unified `editors[]`, the main editor is in the same array. Does the panel list interleave with main? Or filter to `panelEditors` and iterate that subset?
5. **Active-panel restore timing** — today's `_pendingActivePanel` defers activation until secondaries are restored. Same pattern survives; just needs to fit the unified restore flow (walkthrough 04 owns the persistence shape).
6. **Self-close gesture** — today panel headers render a close button: `onClick = () => { model.secondaryEditor = undefined }`. After the setter goes pure, what removes the model from `editors[]`? Visibility criterion via the panels-changed trigger.

Functional invariants the new architecture must preserve:

- **Explorer always survives navigation.** `ExplorerEditorModel.beforeNavigateAway` is a no-op; clears nothing. The model stays in `editors[]` because it still contributes `["explorer"]`.
- **Archive secondary self-evicts when navigated to unrelated content.** `onMainEditorChanged` clears `secondaryEditor` if `newMain` was not opened from this archive. After the clear, visibility criterion detaches + disposes.
- **Panel-set changes re-render PageNavigator without recreating models.** LinkEditor toggling `link-tags` on/off must not destroy the model.
- **`expandPanel(panelId)` resolves only against editors currently contributing that panel.**
- **`pageNavigatorToggled` global event still fires when the navigator opens/closes** — LinkEditor subscribes to this to (re-)register its panels on open.

---

## How the foundation mockups handle this

After walkthrough 01:

- `PageModel.editors[]` + `_mainEditorId` — single membership array.
- `PageModel.panelEditors` getter — derived `editors.filter(e => e.contributesPanels())`.
- `PageModel.attach(editor)` / `detach(editor)` — membership primitives. Old `addSecondaryEditor` / `removeSecondaryEditor` / `removeSecondaryEditorWithoutDispose` all collapse here.
- `PageModel.reconcileVisibility()` — called by `notifyMainEditorChanged`; needs an additional firing point for panel-list changes *(N1)*.
- `EditorModel.contributesPanels()` — currently defined as `state.secondaryEditor?.length > 0`. Walkthrough 03 may formalize.
- `EditorModel.secondaryEditor` setter — pure state mutation, no side effects.
- `PageModel.state.version` — bumped on every membership / main-editor change.
- `PageModel.setActivePanel(panel)` — unchanged shape; calls `onPanelExpanded` on the owner.

**What survives untouched:**

- `secondary-editor-registry.ts` — purely a `panel-id → React component` lookup. No knowledge of editors or membership.
- `PageNavigatorModel.ts` — sidebar layout (open/width). No knowledge of editors.
- `LazySecondaryEditor.tsx` — dynamic-import wrapper. Unchanged.
- `pageNavigatorToggled` and `panelExpanded` global event channels — unchanged shape.

**Mapping today → new:**

| Today | New |
|-------|-----|
| `PageModel.secondaryEditors[]` | `PageModel.panelEditors` (getter, filters `editors[]`) |
| `PageModel.secondaryEditorsVersion` | `PageModel.state.version` (already bumped on membership change) |
| `addSecondaryEditor(m)` | `attach(m)` (also called for the main editor; panel contribution is a property of the editor, not the membership operation) |
| `removeSecondaryEditor(m)` | `detach(m); m.dispose()` (explicit user gesture, e.g., user clicks "close panel") |
| `removeSecondaryEditorWithoutDispose(m)` | `detach(m)` — but in practice this is auto-invoked by `reconcileVisibility` after the editor self-cleared its panels |
| `_notifyMainEditorOfSecondaryChange()` ad-hoc method check | One of the N5 options below |
| `secondaryEditor` setter side-effects | Removed (A8); replaced by panels-changed notification → `reconcileVisibility` |
| Panel-list change without attach (LinkEditor toggling `link-tags`) | Same setter, but only mutates state; PageNavigator re-renders via `state.version`; PageModel reacts via N1 trigger |
| `restoreSecondaryEditors(ownerEditor)` | Deferred to walkthrough 04; the unified descriptor includes all editors with their main/panel-contribution flags |
| `_prePromotePanels` save/restore dance in `promoteSecondaryToMain` | **Gone** — Pattern B doesn't exist, promote is just `setMainEditor(model)` |

---

## Concerns surfaced (secondary-editor-specific)

Each concern presented with the problem, options on the table, and a **proposed** decision (subject to review).

### N1 — Trigger for `reconcileVisibility` on panel-list changes — **RESOLVED 2026-05-19**

**Problem.** Walkthrough 01 explicitly deferred this: when an editor changes its panel contribution **without** going through `setMainEditor`, PageModel needs to re-evaluate the visibility criterion (and PageNavigator needs to re-render). Examples:

- `ExplorerEditorModel.openSearch()` sets `this.secondaryEditor = ["explorer", "search"]`. Already attached, but PageNavigator needs to render the new panel.
- `LinkEditor` reacts to tag-data arriving and toggles `["link-category"]` → `["link-category", "link-tags"]`. Same membership, different panel set.
- A panel renders a close button: `onClick = () => { model.secondaryEditor = undefined }`. The editor is now invisible (assuming it's not the main editor) and must be detached + disposed.
- `ArchiveEditorModel.onMainEditorChanged(newMain)` clears `secondaryEditor` when `newMain` is unrelated — fires DURING `notifyMainEditorChanged` from `setMainEditor`. The page must detect this and self-evict.

**Why it matters.** Today's setter has explicit side effects (`addSecondaryEditor` / `removeSecondaryEditorWithoutDispose`) so the page is notified imperatively. After A8 the setter is pure. Without a trigger, PageModel never knows the editor stopped contributing.

**Decision: option (a) — PageModel subscribes per editor, with a selector restricting fires to the `secondaryEditor` slice.**

Enables a clean (a) by enhancing `TOneState.subscribe` to accept an optional selector (see new foundation mockup `mockups/TOneState.ts`). Today `subscribe(listener)` fires on every state mutation — too noisy. The `use` hook already selects via `useStoreWithEqualityFn` + `compareSelection`; the new overload exposes the same precision to pure models:

```ts
// TOneState (enhanced)
subscribe(listener: () => void): () => void;
subscribe<R>(listener: (value: R) => void, selector: (state: T) => R): () => void;
```

With this in place, PageModel subscribes per editor on `attach` and unsubscribes on `detach`:

```ts
// PageModel
private _editorSubs = new Map<string, () => void>();

attach(editor: EditorModel): void {
    if (this.editors.includes(editor)) return;
    this.editors.push(editor);
    editor.setPage(this);
    const unsub = editor.state.subscribe(
        () => this.onEditorPanelsChanged(editor),
        (s) => s.secondaryEditor,
    );
    this._editorSubs.set(editor.id, unsub);
    this.state.update((s) => { s.version++; });
}

detach(editor: EditorModel): void {
    const idx = this.editors.indexOf(editor);
    if (idx < 0) return;
    this.editors.splice(idx, 1);
    this._editorSubs.get(editor.id)?.();
    this._editorSubs.delete(editor.id);
    editor.setPage(null);
    if (this._mainEditorId === editor.id) {
        this._mainEditorId = null;
        this.state.update((s) => { s.mainEditorId = null; });
    }
    this.state.update((s) => { s.version++; });
}

onEditorPanelsChanged(editor: EditorModel): void {
    this.state.update((s) => { s.version++; });
    if (!this.editors.includes(editor)) return;
    if (editor !== this.mainEditor && !editor.contributesPanels()) {
        this.detach(editor);
        setTimeout(async () => {
            await editor.dispose();
            await fs.deleteCacheFiles(editor.id);
        }, 0);
    }
}
```

The `EditorModel.secondaryEditor` setter stays **fully pure** (A8's intent preserved end-to-end — no editor → page side effect at all). PageModel is the sole owner of "watch for visibility changes."

**Equality semantics.** `compareSelection` (state.ts:34-52) does one-level structural equality for plain objects and reference equality for arrays. `secondaryEditor: string[] | undefined` is an array slice → ref-equality. The setter assigns a new array via `state.update(s => { s.secondaryEditor = value })`, and Immer always produces a new reference when a slice is reassigned. So fires happen exactly when the array is reassigned (including `undefined → []` boundary cases, since `compareSelection(undefined, [])` is `false`).

**Options considered.**

- **(a) — chosen.** PageModel subscribes per editor with a selector on `secondaryEditor`. Setter stays pure. Subscription bookkeeping via a Map keyed on editor id, managed by `attach`/`detach`.
- (b) Dedicated `EditorModel.panelsChanged: Subscription<void>`. Analogous to `descriptorChanged` (A6). Rejected: adds a base-class primitive when a slice-subscribe on existing `state` covers it.
- (c) Reuse `descriptorChanged`. Rejected: conflates persistence-worthy with visibility-worthy; every keystroke would re-run `reconcileVisibility`.
- (d) Setter calls `page.onEditorPanelsChanged(this)` directly. Rejected: small but real side effect on the setter; the slice-subscribe variant achieves the same precision without it.

**Generalizes.** The selector-aware `subscribe` is a general TOneState enhancement — any model wanting to react to a slice of another model's state benefits. It also overlaps with the niche `descriptorChanged` (A6) handles, but doesn't replace it: A6 is fired by *forwarders* spanning multiple reactive sources (host state + editor state), not by a single state mutation.

### N2 — PageNavigator re-render signal — **RESOLVED 2026-05-19**

**Problem.** Today `PageNavigator.tsx` subscribes via `page.secondaryEditorsVersion.use()`. After A8, that field is gone. What does PageNavigator subscribe to?

**Decision: option (a) — subscribe to `page.state` via `.use()`.** The unified `state.version` is bumped on every `attach`/`detach` AND on every `onEditorPanelsChanged` (per N1). One subscription covers both membership changes and panel-list changes.

```tsx
// PageNavigator.tsx (new)
export function PageNavigator({ page }: PageNavigatorProps) {
    page.state.use();                       // re-render on version bump
    const panelEditors = page.panelEditors; // computed fresh per render
    // …existing flatMap loop, but over panelEditors instead of secondaryEditors
}
```

No mockup change — `PageModel.state.version` already exists per walkthrough 01. The implementation update is logged in the "Adjustments to current code" section (B5).

**Options considered.**

- **(a) — chosen.** Subscribe to `page.state`. Single subscription, hits exactly the events PageNavigator cares about (both bumped by the same code paths).
- (b) Subscribe to each individual editor's state and re-render on any change. Rejected: wasteful — title/modified/cursor-position mutations would re-render the navigator.
- (c) Hash + `useMemo` + state subscription. Rejected: over-engineered for a render path that's already cheap.

### N3 — Iteration source for the rendered panel list — **RESOLVED 2026-05-19**

**Problem.** Today `secondaryEditors[]` is a dedicated array. After unification, do we iterate `editors[]` (which includes the main editor) and filter inside the flatMap, or use a derived `panelEditors` getter?

**Decision: option (b) — `page.panelEditors` getter.** Reads clearly at the call site. Filter logic centralized in PageModel (so any future "what counts as a panel-contributing editor" change is one place). Already in the mockup.

Subtlety: the **main editor** can contribute panels (today's Pattern B archive). In the unified model, the same model is in `editors[]` once, and `panelEditors` includes it if `contributesPanels()` is true. PageNavigator renders its panels alongside others. The main-editor view in the content area is unaffected — it reads from `page.mainEditor` independently.

**Options considered.**

- (a) Iterate `editors` and inline-filter inside the flatMap. Reads naturally; one source of truth. Rejected: spreads the filter rule into call sites.
- **(b) — chosen.** Use `page.panelEditors` getter. Filter logic centralized in PageModel.

### N4 — Self-close pattern for panels — **RESOLVED 2026-05-19**

**Problem.** Today a panel's React component renders a close button that does `model.secondaryEditor = undefined`. After A8 the setter is pure. Does the click still close the model?

**Conceptual reframe.** The close button on a panel header is **not** a "close this panel" gesture — it's a "close this model" gesture. Today's panel components implement it by clearing `secondaryEditor`, which (in the today-code) removed the model from the sidebar without disposing it. After the new architecture, the same gesture flows into a clean dispose path automatically — no special API needed.

**Decision: re-use the N1 visibility-criterion path. No new API.**

`model.secondaryEditor = undefined` →
1. Setter mutates state (pure — A8).
2. PageModel's slice subscription on `secondaryEditor` (set up in `attach`, per N1) fires.
3. Handler `onEditorPanelsChanged(editor)` (B4):
   - Bumps `state.version` → PageNavigator re-renders without this panel.
   - Visibility criterion: editor is not mainEditor AND `contributesPanels() === false` → `detach + dispose`.

The model is gone. No `closeEditor` method, no extra confirm step, no setter-side effect.

**Edge case — close button rendered on the mainEditor's panel.**

This shouldn't render in the first place (the panel React component should hide the close button when `model === page.mainEditor`). If the bug slips through and the button is clicked, the visibility criterion keeps the model alive (main editor is always kept) — the panel simply disappears from the sidebar. The model stays in the content area. Visible UI bug, no data loss.

This is the "if for some case we need to close just the panel" path the user described: if a panel component needs to remove only itself (one of several the model contributes), it tells the model to filter its panel list:

```tsx
// Inside a panel component
const close = () => {
    const remaining = model.secondaryEditor?.filter((p) => p !== "my-panel-id");
    model.secondaryEditor = remaining?.length ? remaining : undefined;
};
```

If `remaining` is empty, the model loses its last panel — visibility criterion handles it (detach + dispose unless main).

**Notes on `confirmRelease` for panel-contributing editors.**

Today's panel-contributing editors (Explorer, Archive) are not modifiable. Auto-dispose without confirm is fine for them. If a future modifiable editor contributes panels and wants the close button to prompt save, it can override `dispose()` to refuse on modified or pre-arrange `confirmRelease()` before clearing its panels — but no framework-level API is needed for that. `page.close()` (tab close) continues to call `confirmRelease()` on every modified editor in `editors[]` (per B6).

**Options considered.**

- (a) Add a dedicated `PageModel.closeEditor(editor)` method that runs `confirmRelease` then detaches + disposes. Rejected: no panel-contributing editor today needs confirm-on-modified for a panel-level gesture, and the existing N1 path already handles the dispose cleanly. Keeps the framework surface smaller.
- (b) Demote the model on close (clear `_mainEditorId`) when the button is clicked on a mainEditor's panel. Rejected: hides the underlying UI bug instead of surfacing it. The panel component should not render the button in that state.
- **(c) — chosen.** Use the N1 visibility-criterion path. Setter stays pure; close button just clears `secondaryEditor`; PageModel handles the rest.

### N5 — Replacement for `onSecondaryEditorsChanged` duck-type hook — **RESOLVED 2026-05-19**

**Problem.** `CategoryEditorModel` (the only known caller) needs to react when *other* editors join or leave the page — its `ITreeProvider` data source lives on a sibling secondary editor (`ExplorerEditorModel.treeProvider` or `ArchiveEditorModel.treeProvider`), found by scanning `secondaryEditors[]` for a matching `(type, sourceUrl)` pair. The reactivity is needed mostly for restore timing: the main editor mounts before its sibling secondary finishes async-restoring; CategoryEditor renders a "Please select a category" placeholder; when the secondary finally joins, CategoryEditor must re-scan to find its provider.

Today's mechanism is a chain: `PageModel._notifyMainEditorOfSecondaryChange()` duck-types `onSecondaryEditorsChanged` on the main editor → `CategoryEditorModel.onSecondaryEditorsChanged()` bumps `_providerVersion` + touches state → view's `useMemo` (keyed on `providerVersion`) re-runs the scan. Plus a defensive 50ms `setTimeout(...)` retry inside the view's `useEffect`.

**Decision: option (a-view) — CategoryEditor's *view* subscribes to `page.state` via `.use()`.**

The reactivity is purely view-side; the model has no other reason to know. Move the subscription out of the model entirely:

```tsx
export function CategoryEditor({ model }: { model: CategoryEditorModel }) {
    const page = model.page;
    const link = model.decodedLink;

    page?.state.use();  // re-render on attach/detach/panel-list change

    const host = useMemo(() => {
        if (!page || !link) return null;
        return findTreeProviderHost(page.panelEditors, link.type, link.url);
    }, [page, link, page?.state.get().version]);
    // …rest unchanged
}
```

What goes away:
- `CategoryEditorModel.onSecondaryEditorsChanged()` (model-side method) — deleted.
- `CategoryEditorModel._providerVersion` field + `providerVersion` getter — deleted.
- The defensive 50ms `setTimeout(() => model.onSecondaryEditorsChanged(), 50)` retry in `useEffect` — deleted (the page-state subscription is precise enough).
- `PageModel._notifyMainEditorOfSecondaryChange()` — already removed by the unified-array refactor (walkthrough 01).
- No new base-class API. No `EditorModel.onPageEditorsChanged()` hook. No `page.editorsChanged` Subscription.

**Coverage caveat.** This trigger fires on `editors[]` attach/detach and on any editor's panel-list change (the events that bump `state.version`). It does **not** fire when a secondary editor swaps its `treeProvider` instance without joining/leaving — e.g., `ExplorerEditorModel.navigateUp()` replaces `treeProvider = new FileTreeProvider(parent)`. **This matches today** — today's `onSecondaryEditorsChanged` is also only called on add/remove. If `treeProvider` mutations need their own reactivity, that's a walkthrough-24/30 concern (Explorer/Archive design).

**Options considered.**

- **(a-view) — chosen.** View subscribes to `page.state.use()`. Zero model-side wiring. Reuses PageNavigator's signal.
- (a-model) Model subscribes to `page.state` inside a `setPage` override. Rejected: heavier than needed — the reactivity is purely view-side; no non-view code path needs to react.
- (b) Dedicated `PageModel.editorsChanged: Subscription<void>` channel. Rejected: new API for one caller; the existing `state.version` already fires on the right events.
- (c) Formal `EditorModel.onPageEditorsChanged()` base-class hook. Rejected: adds a method most editors ignore.

### N6 — Pattern A vs. Pattern B in the new architecture — **RESOLVED 2026-05-19**

**Problem.** The today-docs (`secondary-editors.md` §2) explain two distinct patterns. After unification, do they survive as distinct concepts, or do they dissolve?

**Walkthrough analysis.**

- **Pattern A** (separate model, secondary-only, e.g., ExplorerEditorModel): The model is in `editors[]`. Its `id !== _mainEditorId`. It contributes panels. Visible per the criterion.
- **Pattern B** (mainEditor in secondaryEditors[], e.g., ArchiveEditorModel): The model is in `editors[]`. Its `id === _mainEditorId`. It contributes panels. Visible per the criterion (main and panel-contributing).
- **Future "shape" — main editor with no panels** (Monaco): in `editors[]`. `id === _mainEditorId`. `contributesPanels() === false`. Visible per the criterion (because main).
- **Future "shape" — panel-contributing editor that was demoted from main** (today's ArchiveEditor after navigating to a contained file): In `editors[]`. `id !== _mainEditorId`. Still contributes `["archive-tree"]`. Visible because of panels.

The pattern distinction is just a label for two **states** of the same single membership relation. There's no need for separate Pattern A / Pattern B documentation in the new architecture.

**Decision: drop the Pattern A/B framing.** The `editors[]` array holds editors uniformly; the `id === _mainEditorId` and `contributesPanels()` flags describe each editor's current role. `secondary-editors.md` gets rewritten during walkthrough 24/30/the final docs pass to use this framing. No mockup change here — pure documentation update logged for the final docs pass.

### N7 — `close()` confirmation order — **RESOLVED 2026-05-19**

**Problem.** Today's `close()` (PageModel.ts:212-223) calls `confirmSecondaryRelease()` first, then `mainEditor.confirmRelease()`. After unification, the mockup (`mockups/PageModel.ts:260-267`) iterates `editors[]` in array order. The main editor may sit anywhere in the array.

**Decision: option (b) — panel editors first, main last.**

```ts
async close(): Promise<boolean> {
    // Panel-contributing editors first (preserves today's secondary-first order).
    for (const editor of this.editors) {
        if (editor === this.mainEditor) continue;
        if (!editor.modified) continue;
        if (!(await editor.confirmRelease())) return false;
    }
    // Main editor last — closing it commits to closing the page tab itself.
    if (this.mainEditor?.modified) {
        if (!(await this.mainEditor.confirmRelease())) return false;
    }
    this.onClose?.();
    return true;
}
```

**Rationale.** A page is a container of inner editors — closing the page means properly closing every inner editor (same shape as Persephone's "Close Other Tabs": each modified tab gets a Save dialog; if the user cancels one, the rest of the operation aborts). The main editor going last means:

1. **Cancellation leaves the page in a clean visible state.** If the user cancels on any inner editor's Save dialog, `close()` returns false; the main editor (which provides the content area) was never touched and remains visible to the user.
2. **Closing the main editor is the conceptual commit point** — once that dialog is accepted, the page tab itself is closed.

**Behavioral difference vs. raw insertion order.** Today: "Save link annotations? OK. Save main file? Cancel → no closing." With raw insertion order (main typically attached first): "Save main file? OK. Save link annotations? Cancel → no closing." In the latter, `confirmRelease()` on the main file already committed the save (Save/Discard/Cancel — Save commits) even though the close was ultimately cancelled. Surprising. Option (b) avoids this entirely.

**Iteration order within the panel-editor pass.** Insertion order — same as today's `secondaryEditors[]` iteration. No special sort.

**Options considered.**

- (a) Iterate raw insertion order. Rejected: causes the "main file got saved even though close was cancelled" surprise.
- **(b) — chosen.** Panel-contributing editors first, then main editor.

---

## Proposed mockup adjustments

### B1 — `TOneState.subscribe` selector overload (new foundation mockup)

Resolves: N1 (enables option (a)).

New file `mockups/TOneState.ts`. Backward-compatible enhancement to `TOneState.subscribe`:

```ts
subscribe(listener: () => void): () => void;
subscribe<R>(
    listener: (value: R) => void,
    selector: (state: T) => R,
): () => void;
```

When a selector is provided, the listener fires only when the selected slice differs (`compareSelection` — the same equality function `use` already uses for re-render gating). Detail and usage example in the mockup file.

Effort to land: ~20 lines in `state.ts` plus type overloads. Purely additive — no call-site migration required.

### B2 — `EditorModel.secondaryEditor` setter stays pure (no change needed)

Resolves: N1, N4.

A8 from walkthrough 01 already made the setter a pure state mutation. With option (a) for N1, no further change is required — the setter does NOT call `page.onEditorPanelsChanged` directly. PageModel observes the slice via the B1 subscription.

```ts
// mockups/EditorModel.ts — unchanged from walkthrough 01
set secondaryEditor(value: string[] | undefined) {
    this.state.update((s) => { s.secondaryEditor = value; });
}
```

`contributesPanels()` stays as-is (`(secondaryEditor?.length ?? 0) > 0`).

### B3 — `PageModel.attach` / `detach` manage per-editor subscriptions

Resolves: N1.

Update `mockups/PageModel.ts`. The membership primitives subscribe / unsubscribe to each editor's `secondaryEditor` slice:

```ts
// New private field
private _editorSubs = new Map<string, () => void>();

attach(editor: EditorModel): void {
    if (this.editors.includes(editor)) return;
    this.editors.push(editor);
    editor.setPage(this);
    const unsub = editor.state.subscribe(
        () => this.onEditorPanelsChanged(editor),
        (s) => s.secondaryEditor,
    );
    this._editorSubs.set(editor.id, unsub);
    this.state.update((s) => { s.version++; });
}

detach(editor: EditorModel): void {
    const idx = this.editors.indexOf(editor);
    if (idx < 0) return;
    this.editors.splice(idx, 1);
    this._editorSubs.get(editor.id)?.();
    this._editorSubs.delete(editor.id);
    editor.setPage(null);
    if (this._mainEditorId === editor.id) {
        this._mainEditorId = null;
        this.state.update((s) => { s.mainEditorId = null; });
    }
    this.state.update((s) => { s.version++; });
}
```

`dispose()` should also drain `_editorSubs` for safety even though every detach call unsubscribes (defensive — disposal may be called from paths that bypass `detach`):

```ts
async dispose(): Promise<void> {
    for (const unsub of this._editorSubs.values()) unsub();
    this._editorSubs.clear();
    // …existing dispose loop over editors[]…
}
```

### B4 — `PageModel.onEditorPanelsChanged(editor)` handler

Resolves: N1.

Add to `mockups/PageModel.ts` — called from inside the B3 subscription handler (not from the editor):

```ts
/**
 * Called from the per-editor subscription set up in attach() when the
 * editor's `secondaryEditor` slice changed.
 *
 * - Bumps state.version so PageNavigator re-renders.
 * - If the editor is no longer visible (not main AND no panels), detaches +
 *   disposes via the visibility criterion.
 */
onEditorPanelsChanged(editor: EditorModel): void {
    this.state.update((s) => { s.version++; });
    if (!this.editors.includes(editor)) return;
    if (editor !== this.mainEditor && !editor.contributesPanels()) {
        this.detach(editor);
        setTimeout(async () => {
            await editor.dispose();
            await fs.deleteCacheFiles(editor.id);
        }, 0);
    }
}
```

The `setTimeout` mirrors the same defer pattern in `setMainEditor` and `reconcileVisibility` (let React unmount the view before disposing the model).

### B5 — PageNavigator subscribes to `page.state`

Resolves: N2.

Reference for the implementation, no mockup file change (PageNavigator is a real component, not a mockup):
```tsx
export function PageNavigator({ page }: PageNavigatorProps) {
    page.state.use();
    const panelEditors = page.panelEditors;
    // …existing flatMap, iterating panelEditors
}
```

Logged in this walkthrough's "Adjustments to current code" section below.

### B6 — `close()` iterates panel editors then main

Resolves: N7.

Update `mockups/PageModel.ts:259-267`:
```ts
async close(): Promise<boolean> {
    // Panel-contributing editors first (preserves today's secondary-first order).
    for (const editor of this.editors) {
        if (editor === this.mainEditor) continue;
        if (!editor.modified) continue;
        if (!(await editor.confirmRelease())) return false;
    }
    if (this.mainEditor?.modified) {
        if (!(await this.mainEditor.confirmRelease())) return false;
    }
    this.onClose?.();
    return true;
}
```

### B7 — Drop Pattern A / Pattern B framing

Resolves: N6.

No mockup change in this walkthrough — these are docs. Logged as a forward-pointer for the final docs pass (walkthroughs 24/30 / wrap-up): `secondary-editors.md` gets rewritten around the unified `editors[]` shape and the `(is main, contributes panels)` flag pair.

---

## Open questions for review

1. ~~**N1 (panels-changed trigger).**~~ **Resolved 2026-05-19** — option (a) refined with TOneState selective `subscribe` (new foundation mockup `TOneState.ts`). PageModel subscribes per editor on the `secondaryEditor` slice via `attach`; unsubscribes via `detach`. Setter stays fully pure.
2. ~~**N2 (PageNavigator re-render signal).**~~ **Resolved 2026-05-19** — subscribe to `page.state`.
3. ~~**N3 (iteration source).**~~ **Resolved 2026-05-19** — `page.panelEditors` getter.
4. ~~**N4 (self-close pattern).**~~ **Resolved 2026-05-19** — reuse the N1 visibility-criterion path; no new API. Panel components hide the close button when their model is the mainEditor.
5. ~~**N5 (CategoryEditor's cross-editor reactivity).**~~ **Resolved 2026-05-19** — option (a-view): CategoryEditor's view subscribes to `page.state` via `.use()`. No model-side wiring; `onSecondaryEditorsChanged` / `_providerVersion` / defensive 50ms retry all removed.
6. ~~**N6 (Pattern A vs. Pattern B framing).**~~ **Resolved 2026-05-19** — dropped. Unified-array makes them states, not patterns.
7. ~~**N7 (close order).**~~ **Resolved 2026-05-19** — option (b): panel editors first, main last. Rationale: cancellation leaves the page visible; closing main is the conceptual commit point.
8. ~~**Scope.**~~ **Confirmed 2026-05-19** — persistence restore (secondary descriptors, `_pendingActivePanel` timing) folds into walkthrough 04's unified page descriptor.

---

## Adjustments to current code (non-mockup)

Logged for the implementation phase.

- `src/renderer/core/state/state.ts` — add the selector overload to `TOneState.subscribe` (B1). Purely additive — no migration needed.
- `PageModel.secondaryEditors[]`, `addSecondaryEditor`, `removeSecondaryEditor`, `removeSecondaryEditorWithoutDispose`, `secondaryEditorsVersion`, `_notifyMainEditorOfSecondaryChange`, `promoteSecondaryToMain`, `_prePromotePanels`, `pendingSecondaryDescriptors`, `restoreSecondaryEditors`, `confirmSecondaryRelease` — all gone (subsumed by the unified-array shape from walkthrough 01).
- `EditorModel.secondaryEditor` setter — stays pure (B2). No side effect added or restored.
- `PageModel.attach` / `detach` — set up / tear down a per-editor selective subscription on `state.secondaryEditor` (B3). Subscription handler delegates to `onEditorPanelsChanged`.
- `PageModel.onEditorPanelsChanged(editor)` — new method, called from the B3 subscription handler. Bumps version + enforces the visibility criterion (B4).
- `PageNavigator.tsx` — replace `secondaryEditorsVersion.use()` with `page.state.use()`; replace `page.secondaryEditors` with `page.panelEditors` (B5).
- `PageModel.close()` — iterate panel editors first, then main editor, on `modified` editors only (B6).
- `secondary-editor-registry.ts` and `LazySecondaryEditor.tsx` — no change.
- Panel React components (LinkCategorySecondaryEditor, ExplorerSecondaryEditor, ArchiveSecondaryEditor, etc.) — hide the close button when `model === page.mainEditor` (N4). Today this case is broken; the button renders and clicking it has no useful effect.
- `PageNavigatorModel.ts` — no change.
- `CategoryEditorModel` — delete `onSecondaryEditorsChanged()`, `_providerVersion` field, and `providerVersion` getter (N5). No model-side wiring needed.
- `CategoryEditor.tsx` — view subscribes to `page.state.use()`; `useMemo` keys on `page?.state.get().version` (N5). Drop the defensive 50ms `setTimeout` retry inside `useEffect`. Switch the scan source from `page.secondaryEditors` to `page.panelEditors`.
- Active-panel restore (`_pendingActivePanel`) — survives conceptually but the timing fits whatever walkthrough 04 settles on for the unified restore flow.
- `pageNavigatorToggled` and `panelExpanded` global event channels — no change.

---

## Files / concepts that are NOT changing

- `secondary-editor-registry.ts` — purely panel-id → React component lookup. No editor / membership knowledge.
- `LazySecondaryEditor.tsx` — dynamic-import wrapper.
- `PageNavigatorModel.ts` — pure sidebar layout (open/width).
- `pageNavigatorToggled`, `panelExpanded` global events — same shape.
- The portal-header pattern (panel components render their own header into `headerRef`).
- The `secondaryEditor: string[]` field on `IEditorState` — still the source of truth for which panels an editor contributes. (Walkthrough 04 may reshape persistence, but the in-memory field stays.)

---

## Second-pass review (Tier 1 end — 2026-05-19)

Re-read against walkthroughs 04–07 and the final mockup state. N1–N7 all survive; the slice-subscribe approach + view-side reactivity in CategoryEditor are confirmed by every downstream walkthrough that mentions sidebar restoration or panel-list mutation.

### What landed downstream

- **From 04 / P3 / C7**: The sidebar cache file `<pageId>-nav-panel.txt` is retired; `pendingSecondaryDescriptors` / `_pendingActivePanel` / `restoreSecondaryEditors` all disappear from PageModel. This walkthrough explicitly deferred those to 04 — they landed exactly as the unified `PageDescriptor.editors[]` + `sidebar?` shape implies. The "Adjustments to current code" list here calls out "Active-panel restore (`_pendingActivePanel`) — survives conceptually but the timing fits whatever walkthrough 04 settles on" — that's now resolved (it disappears; `Promise.all` over `editors[]` guarantees all panel contributors are present before the active-panel resolution step).
- **From 04 / P5**: Parallel per-editor restore. CategoryEditor's "sibling not yet attached" race (caveat in N5) shrinks to a microscopic placeholder window because all editors `attach()` in tight succession after their parallel restores resolve. The N5 / view-side `page.state.use()` subscription handles even that microwindow correctly. No new concern.
- **From 06 / CK6**: `compareModeChanged` Subscription deleted. This walkthrough already retired `_notifyMainEditorOfSecondaryChange` (the model-side duck-type hook); 06 retires the global compare bridge. Both follow the same reasoning — bridges that exist only because some piece of state lived far from its consumer disappear once the state moves to the right home.
- **From 06 / CK7**: `PageModel.setMainEditor(newMain)` gets a compare-cleanup hook. Doesn't touch any walkthrough-03 decision because the compare flag never lived on a secondary editor — it was on `TextFileModel` state. The unified-array shape and the visibility criterion remain orthogonal to compare-mode placement.
- **From 07 / GK10**: `findPage(id)` resolution under unified `editors[]` works correctly. Walkthrough 03 already migrated `findPage` from `p.id || p.mainEditor?.id || p.secondaryEditors.some(...)` to `p.id || p.editors.some(e => e.id === id)`. Confirmed in 07; no change needed.

### Mockup snapshot vs. doc snippets

Every B-mockup adjustment listed in this walkthrough (B1 `TOneState.ts`, B3 attach/detach + `_editorSubs`, B4 `onEditorPanelsChanged`, B6 `close()` order) is present in the live `mockups/PageModel.ts` and `mockups/TOneState.ts`. B5 (PageNavigator subscribes to `page.state`) is a real-code change not in any mockup file — confirmed still applicable. B2 (setter stays pure) confirms A8 from walkthrough 01.

### One quiet implication for walkthrough 24 (Link)

N5 explicitly noted: "`treeProvider` mutations (e.g., ExplorerEditorModel.navigateUp() replaces `treeProvider = new FileTreeProvider(parent)`) don't fire the slice subscription — same behavior as today. If treeProvider mutations need their own reactivity, that's a walkthrough-24/30 concern."

US-493 (in active work) is exactly this case — Explorer panel not refreshing on `navigateUp`. The fix landed there as a per-Explorer `model.state.use()` subscription in the view. The N5 caveat ages well; walkthrough 24 / 30 will codify the pattern.

### No regressions

All seven N-concerns survive every later walkthrough untouched. The slice-subscribe primitive (TOneState selector overload — B1) is reused at least once outside this walkthrough's territory: walkthrough 04 / P5's parallel restore confirmation depends on `state.version` being bumped reliably on every membership change, which B3's attach/detach explicitly does.

No new concerns surfaced during the second pass.

---

## Status

- [x] Analysis written
- [x] Reviewed by user
- [x] Concerns resolved (decisions captured) — N1–N7 resolved
- [x] Mockups updated per resolutions — `TOneState.ts` added (B1); `PageModel.ts` updated (B3 attach/detach sub bookkeeping, B4 `onEditorPanelsChanged`, B6 `close()` order, defensive sub-drain in `dispose`); `EditorModel.ts` unchanged (B2 confirms A8's pure setter)
- [x] Logged in `concerns.md`
- [x] Marked `[x]` in `progress.md`
- [x] Second-pass review (2026-05-19) — N1–N7 confirmed against 04–07; no decision drift
