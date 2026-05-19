# 06 — Compare mode walkthrough

Scope: where the compare-mode flag lives in the new architecture (resolves C6), how CompareEditor is activated / rendered / exited, the relation to grouped pages (walkthrough 07), and the cleanup obligations when the underlying host changes shape.

**Out of scope** (own walkthroughs): grouped-page layout and `GroupContainer`/splitter mechanics (`07`), Monaco-specific diff configuration (`20`), notebook per-note comparison (not a thing today — `29` only covers per-note editor swap).

**Status:** Done (2026-05-19). All concerns CK1–CK10 resolved. Mockups updated: `TextFileModel.ts` (C1 — `compareMode` comments now point to `PagesModel.state.compareGroups` instead of the "C6 — TBD" markers). Persistence intentionally NOT added per CK9 — main window's tray-hide design covers in-process survival; rare secondary-window restart loss is acceptable. All other adjustments are real-code only and live in the call-site/persistence files (no foundation mockup change).

---

## What exists today

### The flag lives on the host

Two grouped pages enter compare mode by toggling `compareMode: boolean` on **each** `TextFileModel` independently — `src/renderer/editors/text/TextEditorModel.ts:24, 35, 254`:

```ts
interface ITextFileState extends IEditorState {
    // …
    compareMode: boolean;
    // …
}
```

`TextFileActionsModel.setCompareMode` (`TextFileActionsModel.ts:67-72`) mutates the host state AND fires a global `Subscription<void>`:

```ts
setCompareMode = (compareMode: boolean) => {
    this.model.state.update((s) => {
        s.compareMode = compareMode;
    });
    compareModeChanged.send();
};
```

`compareModeChanged` is the only thing that lets the Pages layout react to a host-level change. It lives in `src/renderer/core/state/events.ts:73`:

```ts
/** Fired when any text editor's compareMode toggles. Pages listens to refresh its layout. */
export const compareModeChanged = new Subscription<void>();
```

### Pages bridges host-flag → layout

`Pages.tsx:138-141`:
```ts
useEffect(() => {
    const sub = compareModeChanged.subscribe(() => pagesModel.rerender());
    return () => sub.unsubscribe();
}, []);
```

`pagesModel.rerender()` (`PagesModel.ts:137-140`) bumps a dedicated `rerender: number` counter on `pagesModel.state` purely so that `state.use()` consumers re-fire:

```ts
state = {
    // …
    /** Bumped to force a Pages re-render when off-state changes (e.g. compareMode) need to flow into the layout. */
    rerender: 0,
};

rerender = () => {
    this.state.update((s) => { s.rerender = s.rerender + 1; });
};
```

### Two reads of the host flag

**Per-page render decision** — `Pages.tsx:84-113` (`PageContent`):
```ts
function PageContent({ pageId }: { pageId: string }) {
    // …
    const textEditor = editor && isTextFileModel(editor) ? editor : null;
    const compareMode = useOptionalState(textEditor?.state as any, (s: any) => s.compareMode, false);

    if (compareMode) {
        const { leftRight } = pagesModel.state.get();
        const rightId = leftRight.get(pageId);
        if (rightId) {
            const rightPage = pagesModel.query.findPage(rightId);
            const rightEditor = rightPage?.mainEditor;
            if (editor && rightEditor && isTextFileModel(editor) && isTextFileModel(rightEditor)) {
                return <CompareEditor model={editor} groupedModel={rightEditor} />;
            }
        }
        // RIGHT side renders nothing — the LEFT side's portal paints the diff
        return null;
    }
    return ( /* normal Navigator + editor */ );
}
```

**Whole-pair layout decision** — `Pages.tsx:143-160`:
```ts
const compareModeIds = new Set<string>();
for (const [leftId] of leftRight) {
    const page = pages.find((p) => p.id === leftId);
    const editor = page?.mainEditor;
    if (editor && isTextFileModel(editor) && (editor.state.get() as any).compareMode) {
        compareModeIds.add(leftId);
    }
}

return (
    <AppPageManager
        // …
        compareModeIds={compareModeIds}
        // …
    />
);
```

`AppPageManager` consumes `compareModeIds` to (a) hide the splitter for a compare group, (b) hide the right placeholder + full-span the left placeholder, (c) call `gc.setCompareMode(inCompareMode)` on the `GroupContainer` (which pauses splitter layout) — `AppPageManager.tsx:120-153`.

### Two activation paths

**Toolbar button** — `TextToolbar.tsx:100-118`:
```ts
if (isTextFileModel(model)) {
    const leftGroupedPage = pagesModel.getLeftGroupedPage(model.id);
    const leftGroupedEditor = leftGroupedPage?.mainEditor;
    if (leftGroupedEditor && isTextFileModel(leftGroupedEditor)) {
        actions.push(
            <IconButton
                title="Compare with Left Page"
                onClick={() => {
                    model.setCompareMode(true);
                    leftGroupedEditor.setCompareMode(true);
                }}
            />
        );
    }
}
```

Visible only on the **right** page of a group, when both main editors are `TextFileModel`. Toggling sets the flag on both editors.

**Programmatic** — `PagesLifecycleModel.openDiff` (`PagesLifecycleModel.ts:403-443`): opens two paths, groups them, sets `compareMode = true` on both editors directly via `state.update`, then calls `fixCompareMode`.

```ts
this.model.layout.groupTabs(existingFirst.id, existingSecond.id, true);
this.model.layout.fixCompareMode();
if (firstEditor && isTextFileModel(firstEditor) && secondEditor && isTextFileModel(secondEditor)) {
    firstEditor.state.update((s) => { (s as any).compareMode = true; });
    secondEditor.state.update((s) => { (s as any).compareMode = true; });
}
```

### Sanity sweep — `fixCompareMode`

`PagesLayoutModel.ts:201-215` walks every page and clears `compareMode` on any `TextFileModel` whose page isn't grouped anymore:

```ts
fixCompareMode = () => {
    const pages = this.model.state.get().pages;
    for (const page of pages) {
        const editor = page.mainEditor;
        if (editor && isTextFileModel(editor)) {
            const textEditor = editor as unknown as TextFileModel;
            if (textEditor.state.get().compareMode && !this.model.query.isGrouped(page.id)) {
                textEditor.setCompareMode(false);
            }
        }
    }
};
```

Today's coverage is partial — it handles "compareMode on but ungrouped" but NOT "compareMode on but the partner switched to non-TextFileModel" or "compareMode on but mainEditor itself switched to non-text". Those silently degrade in the render path (no diff appears, flag stays set, no UX surface to re-enter).

### Exit

`CompareEditor.tsx:86-95`:
```ts
<IconButton
    title="Exit Compare Mode"
    onClick={() => {
        model.setCompareMode(false);
        groupedModel.setCompareMode(false);
    }}
/>
```

Pair-symmetric. Toggling either side off via the exit button always toggles both.

### Persistence

Today `compareMode` rides on `IEditorState` (the persistence schema) — `getRestoreData` serializes the whole state including this field. On restart the flag is restored per editor and PageContent re-evaluates the render path on first paint. `WindowState.groupings` already preserves the pairings (`PagesPersistenceModel.ts:29, 128-131`).

---

## What the new arch needs

The C6 baseline already names the design tension: **compareMode is rendering policy on a pair of pages**, not state of any single editor. It happens to be stored on hosts today because that's what existed when the feature was added.

Walkthrough 02 / S10 retires the `IEditorState` flat shape and the `isTextFileModel` type guard. Walkthrough 04 / P1 retires `compareMode` from any flat editor record. So even if we wanted to keep the flag on the host, we'd have to re-place it somewhere new because the carrier (`IEditorState`) is gone.

The clean shape is:

1. **Pair-level flag** on `PagesModel.state` — `compareGroups: Set<string>` keyed by left page id, paralleling `leftRight` / `rightLeft`.
2. **Activation API** on `PagesLayoutModel` — `enterCompareMode(leftPageId)` / `exitCompareMode(leftPageId)`. Single call mutates pair-level state; no double-toggle on two hosts.
3. **CompareEditor stays a React component**, NOT a registered `EditorModel`. It has two hosts and spans two tabs — both of which break the `EditorModel` invariants (one host, one tab) that walkthroughs 01–05 just nailed down.
4. **Compatibility check** centralized as `pagesModel.query.canCompare(leftId, rightId)` — single `instanceof TextFileModel` check on both sides.
5. **Cleanup obligations** fold into existing methods — `ungroup`, `removePage`, `setMainEditor` — instead of a separate `fixCompareMode` sweep.
6. **Retire `compareModeChanged` Subscription and `pagesModel.rerender()`** — pagesModel.state.use() naturally fires when `compareGroups` mutates. The cross-model bridge becomes dead code.
7. **Persistence**: do NOT persist `compareGroups`. The main window hides to tray (process keeps running) so compare mode survives any visible-state change naturally; only true secondary-window save-on-close → restore loses the flag, and that's a rare edge case. Cross-window transfer of a compare pair is impossible anyway — both pages can't be dragged simultaneously. WindowState shape stays as walkthrough 04 / P1 defines it.

The CompareEditor view itself barely changes — it still takes two `TextFileModel` props and renders Monaco DiffEditor. Only its exit-button wiring moves from "toggle two host flags" to "call `pagesModel.layout.exitCompareMode(leftPageId)`".

---

## How mockups handle this (or don't yet)

The existing mockups touch compareMode only as a "C6 — TBD" marker:

- `mockups/TextFileModel.ts:53-54, 202` lists `compareMode` in the "what's gone" section with a TBD note: *"may move to a Monaco-specific state, or to a separate `IComparable` capability."*
- No mockup currently has a `compareGroups` field on a Pages-level state shape (PagesModel is not a foundation mockup).
- `PersistenceTypes.ts:133-138` has `WindowState { schemaVersion, pages, groupings?, activePageId? }` — no `compareGroups?` field yet.

The walkthrough 06 work proposes:
- Confirm "C6 — TBD" resolves to pair-level (not host, not Monaco-specific, not a sub-trait).
- Add `compareGroups?: string[]` to `PersistenceTypes.ts:WindowState` (mockup change — additive to walkthrough 04 / P1).
- Document the cleanup obligations on PagesLayoutModel real-code methods (real-code only — `PagesLayoutModel.ts` isn't a foundation mockup).

---

## Concerns

### CK1 — Storage location for the compare flag

Today: `TextFileModel.state.compareMode` (per-host, duplicated across both sides).

Options:
- **(a) Keep on host.** Re-locate `compareMode` from `IEditorState` to `TextFileModel` private state under the walkthrough 04 / C6 split. Preserves today's two-step toggle pattern.
- **(b) Pair-level on `PagesModel.state`.** Add `compareGroups: Set<string>` keyed by left page id, parallel to `leftRight`/`rightLeft`. Single source of truth; ungroup / removePage / setMainEditor can clean it atomically.
- **(c) Richer grouping record.** Replace `leftRight: Map<string, string>` with `groupings: Map<string, { rightId: string; compareMode?: boolean }>`. Future per-pair state (split ratio, axis, layout mode) folds in.
- **(d) On the CompareEditor instance.** Make CompareEditor a registered EditorModel; its existence IS the flag. But see CK2 — the model contract doesn't fit.

**Recommendation: (b).** Minimal, additive, immediately retires `compareModeChanged` + `pagesModel.rerender()`. (c) is the future-proof option but YAGNI today — only one piece of per-pair state exists. Easy to grow into (c) later if a second appears.

### CK2 — Is CompareEditor a real EditorModel?

Today: pure React component used inline by `Pages#PageContent`.

Options:
- **(a) Stay a React component.** Rendered conditionally by `PageContent` when the active pair is in compare mode. The decision lives in Pages, not in the registry.
- **(b) Register as `EditorModel`.** Add a `"compare-editor"` entry to `editorRegistry`. Becomes a real `EditorModel` with `editorId = "compare-editor"`, `hasContentHost = false`. Tab swap UX could include "switch to compare" alongside Monaco / Grid / etc.

(b) breaks several walkthrough 01–05 invariants:
- One editor, one host (CompareEditor needs two).
- One editor, one tab (CompareEditor spans the LEFT tab and reads the RIGHT tab's host).
- `findEditorsAccepting(host)` would gain an editor that's only "accepting" when the page is grouped — a state outside the host. Pollutes the switch widget for ungrouped pages.

**Recommendation: (a).** Compare mode is not "an editor type" — it's "render the pair differently." The contract mismatch in (b) costs more than the value.

### CK3 — Compatibility check centralization

Today: `isTextFileModel(editor)` checks scattered across `TextToolbar.tsx`, `Pages.tsx` (twice), `PagesLifecycleModel.openDiff`, `PagesLayoutModel.fixCompareMode`. Per S10/C1 the new arch replaces these with `instanceof TextFileModel` on the host of `mainEditor`.

Options:
- **(a) Inline `instanceof TextFileModel` at each call site.** Same scatter pattern, just different syntax.
- **(b) Centralize as `pagesModel.query.canCompare(leftId, rightId): boolean`.** Single helper consumed by toolbar button visibility, `enterCompareMode` precondition, and PageContent render guard.

**Recommendation: (b).** The predicate is identical in every place — "both pages exist, both are grouped together, both mainEditors' hosts are `TextFileModel`." Centralizing keeps the rule in one spot for when compare mode someday supports other host types.

### CK4 — Activation API

Today: `model.setCompareMode(true); leftGroupedEditor.setCompareMode(true);` — caller toggles both sides explicitly.

Options:
- **(a) Single pair-level method.** `pagesModel.layout.enterCompareMode(leftPageId)` / `exitCompareMode(leftPageId)`. Internally adds/removes from `compareGroups`. Throws (or returns boolean) if `canCompare` is false.
- **(b) Toggle on either page id.** `enterCompareMode(pageId)` accepts left or right; internally resolves the leftId and mutates `compareGroups`. Mirrors today's "toggle either side, both flip" symmetry.
- **(c) Keep two-call pattern, just on a new namespace.** `pagesModel.layout.setCompareMode(leftId, true)` + caller iterates both. Awkward — there's no two-sided thing to toggle once `compareGroups` is pair-keyed.

**Recommendation: (b).** Callers don't always know which side is left (the toolbar button is on the right page). `enterCompareMode` accepting either id and resolving internally matches today's call-site ergonomics. Returns boolean (false if precondition fails).

### CK5 — Rendering reads from new source

Today: `PageContent` uses `useOptionalState(textEditor?.state, s => s.compareMode, false)` and `Pages` rebuilds `compareModeIds` by scanning hosts.

New: both consumers read from `pagesModel.state.use()`.

Options:
- **(a) Direct read.** `PageContent` calls `pagesModel.state.use(s => s.compareGroups.has(leftIdForThisPage))`. Edge case: a page that is the RIGHT side of a compare pair needs to resolve its leftId first.
- **(b) Derived getter.** Add `pagesModel.query.isInCompareMode(pageId): { active: boolean; leftId?: string; rightId?: string }`. Subscribers read `pagesModel.state.use(s => s.compareGroups)` to trigger updates and call the getter for the resolved data.

**Recommendation: (b).** The "am I left or right of this pair?" lookup recurs in PageContent (decide whether to render CompareEditor vs. nothing) AND in toolbar/exit button (find the leftId). Centralizing.

### CK6 — Retire `compareModeChanged` Subscription and `pagesModel.rerender()`

Today: `compareModeChanged` and `pagesModel.rerender()` exist purely to bridge host-state-change → pages-layout-React-re-render. They're a workaround for the flag living far from the consumer.

Options:
- **(a) Retire both.** Once `compareGroups` is on `pagesModel.state`, `state.use()` subscribers re-render naturally. Delete `compareModeChanged` from `events.ts`, delete `rerender` field + `rerender()` method from `PagesModel`.
- **(b) Keep `rerender` as general-purpose hammer.** Some other future "off-state changed" might need it. (We don't have one today.)

**Recommendation: (a).** Both exist for one specific bridge that disappears under CK1/(b). Keeping them around as "in case" violates "Don't add features for hypothetical future requirements." Delete now; if another bridge appears, design for it then.

### CK7 — Retire `fixCompareMode` + fold cleanup into existing methods

Today's `fixCompareMode` only handles "compareMode on but ungrouped." It misses "compareMode on but host changed shape." Under pair-level storage these become explicit obligations on the mutating methods.

The required cleanup hooks:
- `PagesLayoutModel.ungroup(pageId)` — `compareGroups.delete(leftId)` for the affected pair.
- `PagesLifecycleModel.removePage(page)` — same; if the closed page is in a compare pair, drop the entry.
- `PageModel.setMainEditor(newMain)` — if this page is in a compare pair AND the new main editor's host isn't `TextFileModel`, exit compare for the pair (delete `compareGroups` entry).

Options:
- **(a) Inline in each method.** Three single-line cleanups, each at the obvious place.
- **(b) Subscription pattern.** `pagesModel.state` subscriber that watches grouping changes and validates `compareGroups` against the new state. More plumbing for three call sites.
- **(c) Keep a `fixCompareGroups()` sweep.** Run after each mutation. More work than (a), same observable behavior.

**Recommendation: (a).** Three explicit cleanups in the three places that mutate the source-of-truth. Easy to read; impossible to forget because the mutating method is right there.

### CK8 — `openDiff` rewrite

Today: openDiff opens two paths, calls `groupTabs(firstId, secondId, true)`, calls `fixCompareMode`, then directly does `state.update(s => (s as any).compareMode = true)` on both editors.

Options:
- **(a) Use the new API.** `groupTabs(firstId, secondId, true)` then `pagesModel.layout.enterCompareMode(firstId)`. Drop the `state.update` calls and the `fixCompareMode` call. ~4 lines deleted.
- **(b) Single atomic method.** New `pagesModel.layout.openComparePair(firstId, secondId)` that groups + enters compare in one call. Reduces openDiff to one line.

**Recommendation: (a).** Composes existing primitives. (b) adds a one-caller helper that doesn't earn its keep — openDiff is the only caller. If a second caller appears later, refactor then.

### CK9 — Persistence

Today: `compareMode` rides each editor's `IEditorState`. Walkthrough 04 / P1 retires `IEditorState`, so we need a new home.

Options:
- **(a) Add `compareGroups?: string[]` to `WindowState`.** Additive optional field; serialized as an array of left page ids. Bootstrap restore reads it after applying `groupings` (which already restores). No schema version bump (additive per P10 contract).
- **(b) Fold into the grouping record.** Change `WindowState.groupings` from `[string, string][]` to `{ left, right, compareMode?: boolean }[]`. Cleaner shape but a non-additive change — would need a schema version bump (P10). Inconsistent with the "additive optional fields don't bump" contract since the array element shape changes.
- **(c) Don't persist.** Always exit compare mode on restart. User-facing regression (today's compare mode survives restart).

**Resolved: (c).** Persephone's main window hides to tray instead of closing — compare mode survives any in-process state change without persistence. The only loss surface is genuine secondary-window save-on-close → restore, which is rare. Cross-window transfer can't carry a compare pair anyway (both pages of the pair can't be dragged simultaneously), so the IPC-payload concern from walkthrough 05 doesn't apply. Net: in-memory only; `WindowState` stays exactly as walkthrough 04 / P1 defines it; no mockup change.

### CK10 — CompareEditor exit-button wiring + leftPageId source

Today: `CompareEditor` receives `model` + `groupedModel` and the exit button toggles both via `setCompareMode(false)`.

Under CK4/(b) the exit must call `pagesModel.layout.exitCompareMode(somePageId)` — but CompareEditor doesn't currently know its leftPageId.

Options:
- **(a) Pass `leftPageId` as a third prop.** PageContent already has the leftId in hand when it decides to render CompareEditor. Cleanest.
- **(b) Reverse-lookup at click time.** Exit handler calls `pagesModel.query.findPageByEditor(model)` to get the left page, then `exitCompareMode(page.id)`. Adds a lookup helper.
- **(c) Use either side.** CK4/(b) allows passing either id to `exitCompareMode`; CompareEditor passes `model`'s page id (the LEFT). Requires `findPageByEditor` or equivalent.

**Recommendation: (a).** PageContent is the one place that resolves "render CompareEditor for THIS leftId"; threading the id one prop deeper is trivial. (b) and (c) both add a global page-by-editor lookup helper that nothing else uses.

---

## Proposed mockup adjustments

### C1 — `TextFileModel.ts` mockup: drop the "C6 — TBD" markers

Two spots refer to `compareMode` as undecided:
- Line 53-54: `// - compareMode (C6 — TBD: may move to a Monaco-specific state, or to a separate IComparable capability)`
- Line 202: `// - compareMode (C6 — TBD)`

Replace with: `// - compareMode (C6 — moved to PagesModel.state.compareGroups, walkthrough 06 / CK1)`.

### Real-code-only changes (no mockup)

These touch files that aren't foundation mockups:
- `src/renderer/api/pages/PagesModel.ts` — add `compareGroups: Set<string>` to state; delete `rerender` field + `rerender()` method (CK6).
- `src/renderer/api/pages/PagesLayoutModel.ts` — add `enterCompareMode(pageId)` + `exitCompareMode(pageId)`; delete `fixCompareMode` (CK4, CK7); fold cleanup into `ungroup` (CK7).
- `src/renderer/api/pages/PagesQueryModel.ts` (or equivalent) — add `canCompare(leftId, rightId)` + `isInCompareMode(pageId)` helpers (CK3, CK5).
- `src/renderer/api/pages/PageModel.ts` — `setMainEditor` cleanup hook for non-text host swap (CK7).
- `src/renderer/api/pages/PagesLifecycleModel.ts` — `openDiff` rewrite (CK8); `removePage` cleanup hook (CK7).
- `src/renderer/core/state/events.ts` — delete `compareModeChanged` (CK6).
- `src/renderer/ui/app/Pages.tsx` — `PageContent` reads `pagesModel.query.isInCompareMode(pageId)`; `Pages` derives `compareModeIds` from `compareGroups` (CK5); delete the `compareModeChanged` subscription (CK6).
- `src/renderer/editors/text/TextToolbar.tsx` — toolbar button calls `pagesModel.layout.enterCompareMode(model.id)` (after resolving the page) (CK4).
- `src/renderer/editors/compare/CompareEditor.tsx` — accept `leftPageId` prop; exit button calls `pagesModel.layout.exitCompareMode(leftPageId)` (CK10).
- `src/renderer/editors/text/TextEditorModel.ts` — drop `compareMode` field from state interface + `setCompareMode` forwarder (CK1).
- `src/renderer/editors/text/TextFileActionsModel.ts` — drop `setCompareMode` method (CK1).

---

## Open questions

None remaining — all design decisions resolve in the CK list with proposed defaults.

---

## Files NOT changing

These were touched by other walkthroughs or stay verbatim:

- `src/renderer/components/page-manager/AppPageManager.tsx` — `compareModeIds` prop survives; the SOURCE of the set changes (CK5) but the prop and consumption stay identical.
- `src/renderer/components/page-manager/GroupContainer.ts` — `setCompareMode(enabled)` method survives unchanged; it's a pure DOM/layout concern, not state.
- `src/renderer/editors/compare/CompareEditor.tsx` (the body) — Monaco DiffEditor wiring, content reading, prop interface (apart from the new `leftPageId` prop). Just the exit button wiring shifts (CK10).
- Foundation mockups beyond `PersistenceTypes.ts` and the `TextFileModel.ts` doc-comment touch — no changes.

---

## Status checklist

- [x] CK1 — Storage location (host vs. pair-level) — **(b)** pair-level `compareGroups: Set<string>` on `PagesModel.state`
- [x] CK2 — CompareEditor: EditorModel or React component — **(a)** stays a React component rendered by `Pages#PageContent`; not a registered EditorModel
- [x] CK3 — Compatibility helper (`canCompare`) — **(b)** centralize as `pagesModel.query.canCompare(leftId, rightId)`; single `instanceof TextFileModel` predicate consumed by toolbar visibility, `enterCompareMode` precondition, PageContent render guard
- [x] CK4 — Activation API shape — **(b)** `pagesModel.layout.enterCompareMode(pageId)` / `exitCompareMode(pageId)` accept either side and resolve the leftId internally; returns boolean (false if precondition fails)
- [x] CK5 — Render reads from new source — **(b)** add `pagesModel.query.isInCompareMode(pageId): { active: boolean; leftId?: string; rightId?: string }`; consumers subscribe via `pagesModel.state.use(s => s.compareGroups)` and call the getter to resolve left/right
- [x] CK6 — Retire `compareModeChanged` + `pagesModel.rerender()` — **(a)** delete both. `state.use()` on `compareGroups` naturally fires consumers. Removes a bridge that existed only because the flag lived far from its consumer
- [x] CK7 — Retire `fixCompareMode`; fold cleanup hooks — **(a)** delete `fixCompareMode`. Three inline cleanups: `PagesLayoutModel.ungroup(pageId)` deletes from `compareGroups`; `PagesLifecycleModel.removePage(page)` drops the entry for the closed page; `PageModel.setMainEditor(newMain)` exits compare for the pair when the new main's host isn't `TextFileModel`. Each cleanup sits at the mutating method — impossible to forget
- [x] CK8 — `openDiff` rewrite — **(a)** compose existing primitives: `this.model.layout.groupTabs(firstId, secondId, true)` + `this.model.layout.enterCompareMode(firstId)`. Drops the direct `state.update(s => s.compareMode = true)` calls and the `fixCompareMode()` call. No new helper; refactor only if a second caller appears
- [x] CK9 — Persistence — **(c)** don't persist. Main window hides to tray (in-memory survives); secondary-window restore loses the flag — rare edge case, acceptable. Cross-window transfer of a compare pair is impossible by design. `WindowState` shape unchanged from walkthrough 04 / P1
- [x] CK10 — CompareEditor exit-button wiring + `leftPageId` prop — **(a)** pass `leftPageId` as a third prop. `PageContent` already resolves the leftId when deciding to render CompareEditor; thread it one prop deeper. Exit button calls `pagesModel.layout.exitCompareMode(leftPageId)`. No global "find page by editor" helper needed
- [x] Mockup adjustment C1 — `TextFileModel.ts` doc-comment update (drop "C6 — TBD" markers; point to `PagesModel.state.compareGroups`)
- [x] Second-pass review (2026-05-19) — see below

---

## Second-pass review (Tier 1 end — 2026-05-19)

Re-read against walkthrough 07. CK1–CK10 all hold; the pair-level placement absorbs every downstream interaction cleanly.

### Downstream confirmations

- **From 07 / GK4**: `PageTab.closeClick`'s grouped branch drops its `fixCompareMode()` call — fully redundant once CK7's `ungroup` carries the compare-cleanup obligation. Walkthrough 07 confirms the simplification end-to-end (drop the call, not belt-and-suspenders).
- **From 07 / GK3**: `fixGrouping` keeps its two passes (swap-direction + dangling-group) but loses its trailing `fixCompareMode()` call per CK7. Confirmed in 07 as a one-line deletion.
- **From 07 / GK2** *(signature refined 2026-05-20 by walkthrough 08 / T2)*: `pagesModel.query.getTextFileHost(pageId): TextFileModel | null` joins `canCompare` (CK3) as a centralized host-instanceof helper. Same pattern, parallel use case — both retire scattered `type === "textFile"` checks at their respective call sites. CK3 stays a two-id boolean (no host to return); GK2 returns the typed host so callers can also reuse it for method calls.
- **From 07 / GK5**: Cross-window transfer dissolves the group; combined with CK9's "compare pair cannot transfer atomically" (both pages can't be dragged simultaneously), the two walkthroughs cover the same impossibility from different angles. Persistence shape stays unchanged for either feature.

### Mockup snapshot vs. doc

`mockups/TextFileModel.ts` already has the C1 doc-comment update (line 54: `// - compareMode (C6 — moved to PagesModel.state.compareGroups, pair-level keyed by left page id; walkthrough 06 / CK1)` and line 202-203: REMOVED list entries for `compareMode` and `setCompareMode`). No further mockup changes needed.

All other CK changes are real-code only (`PagesModel`, `PagesLayoutModel`, `PagesQueryModel`, `PagesLifecycleModel`, `PageModel.setMainEditor`, `events.ts`, `Pages.tsx`, `TextToolbar.tsx`, `CompareEditor.tsx`, `TextEditorModel.ts`, `TextFileActionsModel.ts`) — neither walkthrough 07 nor the live mockups need them.

### No new concerns

Compare mode was the cleanest Tier 1 simplification by line count: a feature that today requires a host-level field, a global Subscription, a `rerender` counter, a sanity-sweep, and per-host setters collapses into a single pair-level `Set<leftId>` with three explicit cleanup hooks. The second pass found zero downstream invalidation.
