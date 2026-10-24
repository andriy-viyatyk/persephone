# US-1717: Pin side model - zones, persistence, and right-pin restrictions

**Epic:** [EPIC-132: Right-pinned pages in a popover](../../epics/EPIC-132.md)
**Scope:** Model/API and persistence only. This task does not implement the tab strip UI (US-1718), popover rendering (US-1719), focused-page retargeting (US-1720), or scripting/MCP surface (US-1721).

## Goal

Add left/right pin-side state to pages, persist it compatibly, preserve the three page-order zones and active-page rules, and enforce right-pinned page restrictions in the model. Expose one reactive, transient popover-open page id on `PagesModel` so US-1719 and US-1720 can bind to it; do not persist that id.

## Background

EPIC-132 decisions R2, R4, R5, and R9 are authoritative. `PageModel` currently stores a `pinned: boolean`; `PageDescriptor` also stores `pinned: boolean`. `PagesModel` has a `TGlobalState` with `pages`, `ordered`, grouping maps and compare state, making it the natural owner for window-level popover state. R1 says pages remain in their existing slots; this task only provides model state and does not render the popover.

The verified `pinned` read inventory and proposed semantics are listed below; the implementation plan records the required conversion to pin-side-aware behavior.

| File and location | Current use | Required classification |
|---|---|---|
| `src/renderer/api/pages/PageModel.ts:45-47,65,317-323,850-855` | Stores boolean, exposes getter, serializes it | Preserve `pinned` as derived `pinSide === "left"`; add `pinSide` |
| `src/renderer/api/pages/PagesLayoutModel.ts:13-18,30-75,141-142` | Boolean partitioning and restrictions | Change to side-zone logic; grouping checks are right-aware |
| `src/renderer/api/pages/PagesLifecycleModel.ts:964-997,1088-1095` | Boolean close-many filtering and default duplicate descriptor | Change close-many filtering to skip either pinned side; refuse duplicating a right pin; initialize duplicate as unpinned |
| `src/renderer/api/pages/PagesModel.ts:179-187` | Protects pinned page from empty-page cleanup | Keep as any-side (either pinned side is protected) |
| `src/renderer/api/pages/PagesPersistenceModel.ts:149-159,180-189,381-405` | Saves active id, restores boolean and active ordering | Migrate legacy true to left; use `pinSide` when present; fall back from a right active id |
| `src/shared/persistence.ts:40-45` | Persisted boolean in `PageDescriptor` | Retain as compatibility left-pin projection; add optional `pinSide` |
| `src/main/open-windows.ts:57-63` | Keeps window if a page is modified or pinned | Change to any-side (`pinSide` when present, legacy `pinned` fallback) |
| `src/main/mcp/ai-vision/main-root.ts:99-106` | Reports boolean in each page summary | Keep `pinned` boolean as left for compatibility |
| `src/renderer/api/types/page.d.ts:71` | Public page type boolean | Keep meaning “left” |
| `src/renderer/api/types/page-tab.d.ts:8` | Page-tab type boolean | Keep meaning “left” |
| `src/renderer/api/types/link-editor.d.ts:42` | Pinned link-editor item, unrelated to page tabs | Keep unchanged; this is a separate link pin concept |
| `src/renderer/api/pages/IPageHost.ts:53-54` | Optional host boolean; embedded editor hosts are not pinnable tabs | Keep optional compatibility field meaning “left” |

## Implementation Plan

1. **Add pin-side state while retaining the boolean contract** in `src/renderer/api/pages/PageModel.ts` (`IPageState` at line 45, pinned accessors at 317, automatic close at 708-721, interactive close at 820, descriptor at 850).
   - Add `PagePinSide = "left" | "right" | undefined` (or an equivalent exported type) and `pinSide` to `IPageState`, defaulting to `undefined`.
   - Add reactive `pinSide` getter/setter. Retain `pinned` getter/setter as a compatibility projection: getter is true only for left; setting true selects left and setting false clears only a left pin (it must leave a right pin unchanged).
   - Include `pinSide` in `getDescriptor()`, retaining `pinned: this.pinned`.
   - Enforce right-pinned close refusal in `PageModel.close()` by returning `false` before the existing restore/cancel and modified-editor checks. There is no close override: callers must unpin first, then close. Window close and app shutdown continue through disposal rather than interactive `close()` (R5).

   Before:
   ```ts
   pinned: boolean;
   // ...
   get pinned(): boolean { return this.state.get().pinned; }
   set pinned(value: boolean) { this.state.update((s) => { s.pinned = value; }); }
   ```
   After:
   ```ts
   pinSide: PagePinSide;
   get pinSide(): PagePinSide { return this.state.get().pinSide; }
   set pinSide(value: PagePinSide) { this.state.update((s) => { s.pinSide = value; }); }
   get pinned(): boolean { return this.pinSide === "left"; }
   ```

   Close guard placement:
   ```ts
   async close(): Promise<boolean> {
       if (this.pinSide === "right") return false;
       if (this.isRestoring) { /* existing interactive cancellation */ }
       // existing modified-editor confirmation and close
   }
   ```

2. **Implement three page zones and side-aware pin operations** in `src/renderer/api/pages/PagesLayoutModel.ts` (`moveTabByIndex` line 13, `pinTab` line 30, `unpinTab` line 53, grouping line 78/127, repair line 169), `PagesQueryModel.ts`, and delegates in `PagesModel.ts` (layout delegates at 314-330).
   - `pages[]` order must be left-pinned, normal, right-pinned. `moveTabByIndex` may reorder within a zone, but cannot cross a zone boundary. Add `PagesQueryModel.getFirstRightPinnedIndex()` as the one insertion boundary helper, returning `pages.findIndex(isRightPinned)` or `pages.length` when no right pin exists. Use it from `PagesLifecycleModel.addPage` (`PagesLifecycleModel.ts:440-443`), `movePageIn` (`:1015-1027`), and `duplicatePage` (`:1100-1105`); restore also normalizes descriptors into the three zones while preserving order within each zone.
   - Add `PagesQueryModel.isRightPinned(id)` as the single side predicate used by model operations and downstream UI; implement it through `findPage(id)?.pinSide === "right"`. Do not spread ad-hoc side comparisons across callers.
   - Change the model method to `pinTab(pageId, side = "left")`; the default preserves existing UI/API callers. Return early only when the page already has the requested side. A direct left-to-right or right-to-left switch removes the old zone membership and inserts at the requested zone edge. Pinning a grouped page to the right first calls `ungroup` so no right pin remains grouped.
   - Pinning a right page to the left, or unpinning a right page, closes its popover if open, inserts it at the end of `ordered` so it becomes active, and sends `onShow` and `onFocus` for it. Re-pinning an already-left page does not reorder it. Pinning an active left/normal page to the right removes it from `ordered`; if it was active, run the shared active-page-removal helper described in step 3.
   - Grouping (`group`, `groupTabs`, `fixGrouping`) must refuse right-pinned members. Make the public layout methods throw a descriptive `Error` for an explicit attempt to group a right-pinned page; `fixGrouping` silently removes any stale group relation involving one. Keep left-pinned behavior as currently supported.
   - Ensure left/right membership checks use `pinSide`, not the legacy boolean.

   Before:
   ```ts
   pinTab = (pageId: string) => { /* boolean pin and left-zone insertion */ };
   ```
   After:
   ```ts
   pinTab = (pageId: string, side: "left" | "right" = "left") => {
       if (page.pinSide === side) return;
       // remove from old zone, update pinSide, insert at requested zone edge
       // update ordered and active-page notifications when crossing right boundary
   };
   ```

   Normal insertion boundary and call sites:
   ```ts
   // PagesQueryModel: one index calculation for all normal-page insertions
   getFirstRightPinnedIndex = (): number => {
       const pages = this.model.state.get().pages;
       const index = pages.findIndex((page) => this.isRightPinned(page.id));
       return index < 0 ? pages.length : index;
   };

   // PagesLifecycleModel.addPage, before: s.pages.push(page)
   // after:
   const insertionIndex = this.model.query.getFirstRightPinnedIndex();
   this.model.state.update((s) => {
       s.pages.splice(insertionIndex, 0, page);
       s.ordered.push(page);
   });
   ```

   Apply the same helper at both other current append sites:
   ```ts
   // movePageIn before: s.pages.splice(targetIndex, 0, page)
   // after: clamp the target to the normal-zone boundary
   const insertionIndex = Math.min(
       targetIndex,
       this.model.query.getFirstRightPinnedIndex(),
   );
   s.pages.splice(insertionIndex, 0, page);

   // duplicatePage before: s.pages.push(newPage)
   // after:
   s.pages.splice(this.model.query.getFirstRightPinnedIndex(), 0, newPage);
   s.ordered.push(newPage);
   ```

3. **Add transient reactive popover state to `PagesModel`** in `src/renderer/api/pages/PagesModel.ts` (`defaultOpenFilesState` line 23, class and delegates from line 36).
   - Add `popoverPageId: string | undefined` to `OpenFilesState`, initialized undefined. Store it in the existing `TGlobalState`; this makes the value reactive and automatically excluded from persistence because `PagesPersistenceModel.saveState()` at line 149 explicitly builds `WindowState` from page descriptors, groupings, and the active id.
   - Add `openPopover(pageId)`, `closePopover()`, and `togglePopover(pageId)` methods plus a state-backed `popoverPageId` getter to `PagesModel`. Opening must validate that the target is an attached right-pinned page; invalid targets throw a descriptive `Error`. Closing clears the id. Removing, unpinning, or closing the target clears it. `PagesModel.removePage` is the shared removal point; `PagesLayoutModel.unpinTab` clears it before changing the side.
   - Add one `handleActivePageRemoved(wasActive)` helper on `PagesModel` and call it from both `removePage` (currently lines 128-165) and the right-pin path in `pinTab`. When `wasActive` is true, send `onShow` and `onFocus` for the new last page in `ordered`; if `ordered` is empty, call `lifecycle.addEmptyPage()` and send both events for the new active page. This replaces/factors the notification block already in `removePage`.
   - Change `checkEmptyPage` at lines 166-172 to add an empty page when `ordered.length === 0`, rather than only when `pages.length === 0`; right-only windows must not remain without an active page.
   - `movePageOut` at `PagesLifecycleModel.ts:1033-1063` clears `popoverPageId` when it matches the requested page before applying the right-pin refusal. A right-pinned page remains in its source window; clear the state defensively even on that refusal path.
   - Keep this state per renderer window, consistent with R9. US-1719/US-1720 bind reactively to `pagesModel.state` (or the getter through a state selector); no DOM or persistence behavior is added here. Popover open/close does not change the active page and does not emit active-page `onShow` events.
   - `showPage` for a normal or left-pinned page leaves an already-open popover unchanged. US-1719 closes it on click-away, and US-1720 closes it on Ctrl+Tab; neither behavior is implemented in this task.

   Before:
   ```ts
   const defaultOpenFilesState = {
       pages: [] as PageModel[], ordered: [] as PageModel[],
       leftRight: new Map<string, string>(), rightLeft: new Map<string, string>(),
       compareGroups: new Set<string>(),
   };
   ```
   After:
   ```ts
   const defaultOpenFilesState = { ..., popoverPageId: undefined as string | undefined };
   ```

4. **Route navigation and ordered-page navigation** in `src/renderer/api/pages/PagesNavigationModel.ts` (`showPage` line 10, `showNext` line 24, `showPrevious` line 35), `PagesQueryModel.ts` (`activePage` line 78), and `PagesPersistenceModel.ts` (`applyState` line 381).
   - Resolve `showPage(id)` from all pages (via `query.findPage`), not just `ordered`, because right pins are deliberately absent from `ordered`. A right-pinned page calls `openPopover(id)` and does not change `ordered`, active page, or persisted `activePageId` (R4). Showing a normal or left-pinned page does not close an already-open popover.
   - `showNext` / `showPrevious` operate only on `ordered`; when adding/restoring pages, exclude right-pinned pages from `ordered`. `ordered` retains the current active-page recency semantics for left-pinned and normal pages, while `pages[]` retains all three pin zones.
   - The Ctrl+Tab caller closes the popover in US-1720; keep that behavior out of this model task.
   - In `PagesPersistenceModel.applyState` (`PagesPersistenceModel.ts:381-415`), call `PagesLayoutModel.sortByPinSide(models)` to order `pages[]` zones while preserving order within each zone, and build `ordered` only from non-right pages. Put a valid requested `activePageId` from that eligible list last. If the id is missing or resolves to a right-pinned page, use the last unpinned page, then the last remaining non-right page (left pin); if no non-right page exists, add an ordinary empty page through `PagesLifecycleModel.addEmptyPage()` after assigning restored state. Restore groupings only when neither endpoint is right-pinned, so stale persisted pairs cannot reach the rejecting `group` method.

   Before:
   ```ts
   const { ordered } = this.model.state.get();
   const page = this.model.query.findPage(pageId);
   if (page && page !== ordered[ordered.length - 1]) {
       // move within ordered, persist, and emit onShow/onFocus
   }
   ```
   After:
   ```ts
   const { ordered } = this.model.state.get();
   const page = this.model.query.findPage(pageId);
   if (page?.pinSide === "right") return this.model.openPopover(page.id);
   // A normal show leaves popoverPageId unchanged.
   // otherwise run the existing ordered-page activation path
   ```

   Restore decision:
   ```ts
   const nonRight = models.filter((page) => !this.model.query.isRightPinned(page.id));
   const normal = nonRight.filter((page) => page.pinSide === undefined);
   const requested = nonRight.find((page) => page.id === data.activePageId);
   const active = requested ?? normal.at(-1) ?? nonRight.at(-1);
   const ordered = active
       ? [...nonRight.filter((page) => page !== active), active]
       : [];
   const pagesByZone = this.model.layout.sortByPinSide(models);
   this.model.state.update((s) => { s.pages = pagesByZone; s.ordered = ordered; });
   for (const [leftId, rightId] of data.groupings ?? []) {
       if (this.model.query.isRightPinned(leftId) || this.model.query.isRightPinned(rightId)) continue;
       this.model.layout.group(leftId, rightId);
   }
   this.model.layout.fixGrouping();
   if (!nonRight.length) this.model.lifecycle.addEmptyPage();
   ```

5. **Persist pin side and migrate old descriptors** in `src/shared/persistence.ts` (`PageDescriptor` line 40), `src/renderer/api/pages/PageModel.ts` (`getDescriptor` line 850), and `src/renderer/api/pages/PagesPersistenceModel.ts` (`restorePage` line 180).
   - Add optional `pinSide?: "left" | "right"` to `PageDescriptor`; leave `pinned` present for older readers and make its documented meaning “left”.
   - `restorePage` chooses `desc.pinSide` when valid; otherwise `desc.pinned ? "left" : undefined`.
   - New descriptors include both fields during transition. Popover-open state is never serialized.

   Before:
   ```ts
   export interface PageDescriptor {
       id: string;
       pinned: boolean;
   }
   ```
   After:
   ```ts
   export interface PageDescriptor {
       id: string;
       pinned: boolean; // left pin compatibility
       pinSide?: "left" | "right";
   }
   ```

   Restore mapping:
   ```ts
   // Before
   page.pinned = desc.pinned;

   // After
   page.pinSide = desc.pinSide === "left" || desc.pinSide === "right"
       ? desc.pinSide
       : desc.pinned ? "left" : undefined;
   ```

6. **Enforce right-pin restrictions in model lifecycle paths** in `src/renderer/api/pages/PagesLifecycleModel.ts` (`closePage` line 849, close-many lines 964/983, transfer lines 1006/1033, duplicate line 1071, grouped text line 1131), `PagesLayoutModel.ts`, and `PagesModel.ts` (`closeFirstPageIfEmpty` line 179 and `removePage` line 128).
   - Reject right-pinned pages from `group`/`groupTabs` and any grouping repair path; Ctrl+click UI guard remains US-1718, but model validation is authoritative.
   - Refuse `page.close()` for right-pinned pages; unpin-then-close is the explicit user route. App/window teardown uses model disposal.
   - `closeOtherPages` and `closeToTheRight` skip either pinned side, preserving the current left-pin exclusion. `duplicatePage` rejects a right-pinned source because duplicate creates a grouped page. `movePageOut` rejects a right-pinned page; `movePageIn` rejects an incoming right-pinned descriptor, since right-pinned pages belong to their source window. `requireGroupedText` must reject a right-pinned source before creating a group.
   - For methods already returning a boolean, refusal is `false`; for explicit model operations with `void`/`Promise<void>` contracts, throw a descriptive `Error`. Do not implement scripting/MCP exposure in this task.

   Before:
   ```ts
   if (!pages[i].pinned) {
       pagesToClose.push(pages[i]);
   }
   ```
   After:
   ```ts
   if (pages[i].pinSide === undefined) {
       pagesToClose.push(pages[i]);
   }
   ```

7. **Keep right-pinned windows alive** in `src/main/open-windows.ts` (`windowOnClose` line 57).
   - Classify a stored page as pinned when `pinSide === "left" || pinSide === "right"`, falling back to `pinned` for old descriptors.

   Before:
   ```ts
   if (!wState?.pages.some((p) => p.modified || p.pinned)) { /* close */ }
   ```
   After:
   ```ts
   if (!wState?.pages.some((p) => p.modified || p.pinSide || p.pinned)) { /* close */ }
   ```

8. **Adjust existing internal callers and close-time behavior** in `src/renderer/ui/tabs/PageTabView.ts` (`state.pinned` selector at line 194, context menu at 515, drag handlers at 575-583) only as needed to keep the build green after the side-aware model changes. Keep this context menu's pin action left-only; US-1718 owns right-pin menu items and presentation. In `PageTabsView.ts`, change the `state.pinned` selector at line 183 to `state.pinSide`, but keep its `page.pinned` checks at lines 205 and 209 left-only for the existing strip.

## Concerns

- `PageModel.close()` is the interactive close path; window/app shutdown disposes the model. The guard must return `false` before modified-editor prompts, while teardown continues to dispose the page (R5, R9).
- The right-pin guard is also reached by `PageModel._enforceEmptyPanelPageClose()` (`PageModel.ts:708-721`) and `PagesModel.closeFirstPageIfEmpty()` (`PagesModel.ts:179-187`). Both are harmless refusals: `close()` returns `false`, so an automatic cleanup attempt leaves the right-pinned page attached.
- The compatibility setter must make `page.pinned = false` clear only a left pin and leave a right pin unchanged. The verified assignment inventory is the restore path and the current layout methods; migrate restore and layout to `pinSide` directly.
- The page model is itself subscribed for persistence (`PagesModel.attachPage`); adding `pinSide` to `PageModel.state` persists it through page descriptors. `popoverPageId` belongs only in the outer `OpenFilesState` and must stay out of the saved `WindowState` shape.
- US-1721 should add `pinSide`, popover identification, and open/close methods to scripting and MCP, while `pinned` remains a left-only boolean in the page and page-tab declarations, `PageWrapper`, and the AiVision page-tab wrapper.
- Cross-window transfer is split between renderer lifecycle methods and `src/main/open-windows.ts`; both directions need explicit right-pin checks. `movePageIn` must not copy a right pin into a normal destination accidentally.
- Pin-side ordering and grouped-page invariants interact. Right-pinned pages cannot participate in grouping; pinning a grouped page must leave grouping maps consistent using the existing `ungroup`/`fixGrouping` behavior.
- `PagesModel.removePage` currently sends `onShow` and `onFocus` for the next active page when removing the active one. The focused-page and focus-retargeting behavior while a popover is open is US-1720; this task only clears `popoverPageId` when its own page is removed and preserves active-page semantics.
- Opening a popover for a right-pinned page whose slot has never been rendered depends on `AppPageManagerView.hasBeenActive`; US-1719 must make that slot render when `popoverPageId` selects it.

## Acceptance Criteria

- `PageModel` has `pinSide: "left" | "right" | undefined`; legacy `pinned` remains true only for left pins.
- `PageDescriptor` persists `pinSide`, and old `pinned: true` descriptors restore as left-pinned.
- `pages[]` maintains left-pinned, normal, right-pinned zones; pin/move/unpin operations cannot cross those zones.
- `pinTab` supports direct side changes; moving a page to right removes it from `ordered`, while moving a right page to left or unpinned closes its popover, activates it, and emits `onShow` / `onFocus`.
- Removing the active page from `ordered` shares one notification helper with right-pinning; it activates the new last ordered page or adds an empty page when none remains. `checkEmptyPage` detects an empty `ordered` list even when right pins remain in `pages[]`.
- Add, move-in, and duplicate insertions use the shared first-right-zone index so normal pages remain before right pins.
- A right-pinned page is never activated by `showPage`; it opens the transient popover id without changing active page or persisted active page.
- Showing a normal or left-pinned page programmatically leaves `popoverPageId` open.
- `popoverPageId` is reactive, window-local, cleared when its target is removed/unpinned/closed, and absent from serialized state.
- Restore puts only non-right pages into `ordered`, falls back when `activePageId` is missing or right-pinned, skips saved groupings that touch right pins, and creates an empty page if every restored page is right-pinned.
- Right-pinned pages are refused by grouping, close, duplicate, and cross-window transfer model paths; close-other/to-right operations skip them; teardown still disposes normally.
- A right-pinned descriptor keeps its window alive on close, including compatibility with old persisted descriptors.
- Existing `pinned` boolean API declarations keep their left-only compatibility meaning; scripting/MCP additions remain assigned to US-1721.
- `PageTabView` call sites compile with the side-aware model method while the existing UI continues to pin/unpin left only.

### Files requiring no changes

- `src/renderer/api/types/page.d.ts`, `src/renderer/api/types/page-tab.d.ts`, `src/renderer/api/types/pages.d.ts`, and `src/renderer/api/pages/IPageHost.ts`: retain their legacy left-only boolean and one-argument API contracts.
- `src/renderer/ui/PagesView.ts`: view composition belongs to US-1718/US-1719.
- `src/renderer/components/page-manager/AppPageManagerView.ts`: slot visibility and popover geometry belong to US-1719.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/api/pages/PageModel.ts` | Pin-side state, compatibility boolean, descriptor mapping, close guard |
| `src/renderer/api/pages/PagesLayoutModel.ts` | Zone ordering, side-aware pinning, grouping restrictions |
| `src/renderer/api/pages/PagesModel.ts` | Reactive transient popover state and methods; delegates |
| `src/renderer/api/pages/PagesQueryModel.ts` | Shared `isRightPinned(id)` predicate and first-right-zone insertion index |
| `src/renderer/api/pages/PagesNavigationModel.ts` | `showPage` opens right-pin popover; ordered navigation excludes right pins |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Close/duplicate/group/transfer restrictions |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Restore migration and invalid active-page fallback |
| `src/shared/persistence.ts` | Optional persisted `pinSide` |
| `src/main/open-windows.ts` | Retain windows containing either pinned side |
| `src/renderer/ui/tabs/PageTabView.ts` | Update state selector; retain left-only menu and drag behavior |
| `src/renderer/ui/tabs/PageTabsView.ts` | Update reactive state selector; retain left-only pinned layout checks |
