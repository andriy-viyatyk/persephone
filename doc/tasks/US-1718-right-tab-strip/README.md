# US-1718: Right tab strip — header placement, context menu, reorder, toggle click

**Epic:** [EPIC-132: Right-pinned pages in a popover](../../epics/EPIC-132.md)
**Depends on:** [US-1717: Pin side model](../US-1717-pin-side-model/README.md)
**Scope:** Renderer tab and header UI, plus the focus notification guard required by right-strip reordering. Do not implement the popover host/geometry (US-1719), focused-page behavior (US-1720), scripting/MCP surface (US-1721), or other model/persistence changes owned by US-1717.

## Goal

Render right-pinned pages as an icon-only strip in the window header, with localized pin actions, within-strip reordering, and click-to-toggle-popover behavior. Keep active-page selection and the main tab strip limited to normal and left-pinned pages.

## Background

EPIC-132 decisions R2 and R5 are authoritative for page zones and restrictions; R4 defines opening a right page as a popover rather than activation. US-1717 supplies `pinSide`, the `left | normal | right` page zones, `popoverPageId`, `openPopover`, `closePopover`, `togglePopover`, and `query.isRightPinned`. Depend on that API; do not recreate model rules in the view.

The right strip belongs in `MainPageView.buildHeader`, after `app-header-spacer` and before the zoom, recording, and system buttons. The header is a drag region, so its interactive strip and tab controls must opt out of dragging. The existing main `PageTabsView` must render left-pinned and normal pages only.

## Implementation Plan

1. **Add the right strip to the header** in `src/renderer/ui/app/MainPageView.ts` (`buildHeader`, approximately lines 123–149) and its styling in `src/renderer/ui/app/MainPage.css`.
   - Inspect the existing header composition and preserve its order: `app-header-spacer`, right-pinned tabs, then zoom/recording/system controls.
   - Add a dedicated `RightPageTabsView` in `src/renderer/ui/tabs/RightPageTabsView.ts`; it renders the right-zone pages with keyed child views. Mount it after the spacer, before the existing autoload/zoom/recording/system controls. Reuse `PageTabView` with an explicit mode for right tabs.
   - The header has `-webkit-app-region: drag`; header buttons are no-drag, and `PageTab.css` already marks each tab root no-drag. Mark the new strip container no-drag and preserve the tab-root rule so users can click and drag tabs without dragging the window.
   - Give the strip a `data-name="right-page-tabs"`; retain `data-name="page-tab"` and `data-page-id` on each reused tab root, as required by `doc/architecture/ui-element-contract.md`.
   - US-1719's click-away handler treats clicks inside the right strip as inside by matching the strip root selector `[data-name="right-page-tabs"]`. Keep this attribute on the strip root; do not introduce a per-tab `data-page-mode` marker for click-away detection.

   Before:
   ```ts
   this.header.append(this.menuButton, this.pageTabs.root);
   this.header.append(createPanelElement({ name: "app-header-spacer", flex: 1, minWidth: 40 }));
   // existing autoload, zoom, recording, and system controls
   ```
   After:
   ```ts
   this.header.append(this.menuButton, this.pageTabs.root);
   this.header.append(createPanelElement({ name: "app-header-spacer", flex: 1, minWidth: 40 }));
   this.header.append(this.rightPageTabs.root);
   // existing autoload, zoom, recording, and system controls
   ```

2. **Separate page selection and share tab behavior** in `src/renderer/ui/tabs/PageTabsView.ts`, `PageTabView.ts`, `PageTab.ts`, and `PageTab.css`.
   - `PageTabsView.onMount` currently projects `state.pages` directly into its `KeyedList`, and `syncPageLayoutSubscriptions` selects `state.pinned`. Keep the bind selector on the stored `state.pages` reference; filter right pages inside `updateTabs` / `refreshTabLayout` with `pagesModel.query.isRightPinned(page.id)` before updating the `KeyedList`. Subscribe to `pinSide`; preserve left-pinned then normal order. `pinnedLeft` remains left-only.
   - Add `PageTabProps.mode: "main" | "right"` (or an equivalent explicit mode) and reuse `PageTabView`. Right mode uses the page's own icon/title content but omits visible title text, close affordance, and left-sticky offset. Keep the existing main-tab mode behavior intact.
   - A right tab is icon-only, has a tooltip using the existing `pinned-tooltip-trigger` pattern, and reflects popover selection in a separate state attribute when its page id equals `pagesModel.popoverPageId`. Do not set `data-active` for popover selection: that attribute remains the active-page indicator. For icon-only tabs without a file path, show the projected title in the tooltip; file-backed tabs may show their path.
   - Preserve left-pinned presentation details in right mode: show the modified dot when modified and reserve the encrypted width when encryption state is present, using the existing `pinnedTabWidth` / `pinnedTabEncryptedWidth` sizing convention from `PageTab.ts`.
   - Clicking a right tab calls `pagesModel.togglePopover(page.id)` and never activates the page. Ctrl+click does nothing and must not group. Right tabs have no middle-click close or close button.
   - The right strip root is excluded from US-1719 click-away detection, so a right-tab click must not race an outside-click close. `togglePopover(page.id)` alone handles switching: clicking a different right tab while one popover is open opens that other page's popover.
   - The current `PageTabView` root is a draggable div with no explicit `tabIndex` or keyboard handler; right tabs must preserve the same focusability and activation behavior as main tabs without inventing a new keyboard interaction.
   - `onLanguageClick` currently activates an inactive page and opens the language menu only when the tab was already active. A right tab is never active, so right mode must return before that path. Do not stop propagation: the click bubbles to the tab root, where it toggles the popover.
   - Set stable `data-name` values on the strip and tab roots. In CSS, distinguish right mode and selected/open state without adding hard-coded colors; use existing theme tokens/patterns.

   Before:
   ```ts
   private updateTabs(projection: TabProjection): void {
       this.currentPages = projection.pages;
       this.syncPageLayoutSubscriptions(projection.pages);
       this.tabs.update(projection.pages);
   }
   ```
   After:
   ```ts
   private updateTabs(projection: TabProjection): void {
       const mainPages = projection.pages.filter((page) => !pagesModel.query.isRightPinned(page.id));
       this.currentPages = mainPages;
       this.syncPageLayoutSubscriptions(mainPages);
       this.tabs.update(mainPages);
   }
   ```
   Apply the same filtering in `refreshTabLayout`; do not allocate a filtered array in the state selector.

   Language-icon handler:
   ```ts
   private onLanguageClick(event: MouseEvent): void {
       if (this.props.mode === "right") return;
       // Existing main-tab activation and language-menu behavior follows.
   }
   ```
   The early return must not call `preventDefault()` or `stopPropagation()`, allowing the tab-root click handler to toggle the popover.

3. **Add right-strip context-menu choices** in `src/renderer/ui/tabs/PageTabView.ts` using the existing menu API.
   - Preserve left-pin access while adding side-specific actions: normal tabs offer **Pin to the left** and **Pin to the right**; left-pinned tabs offer **Unpin** and **Pin to the right**; right-pinned tabs offer **Unpin** and **Pin to the left**. A right tab must omit Close Tab, Close Tabs to the Right, Open in New Window, and Duplicate; retain applicable editor-specific items.
   - Use `pagesModel.pinTab(page.id, "left" | "right")` and `pagesModel.unpinTab(page.id)`; the model API moves directly between zones. Omit Duplicate for right-pinned tabs because duplication groups.
   - Replace hard-coded `Pin Tab` / `Unpin Tab` labels in `PageTabView.ts` with catalog keys. Add semantic flat messages to `src/shared/i18n/en/shell.ts`, which is already included by `src/shared/i18n/en/index.ts`; use `t()` at the menu call site. Give each translated menu item a stable English `id` as required by localization guidance. Do not concatenate labels.
   - Per `doc/standards/localization.md`, add the English source entries to the `en` catalog only. This task does not need edits to non-English language packs; pack translation coverage is maintained separately and missing translations use the English source fallback.

   Before:
   ```ts
   label: isPinned ? "Unpin Tab" : "Pin Tab",
   onClick: () => isPinned ? pagesModel.unpinTab(page.id) : pagesModel.pinTab(page.id),
   ```
   After:
   ```ts
   label: t("shell.pinTabToRight"),
   id: "page-tab-pin-to-right",
   onClick: () => pagesModel.pinTab(page.id, "right"),
   ```

   The existing English catalog already has `shell.unpin` for **Unpin**. Add distinct `shell.pinTabToLeft` and `shell.pinTabToRight` messages for the two side labels.

4. **Constrain drag behavior to the right zone** in `src/renderer/ui/tabs/PageTabView.ts`, `PageTab.ts`, and `RightPageTabsView.ts`.
   - Permit reorder only among right-pinned tabs; the right-strip drop handler accepts a source only when `pagesModel.query.isRightPinned(sourceId)` is true, then calls `pagesModel.moveTab(sourceId, targetId)`. A drop of a normal/left tab onto the right strip is a no-op, not a pin operation. The model still refuses every cross-zone move.
   - A right tab's click handler must short-circuit `event.ctrlKey` before the existing `groupTabs` path, then call `pagesModel.togglePopover(page.id)`. No right-tab path calls `showPage`.
   - `PageTabView.handleDragStart` currently sets trait drag data for every page, while the `application/persephone-tab` payload and `handleDragEnd` outside-window behavior are guarded only by `page.pinned`. Make those guards side-aware: right tabs may use trait payload for same-strip reorder but never set cross-window payload and never launch `api.addDragEvent` on dragend outside. Keep main-tab drag behavior and model zone refusal. Existing `PageTab.css` already makes every tab root `-webkit-app-region: no-drag`; preserve that rule for right mode.

   Before:
   ```ts
   if (!page.pinned) event.dataTransfer.setData("application/persephone-tab", JSON.stringify(this.getDragData()));
   // handleDragEnd launches a new window for tabs that end outside the window.
   ```
   After:
   ```ts
   if (page.pinSide !== "right") event.dataTransfer.setData("application/persephone-tab", JSON.stringify(this.getDragData()));
   // handleDragEnd returns for page.pinSide === "right".
   ```

   - Right-strip reorder currently reaches `PagesLayoutModel.moveTabByIndex`, which emits `this.model.onFocus.send(movedPage)` after moving any page. Skip that notification when the moved page is right-pinned, because a closed popover page has no visible editor to focus. The current working-tree implementation still sends it unconditionally; include this one-line change in `src/renderer/api/pages/PagesLayoutModel.ts` for this task:

   Before:
   ```ts
   this.model.onFocus.send(movedPage);
   ```
   After:
   ```ts
   if (movedPage.pinSide !== "right") this.model.onFocus.send(movedPage);
   ```

5. **Keep header and tab interaction attributes aligned with the UI contract** in `src/renderer/ui/app/MainPage.css`, `src/renderer/ui/tabs/PageTab.css`, and `src/renderer/ui/tabs/PageTabs.css`.
   - Confirm the correct `-webkit-app-region: no-drag` selector reaches the new strip and its tabs while the surrounding header remains draggable. Use existing theme variables for its open appearance.
   - `PageTabs.css` already owns `[data-type="page-tabs"]` strip layout; extend it for a right-strip root without left-strip scrolling/add controls. Keep the tab's `data-type`, `data-part`, and page identity attributes unchanged.
   - Give the right strip a 4px left margin so it does not visually touch the spacer's drag area; this follows the 4px header column gap and existing `PageTabs.css` margin convention. Keep the strip itself no-drag.

## Concerns

- `PageTabView` currently couples pin presentation, selection, close controls, tooltip content, context-menu choices, and drag handlers. Right mode must branch at those sites while leaving main-mode behavior intact.
- US-1717's task document specifies `pinSide`, `query.isRightPinned`, `popoverPageId`, `togglePopover`, side-aware `pinTab`, and zone-aware `moveTab`; verify those APIs against its finalized implementation before coding. If an API required here is missing from US-1717, record it as **needs US-1717 addition**. `PagesLayoutModel.moveTabByIndex` currently still emits `onFocus` for right-page reorder; this task owns the right-pin guard described above.
- The existing `PageTabsView` renders `state.pages`, while `moveTab(fromId, toId)` resolves indices in the full `pages[]` collection. The right-strip list filters the right zone, then passes source/target page ids to `moveTab`; adjacent right-tab drops must produce the expected right-zone order in the full collection.
- `src/renderer/core/events/context-menu.ts` already provides generic `MenuItem` fields (`label`, `onClick`, `id`, `startGroup`) and the `page-tab` target kind; no context-menu event API change is expected.
- Header descendants are inside a drag region. The new strip div needs an explicit no-drag rule; retain the existing no-drag rule on tab roots because the header button selector alone does not cover a div tab root.

## Acceptance Criteria

- Right-pinned tabs appear as a separate icon-only strip after `app-header-spacer` and before zoom/recording/system buttons; normal and left-pinned tabs remain in the main strip.
- Strip and tabs have contract-compliant `data-name` attributes, and all interactive descendants work inside the draggable header.
- Clicking a right tab toggles its popover through `togglePopover`, never activates the page, and shows a selected state exactly while that page's popover is open.
- The strip root uses `data-name="right-page-tabs"`, which US-1719 click-away handling matches as inside; clicking another right tab switches the open popover through `togglePopover` without a competing click-away close.
- Clicking a right tab's language icon does not activate the page or open its language menu; the click bubbles to the tab root and toggles the popover.
- Ctrl+click does not group; right tabs cannot close by middle-click or close button.
- Context menus expose Pin to the left and Pin to the right on normal tabs; Unpin and Pin to the right on left-pinned tabs; Unpin and Pin to the left on right-pinned tabs. Duplicate and close/transfer actions are absent for right tabs.
- Pin to left, Pin to right, and Unpin labels, including replacements for the existing hard-coded labels, use localized English catalog entries through `t()` and stable menu item ids.
- Right tabs reorder within the right strip only. A normal tab dropped onto the strip does nothing; right tabs cannot transfer across windows or create a new window when drag ends outside.
- Reordering a right tab does not emit `onFocus` for the moved page.
- Right tab presentation retains the modified dot and encrypted width behavior of left-pinned tabs; the strip has a small visual gap after the spacer.
- Right tabs preserve the focusability and activation behavior of main tabs, without new keyboard behavior.
- Icon-only tabs provide a tooltip using the existing pinned-tooltip-trigger convention.

### Files requiring no changes

- `src/renderer/api/pages/PagesModel.ts`, `PageModel.ts`, and `PagesQueryModel.ts`: state, zones, operations, and `query.isRightPinned` belong to US-1717; consume its API here. `PagesLayoutModel.ts` is changed only for the right-reorder `onFocus` guard specified in this task.
- `src/renderer/core/events/context-menu.ts`: the generic `MenuItem` API and `page-tab` event target already support this menu; no event contract change is required.
- `src/renderer/components/page-manager/AppPageManagerView.ts` and `src/renderer/ui/app/PagesView.ts`: page slot/popover rendering belongs to US-1719.
- `src/shared/persistence.ts` and `src/renderer/api/pages/PagesPersistenceModel.ts`: pin-side persistence belongs to US-1717.
- `src/renderer/api/types/page.d.ts`, `page-tab.d.ts`, and scripting/MCP wrappers: public script surface belongs to US-1721.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/ui/app/MainPageView.ts` | Place right strip in header and wire it to pages model |
| `src/renderer/ui/app/MainPage.css` | Header strip layout and no-drag behavior |
| `src/renderer/ui/tabs/RightPageTabsView.ts` | Render and reorder the right-zone tabs in a dedicated header strip |
| `src/renderer/ui/tabs/PageTabsView.ts` | Exclude right-pinned pages from main strip |
| `src/renderer/ui/tabs/PageTabView.ts` | Right-mode click, selected state, context menu, tooltip, drag restrictions; localize pin labels |
| `src/renderer/ui/tabs/PageTab.ts` | Add explicit right/main presentation mode to tab props |
| `src/renderer/ui/tabs/PageTab.css` | Icon-only, selected, tooltip-trigger, and no-drag presentation |
| `src/renderer/ui/tabs/PageTabs.css` | Right-strip-specific layout |
| `src/renderer/api/pages/PagesLayoutModel.ts` | Skip `onFocus` notification when reordering a right-pinned page |
| `src/shared/i18n/en/shell.ts` | Add semantic English messages for Pin to left and Pin to right; use existing Unpin message |
