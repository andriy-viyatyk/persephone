# US-1561: Page-level pipe status badge and stage popover

**Epic:** [EPIC-116: Pipe status and instant open](../../epics/EPIC-116.md)  
**Status:** Done  
**Scope:** Show the current page pipe's live status in shared page chrome, expose every stage in a popover, and provide a reusable stage-list view for US-1563's loading shell.

## Goal

Give every editor page a shared, page-owned badge for the current content pipe, with a popover that shows all pipe stages. Keep the stage list independently reusable so the instant-open loading shell in US-1563 can render the same information before an editor view exists.

## Background

### Shared page chrome and view ownership

- `PageToolbarView` is the existing shared toolbar for text-host pages and many standalone editor views. It owns an `EditorToolbarView`, the right-contribution slot, and the switch widget; the right side can host the badge immediately before the switch (`src/renderer/editors/base/PageToolbarView.ts:364-427`). Its shared call sites are `TextChromeView` (`src/renderer/editors/base/TextChromeView.ts:356-362`), image (`src/renderer/editors/image/ImageView.ts:45-53`), video (`src/renderer/editors/video/VideoView.ts:62-70`), archive (`src/renderer/editors/archive/ArchiveEditorView.ts:63-63`), category (`src/renderer/editors/category/CategoryEditor.ts:67-67`), git-tree (`src/renderer/editors/git-tree/GitTreeEditorView.ts:206-206`), mneme-root (`src/renderer/editors/mneme-root/MnemeRootEditorView.ts:279-279`), and board-info (`src/renderer/editors/board-info/BoardInfoEditorView.ts:97-97`). Add the badge once inside `PageToolbarView`; those editors then inherit it without individual changes.
- Boards use their own toolbar class. `BoardEditorView` creates and mounts `BoardToolbarView` unconditionally (`src/renderer/editors/board/BoardEditorView.ts:83-109`). `PagesLifecycleModel` creates `BoardContentEditorModel` for `editorKind === "content-host"`, while `stream-host` deliberately uses the base board model (`src/renderer/api/pages/PagesLifecycleModel.ts:211-232`); `BoardContentEditorModel` extends `BoardEditorModel` (`src/renderer/editors/board/BoardContentEditorModel.ts:14-26`). Therefore the same badge must also be composed in `BoardToolbarView` for both board kinds.
- The current page-source pipe owners found in the editor tree are text hosts, image, video, and boards; each uses one of the two toolbar paths above. There is no page-source pipe-consuming editor without either toolbar. `link-editor/pipe-image-src.ts` reads a separate archive image to produce a tile blob URL, not the page's current pipe (`src/renderer/editors/link-editor/pipe-image-src.ts:1-16, 43-51, 59-79`), so it is outside the page badge's scope.
- Text pages already show a provider badge in `ContentHostFooterView`, which binds the host's `pipeState` and renders provider/archive identity (`src/renderer/editors/base/ContentHostFooterView.ts:42-54, 105-111, 135-154`). It is provider metadata in the footer, not live status, and applies only to text-host pages. `TextFileModel.pipe` explicitly documents the footer badge and explains why the property is backed by `pipeState` (`src/renderer/editors/text/TextEditorModel.ts:82-106`). Keep that provider badge intact; the new status badge is page-level and applies to all editor kinds.
- A page's editor view is loaded asynchronously by `RenderEditorView` (`src/renderer/ui/app/RenderEditorView.ts:11-25, 50-56`), so its toolbar and badge do not exist before the editor view mounts. That interval is owned by US-1563: its loading shell renders the same `PipeStageListView` in expanded density. The badge itself belongs in the existing toolbar and does not reserve a row while hidden.

### Finding the current pipe and observing replacement

- Use the raw `page.mainEditorInstance`, not the unwrapped `page.mainEditor`: the raw editor preserves `contentHost`, while `mainEditor` unwraps text-bearing editors (`src/renderer/api/pages/PageModel.ts:197-220`). US-1560 step 5 specifies the selection rule: if the current model is a `TextFileModel`, or its `contentHost` is a `TextFileModel`, use that host's primary `pipe`; otherwise use the raw editor's `pipe` (`doc/tasks/US-1560-pipe-status-model/README.md:74`). This avoids reading a text editor's base `EditorModel.pipe` field, which is not where its primary pipe lives (`src/renderer/editors/base/EditorModel.ts:78-81`).
- A text host's `pipeState` is the source-change notification. `TextFileModel.setPipe()` delegates to `TextFileIOModel.setPrimary()` (`src/renderer/editors/text/TextEditorModel.ts:96-106`); `setPrimary()` replaces the paired primary/cache pipes and publishes the primary through the `pipe` accessor (`src/renderer/editors/text/TextFileIOModel.ts:73-83`). Subscribe to the host's `pipeState`, not to `cachePipe` (`src/renderer/editors/text/TextFileIOModel.ts:18-35`).
- Navigation changes the page's raw main editor and publishes a new `mainEditorId` (`src/renderer/api/pages/PageModel.ts:463-472`); `PageContentView` already subscribes to page state and synchronizes when it changes (`src/renderer/ui/app/PageContentView.ts:35-45, 57-89`). Re-read the current page pipe and rebind both page-model and pipe-status subscriptions when the main editor changes.
- No-host editors currently have a plain `EditorModel.pipe` field, not an observable pipe channel (`src/renderer/editors/base/EditorModel.ts:73-81`). New opens assign a supplied pipe before the page is added (`src/renderer/api/pages/PagesLifecycleModel.ts:255-275`), and navigation builds/attaches a new editor and then swaps the page main editor (`src/renderer/api/pages/PageNavigator.ts:231-256`). But an already-open video page can replace its pipe during `onReopen()` without changing the page's main editor (`src/renderer/editors/video/VideoEditor.ts:123-136, 200-224`). Add an `EditorModel.pipeState` channel with a `pipe` accessor/setter so all existing direct assignments publish; subscribe to it for no-host editors. This keeps the page badge correct on both navigation and same-page pipe replacement.

### Status UI patterns, styling, and lifecycle

- US-1560 fixes the consumer API: `IContentPipe.stages` is ordered provider then transformers; `summary` prioritizes an error, otherwise selects the most recently updated stage with status; and `onStatusChange(callback)` returns a disposer (`doc/tasks/US-1560-pipe-status-model/README.md:34-68, 74, 78`). Subscribe only to the current page pipe and render an immediate snapshot after every rebind. No status API source is part of this task; US-1560 is implementing it separately.
- `PopoverView` supports a button anchor through `elementRef`, controlled `open`, `placement`, `onClose`, and a native `contentView` callback (`src/renderer/uikit/Popover/PopoverModel.ts:32-78`; `src/renderer/uikit/Popover/PopoverView.ts:24-29, 344-382`). Use that existing primitive for the stage popover. `contentView` returns an owned native view, so the popover can host the reusable stage list without React or an app-specific UIKit wrapper (`src/renderer/uikit/Popover/PopoverView.ts:42-60`).
- The split standard reserves UIKit for pure primitives and keeps API/page-coupled views in `components/` (`doc/standards/uikit-vs-components-split.md:8-20`). Put this app-specific pipe display in `src/renderer/components/pipe-status/`; it consumes `IContentPipe` and `PageModel`, so it is coupled. Follow UIKit's native `VanillaView` ownership rules for its children and the existing Popover primitive (`src/renderer/uikit/CLAUDE.md:25-28, 176-190, 228-230`).
- `VanillaView` owns registered cleanup and child lifetimes; explicit subscriptions can be wrapped in `ownSubscription`, and released when rebinding (`src/renderer/uikit/shared/vanilla-view.ts:33-51, 160-200, 228-230`). Dispose the prior page/pipe subscription on every rebind, and dispose the badge, popover branch, stage list, and completion timer with their owner. Do not leave raw pipe listeners attached after navigation, page close, or view disposal.
- The popover's `contentView` factory does not attach or update its returned view automatically: it must append the returned view's root to the supplied host, and the caller must push new stage snapshots into a retained stage-view reference (`src/renderer/uikit/CLAUDE.md:624-648`). Do not claim that view a second time with `child()`; `PopoverFloatingView` owns it.
- `src/renderer/core/utils/format-bytes.ts` already exports the shared `formatBytes()` helper used by board-info, tools-hub, and browser downloads; its current implementation formats only B/KB/MB (`src/renderer/core/utils/format-bytes.ts:1-8`). Extend that existing helper to GB/TB without adding a second formatter. `src/renderer/editors/mneme-config/mnemeTypes.ts:139-151` confirms the app's existing B-through-TB unit convention.
- Grouped pages are separate `PageSlot` views laid out side by side by `GroupContainer` (`src/renderer/components/page-manager/GroupContainer.ts:4-17, 24-47`). Since each page has its own toolbar and current pipe, a grouped pair intentionally shows one independent badge per page.
- New DOM handles use `data-name` for addressing, `data-type` for component kind, `data-part` for internal regions, and `data-*` attributes for state; repeated names are allowed and are not unique (`doc/architecture/ui-element-contract.md:8-38`). Give the trigger and stage list stable names such as `page-pipe-status` and `pipe-stage-list`; express state with `data-state`/`data-status`, not a CSS class per state.
- Use theme tokens only. Existing semantic colors are available from `src/renderer/theme/color.ts:1-39, 63-85` and correspond to theme CSS variables. Component CSS must use `var(--color-...)` and spacing/size/radius/font token families with fallbacks; no literal colors (`src/renderer/uikit/CLAUDE.md:125-151`). The `SpinnerView` and `ProgressBarView` primitives already provide accessible spinner and determinate/indeterminate progress states (`src/renderer/uikit/Spinner/SpinnerView.ts:13-45`; `src/renderer/uikit/ProgressBar/ProgressBarView.ts:13-23, 39-103`).

## Implementation Plan

1. **Add the shared, reusable stage-list view.** Create `src/renderer/components/pipe-status/PipeStageListView.ts` and `src/renderer/components/pipe-status/PipeStageListView.css`. Accept a readonly `IPipeStage[]` snapshot and a compact/expanded density prop; render every stage in API order with its `displayName`, role, state, optional `text`/`detail`, byte progress and rate when present. The expanded density is for US-1563's loading shell; compact is for the badge popover. Use a `data-type="pipe-stage-list"` root, named stage rows/parts, `data-status` state attributes, token-based CSS, and no direct application APIs. Export this view for the page badge and later loading-shell consumer.

2. **Add the page badge and popover view/model.** Create `src/renderer/components/pipe-status/PagePipeStatusView.ts`, `src/renderer/components/pipe-status/PagePipeStatusView.css`, and `src/renderer/components/pipe-status/PagePipeStatusModel.ts`. `PagePipeStatusView` receives `{ page: PageModel }`; each toolbar resolves that page from its editor model's `page.id` with `pagesModel.findPage()` and passes it to the badge (see step 6). `PagePipeStatusModel` owns transient data/effects: current pipe, current `summary`/`stages`, error dismissal, active start time, and the disposable done timer. It subscribes to `page.state` for main-editor changes and to the active host/editor pipe channel; it releases each source before rebinding. Implement it as a `TComponentModel` driven by `createComponentModelDriver`, since it coordinates subscriptions and a completion timer. `PagePipeStatusView` owns DOM, the button and `PopoverView`, and binds to the model. Resolve the pipe using the US-1560 step 5 rule: narrow the raw main editor to `TextFileModel` or a `TextHostEditorModel` whose `contentHost` is a `TextFileModel`, then use the host's primary pipe; otherwise read `mainEditorInstance.pipe`. When the pipe identity changes, release the previous `pipe.onStatusChange`, reset dismissal/timing for the new source, bind the new pipe, and immediately read `summary` and `stages`. While bound, subscribe to `pipe.onStatusChange` and refresh both snapshots. Keep the popover's open/closed state in the view. Name the badge trigger `page-pipe-status`, the floating popover `page-pipe-status-popover`, the stage-list root `pipe-stage-list`, and rows `pipe-stage`; keep state out of those names.

   Before (badge absent from the editor toolbar):
   ```ts
   // src/renderer/editors/base/PageToolbarView.ts
   content.append(rightHost, switchWidget.root);
   ```

   After (badge sits on the shared toolbar's right side, before the switch):
   ```ts
   // src/renderer/editors/base/PageToolbarView.ts
   const statusHost = createContentsPart("page-toolbar-status");
   content.append(rightHost, statusHost, switchWidget.root);
   const page = this.props.model.page
       ? pagesModel.findPage(this.props.model.page.id)
       : undefined;
   if (page) {
       this.pipeStatus = this.child(new PagePipeStatusView({ page }));
       statusHost.append(this.pipeStatus.root);
       this.pipeStatus.mount();
   }
   ```

3. **Implement badge states from the pipe snapshots.** Show the badge for `connecting`/`active` summary states with `SpinnerView`, `summary.text` (use a short neutral loading label only when absent), and a thin `ProgressBarView`. Use determinate progress when a valid loaded/total pair exists and indeterminate progress otherwise. Track, per pipe binding, whether this badge has observed `connecting` or `active`. On `done`, show a final line for 3 seconds only if that binding previously observed one of those states; a pipe already `done` when this view binds shows nothing. Derive elapsed time from the first connecting/active snapshot and byte count from the provider stage's loaded progress (do not add provider and transformer byte counts); call the existing `formatBytes()` from `src/renderer/core/utils/format-bytes.ts` for the byte portion, extending that helper to GB/TB in place as needed. Fall back to a completion label when byte/time data is unavailable, then hide. An `error` found at bind time or reached later stays visible until dismissed or the current pipe is replaced. Do not add a Retry button: the pipe API is informational and there is no uniform retry operation at this layer; an owning page/editor can retry by replacing its pipe. Dismissing hides the current pipe's error badge; a new pipe resets dismissal. Show a close/dismiss control with an accessible label.

4. **Wire the popover to the shared stage list.** Anchor `PopoverView` to the status button, use bottom-end placement and click-outside/Escape close behavior, and create `PipeStageListView` in its `contentView` factory. The factory appends the stage view root to the supplied host and returns the view for PopoverView to own. Keep a non-owning reference in `PagePipeStatusView`; on each model snapshot change, update that view directly while the popover is open because PopoverView does not forward updates to `contentView`. Clear the reference when the popover closes or the pipe changes; the popover branch owns and disposes the stage view. The stage view must list every provider and transformer stage, including stages with no current status; show each available state/text/detail/progress/rate without dropping inactive stages. Keep popover open state independent of pipe updates.

5. **Make base editor pipe replacement observable.** In `src/renderer/editors/base/EditorModel.ts`, replace the bare `pipe` field with `readonly pipeState = new TOneState<IContentPipe | null>(null)` and a `pipe` getter/setter backed by it, matching the already established pattern in `TextFileModel` (`src/renderer/editors/text/TextEditorModel.ts:82-106`). Existing assignment sites continue to use `editor.pipe = ...` and automatically notify. Keep `TextFileModel.pipeState` as its own host-owned channel; do not route text-host pages through the wrapper editor's base pipe.

6. **Mount the badge in both existing shared toolbar paths.** In `src/renderer/editors/base/PageToolbarView.ts`, create a dedicated status host after `rightHost` and before `switchWidget.root`; do not append into `rightHost`, because `fillSlot()` owns that contribution host. Resolve `page` with `pagesModel.findPage(this.props.model.page.id)`, create `PagePipeStatusView({ page })`, mount it, and release it with the toolbar's child ownership. This one integration covers TextChromeView plus image, video, archive, category, git-tree, mneme-root, and board-info. In `src/renderer/editors/board/BoardToolbar.ts`, resolve `this.model.page.id` the same way and append/mount `PagePipeStatusView` after `morePanel` and before `switchWidget`; this toolbar is created by `BoardEditorView` for both content-host and stream-host models. The badge is absent until an editor toolbar mounts; during deferred restore, US-1563's loading shell renders `PipeStageListView` in expanded density.

7. **Add addressing documentation.** Add `[data-name="page-pipe-status"]`, `[data-name="page-pipe-status-popover"]`, `[data-name="pipe-stage-list"]`, and `[data-name="pipe-stage"]` to the Page area of `doc/architecture/ui-element-contract.md`, documenting repeated-page addressing through the containing `[data-name="page-slot"][data-page-id="<page id>"]` (emitted by `src/renderer/components/page-manager/PageSlot.ts:17-20`). Do not describe `className` as an addressing hook.

8. **Update epic and dashboard links.** Link this document in the US-1561 row in `doc/epics/EPIC-116.md` and replace the plain US-1561 item in `doc/active-work.md` with `- [ ] [US-1561: Page-level pipe status badge and stage popover](tasks/US-1561-pipe-status-badge/README.md)`.

## Concerns

- A page can replace a no-host pipe without changing its main editor (`VideoEditor.onReopen` is one verified path). The base `EditorModel.pipeState` channel in step 5 is required so the badge can detach from the old pipe and attach to the replacement.
- Put one badge inside each page's existing toolbar. The grouped layout intentionally renders one independent badge for each side-by-side page. Before a toolbar exists, US-1563's loading shell owns the expanded stage list; it does not need a pre-mount badge or a permanently reserved chrome row.
- There is no universal Retry API exposed by `IContentPipe`; the badge must not invent one. Keep errors dismissible and clear their dismissed state when the page's current pipe changes.
- A pipe can expose a byte count at more than one stage. The completion line uses the provider's count only, preventing transformed pipeline stages from being double-counted.
- Status is live-only. Do not persist badge state, stage status, error dismissal, elapsed time, or timers.

## Acceptance Criteria

- Every editor kind shows the same page-owned pipe badge in its existing shared toolbar when its current pipe is connecting, active, done briefly, or in error; an absent pipe/status leaves no badge. Before an editor toolbar mounts during deferred open, US-1563's loading shell renders the expanded stage list instead.
- The badge displays a spinner, `summary.text`, and a thin progress bar while connecting/active; completion shows a final line for a few seconds and then hides; an error remains until dismissed or the current pipe is replaced.
- Show the completion line only if this toolbar binding observed `connecting` or `active` for that pipe. An already-done pipe is hidden at bind time, while an error found at bind time is shown until dismissed.
- Clicking the badge opens an anchored popover listing every pipe stage and all available status fields. Dismissing a pipe error is separate from closing the popover.
- The same exported stage-list view can render in compact popover and expanded loading-shell layouts; US-1563 can use it before an editor view mounts.
- A grouped side-by-side pair shows one independent badge per page.
- The badge follows main-editor navigation, text-host `pipeState`/`setPipe`, and no-host editor `pipe` replacement; all page, pipe, popover, child-view, and timer subscriptions/resources are disposed on rebind and teardown.
- New CSS uses theme color and sizing tokens only. New inspectable UI uses `data-type`, `data-name`, `data-part`, and `data-*` according to the UI element contract.
- Task doc is linked from EPIC-116 and `active-work.md`. No tests are added by this task.

## Files that do not need changes

| File | Reason |
|------|--------|
| `src/renderer/editors/base/ContentHostFooterView.ts` | Keep the existing text-only provider/archive badge; the new badge is separate page status UI. |
| `src/renderer/ui/app/PageContentView.ts` and `src/renderer/ui/app/Pages.css` | Keep the existing page-host and layout structure; the badge lives in the editor's existing toolbar. |
| `src/renderer/editors/text/TextEditorModel.ts` | Its `pipeState`, `pipe` accessor, and `setPipe()` already publish text primary-pipe replacement. |
| `src/renderer/content/ContentPipe.ts` and `src/renderer/api/types/io.pipe.d.ts` | US-1560 owns the pipe status API. |
| `src/renderer/content/providers/ProxyProvider.ts` and service bridge files | Board service reporting is owned by US-1562. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` and `src/renderer/api/pages/PageNavigator.ts` | Their current open/navigation paths are observed by the page view; this task does not change page-open timing (US-1563). |
| `src/renderer/uikit/Popover/PopoverView.ts` | Use the existing UIKit popover primitive; no new primitive is needed. |

## Files Changed Summary

| File | Planned change |
|------|---------------|
| `doc/tasks/US-1561-pipe-status-badge/README.md` | This task plan. |
| `src/renderer/components/pipe-status/PipeStageListView.ts` | Reusable compact/expanded stage list. |
| `src/renderer/components/pipe-status/PipeStageListView.css` | Token-based stage-list styling. |
| `src/renderer/components/pipe-status/PagePipeStatusView.ts` | Current page-pipe selection, subscriptions, badge states, popover, and completion/error lifecycle. |
| `src/renderer/components/pipe-status/PagePipeStatusView.css` | Token-based page badge styling. |
| `src/renderer/components/pipe-status/PagePipeStatusModel.ts` | Page/pipe subscriptions, snapshots, transient error/completion state, and timer cleanup. |
| `src/renderer/editors/base/EditorModel.ts` | Observable no-host `pipeState` backing the existing `pipe` accessor. |
| `src/renderer/editors/base/PageToolbarView.ts` | Compose the badge on the right before the switch widget for shared-toolbar editors. |
| `src/renderer/editors/board/BoardToolbar.ts` | Compose the same badge before the switch widget for content-host and stream-host boards. |
| `src/renderer/core/utils/format-bytes.ts` | Extend existing `formatBytes()` to GB/TB while retaining this shared formatter. |
| `doc/architecture/ui-element-contract.md` | Document page pipe badge and popover names. |
| `doc/epics/EPIC-116.md` | Link US-1561 task doc in epic table. |
| `doc/active-work.md` | Link US-1561 task doc from active epic block. |

## Implementation notes

- **Smoke-check fix (Claude):** every page built with `PageToolbarView` crashed on mount with
  "defaultState should be provided when modelState is State class". `createComponentModelDriver`
  was called without an initial state. `PagePipeStatusView` now passes the exported
  `initialPagePipeStatusState`. The badge mounts on text pages; the active state was not seen
  live yet, because until US-1563 a page only appears after its content has loaded.
