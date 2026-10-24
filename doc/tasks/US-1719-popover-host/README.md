# US-1719: Popover host — slot geometry, grip resize, size persistence, click-away, Escape

**Epic:** [EPIC-132: Right-pinned pages in a popover](../../epics/EPIC-132.md)
**Depends on:** [US-1717: Pin side model](../US-1717-pin-side-model/README.md)
**Scope:** Popover rendering and lifecycle behavior for an existing right-pinned page slot. R1, R6, R7, and R8 are authoritative. This task does not implement focused-page retargeting, board visibility, privacy checks, or other R3 behavior assigned to US-1720.

## Goal

Render an open right-pinned page inside its existing page-manager slot as a top-right resizable popover, persist per-page size fractions, and close it according to EPIC-132 click-away and Escape rules. Keep the active page model identity unchanged and coordinate descriptor storage with US-1717.

## Background

EPIC-132 decisions R1, R6, R7, and R8 define the behavior. US-1717 supplies `pinSide`, three page zones, transient `popoverPageId`, `openPopover` / `closePopover` / `togglePopover`, and `pagesModel.query.isRightPinned`. This task adds only the per-page size field to the descriptor and restore path.

`AppPageManagerView` owns a stable `PageSlot` for every page. `PageSlot.attach()` appends a placeholder once and `renderNative()` mounts one retained native view once; it never moves an attached slot. `GroupContainer` also deliberately keeps placeholders as direct siblings because moving a live iframe/webview reloads it. `AppPageManagerView.reconcile()` currently adds only `activeId` and `groupedActiveId` to `hasBeenActive`, renders those slots, then displays only the active page or active group. Therefore the popover page must be added to the mount set and its display override applied without changing its slot parent.

`PagesView` projects `pages`, `ordered`, grouping maps, and compare groups from `pagesModel.state`. It derives `activeId` from the end of `ordered`, then passes the page IDs and active group to `AppPageManagerView`. Extend this projection with `popoverPageId` and right-pin membership (through the US-1717 `query.isRightPinned` API). `.pages-container` is already `position: relative` in `src/renderer/ui/app/MainPage.css:27`; `MainPageView.ts:94` assigns that class to the host.

**Popover chrome belongs on the slot element itself.** The existing slot remains in its original stacking context and direct-child position; applying geometry, border, shadow, and the grip to it keeps the visible frame and content in one hit-test/focus subtree. A sibling overlay would require synchronizing its geometry and z-order with the live slot, complicate outside-click containment, and add another element whose lifetime can drift from the page. The slot is already the intended R1 popover surface.

Existing `color.ts` tokens include `background.default`, `border.default`, `shadow.default`, and `text.light`; the task should use those CSS variables or tokens for all popover colors. Do not copy the fallback hex/RGB colors in `Popover.css`. `PopoverView` provides useful patterns for pointer capture and drag cleanup. Its `PopoverModel.onHandlePointerDown()` currently grows from the bottom-right; US-1719 needs a separate bottom-left anchored geometry and per-page fraction persistence, so reuse the pointer session pattern rather than mounting `PopoverView` around/reparenting page content.

Outside-click classification can use a positive rule without modifying UIKit overlays. `src/renderer/index.ts:14-35` mounts `MainPageView`, `DialogsView`, `ProgressOverlayView`, `AlertsBarView`, and `PoppersView` as siblings in the renderer container. `getOverlayLayer()` appends its host to `document.body` (`src/renderer/uikit/shared/overlayLayer.ts:32`), and `openMenu()` attaches its wrapper to `document.body` (`src/renderer/uikit/Menu/attach-menu.ts:42`). Therefore only a pointerdown/focusin target inside `.app-root` can count as outside; a target outside `.app-root` is an overlay and is ignored. Within `.app-root`, ignore the open popover slot and the right-pin tab strip. This exempts menus, dialogs, tooltips, popovers, progress, and alerts by their existing mount placement without a portal marker.

`PagesNavigationModel.showPage()` currently emits `onFocus` when a normal page becomes active. `TextChromeView` listens for that event, focuses its root, and calls the text model's `focus()` after a 200 ms delay; `BoardWebview` focuses its frame after the same delay; `MarkdownBodyView` restores its scroll position when focused. On a popover transition, `PagesView` must first call `manager.update(...)` so the never-active slot's native view mounts, and only then send `pagesModel.onFocus` for the newly opened popover page. On close, after updating the manager to hide the popover, send `onFocus` for `query.activePage`. Do not change `ordered` or `activePage`. Board `page.visible` is derived from active/grouped-active state in `BoardWebview.getPageVisibility()` and remains US-1720 work.

The current persisted page shape is `PageDescriptor` in `src/shared/persistence.ts:40-56`. `PageModel.getDescriptor()` at `src/renderer/api/pages/PageModel.ts:850-865` builds it; `PagesPersistenceModel.restorePage()` normalizes descriptors with object spreads, constructs the page, and currently restores `pinned` at line 188. Add an optional fraction pair there; `normalizePageDescriptor()` preserves additive fields through `...desc`.

## Implementation Plan

1. **Pass popover data and resize callback through `PagesView`.** In `src/renderer/ui/app/PagesView.ts`, include `popoverPageId` in `PagesProjection`, select it from `OpenFilesState`, and pass `popoverId`, that page's `popoverSize` fractions (or `undefined`), right-pinned IDs, and `onPopoverResize(id, fractions)` through `AppPageManagerProps`. `AppPageManagerView` remains props-driven and must not import or call `pagesModel`. In `PagesView`, the resize callback writes fractions to the identified page's model state. Do not derive `activeId` from `popoverId`.

   Before:
   ```ts
   type PagesProjection = Pick<OpenFilesState,
       "pages" | "ordered" | "leftRight" | "rightLeft" | "compareGroups">;
   // managerProps returns activeId and groupedActiveId only
   ```

   After:
   ```ts
   type PagesProjection = Pick<OpenFilesState,
       "pages" | "ordered" | "leftRight" | "rightLeft" | "compareGroups" | "popoverPageId">;
   interface AppPageManagerProps {
       popoverId?: string;
       popoverSize?: { width: number; height: number };
       onPopoverResize: (id: string, fractions: { width: number; height: number }) => void;
       // existing page, grouping, and view props remain
   }
   ```

2. **Mount and display the existing slot as the popover.** In `src/renderer/components/page-manager/AppPageManagerView.ts`, add `popoverId`, `popoverSize`, `rightPinnedIds`, and `onPopoverResize(id, fractions)` to `AppPageManagerProps`; add the open ID to `hasBeenActive` before rendering; and render native content for that page even when it has never been active. `AppPageManagerView` receives no `pagesModel` dependency and does not own close/focus behavior. In the final slot-visibility pass, keep every non-open right-pinned slot at `display: none`, and let existing active/group visibility behavior continue for non-right-pinned slots. For the open slot, write all geometry inline because `applyStandaloneStyle()` and reconcile already write inline layout values; CSS is only for non-geometry chrome.

   Before:
   ```ts
   if (activeId) this.hasBeenActive.add(activeId);
   if (groupedActiveId) this.hasBeenActive.add(groupedActiveId);
   // ...render mounted slots...
   slot.element.style.display = id === activeId ? "flex" : "none";
   ```

   After:
   ```ts
   if (activeId) this.hasBeenActive.add(activeId);
   if (groupedActiveId) this.hasBeenActive.add(groupedActiveId);
   if (popoverId) this.hasBeenActive.add(popoverId);
   // ...render mounted slots...
   if (isPopoverSlot) {
       const maxWidth = containerWidth * 0.8;
       const maxHeight = containerHeight * 0.8;
       const width = clamp(containerWidth * (popoverSize?.width ?? 0.5), Math.min(360, maxWidth), maxWidth);
       const height = clamp(containerHeight * (popoverSize?.height ?? 0.5), Math.min(240, maxHeight), maxHeight);
       Object.assign(slot.element.style, {
           inset: "auto", top: "8px", right: "8px", bottom: "auto", left: "auto",
           width: `${width}px`, height: `${height}px`, display: "flex", zIndex: "10",
       });
   }
   ```

   When a slot ceases to be the popover, remove its popover marker/grip, clear inline `height` and `zIndex` (the current `applyStandaloneStyle()` does not reset those properties), call `applyStandaloneStyle(slot.element)`, and then set its normal visibility (right-pinned pages remain `display: none`). Do this only for a slot previously styled as the popover, so grouped layout is not reset on ordinary reconciles. In `src/renderer/components/page-manager/PageSlot.ts`, retain the stable element and native view ownership; do not detach or reparent a live slot.

3. **Add slot-owned chrome and directional grip geometry.** Add a co-located `src/renderer/components/page-manager/AppPageManagerView.css` stylesheet and import it from `AppPageManagerView.ts`. The stylesheet carries only non-geometry chrome: themed background, border, radius, shadow, and grip styling. Geometry is inline because `applyStandaloneStyle()` sets inline `position: absolute; inset: 0; display: flex` (`AppPageManagerView.ts:208-226`) and reconcile sets inline display. For the open slot, reconcile clears `inset`, sets `top`, `right`, `width`, `height`, `display: flex`, and `zIndex` inline using pixels computed from `popoverSize` and clamps. Use a 50% default, 80% maximum, and minimum about 360 by 240 CSS pixels, with each minimum clamped to its maximum on small containers. Use existing theme CSS variables for color; no literal colors.

   Put a resize button/handle at the slot's **bottom-left** corner. A drag rightwards reduces width; a drag leftwards grows it, while a drag downwards grows height. Capture the pointer for the drag, release listeners on pointer-up/lost capture/dispose, and clamp dimensions to min/max. Keep top and right anchored as dimensions change. Add a `ResizeObserver` on the manager root/container; recompute the slot's inline pixel geometry from fractions after each observation and disconnect the observer on dispose.

   Before:
   ```ts
   // applyStandaloneStyle sets inline inset: 0; reconcile sets display inline.
   Object.assign(slot.element.style, { inset: "0", display: isVisible ? "flex" : "none" });
   ```

   After:
   ```ts
   // Inline geometry wins over CSS: clear inset and assign clamped pixel geometry.
   Object.assign(slot.element.style, {
       inset: "auto", top: "8px", right: "8px", bottom: "auto", left: "auto",
       width: `${width}px`, height: `${height}px`, display: "flex", zIndex: "10",
   });
   // CSS owns only border, radius, shadow, background and grip styling.
   ```

   The grip is appended to `slot.element` next to the native view root, which is `display: contents`. Create it once when that slot becomes the popover and remove it when the slot stops being the popover. Keep drag handling with the manager that owns the slot element; the grip is inside the slot, so it is never an outside-click target.

4. **Persist size as fractions on each page.** In `src/renderer/api/pages/PageModel.ts`, add `popoverSize` to `IPageState`, initialize it to `undefined` (the view uses 0.5 by 0.5 until the first resize), expose a state-backed getter/setter, and serialize it from `getDescriptor()`. In `src/shared/persistence.ts`, add optional `popoverSize?: { width: number; height: number }` to `PageDescriptor`, documenting both values as fractions of the current pages container. In `src/renderer/api/pages/PagesPersistenceModel.ts`, validate restored fractions and assign valid values; malformed/out-of-range values restore as `undefined`. On drag end only, write `width / containerWidth` and `height / containerHeight`, clamped to the supported maximum. Do not write PageModel state on pointermove. `PagesModel.attachPage()` subscribes to `page.state` and calls `persistence.saveStateDebounced()` (`src/renderer/api/pages/PagesModel.ts:91-94`), so this state update triggers descriptor persistence. Keep the field optional in `PageDescriptor` so old descriptors use the default; keep `popoverPageId` transient and out of `WindowState`.

   Before:
   ```ts
   interface PageDescriptor { id: string; pinned: boolean; /* ... */ }
   // restorePage: page.pinned = desc.pinned;
   ```

   After:
   ```ts
   interface PagePopoverSize { width: number; height: number; }
   interface IPageState { popoverSize: PagePopoverSize | undefined; /* ... */ }
   interface PageDescriptor {
       id: string; pinned: boolean;
       popoverSize?: { width: number; height: number };
       // ...
   }
   // restorePage validates the fractions, then assigns page.popoverSize
   ```

5. **Implement click-away, Escape, and focus transitions in `PagesView`.** In `src/renderer/ui/app/PagesView.ts`, install document `pointerdown` / `focusin` and window `blur` listeners only while `popoverId` is set; remove them when it closes or the view is disposed. Close only if the event target is inside `.app-root` and outside the open popover slot and `[data-name="right-page-tabs"]`. Targets outside `.app-root` include all renderer overlays (dialogs, progress, alerts, PoppersView); body-portalled UIKit overlays also remain outside `.app-root`, so no portal markers or changes to UIKit overlay files are needed. Call `pagesModel.closePopover()` from `PagesView` only. `AppPageManagerView` receives only `popoverId`, `popoverSize`, `rightPinnedIds`, and `onPopoverResize(id, fractions)` props in addition to its existing view props.

   Before:
   ```ts
   if (!popoverSlot.contains(target)) pagesModel.closePopover();
   ```

   After:
   ```ts
   if (appRoot.contains(target)
       && !popoverSlot.contains(target)
       && !rightPageTabs.contains(target)) {
       pagesModel.closePopover();
   }
   ```

   Keep the right strip root selector aligned with US-1718's `data-name="right-page-tabs"`. A document `focusin` closes only for a target inside `.app-root` and outside those same protected subtrees. For top-window `blur`, schedule a one-shot `requestAnimationFrame` check of `document.activeElement`; close only if it is an iframe/webview inside `.app-root` and outside the popover and right strip. Also schedule that active-element recheck after each host `focusin`, with no polling interval.

   **Foreign-document transition investigation:** when focus is already inside the popover's board iframe, a click in an underlying iframe/webview may produce no host `pointerdown`, no host `focusin`, and no new top-window `blur`. During implementation, verify whether Chromium dispatches host-document `focus` / `focusin` on the `<iframe>` or `<webview>` element as focus moves between the two frames, and record the result. If host `focusin` does not expose that transition, use the blur/focusin-triggered `requestAnimationFrame` active-element recheck as the next fallback and record whether it detects the outside frame. A board-side `pointerdown` message over its existing frame message channel and webview-preload IPC are last-resort follow-ups if host signals fail; do not implement either bridge unless the host-level checks fail, and report which path was needed.

   Handle `keydown` on `document` in the default bubble phase. Close only for `event.key === "Escape" && !event.defaultPrevented`, calling `pagesModel.closePopover()` from `PagesView`.

   Before:
   ```ts
   // No click-away or focus-away handler exists for the page-manager slot.
   ```

   After:
   ```ts
   if (!appRoot.contains(target) || popoverSlot.contains(target) || rightPageTabs.contains(target)) return;
   pagesModel.closePopover();
   ```

6. **Order manager update before focus notification.** In the `PagesView` state binding, compute the next manager props and call `manager.update(nextProps)` first. After that update returns and the newly opened slot has been rendered/mounted, detect the `popoverId` transition and send `pagesModel.onFocus` for the opened page. When it closes, update the manager to hide the slot first, then send `onFocus` for `pagesModel.query.activePage`. This ensures never-rendered content is mounted before its focus event; TextChromeView and BoardWebview then apply focus after their current 200 ms delay, while MarkdownBodyView restores scroll. Do not send `onShow`, modify `ordered`, or change the saved active page.

   Before:
   ```ts
   // No popover Escape listener.
   ```

   After:
   ```ts
   if (event.key === "Escape" && !event.defaultPrevented) pagesModel.closePopover();
   ```

## Concerns / Open Questions

- **Foreign-document focus transition needs an implementation finding.** Verify host `focusin` when focus moves from a popover iframe/webview to an underlying iframe/webview. If it is absent, test the specified blur/focusin-triggered animation-frame recheck. Report which host-level path works; only if those fail should a board frame message or webview-preload IPC be proposed as follow-up work.
- **US-1718 coordination:** ignore the complete strip using its planned root `data-name="right-page-tabs"` (not individual tab roots). This keeps right-tab toggles from dismissing the popover first while ordinary tabs remain outside and dismiss it.
- **US-1720 boundary:** `BoardWebview.getPageVisibility()` currently checks only active and grouped-active pages. It must include the open popover page in US-1720. Other R3 focused-page and privacy behaviors remain outside this task.
- **US-1717 coordination:** the size field is added in this task to `PageModel` state, `PageDescriptor`, descriptor serialization, and restore. If its parallel implementation changes those same structures, merge the optional size field alongside `pinSide` without moving popover geometry/state into US-1717. Required US-1717 APIs (`pinSide`, zones, `popoverPageId`, open/close/toggle, `query.isRightPinned`) are assumed by this plan; none is listed as a missing addition.

## Acceptance Criteria

- Opening a never-active right-pinned page mounts its native view and displays its existing `PageSlot`; its DOM parent and native view instance remain stable through open, resize, close, and reopen.
- The open slot overlays the active page at the top-right of `.pages-container`, with an inset, z-index above ordinary slots, themed background/border/shadow, radius, and a bottom-left grip. No literal colors are introduced.
- Default geometry is 50% by 50%, capped at 80% by 80%; minimum is approximately 360 by 240 px and is clamped to the maximum on small containers. Resize grows width leftward and height downward; window/container resize reclamps effective dimensions.
- Resized width and height are stored per page as fractions and restored from `PageDescriptor`; old descriptors without the field use the default. Malformed sizes fall back safely. Open state remains transient.
- All non-open right-pinned slots remain `display: none`; the popover does not alter active page, page ordering, or persisted active page.
- Pointerdown/focusin closes only for targets inside `.app-root` and outside the popover slot/right-page-tabs strip. Targets outside `.app-root`, including sibling dialogs, progress, alerts, PoppersView, and body-portalled UIKit overlays, do not dismiss it.
- The implementation records whether host `focusin` exposes movement between foreign iframe/webview documents; it reports whether a blur/focusin-triggered animation-frame active-element check was sufficient. Frame-message/preload IPC remains a follow-up unless the host checks fail.
- Escape closes only in bubble phase when not already `defaultPrevented`.
- `PagesView` updates the manager before sending `pagesModel.onFocus` for the popover page; on close it hides the popover before returning focus through `onFocus` to the active page. No `onShow` is emitted and no active-page state changes.
- The manager uses `ResizeObserver` to recompute inline pixel geometry from fractions and disconnects it on dispose. The grip is created once per popover activation and removed when the slot stops being the popover.
- `popoverSize` is written to page state only on drag end; the `PagesModel.attachPage()` state subscription triggers debounced descriptor persistence.
- Board visibility (`BoardWebview.page.visible`) and focused-page retargeting are documented for US-1720 and are not changed here.

### Files requiring no changes

- `src/renderer/ui/app/MainPage.css` and `src/renderer/ui/app/MainPageView.ts`: `.pages-container` already provides the positioned containing block.
- `src/renderer/components/page-manager/GroupContainer.ts`: grouped slots already remain direct siblings; right-pinned pages are prohibited from grouping by US-1717.
- `src/renderer/ui/app/PageContentView.ts`: the existing page view remains mounted inside its slot.
- `src/renderer/uikit/Popover/PopoverView.ts` and `src/renderer/uikit/Popover/PopoverModel.ts`: reuse their pointer-capture pattern, but do not host the page in a second PopoverView or alter their general component behavior for this task.
- `src/renderer/uikit/Dialog/DialogView.ts`, `src/renderer/uikit/Tooltip/attach-tooltip.ts`, `src/renderer/ui/dialogs/poppers/PoppersView.ts`, and `src/renderer/uikit/Menu/attach-menu.ts`: existing overlay mount points stay unchanged; click-away ignores targets outside `.app-root`.
- `src/renderer/editors/board/BoardWebview.ts`: R3 page visibility is US-1720.
- `src/renderer/editors/browser/BrowserEditor.ts`: focused-page host-key behavior is US-1720.
- `src/renderer/api/pages/PagesModel.ts` and `src/renderer/api/pages/PagesQueryModel.ts`: transient open state and right-pin query APIs come from US-1717.
- No existing tests target `AppPageManagerView`, `PageSlot`, or `PagesView`; no test files are in scope for this task document.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/ui/app/PagesView.ts` | Project popover props, handle click-away/focus-away/Escape/close calls, persist drag-end fractions, and send focus after manager updates |
| `src/renderer/components/page-manager/AppPageManagerView.ts` | Mount popover page, render its existing slot with inline geometry, observe container resize, and manage grip drag lifecycle |
| `src/renderer/components/page-manager/AppPageManagerView.css` | Slot-owned non-geometry chrome and bottom-left grip styling |
| `src/renderer/components/page-manager/PageSlot.ts` | Own the once-per-activation grip beside the native view while retaining stable parent/view |
| `src/renderer/api/pages/PageModel.ts` | Add reactive per-page fraction size and serialize it in `getDescriptor()` |
| `src/shared/persistence.ts` | Add optional `PageDescriptor.popoverSize` fractions |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Restore optional per-page popover size |
