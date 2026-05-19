# 07 — Grouped pages walkthrough

Scope: side-by-side rendering of two pages backed by the `leftRight` / `rightLeft` parallel maps on `PagesModel.state`; the `group` / `ungroup` / `groupTabs` / `fixGrouping` API on `PagesLayoutModel`; the `AppPageManager` + `GroupContainer` + `ImperativeSplitter` DOM machinery; the few EPIC-028 touch points (host-instanceof migration of `requireGroupedText`, CK7-driven simplification of close-button flow); relation to compare mode (`06`) and multi-window transfer (`05`).

**Out of scope** (own walkthroughs): the compare flag and the `compareModeIds` set (`06`), tab drag-reorder ergonomics (`08`), single-tab cross-window drag (`05`), Monaco DiffEditor wiring inside `CompareEditor` (`20`), `secondaryEditors[]` → unified `editors[]` (`01` / `03`).

**Status:** Done (2026-05-19). All concerns GK1–GK10 resolved. No mockup adjustments required — `WindowState.groupings?: [string, string][]` was already in the new persistence mockup from walkthrough 04 / P1, and the grouping mechanism is page-level layout code (page-id-keyed) untouched by the editor/host refactor. Real-code changes are narrow: GK2's centralized `getTextFileHost` helper (replaces the `type === "textFile"` discriminator in `requireGroupedText`), GK4's `closeClick` cleanup (drops the now-redundant `fixCompareMode()` call), and the trailing `fixCompareMode()` call inside `fixGrouping` deletes per walkthrough 06 / CK7. All other surfaces (parallel maps, `group`/`ungroup`/`groupTabs`, swap-direction + dangling-group passes of `fixGrouping`, `AppPageManager` / `GroupContainer` / `ImperativeSplitter`, persistence, script API, multi-window transfer behavior) carry over unchanged.

---

## What exists today

### Storage — two parallel maps on `PagesModel.state`

`src/renderer/api/pages/PagesModel.ts:21-22`:

```ts
const defaultOpenFilesState = {
    pages: [] as PageModel[],
    ordered: [] as PageModel[],
    leftRight: new Map<string, string>(),
    rightLeft: new Map<string, string>(),
    rerender: 0,
};
```

A group is exactly two pages — one entry in each map: `leftRight.set(leftId, rightId)` AND `rightLeft.set(rightId, leftId)`. Both directions are mutated together; the parallel maps keep both lookups O(1).

### Mutation API — `PagesLayoutModel`

`PagesLayoutModel.ts:85-159` exposes four mutation primitives, all on `pagesModel.layout`:

**`group(leftPageId, rightPageId)`** — base method. Calls `ungroup` on both ids first (clears any existing membership), then sets both maps. Triggers `saveStateDebounced`.

**`ungroup(pageId)`** — accepts either side. Looks up the partner via `leftRight.get(pageId) || rightLeft.get(pageId)`, deletes both directions, fires `saveStateDebounced`.

**`groupTabs(id1, id2, enforceAdjacency = false)`** — public entry point used by all UI/script callers. Accepts page OR editor ids, resolves to page ids via `findPage(...)?.id ?? id`. Normalizes order by tab index (lower index becomes left). When `enforceAdjacency` is true AND both pages are unpinned, moves the second tab adjacent to the first via `moveTabByIndex(...)` before calling `group(...)`.

**`fixGrouping()`** — sanity sweep called from two places (`removePage` and `moveTabByIndex`). Three responsibilities today:
1. **Swap-direction fix.** Walks `pages[]` in order; if `pages[i+1].id === rightLeft.get(pages[i].id)`, the spatial order is reversed relative to the stored direction — ungroup and re-group with swapped sides.
2. **Dangling-group cleanup.** Drops entries from both maps when one or both pages no longer exist in `pages[]`.
3. **`fixCompareMode` call.** Walkthrough 06 / CK7 deletes this responsibility.

```ts
fixGrouping = () => {
    // …swap-detection pass
    // …existence cleanup pass
    this.fixCompareMode(); // ← retired per walkthrough 06 / CK7
};
```

### Query API — `PagesQueryModel`

`PagesQueryModel.ts:28-72`:

```ts
get groupedPage(): PageModel | undefined {
    const activePage = this.activePage;
    if (!activePage) return undefined;
    return this.getGroupedPage(activePage.id);
}

getGroupedPage = (withId: string): PageModel | undefined => {
    const pageId = this.findPage(withId)?.id ?? withId;
    const groupedWithId = state.leftRight.get(pageId) || state.rightLeft.get(pageId);
    return groupedWithId ? this.findPage(groupedWithId) : undefined;
};

getLeftGroupedPage = (withId: string): PageModel | undefined => {
    // returns left iff withId is the RIGHT side
    const pageId = this.findPage(withId)?.id ?? withId;
    const leftId = state.rightLeft.get(pageId);
    return leftId ? this.findPage(leftId) : undefined;
};

isGrouped = (id: string): boolean => {
    const pageId = this.findPage(id)?.id ?? id;
    return state.leftRight.has(pageId) || state.rightLeft.has(pageId);
};
```

All four accept either page id or editor id via `findPage` resolution.

### Callers and entry points

**`PageTab.handleClick` (`PageTab.tsx:517-527`)** — Ctrl+click on a non-active tab calls `pagesModel.groupTabs(activeId, pageId, true)`. The `enforceAdjacency=true` makes the click also reorder one tab to sit next to the other.

**`PageTab.closeClick` (`PageTab.tsx:506-515`)** — when the tab is grouped, the close button ungroups instead of closing:
```ts
if (this.isGrouped) {
    pagesModel.ungroup(page.id);
    pagesModel.fixCompareMode();   // ← retired per CK7 (folded into ungroup)
    pagesModel.showPage(page.id);
} else {
    page.close();
}
```

**`PagesLifecycleModel.openDiff` (`PagesLifecycleModel.ts:403-443`)** — script API entry. Opens two files, calls `groupTabs(first, second, true)`, then sets `compareMode = true` on both editors. Walkthrough 06 / CK8 collapses the second half to `enterCompareMode(firstId)`.

**`PagesLifecycleModel.requireGroupedText` (`PagesLifecycleModel.ts:686-707`)** — script API helper used by `page.grouped.content = "..."` (and similar). Ensures the partner is a text editor; if not, ungroups and creates a new empty page in its place:

```ts
requireGroupedText = (pageId: string, suggestedLanguage?: string): TextFileModel => {
    let groupedPage = this.model.query.getGroupedPage(pageId);
    if (groupedPage && groupedPage.mainEditor?.type !== "textFile") {
        this.model.layout.ungroup(pageId);
        groupedPage = undefined;
    }
    if (!groupedPage) {
        groupedPage = this.addEmptyPage();
        this.model.layout.groupTabs(pageId, groupedPage.id, false);
        groupedPage.mainEditor?.changeLanguage(suggestedLanguage);
    }
    return groupedPage.mainEditor as unknown as TextFileModel;
};
```

`mainEditor?.type !== "textFile"` reads the soon-removed string discriminator from `IEditorState` (walkthrough 02 / S10).

**`PagesModel.removePage` (`PagesModel.ts:110-126`)** — implicit cleanup. When a page closes, `removePage` filters it out of `pages` and `ordered`, then calls `fixGrouping()`. Any group that referenced the closed page is dropped automatically.

**`PagesLayoutModel.moveTabByIndex` (`PagesLayoutModel.ts:30`)** — calls `fixGrouping()` after a same-window tab reorder. Catches the spatial-vs-stored direction mismatch.

**Pin / unpin** — `pinTab` / `unpinTab` (`PagesLayoutModel.ts:35-83`) do NOT call `ungroup` or `fixGrouping`. A grouped pair where one side is pinned and the other isn't survives the pin operation. Whether this is intentional design or accident is unclear (see GK8).

**Script API** — `PageCollectionWrapper.ts:35-44, 180-181`:
- `pages.groupedPage` → `pagesModel.groupedPage` (active page's partner)
- `pages.getGroupedPage(pageId)` → `pagesModel.query.getGroupedPage(pageId)`
- `pages.ungroup(pageId)` → `pagesModel.ungroup(pageId)`
- `pages.groupTabs(id1, id2, enforceAdjacency)` (via `PagesModel` delegate)

### Rendering — `AppPageManager`

`Pages.tsx:133-162` (today) reads `leftRight` from state, builds a `compareModeIds: Set<string>` (walkthrough 06 / CK5 redirects this to `pagesModel.state.compareGroups`), and hands `leftRight` as the `grouping` prop to `AppPageManager`.

`AppPageManager.tsx:61-154` does the DOM work. Key invariants:

1. **Placeholders are never reparented.** Each page id gets a stable `<div>` placeholder; React content renders into it via `createPortal`. Moving placeholders between containers would reload iframes/webviews. So grouping is done purely via CSS absolute positioning — placeholders stay siblings in the container regardless of group membership.
2. **Per-pair `GroupContainer`.** For each `[leftId, rightId]` in `grouping`, `AppPageManager` lazy-creates a `GroupContainer` instance and caches it in `groupContainersRef`. The container owns the splitter element and applies position styles to the left/right placeholders.
3. **Group-container churn on right-side change.** When the right page of a stored group changes (rare — only via `fixGrouping` swap-detection), the old `GroupContainer` is disposed and a new one created.
4. **Active-group rule.** Only one group is visible at a time — the one containing `activeId`. All other group containers' placeholders get `display: none`.
5. **Compare-mode visual override.** When `compareModeIds.has(leftId)`, the left placeholder full-spans the container, the right placeholder hides, and the splitter hides. `gc.setCompareMode(true)` pauses the splitter's `ResizeObserver`.

### `GroupContainer` (DOM mechanics)

`components/page-manager/GroupContainer.ts:18-115`. Pure DOM class — no React, no state model. Constructor takes the main container element + the two placeholder divs that already live in the container, then:
- Applies `position: absolute; top: 0; bottom: 0; …` styles to both placeholders.
- Creates an `ImperativeSplitter` that lays out left/right via `left: 0/Npx/N+8px` + `width: Npx`.
- Inserts the splitter's `<div>` element into the main container.

`setCompareMode(enabled)` pauses the splitter, hides the right placeholder visual override, restores on exit.

`dispose()` removes the splitter element and resets the placeholders to standalone styles. The placeholders themselves are NOT removed (they stay in the container until the page closes).

### `ImperativeSplitter`

`components/page-manager/ImperativeSplitter.ts:11-130`. Owns the drag handle between two panes. Internal state: `widthK` (0..1 split ratio, defaults to 0.5). `widthK` is NOT persisted — every group resets to 50/50 on app restart. `ResizeObserver` re-applies the layout when the container width changes; paused during compare mode.

Drag, mouse-enter/leave color feedback, and double-click reset-to-50/50 all live here.

### Persistence

`PagesPersistenceModel.saveState` (`PagesPersistenceModel.ts:29`):
```ts
const groupings = Array.from(leftRight.entries());  // [string, string][]
const storedState: WindowState = { pages: pageDescriptors, groupings, activePageId };
```

`PagesPersistenceModel.restoreState` (line 128-135):
```ts
if (data.groupings && Array.isArray(data.groupings)) {
    data.groupings.forEach((el) => {
        if (Array.isArray(el) && el.length === 2) {
            this.model.layout.group(el[0], el[1]);
        }
    });
    this.model.layout.fixGrouping();
}
```

The on-disk shape — `WindowState.groupings?: [string, string][]` — is already present in the new persistence mockup (`mockups/PersistenceTypes.ts:136`). Walkthrough 04 didn't change it. So persistence is a non-issue here.

### Multi-window transfer (walkthrough 05) interaction

`PageDragData.page` carries a single `PageDescriptor`. A dragged group always becomes a single tab on the target. On the source side, `removePage` → `fixGrouping` cleans up the dangling group entry. On the target side, the page lands as an ungrouped tab.

Walkthrough 05 didn't address group transfer — implicit "groups don't transfer; they dissolve on the source side."

---

## What the new arch needs

Grouped pages are **page-level layout state**, not editor or host state. The maps key on page ids; the renderer operates on page ids; the splitter operates on DOM placeholders. The EPIC-028 editor/host refactor leaves the grouping mechanism nearly untouched.

The narrow set of real changes:

1. **`requireGroupedText` discriminator.** Today: `mainEditor?.type !== "textFile"`. After walkthrough 02 / S10 retires the `type` field on `IEditorState`, the check must read the host directly — `instanceof TextFileModel` on whatever the editor exposes as its content host. Per CK3 the analog helper is `pagesModel.query.getTextFileHost(pageId)` (or fold into a unified `pagesModel.query.canCompare`-style predicate set).

2. **`PageTab.closeClick` simplification.** After walkthrough 06 / CK7 folds compare-mode cleanup into `ungroup`, the close-while-grouped path drops the `fixCompareMode()` call:
   ```ts
   if (this.isGrouped) {
       pagesModel.ungroup(page.id);  // CK7: also exits compareGroups for the pair
       pagesModel.showPage(page.id);
   }
   ```

3. **`fixGrouping` body.** With CK7's `fixCompareMode` deletion, the body loses its trailing line. The two remaining responsibilities (swap-direction fix + dangling-group cleanup) stay.

4. **`PageCollectionWrapper.groupTabs` / `ungroup`.** Script API surface unchanged — they delegate to `PagesModel`. Confirm.

5. **`isGrouped(editorId)` resolution under unified `editors[]`.** Today: `findPage(id)` checks `p.id || p.mainEditor?.id || p.secondaryEditors.some(...)`. Walkthrough 01 / A8 + walkthrough 03 retire `secondaryEditors[]` in favor of `editors: EditorModel[]`. `findPage` updates to `s.pages.find(p => p.id === id || p.editors.some(e => e.id === id))` — already absorbed by walkthroughs 01/03/04. Confirm `isGrouped` still works.

Everything else — `group`, `ungroup`, `groupTabs`, `fixGrouping`'s remaining body, `AppPageManager`, `GroupContainer`, `ImperativeSplitter`, persistence shape, the script API — is untouched.

---

## How mockups handle this

No foundation mockup change required. The grouping data lives on `PagesModel.state`, which isn't a foundation mockup. `WindowState.groupings?: [string, string][]` is already in `mockups/PersistenceTypes.ts` from walkthrough 04. The real-code adjustments are narrow:

- `src/renderer/api/pages/PagesLifecycleModel.ts` — `requireGroupedText` discriminator (GK2).
- `src/renderer/api/pages/PagesQueryModel.ts` — add `getTextFileHost(pageId)` helper if GK2 picks the centralized form.
- `src/renderer/api/pages/PagesLayoutModel.ts` — `fixGrouping()` body loses the trailing `fixCompareMode()` call (already absorbed by walkthrough 06 / CK7).
- `src/renderer/ui/tabs/PageTab.tsx` — `closeClick` drops the `fixCompareMode()` call (GK4).

No changes to `AppPageManager.tsx`, `GroupContainer.ts`, `ImperativeSplitter.ts`, `PagesPersistenceModel.ts` (for grouping; walkthrough 04 already rewrote the editor-descriptor parts).

---

## Concerns

### GK1 — Storage shape: parallel maps vs. single map + derived reverse

Today: `leftRight: Map<string, string>` AND `rightLeft: Map<string, string>` on `PagesModel.state`. Both directions mutated atomically.

Options:
- **(a) Keep parallel maps.** Two writes per group/ungroup, O(1) both ways.
- **(b) Single `Map<leftId, rightId>`, derive `rightLeft` on read.** Halves storage; eliminates drift risk; reverse lookup becomes O(n) over entries (small n; in practice imperceptible).
- **(c) Single `groupings: Map<leftId, { rightId, … }>` for future per-pair metadata.** Same as (b) plus room for future fields (split ratio per GK6, future per-pair compare-mode if CK1 ever reverses).

**Recommendation: (a).** Drift is structurally impossible — every mutation site (`group`, `ungroup`) writes both. Maps are tiny (a handful of entries). The benefit of (b)/(c) is theoretical; the cost is rewriting working code. (c) is the future-proof shape but YAGNI today — same reasoning as walkthrough 06 / CK1 picked the simplest store.

### GK2 — `requireGroupedText` discriminator under host split

Today: `groupedPage.mainEditor?.type !== "textFile"` reads the soon-removed `IEditorState.type` discriminator.

Under the host split, the editor is no longer a TextFileModel — the editor *wraps* a TextFileModel via its `contentHost` (or equivalent). The check needs to flip to "is the editor's host a `TextFileModel`?"

Options:
- **(a) Inline `instanceof TextFileModel` on the editor's host.** Each call site reads `editor.host instanceof TextFileModel` (or whatever the trait helper is — `getContentHost(editor) instanceof TextFileModel`).
- **(b) Centralize as `pagesModel.query.getTextFileHost(pageId): TextFileModel | null`.** One helper, used by `requireGroupedText` and any future "is this a text-bearing page" predicate. Mirrors walkthrough 06 / CK3 (`canCompare`).
- **(c) Generalize as `pagesModel.query.getHost(pageId): IContentHost | undefined`.** Returns the host or undefined; callers test `instanceof`.

**Recommendation: (b).** The predicate "is this page a text-bearing page" recurs in at least three places under the new arch (`requireGroupedText`, `canCompare` already centralized per CK3, and future host-instanceof checks per C1). One named helper reads cleanly. (c) is over-general — there's no second host type today (C1 / C7 conclusions).

### GK3 — `fixGrouping` decomposition after CK7

Walkthrough 06 / CK7 deletes the trailing `fixCompareMode()` call. Remaining body: swap-direction fix + dangling-group cleanup. Both run from `removePage` (after a close) and `moveTabByIndex` (after a reorder).

Options:
- **(a) Keep as single sweep.** Two responsibilities, one method, two callers.
- **(b) Split into `_fixGroupDirection` + `_removeDanglingGroups` for clarity.**
- **(c) Push direction-fix into `moveTabByIndex` only, dangling-cleanup into `removePage` only.** Each caller does only what it needs.

**Recommendation: (a).** The two passes are cheap (one walk over `pages[]`) and share input. (c) wins on minimal-work but loses on robustness — if a future caller forgets one pass, drift appears silently. Keep the single sweep; it's the today's pattern that works.

### GK4 — `PageTab.closeClick` simplification

Today's close-while-grouped path: `ungroup → fixCompareMode → showPage`. Walkthrough 06 / CK7 absorbs `fixCompareMode` into `ungroup`, so the middle call becomes redundant.

Options:
- **(a) Drop the `fixCompareMode()` call.** Resulting flow: `ungroup → showPage`. Behavior identical because CK7's `ungroup` now does the compare cleanup itself.
- **(b) Keep the explicit `fixCompareMode()` call as belt-and-suspenders.** Doesn't hurt; documents the intent.

**Recommendation: (a).** Walkthrough 06 / CK6 deleted `compareModeChanged` and the `rerender` method for the same reason — "doesn't hurt" is exactly the cargo-cult pattern that makes refactors hard. Drop the call; the `ungroup` rename in the new arch carries the cleanup obligation.

### GK5 — Multi-window transfer of a grouped page

Today: a single tab transfer dissolves the group. The partner stays in the source window; `fixGrouping` on the source removes the orphan entry; the target window has no group entry for the transferred page.

Options:
- **(a) Keep this behavior.** Group dissolves on transfer; explicit single-tab semantics.
- **(b) Transfer the pair atomically.** Both pages move to the target window together; `PageDragData` carries two `PageDescriptor`s; the target restores both and re-establishes the group.

**Recommendation: (a).** Cross-window drag is a single-tab gesture — the user grabs ONE tab and drops it. There's no UX affordance for "drag both pages of a group" (and dragging two tabs simultaneously is impossible by design — see CK9). Group dissolution on transfer matches what the user expressed. (b) requires a significant `PageDragData` shape change and synchronized cleanup logic for no observable user benefit.

### GK6 — `ImperativeSplitter.widthK` persistence

Today: `widthK` is component-local, resets to 0.5 on app restart. Per-group split ratio is NOT persisted.

Options:
- **(a) Keep as-is.** Every group resets to 50/50 on restart.
- **(b) Persist per-group `widthK` in `WindowState.groupings`.** Changes `groupings` from `[string, string][]` to `[string, string, number?][]` or `{ left, right, widthK? }[]`. Triggers `schemaVersion` bump (P10 — non-additive change to array element shape).
- **(c) Persist in a separate `splitterStates` field on `WindowState`.** Additive optional field; no schema bump per P10.

**Recommendation: (a).** Splitter ratio persistence is a UX nicety orthogonal to the EPIC-028 editor refactor. Adding it now expands scope; it's safely deferable as an additive `WindowState.splitRatios?: Record<leftId, number>` later (per P10's "additive optional fields don't bump"). Explicit scope cut for this walkthrough.

### GK7 — Two-pages-per-group invariant

Today: hard-coded two. `leftRight` is one-to-one; `GroupContainer` is binary; `ImperativeSplitter` is binary; `AppPageManager`'s active-group rule names exactly one of each.

Options:
- **(a) Two-pages-per-group is permanent design.** No N-page generalization.
- **(b) Leave room for N-page groups under EPIC-028.** Would require new DOM splitter, new persistence shape, new UI affordances.

**Recommendation: (a).** Two-pages is deliberate — the diff editor needs exactly two; a three-pane UI requires new splitter mechanics, new tab grouping affordances, and arbitrary spatial ordering rules. No user-facing request exists for N > 2. YAGNI applies (matches CK1's reasoning for `compareGroups` being a flat `Set<leftId>` instead of a richer record).

### GK8 — Pin / group interaction

Today: `pinTab` / `unpinTab` do NOT touch `leftRight` / `rightLeft`. A pinned tab can be the left side of a group whose right is unpinned (or vice versa). The pinned tab lives in the sticky pinned section; its partner sits in the regular unpinned section. The group spans both sections.

Visual result: when the user activates either side of such a split-pinning pair, `AppPageManager.findGroupId` resolves both to the same group, the left placeholder appears in the pinned slot, the right in the unpinned slot. Splitter still spans the container width. Works "accidentally."

Options:
- **(a) Preserve as-is.** No change.
- **(b) Pin operation should ungroup.** Simpler invariant ("pinned tabs are never grouped") but loses a working corner case.
- **(c) Pinning one side should pin both.** Forces the pair to move together to pinned section.

**Recommendation: (a).** Today's behavior is an emergent property of the parallel-maps storage independent of the pin section. Changing it would require additional logic with no clear user benefit. The behavior is benign — if a user pins one side of a group, they accept the split visual. Leave alone.

### GK9 — Script API surface

Today the script API exposes:
- `pages.groupedPage` — active page's partner
- `pages.getGroupedPage(pageId)` — partner of any page
- `pages.ungroup(pageId)` — break a group
- `pages.groupTabs(id1, id2, enforceAdjacency?)` — create a group

Options:
- **(a) Keep all four under EPIC-028.** Implementation underneath unchanged.
- **(b) Tighten to two:** `groupedPage` and `groupTabs(id1, id2)` only. `getGroupedPage(other)` is a single Map lookup; users can call it from `PageWrapper.getGroupedPage` directly via the host model. `ungroup` falls out of `groupTabs(a, undefined)` or similar.

**Recommendation: (a).** Existing script API; breaking it would invalidate every script using `pages.ungroup(pageId)`. No EPIC-028 motivation to break the surface. Confirm unchanged.

### GK10 — `isGrouped(editorId)` resolution under unified `editors[]`

Today: `findPage(id)` checks `p.id`, `p.mainEditor?.id`, `p.secondaryEditors.some(se => se.id === id)`. Walkthrough 01 / A8 + walkthrough 03 retire `secondaryEditors[]` in favor of `editors: EditorModel[]`. `findPage` updates to `s.pages.find(p => p.id === id || p.editors.some(e => e.id === id))`. This change is already absorbed by 01/03.

Question: does `isGrouped(someEditorId)` still mean "the page that owns this editor is grouped"?

Options:
- **(a) Yes — `findPage` resolves to the unique page owning the editor; `isGrouped` then checks page membership.** Semantics identical to today (where "the unique page owning the editor" was the page whose `mainEditor.id` matched).
- **(b) `isGrouped(editorId)` becomes ambiguous because multiple editors per page mean a single page-grouped state for multiple editor ids.** The lookup returns the same answer for all editors of the same page — but is that what the caller wants? In practice, all today's callers pass a page id.

**Recommendation: (a).** The page-id-or-editor-id resolution in `findPage` was designed to be transparent — callers don't care which kind of id they have. `isGrouped` returning "is the OWNING page grouped" is the only sensible semantics. No change required; the unified `editors[]` shift is absorbed inside `findPage`. Confirm.

---

## Proposed mockup adjustments

None. No foundation mockup change required.

### Real-code-only changes (no mockup)

- `src/renderer/api/pages/PagesQueryModel.ts` — add `getTextFileHost(pageId): TextFileModel | null` helper (GK2, signature refined by walkthrough 08 / T2). One-line lookup wrapping `findPage` + host instanceof check.
- `src/renderer/api/pages/PagesLifecycleModel.ts` — `requireGroupedText` rewrites against the typed accessor: `const textHost = pagesModel.query.getTextFileHost(groupedPage.id); if (!textHost) { ungroup; addEmptyPage; … }` (GK2 — accessor form drops the trailing `as unknown as TextFileModel` cast).
- `src/renderer/api/pages/PagesLayoutModel.ts` — delete the trailing `this.fixCompareMode()` call from `fixGrouping`'s body (already absorbed by walkthrough 06 / CK7). `fixCompareMode` itself is deleted by CK7.
- `src/renderer/ui/tabs/PageTab.tsx` — `closeClick`'s grouped branch drops the `pagesModel.fixCompareMode()` call (GK4).
- `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` — no change (GK9 confirms).
- `src/renderer/components/page-manager/AppPageManager.tsx`, `GroupContainer.ts`, `ImperativeSplitter.ts` — no change.
- `src/renderer/api/pages/PagesPersistenceModel.ts` — no grouping change (walkthrough 04 already rewrote the editor-descriptor parts; `groupings` field shape is identical).

---

## Open questions

None remaining after GK1–GK10 resolve.

---

## Files NOT changing

These were touched by other walkthroughs or stay verbatim:

- `mockups/PersistenceTypes.ts` — `WindowState.groupings?: [string, string][]` already in the new shape (walkthrough 04 / P1).
- `src/renderer/components/page-manager/AppPageManager.tsx` — `grouping` prop shape unchanged; `compareModeIds` source changes per walkthrough 06 / CK5 (not 07's responsibility).
- `src/renderer/components/page-manager/GroupContainer.ts` — pure DOM layout class. No editor/host references.
- `src/renderer/components/page-manager/ImperativeSplitter.ts` — pure DOM splitter. No editor/host references.
- `src/renderer/api/pages/PagesLayoutModel.ts` `group`, `ungroup`, `groupTabs`, swap-direction-fix + existence-cleanup passes of `fixGrouping` — unchanged.
- `src/renderer/api/pages/PagesQueryModel.ts` `findPage`, `getGroupedPage`, `getLeftGroupedPage`, `isGrouped`, `groupedPage` — semantics survive (GK10 confirms).
- `src/renderer/api/pages/PagesLifecycleModel.ts` `movePageIn` / `movePageOut` group-transfer behavior — unchanged (GK5 confirms).
- `src/renderer/api/pages/PagesPersistenceModel.ts` grouping restore loop — unchanged (the descriptor shape change from walkthrough 04 doesn't touch `groupings`).

---

## Status checklist

- [x] GK1 — Storage shape — **(a)** keep parallel `leftRight` / `rightLeft` maps on `PagesModel.state`. Drift is structurally impossible (every mutation site writes both directions); maps are tiny; O(1) both ways. Future per-pair metadata (split ratio, etc.) folds in additively without restructuring
- [x] GK2 — `requireGroupedText` discriminator under host split — **(b)** centralize as `pagesModel.query.getTextFileHost(pageId): TextFileModel | null` *(signature refined 2026-05-20 by walkthrough 08 / T2 from the original `getTextFileHost(pageId): boolean` to return the typed host — same lookup, more useful return shape; the boolean predicate is subsumed by the truthy check)*. One helper consumed by `requireGroupedText` (drops its trailing `as unknown as TextFileModel` cast) and by the 14 PageTab callsites that read TextFileModel-only fields/methods (T2). Mirrors walkthrough 06 / CK3's `canCompare` pattern in spirit. Today's scattered `mainEditor?.type !== "textFile"` checks collapse to a single named call
- [x] GK3 — `fixGrouping` decomposition after CK7 — **(a)** keep as single sweep. Two remaining responsibilities (swap-direction fix + dangling-group cleanup) are cheap (one walk over `pages[]`), share input, and run from two callers (`removePage`, `moveTabByIndex`). Splitting into named helpers adds names without value; pushing each pass into its single caller (c) loses robustness if a future caller forgets one pass
- [x] GK4 — `PageTab.closeClick` simplification — **(a)** drop the `fixCompareMode()` call. Resulting grouped-branch flow: `ungroup → showPage`. CK7's `ungroup` carries the compare-cleanup obligation now, so the explicit call is redundant. Belt-and-suspenders (b) is the cargo-cult pattern walkthrough 06 / CK6 rejected for `compareModeChanged` and `rerender()` — same reasoning applies
- [x] GK5 — Multi-window transfer of a grouped page — **(a)** keep today's behavior. Single tab transfers; partner stays in source window; `fixGrouping` on the source removes the dangling entry; target receives an ungrouped tab. Cross-window drag is a single-tab gesture by design (dual-tab simultaneous drag is impossible — same reasoning as walkthrough 06 / CK9). Atomic pair transfer (b) would require `PageDragData` shape changes for no observable user benefit
- [x] GK6 — `ImperativeSplitter.widthK` persistence — **(a)** keep as-is. Per-group split ratio resets to 50/50 on every app restart. UX nicety orthogonal to EPIC-028's editor refactor; explicit scope cut here. Safely deferable as additive `WindowState.splitRatios?: Record<leftId, number>` later (per P10's "additive optional fields don't bump schemaVersion"). No mockup change; no schema bump
- [x] GK7 — Two-pages-per-group invariant — **(a)** permanent design. No N-page generalization under EPIC-028. `leftRight` is one-to-one; `GroupContainer` is binary; `ImperativeSplitter` is binary; the diff editor needs exactly two. A three-pane UI would require new splitter mechanics, new tab grouping affordances, and arbitrary spatial ordering rules — none of which serve any existing user request. YAGNI applies (matches CK1's `compareGroups: Set<leftId>` choice)
- [x] GK8 — Pin / group interaction — **(a)** preserve as-is. `pinTab` / `unpinTab` don't touch `leftRight` / `rightLeft`; a pinned-with-unpinned-partner group spans both tab sections. Emergent benign behavior — `AppPageManager.findGroupId` still resolves correctly; the splitter still spans the container; no rendering glitches. Forcing ungroup on pin (b) or pin-the-partner-too (c) adds logic for no observable user benefit
- [x] GK9 — Script API surface — **(a)** keep all four (`pages.groupedPage`, `pages.getGroupedPage`, `pages.ungroup`, `pages.groupTabs`). Implementation underneath unchanged — they're thin `PageCollectionWrapper` delegates over `PagesModel`. Tightening (b) would break every existing script using `pages.ungroup(pageId)`; no EPIC-028 motivation to break the surface
- [x] GK10 — `isGrouped(editorId)` under unified `editors[]` — **(a)** works correctly via `findPage` resolution. Walkthrough 01 / A8 + walkthrough 03 already migrated `findPage` from checking `p.id || p.mainEditor?.id || p.secondaryEditors.some(...)` to `p.id || p.editors.some(e => e.id === id)`. `isGrouped` reads the resolved page id; semantics identical to today. No new change in 07
- [x] Second-pass review (2026-05-19) — see below

---

## Second-pass review (Tier 1 end — 2026-05-19)

Walkthrough 07 is the last in Tier 1; no later Tier 1 walkthrough exists to invalidate its decisions. The second-pass purpose is to verify it consumed its upstream dependencies cleanly and to note anything that ages into Tier 2+.

### Upstream consumption verified

- **From 01 / A8 + 03**: Unified `editors[]` and the rewired `findPage` resolution. GK10 confirmed.
- **From 02 / S10**: `IEditorState.type` removed. GK2 migrates `requireGroupedText`'s `mainEditor?.type !== "textFile"` discriminator to `pagesModel.query.getTextFileHost(pageId)` (mirrors 06 / CK3's `canCompare`). The migration scope from S10 includes this site.
- **From 04 / P1**: `WindowState.groupings?: [string, string][]` is already in the new persistence shape — no change required for grouping persistence. P10's "additive optional fields don't bump schemaVersion" contract leaves headroom for GK6's deferred `splitRatios?` field if it ever lands.
- **From 06 / CK7**: `fixCompareMode` deletion + cleanup folded into `ungroup` / `removePage` / `setMainEditor`. GK3 (keep `fixGrouping` as single sweep) and GK4 (drop redundant `fixCompareMode` call in `closeClick`) both depend on CK7 having landed correctly. Both confirmed.

### No mockup changes; minimal real-code surface

This walkthrough's footprint is the smallest in Tier 1 — three narrow real-code changes:
1. Add `pagesModel.query.getTextFileHost(pageId)` helper (GK2).
2. Rewrite `requireGroupedText` discriminator using GK2's helper.
3. Delete `pagesModel.fixCompareMode()` call from `PageTab.closeClick` (GK4) — CK7 carries the cleanup obligation now.

No foundation mockup touches. `mockups/PersistenceTypes.ts:WindowState.groupings` already has the right shape; `AppPageManager.tsx` / `GroupContainer.ts` / `ImperativeSplitter.ts` are page-level layout DOM code that operates on page ids — entirely orthogonal to the editor/host refactor.

### Forward-looking notes (not new concerns)

- **GK6 (split ratio persistence)** is a UX nicety deferred as additive `WindowState.splitRatios?` for a future iteration. No EPIC-028 work owes anything to it.
- **GK7 (two-pages-per-group invariant)** is permanent design. Confirms `compareGroups: Set<leftId>` (CK1) shape decision.
- **GK8 (pin/group interaction)** preserved emergent behavior — no rework planned in Tier 2.
- **GK9 (script API surface)** unchanged. Walkthrough 12 (scripting facades) inherits the four script-side methods as-is.

### Tier 1 design stability check

Walkthrough 07 produced **zero mockup adjustments**. Per the README workflow: "Stable when the last 2–3 walkthroughs produce zero mockup changes — design ready for implementation planning."

Walkthroughs that produced **zero foundation mockup changes** in Tier 1:
- **07 — Grouped pages**: zero foundation mockup changes; three narrow real-code rewrites.
- **06 — Compare mode**: one TextFileModel doc-comment touch (C1 — point to `PagesModel.state.compareGroups`). No structural change; the field move is real-code only.

That's the **last two walkthroughs** producing essentially zero mockup changes. The stability signal is positive — Tier 1 is design-ready. Tier 2 (page tabs, page toolbar, TextChrome) can begin without further reshaping of the foundation primitives.

No new concerns.
