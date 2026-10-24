# US-1720: Focused page — retarget keyboard, browser keys, board visibility, privacy block, ai-vision activation

**Epic:** [EPIC-132: Right-pinned pages in a popover](../../epics/EPIC-132.md)
**Depends on:** [US-1717: Pin side model](../US-1717-pin-side-model/README.md), [US-1719: Popover host](../US-1719-popover-host/README.md)
**Scope:** Implement R3 focused-page behavior and complete the `activePage` source inventory. The active page remains the workspace page. This task does not implement tab-strip or popover-host rendering.

## Goal

Use the open popover page as the focused page for keyboard commands and browser host keys, while keeping `activePage` as the active workspace page. Treat the active page, its grouped partner, and the open popover page as visible through one shared query used by board visibility and the Tor/incognito privacy block.

## Background

EPIC-132 R3 is authoritative. The current working tree includes the US-1717 model work: `OpenFilesState.popoverPageId`, `PagesModel.openPopover()`, `closePopover()`, `togglePopover()`, and `PagesQueryModel.isRightPinned(id)` are present in `src/renderer/api/pages/PagesModel.ts:23-32,172-192` and `src/renderer/api/pages/PagesQueryModel.ts:25`. `PagesQueryModel.activePage` remains the last page in `ordered` (`PagesQueryModel.ts:86-89`). There is not yet a derived `focusedPage` or a shared page-visibility query.

US-1719 is responsible for `PagesView` focus transitions and adding the popover page to `AppPageManagerView.hasBeenActive` before rendering its retained slot. `PagesView` currently projects only pages, ordering, grouping, and compare state (`src/renderer/ui/app/PagesView.ts:8-55`); `AppPageManagerView.reconcile()` marks only active and grouped-active pages as previously active (`src/renderer/components/page-manager/AppPageManagerView.ts:76-83`). US-1720 consumes that host behavior and adjusts model focus notifications when an active page is removed during an open popover.

The current keyboard service sends F1 to `openActiveGuideOrContents()`, closes `pagesModel.activePage` for Ctrl+W/Ctrl+F4, and cycles pages with Ctrl+Tab (`src/renderer/api/internal/KeyboardService.ts:78-113`). `openActiveGuideOrContents()` currently reads the active editor before resolving the guide and later reads the newly active About editor (`:146-176`). Browser host keys are broadcast globally and gated only by `pagesModel.activePage === this.page` (`src/renderer/editors/browser/BrowserEditor.ts:114,264-315`); that guard must follow `focusedPage` so the browser underneath an open popover cannot consume the popover's host shortcuts.

`BoardWebview` already subscribes to `pagesModel.state` and re-posts only when its computed visibility changes (`src/renderer/editors/board/BoardWebview.ts:490-491,1036-1058`). Its current computation covers only the active page and its grouped partner. Using the shared visibility query there will add popover visibility and make the existing subscription re-post when `popoverPageId` changes.

The Tor/incognito block in `src/renderer/scripting/ai-vision/namespaces/window-screen.ts:74-84` currently inspects only the active browser editor. The privacy rule applies to every visible page, because a visible private popover still exposes private content to whole-window automation. `activatePageAndWaitForLayout()` in `src/renderer/scripting/ai-vision/page-elements.ts:16-40` already calls `pagesModel.showPage(pageId)` inside `withAgentNavigation` before waiting for a non-zero retained slot. US-1717's `PagesNavigationModel.showPage()` already routes a right-pinned page to `openPopover()` (`src/renderer/api/pages/PagesNavigationModel.ts:10-20`); keep this entry point and wait for the popover slot instead of adding an activation path that changes active-page ordering.

Ai-vision activation events are produced by `installPageActivationEvents()` listening to `pagesModel.onShow` (`src/renderer/scripting/ai-vision/page-activation.ts:21-44`). Popover open/close does not send `onShow`, so it does not currently produce `page-activated` text. `event-log.ts:59-71` describes an actual active-page change and a hidden previous page. The installed `ai-vision` `IAiEvent.kind` is a free-form `string` (`node_modules/ai-vision/dist/core/events.d.ts:1-7`); this repository has no event-kind registry. Keep popover transitions out of `page-activated` and do not add a separate event for this task: popover state is already queryable, and a lifecycle event adds no necessary activation semantics.

`window-recording.ts:75-80` intentionally selects `pagesModel.query.activePage` and captures its slot/editor. EPIC-132 explicitly keeps recording on the active page; leave this behavior unchanged.

## Implementation Plan

1. **Add derived focus and visible-page queries** in `src/renderer/api/pages/PagesQueryModel.ts` and expose the focused query through `pagesModel.query`.
   - Add `focusedPage`, returning the attached page identified by `popoverPageId` when present, otherwise `activePage`. Use `findPage(popoverPageId)` so removal cannot leave a stale focus object; when no attached popover page resolves, fall back to active.
   - Add one `isPageVisible(pageId)` helper. It returns true when the page is active, grouped with the active page, or is the currently open popover page. This is a layout/visibility predicate, not a focus predicate.
   - Keep `activePage` and `groupedPage` semantics unchanged. Do not make popover open/close mutate `ordered` or the persisted active id.

   Before:
   ```ts
   get activePage(): PageModel | undefined {
       const { ordered } = this.model.state.get();
       return ordered.length ? ordered[ordered.length - 1] : undefined;
   }
   ```
   After:
   ```ts
   get activePage(): PageModel | undefined { /* existing active-page meaning */ }
   get focusedPage(): PageModel | undefined {
       const popoverPageId = this.model.popoverPageId;
       return (popoverPageId ? this.findPage(popoverPageId) : undefined) ?? this.activePage;
   }
   isPageVisible = (pageId: string): boolean => {
       const activePage = this.activePage;
       return pageId === activePage?.id
           || pageId === this.getGroupedPage(activePage?.id ?? "")?.id
           || pageId === this.model.popoverPageId;
   };
   ```

2. **Retarget application keyboard commands** in `src/renderer/api/internal/KeyboardService.ts`.
   - Ctrl+W and Ctrl+F4 close `pagesModel.query.focusedPage`; if it is right-pinned (the open popover page), close the **popover** instead (`pagesModel.closePopover()`), never the page. The model already refuses a right-pinned page close, but branch explicitly before calling `close()` so the shortcut never targets the active page underneath the popover.
   - F1 resolves the guide from the focused page. Preserve the existing Monaco suppression, modifiers, guard, and guide matching. Capture the selected editor before asynchronous guide lookup; when opening About, use the new About page's active editor only for the final `AboutEditor` operation.
   - Ctrl+Tab and Ctrl+Shift+Tab first close an open popover, then cycle from the unchanged active page. `showNext()` / `showPrevious()` already navigate `ordered`; do not cycle from the popover page or change the active-page API.

   Before:
   ```ts
   const activePage = pagesModel.activePage;
   if (activePage) activePage.close();
   // F1 calls openActiveGuideOrContents(), which reads pagesModel.activePage.
   if (e.shiftKey) pagesModel.showPrevious();
   else pagesModel.showNext();
   ```
   After:
   ```ts
   const focusedPage = pagesModel.query.focusedPage;
   if (focusedPage && pagesModel.query.isRightPinned(focusedPage.id)) pagesModel.closePopover();
   else if (focusedPage) focusedPage.close();
   // F1 resolves the focused page's editor; Ctrl+Tab closes popover before active-page cycling.
   ```

3. **Gate browser host keys by focused page** in `src/renderer/editors/browser/BrowserEditor.ts` (`handleGlobalKeyDown`, currently line 264).
   - Replace the active-page identity check with `pagesModel.query.focusedPage !== this.page`. This keeps the existing global key set and `defaultPrevented` behavior, lets the open browser popover receive its host shortcuts, and prevents the browser underneath it from capturing them.

   Before:
   ```ts
   if (pagesModel.activePage !== this.page) return;
   ```
   After:
   ```ts
   if (pagesModel.query.focusedPage !== this.page) return;
   ```

4. **Use the shared visibility query for boards and private-window blocking.**
   - In `src/renderer/editors/board/BoardWebview.ts`, make `getPageVisibility()` delegate to `pagesModel.query.isPageVisible(pageId)`. Keep its existing state subscription and change guard; `popoverPageId` is in the subscribed model state, so opening, switching, or closing the popover will re-post `page:visibility` only when the boolean changes.
   - In `src/renderer/scripting/ai-vision/namespaces/window-screen.ts`, inspect every visible page with a browser editor, not just `activePage`. If any visible browser is Tor or incognito, return the privacy refusal. Preserve the existing wording or update it to explain that a visible private page (including a popover) must be hidden before whole-window automation.

   Before:
   ```ts
   const activeEditor = pagesModel.activePage?.mainEditorInstance;
   if (!activeEditor || activeEditor.editorId !== "browser-view") return undefined;
   const state = activeEditor.state.get() as IBrowserAccessFlags;
   ```
   After:
   ```ts
   const visiblePages = pagesModel.state.get().pages.filter(
       (page) => pagesModel.query.isPageVisible(page.id),
   );
   // Refuse when any visible page's browser editor has isTor or isIncognito set.
   ```

5. **Preserve ai-vision page layout activation semantics** in `src/renderer/scripting/ai-vision/page-elements.ts`, its callers, `page-activation.ts`, and `event-log.ts`.
   - Keep `activatePageAndWaitForLayout(pageId)` calling `pagesModel.showPage(pageId)` and waiting until the retained page slot has a non-zero rectangle. Because `showPage()` opens a right-pinned page's popover under US-1717, the wait must resolve from the US-1719 slot becoming visible. Do not manually activate a right-pinned page or change `ordered`.
   - Preserve all callers in `page-compare.ts`, `page-editor-switches.ts`, and `page-panels.ts`; they share this helper and therefore get the corrected right-pin route.
   - Ensure the popover-open/close path does not send `onShow` or call `logPageActivated()`. Continue logging only genuine active-page changes; no distinct popover event is added because there is no event-kind registry and the current event log's `kind` is intentionally open-ended.

   Before:
   ```ts
   export async function activatePageAndWaitForLayout(pageId: string): Promise<void> {
       withAgentNavigation(() => pagesModel.showPage(pageId));
       await waitForPageSlot(pageId);
   }
   ```
   After:
   ```ts
   // Keep the same route: showPage(rightPinnedId) opens its popover; wait for that slot's layout.
   ```

6. **Prevent active-page removal from stealing popover focus** in `src/renderer/api/pages/PagesModel.ts` (`handleActivePageRemoved`, currently lines 163-170).
   - When removing the active page while a popover is open, continue sending `onShow` for the new active page, but skip `onFocus`. The popover remains the focused page. When no popover is open, preserve the existing `onShow` and `onFocus` pair. This guard applies to active page removal paths that share `handleActivePageRemoved`.

   Before:
   ```ts
   this.onShow.send(activePage);
   this.onFocus.send(activePage);
   ```
   After:
   ```ts
   this.onShow.send(activePage);
   if (!this.popoverPageId) this.onFocus.send(activePage);
   ```

7. **Retain active-page identity where it is intentional.** Keep `src/renderer/api/window-recording.ts:75-80` on `query.activePage`; recording continues to capture the active page/editor under a popover. Keep active-page persistence, scripting/MCP `activePage`, active tab selection, grouped layout derivation, page-cycle origin, and active-page change detection as catalogued below.

### `activePage` source inventory

This is the requested full `rg -n "activePage" src/renderer` sweep. “Focused” means use `query.focusedPage`; “visible” means use the shared `query.isPageVisible()` only where the question is whether a page is rendered/accessible. The rest intentionally preserve active workspace identity.

| Verified source location(s) | Current meaning | R3 classification |
|---|---|---|
| `src/renderer/api/internal/KeyboardService.ts:110-112` | Ctrl+W / Ctrl+F4 close target | Change to focused; right-pinned target is a no-op. |
| `src/renderer/api/internal/KeyboardService.ts:147-158` | F1 guide lookup editor and board root | Change initial lookup to focused page. |
| `src/renderer/api/internal/KeyboardService.ts:171-175` | Resolve the editor after opening About | Keep active: this is the About page just activated by F1, not the original guide target. |
| `src/renderer/editors/browser/BrowserEditor.ts:266` | Global browser host-key eligibility | Change to focused page. |
| `src/renderer/editors/browser/browser-pages.ts:129-130` | Insert/reuse browser pages relative to active page position | Keep active; this is page/tab placement relative to the workspace page. |
| `src/renderer/editors/board/BoardWebview.ts:1036-1041` | `page.visible` for main board bridge | Change to shared visibility query. |
| `src/renderer/api/pages/PagesLayoutModel.ts:48` | Determine whether pinning to right removes active page | Keep active; right pin removes workspace active identity from `ordered`. |
| `src/renderer/api/pages/PagesModel.ts:131,160,165-169,221-222` | Removal notification, empty-page fallback, and public active getter | Keep active for removal/show behavior and active getter; only conditionally skip `onFocus` while a popover remains open. |
| `src/renderer/api/pages/PagesNavigationModel.ts:31-32,42-43` | Ctrl+Tab next/previous cycle origin | Keep active; close popover first, then cycle `ordered`. |
| `src/renderer/api/pages/PagesPersistenceModel.ts:158,408` | Persist and restore active id | Keep active; never persist the transient focused page. |
| `src/renderer/api/pages/PagesQueryModel.ts:86-94` | Active page and grouped partner query | Keep `activePage`; add `focusedPage` and `isPageVisible` alongside it. `groupedPage` remains relative to active. |
| `src/renderer/api/window-recording.ts:75-80` | Page/editor recording crop | Keep active, as EPIC-132 explicitly requires. |
| `src/renderer/scripting/renderer-script-target.ts:5` | Default page for renderer script execution | Keep active; this is the script's workspace page context. |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:23,134,139,195-196` | Public `pages.activePage`, summaries, active flag, and attention marking | Keep active; R3 does not change scripting/MCP active-page identity. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts:343` | Per-page summary `active` flag | Keep active; a popover page is focused but not active. |
| `src/renderer/scripting/ai-vision/root.ts:236,289` | Default AiVision page and summary active id | Keep active; visible-page privacy is handled separately by `window-screen`. |
| `src/renderer/scripting/ai-vision/page-compare.ts:120-129` | Select active compare pair | Keep active; compare targets the workspace page/group. |
| `src/renderer/scripting/ai-vision/page-activation.ts:17-18,24-40` | Detect and describe actual active-page changes | Keep active; popover open/close does not emit `onShow` or `page-activated`. |
| `src/renderer/scripting/ai-vision/namespaces/window-screen.ts:75-84` | Tor/incognito privacy check | Change to all visible pages via shared visibility query. |
| `src/renderer/ui/app/PagesView.ts:39-45` | Select page-manager active slot and grouped partner | Keep active; separately pass the popover id for slot visibility in US-1719. |
| `src/renderer/ui/tabs/PageTabView.ts:692` | Main-tab click compares the clicked page with the active page before Ctrl+click grouping | Keep active; the active strip remains distinct from right-strip popover selection. |
| `src/renderer/ui/sidebar/OpenTabsListView.ts:33` | Selected row in open-tabs list | Keep active; selection indicates active workspace page. |
| `src/renderer/scripting/ai-vision/namespaces/window-screen.ts:61` | Help text says recording starts on active page | Keep unchanged; matches recording behavior. |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:23` and `src/renderer/api/types/pages.d.ts:15,30` | Public API documentation | Keep active wording; focused page is not part of this task's scripting API. |
| `src/renderer/api/types/page.d.ts:63` | Public page-global docs mention `app.pages.activePage` | Keep active wording. |
| `src/renderer/ui/app/HeaderQuickSettingsPopover.ts:129` | Localized “active page” label | Keep; this is a label, not a page-state read. |

The grep also finds active-page names and comments in `KeyboardService.ts`, `PagesQueryModel.ts`, `PagesNavigationModel.ts`, `window-recording.ts`, and `ai-vision` comments/help text that describe the active-page contract. Update only wording that becomes false after implementation; do not bulk-replace the active-page concept.

## Concerns

- **Privacy scope:** the refusal must consider every visible page, including the active page, its grouped partner, and an open popover. Checking only the focused page would miss a private active page under a non-private popover, and checking only the active page would miss a private popover over a normal page.
- **F1 asynchronous lookup:** capture the focused page/editor and its guide context before awaits. Re-reading `focusedPage` after an await could point at another page if the user changes focus while guide metadata loads.
- **Focus notification order:** US-1719 must update/mount the popover slot before sending `onFocus` for it. This task's removal guard only prevents the active-page-removal notification from stealing focus after that transition.
- **Ai-vision event semantics:** keep `page-activated` tied to `onShow` active-page changes. No distinct popover event is needed in the current open-string event log; adding a new kind would require defining useful consumer-facing text and documentation without a registry enforcing it.
- **Shared working tree:** US-1718 is in progress in another session. This task does not edit source files as part of document authoring; the implementation plan names the R3 source work for a later implementation turn.

## Acceptance Criteria

- `pagesModel.query.focusedPage` resolves to the attached open popover page, otherwise `query.activePage`; opening/closing a popover never changes `activePage`, `ordered`, or persisted `activePageId`.
- `pagesModel.query.isPageVisible(pageId)` returns true exactly for the active page, its grouped partner, or the open popover page.
- Ctrl+W / Ctrl+F4 target the focused page; for an open popover page they close the popover and leave the page pinned; F1 resolves the focused page's guide.
- Ctrl+Tab and Ctrl+Shift+Tab close an open popover before cycling from the active page.
- Browser host keys are gated by the focused page; the browser under an open popover does not handle those shortcuts.
- `BoardWebview.page.visible` uses the shared query and re-posts visibility when the open popover changes the result.
- `window-screen` refuses whole-window automation if any visible browser page is Tor or incognito, including grouped and popover pages.
- Ai-vision page activation continues to call `showPage()` and waits for the retained slot layout; right-pinned pages open through the existing popover route. Popover transitions never emit misleading `page-activated` text and do not emit a new event kind.
- Removing the active page while a popover remains open sends `onShow` to the new active page but does not send it `onFocus`.
- `window-recording` continues to select and record `query.activePage`.
- Every remaining renderer `activePage` use is classified in the inventory above and retains active semantics unless explicitly listed for conversion.

## Files requiring no changes

- `src/renderer/api/pages/PagesNavigationModel.ts`: US-1717 already makes `showPage(rightPinnedId)` open the popover; preserve this route. Ctrl+Tab ordering/close behavior is added in `KeyboardService.ts`.
- `src/renderer/scripting/ai-vision/page-elements.ts`: `activatePageAndWaitForLayout()` already calls `showPage()` and waits for the requested retained slot to get a non-zero rectangle; US-1717 routes right-pinned IDs to `openPopover()`, and US-1719 makes that slot visible. No caller branch is needed.
- `src/renderer/scripting/ai-vision/page-elements.ts` callers in `page-compare.ts`, `page-editor-switches.ts`, and `page-panels.ts`: keep using the shared activation helper; no caller-specific right-pin branches are needed.
- `src/renderer/scripting/ai-vision/event-log.ts`: do not add a popover event; retain `page-activated` for actual active-page changes.
- `src/renderer/api/window-recording.ts`: keep recording bound to the active page.
- `src/renderer/ui/app/PagesView.ts` and `src/renderer/components/page-manager/AppPageManagerView.ts`: R3 consumes the focus/mount ordering and popover visibility support owned by US-1719; keep rendering changes there.
- `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, `PageWrapper.ts`, `src/renderer/scripting/ai-vision/root.ts`, and `src/renderer/api/types/pages.d.ts` / `page.d.ts`: public active-page identity remains unchanged; scripting/MCP additions belong to US-1721.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/api/pages/PagesQueryModel.ts` | Add derived `focusedPage` and shared `isPageVisible(pageId)` queries |
| `src/renderer/api/internal/KeyboardService.ts` | Target focused page for close/F1; close popover before Ctrl+Tab cycling |
| `src/renderer/editors/browser/BrowserEditor.ts` | Gate host shortcuts by focused page |
| `src/renderer/editors/board/BoardWebview.ts` | Derive bridge visibility from shared page-visibility query |
| `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` | Apply Tor/incognito refusal to all visible browser pages |
| `src/renderer/api/pages/PagesModel.ts` | Skip active-page `onFocus` after removal while a popover remains open; retain `onShow` |
