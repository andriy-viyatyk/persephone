# US-1369: Entry points — Menu Bar, `F1`, and the update flow's What's New

## Status

**Status:** Planned  
**Epic:** [EPIC-093 — About page as guide browser](../../epics/EPIC-093.md)  
**Depends on:** [US-1366 — The `persephone-guide://` scheme](../US-1366-guide-link-scheme/README.md),
with the About-browser seam supplied by [US-1367 — About page split and the contents
view](../US-1367-about-split-contents/README.md) and the in-pane renderer from US-1368.

This document is a plan only. No product code, guide prose, tests, or harnesses are changed by
US-1369 planning.

## Goal

Make the in-app guide reachable from the Menu Bar, a focused screen's `F1` shortcut, and the
update-available card's *What's New* action. The normal `F1` path is the About page's contents view;
only a matching user-facing guide page is opened directly, and the update link uses the committed
`persephone-guide://whats-new` identity instead of GitHub.

## Background

### Binding epic and committed guide route

EPIC-093 decisions 1, 7, and 8 are binding here:

- Guide identities are `persephone-guide://<corpus-path>[#anchor]`; `whats-new` is therefore
  `persephone-guide://whats-new`.
- `F1` resolves the active page's editor id to a guide whose front matter has the same `editorId`,
  otherwise it opens About's contents. The empty mapping is expected until EPIC-094 writes the
  per-screen pages; missing mappings are not errors and must never produce a “no guide” failure.
- The About card remains unchanged except for the update-available *What's New* behavior.

US-1366's renderer route is present in the source: `src/renderer/guides/index.ts` owns one
module-level `createGuideIndex(new RendererGuideSource())`, and exports `getGuideIndex()` and
`getGuidePage()`. `GuideIndex.getTree(audience?)` returns `GuideTreeFolder`/`GuideTreePage` values,
and `GuideTreePage.editorId` is the existing mapping field. The content parser defaults a guide
route to `md-view`, while the guide resolver validates membership and constructs the `guide` pipe;
US-1369 must call that route rather than introduce another provider, parser, or index.

### Menu Bar findings

`src/renderer/ui/sidebar/MenuBarView.ts` declares `aboutButton` as an `IconButtonView` field with
`name: "menubar-about"`, `icon: "info"`, `title: "About"`, and `onClick: () => this.openAbout()`.
`onMount()` appends and mounts it between the spacer and settings button. `openAbout()` closes the
Menu Bar and calls `pagesModel.showAboutPage()`.

The verified icon registry is `src/renderer/theme/icon-registry.ts`. It contains the `question`
icon (`QuestionIcon`), so `question` is the valid help-shaped icon selected for the sibling; there is
no invented `guide` or `book` icon name. The new item will be named `menubar-user-guide` and will
call a separate `openUserGuide()` method that closes the Menu Bar and calls
`pagesModel.showAboutPage({ atContents: true })`. This deliberately opens the About page, not a
separate tab: the epic makes About the guide browser. The ordinary About button keeps its existing
`openAbout()` callback and calls plain `pagesModel.showAboutPage()` without the option, so reading
a guide is not reset just because the About page is shown again. US-1369 owns this explicit
contents option; it does not fabricate a second contents view or add a `persephone-guide://index`
tab fallback.

### Global shortcut and active-editor findings

There is no renderer `F1` handler today. The only current `F1` hit outside Monaco is the automation
key definition at `src/renderer/automation/input.ts`, where it maps the synthetic key to keycode
112; it is not an application shortcut.

`src/renderer/api/internal/KeyboardService.ts` is the verified owner for global renderer shortcuts:
`init()` installs one process-lifetime bubbling `document` `keydown` listener, `handleKeyDown` first
broadcasts `globalKeyDown`, and its switch handles `Ctrl+Tab`, `Ctrl+W`/`Ctrl+F4`, `Ctrl+N`,
`Ctrl+O`, and theme cycling. `src/renderer/api/app.ts` constructs and initializes this service in
`App.initEvents()`. The new `F1` case belongs in this switch, with no view-level listener.

The existing `globalKeyDown` browser subscriber in `src/renderer/editors/browser/BrowserEditor.ts`
also was checked: `handleGlobalKeyDown()` ignores already-prevented events and claims F5, F12,
Ctrl-R/Ctrl-F, and Escape only. It does not consume `F1`, so the new switch remains the single
application-level owner after the broadcast.

The two embedded-page focus boundaries were checked separately. Browser content is an Electron
`<webview>` mounted by `src/renderer/editors/browser/BrowserView.ts`; the browser main-process
`before-input-event` hook and `src/preload-webview.ts` handle selected reload/devtools/navigation,
find, and Escape behavior but do not claim `F1`. A focused guest page therefore keeps its own `F1`
behavior, and its keydown does not bubble into the renderer document or `globalKeyDown`. Board
content is a cross-origin `board://` `<iframe>` mounted by `src/renderer/editors/board/BoardWebview.ts`;
`src/board-shim.ts` forwards Ctrl-S and the theme-cycle keys to the host, but not `F1`, so a board
page likewise keeps ownership of its own `F1`. The intended behavior is deliberate: the app claims
`F1` only when the event reaches the renderer document (native renderer views, subject to the
Monaco guard); browser and board embedded content retain their own page-level behavior.

The active screen's editor id is available without a new page lookup:
`pagesModel.activePage` is the last page in `PagesQueryModel.ordered`, and
`PageModel.mainEditorInstance` returns the raw `EditorModel`, whose public `editorId` identifies the
active main editor. The lookup will call `getGuideIndex().getTree("user")` and recursively inspect
the returned existing tree for the first page with the captured `editorId`. Using the `user` filter
keeps agent-only format references out of a user shortcut and avoids the currently duplicated
agent/user mappings. It walks the index result; it does not create a second index or a persistent
editor-id map. The current corpus has seven `editorId` front-matter entries, but only the
user-visible browser and notebook editor pages are eligible under this filter; EPIC-094 will add
the per-screen corpus pages, so contents fallback remains the normal current result for editors
such as grid.

After resolving a path, the handler will await plain `pagesModel.showAboutPage()` and dynamically
import `AboutEditor` from the same About module. It will narrow
`pagesModel.activePage?.mainEditorInstance` with `instanceof AboutEditor`, then call the shipped
runtime seam as `editor.guideBrowser.openGuide({ kind: "guide", path: guidePath })`; the location
object carries `kind`, `path`, and its optional `fragment`, rather than passing a string path.
The `instanceof` check is required so a renamed seam fails at compile time instead of becoming a
silent optional no-op. With no path, it will call
`pagesModel.showAboutPage({ atContents: true })`; that normal fallback owns the reset and is not a
user-facing “no guide” error. The action is a seam call into the About browser; US-1369 must not
add another About state holder or instantiate an editor/page model.

### Verified Monaco `F1` collision

`src/renderer/api/setup/configure-monaco.ts` calls `redefineKeybinding()` from `initMonaco()`, but
that project override contains only delete-lines and column-selection bindings; it does not change
`F1`. The installed Monaco source registers `F1` in
`node_modules/monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js`
as the built-in `editor.action.quickCommand` / Command Palette action, guarded by the editor-focus
context.

The collision is safe with the planned registration scope. Monaco's
`StandaloneKeybindingService` adds a bubbling `keydown` listener to each editor container; when its
focused-editor `F1` binding resolves, it invokes the Command Palette and calls both
`preventDefault()` and `stopPropagation()`. `KeyboardService` listens later at `document`, so that
event does not reach the new global case. The implementation will retain the document-bubble
listener (never a capture listener) and add a defensive early return when the event target is inside
`.monaco-editor`; this keeps Monaco's command palette authoritative even if its event plumbing
changes. Live verification must confirm that focused Monaco `F1` opens the palette and does not open
About, while `F1` on a non-Monaco screen opens the appropriate guide or contents.

### Update flow and link sweep findings

`src/renderer/editors/about/AboutView.ts` currently creates the update-available *What's New*
button in `renderUpdateStatus()`. Its callback at the verified GitHub-guide URL calls
`shell.openExternal()`. The surgical replacement will send
`createLinkData("persephone-guide://whats-new")` through `app.events.openRawLink`, wrapped with
`guard("Failed to open What's New", ...)`. The committed scheme opens an ordinary in-app `md-view`
tab and keeps this card change independent of the About pane's internal navigation state.

`src/renderer/api/internal/RendererEventsService.ts` was checked separately: its update handler
only shows the notification and calls `pagesModel.showAboutPage()` when that notification is
clicked. It does not create or own the card link, so it is intentionally unchanged.

The required sweep found these guide/doc pointers:

- Inside `src/`, only `src/renderer/editors/about/AboutView.ts` points a user at the GitHub copy of
  a shipped guide, and it is the US-1369 change above.
- `README.md` points at local `assets/guides/**` pages, `CONTRIBUTING.md` still points at `/docs/`,
  `build/README.txt` points at the GitHub `assets/guides` tree, and
  `assets/board-template/CLAUDE.md` points at the GitHub boards guide. These repo-side pointers
  belong to EPIC-095 and are not changed here.
- The sweep also found `assets/script-library/autoload/register-all.ts` pointing at the GitHub
  scripting guide. It is another repo-side pointer covered by the roadmap's EPIC-095 retirement
  work and is not changed here.
- External repository/issues/release links in the shipped guide prose, the About repository/issues
  actions, `src/renderer/api/settings.ts`'s generic repository docs comment, and the separate
  `persephone-boards` repository are not hard-coded links to the GitHub copy of a Persephone guide;
  they remain unchanged.

## Implementation Plan

### 1. Add the Menu Bar *User Guide* sibling

- Modify `src/renderer/ui/sidebar/MenuBarView.ts` only in the existing Menu Bar button group.
- Declare `userGuideButton` immediately after `aboutButton`, following the same `IconButtonView`
  declaration shape and using `name: "menubar-user-guide"`, `size: "md"`, `icon: "question"`,
  `title: "User Guide"`, and `onClick: () => this.openUserGuide()`.
- Append and mount it immediately after `aboutButton` in `onMount()`. Add `openUserGuide()` beside
  `openAbout()`; it closes the Menu Bar and calls `pagesModel.showAboutPage({ atContents: true })`.
  Leave `openAbout()` unchanged: the plain About button calls `pagesModel.showAboutPage()` without
  `atContents`, preserving any existing guide location.
- US-1367's shipped About browser is the dependency seam. The typed contents option and its reset
  call are owned by US-1369, so the Menu Bar item does not need a separate guide tab or duplicate
  contents view.

Before:

```ts
private readonly aboutButton = new IconButtonView({
    name: "menubar-about",
    size: "md",
    icon: "info",
    title: "About",
    onClick: () => this.openAbout(),
});
private readonly settingsButton = new IconButtonView({
```

After:

```ts
private readonly aboutButton = new IconButtonView({
    name: "menubar-about",
    size: "md",
    icon: "info",
    title: "About",
    onClick: () => this.openAbout(),
});
private readonly userGuideButton = new IconButtonView({
    name: "menubar-user-guide",
    size: "md",
    icon: "question",
    title: "User Guide",
    onClick: () => this.openUserGuide(),
});
private readonly settingsButton = new IconButtonView({
```

The matching `onMount()` delta is:

```ts
this.toolbar.append(
    this.openFileButton.root,
    this.newWindowButton.root,
    this.spacer.root,
    this.aboutButton.root,
    this.userGuideButton.root,
    this.settingsButton.root,
);
// mount userGuideButton immediately after aboutButton
```

The new method is deliberately distinct from the About button:

```ts
private openUserGuide(): void {
    this.props.onClose?.();
    pagesModel.showAboutPage({ atContents: true });
}
```

### 2. Add the explicit About-contents option

- Modify `src/renderer/api/pages/PagesLifecycleModel.ts`.
- Change the shipped method signature to
  `showAboutPage(options?: { atContents?: boolean }): Promise<void>`. Preserve its existing
  guarded dynamic About-module loading and fixed-page deduplication, but retain the returned
  `PageModel` from `showEditorPage()` for the optional reset.
- When `options?.atContents` is true, dynamically import the About module in the same way as the
  existing route and narrow `page?.mainEditorInstance` with `instanceof AboutEditor`; call the
  already-shipped `resetGuideBrowser()` only for that instance. Do not use a structural cast or an
  optional method call. If the guarded route returns no page, leave the failure handling to the
  existing `guard()` path rather than creating a second About state holder.
- The Menu Bar User Guide item and the F1 no-mapping fallback pass `{ atContents: true }`. The
  ordinary About button, the update-available notification's About click, and `call`'s
  `pages.showAboutPage()` continue to pass no option, so they preserve the current guide location.

Before:

```ts
showAboutPage = async (): Promise<void> => {
    await this.showEditorPage("about-view", async () =>
        (await import("../../editors/about")).ABOUT_PAGE_ID);
};
```

After:

```ts
showAboutPage = async (options?: { atContents?: boolean }): Promise<void> => { ... };
```

### 3. Register `F1` in the global renderer shortcut owner

- Modify `src/renderer/api/internal/KeyboardService.ts`.
- Keep `KeyboardService.init()` as the process-lifetime document-bubble registration and add an
  `F1` case that accepts only an unmodified, non-composing event. Before doing asynchronous work,
  return when `event.defaultPrevented` or the event target is inside `.monaco-editor`; do not use a
  capture listener and do not call `preventDefault()` for Monaco events.
- Capture `pagesModel.activePage?.mainEditorInstance?.editorId` before awaiting. Resolve the guide
  with the existing `getGuideIndex().getTree("user")` result and a small recursive tree walk that
  compares `GuideTreePage.editorId`. If no id or no page matches, keep `guidePath` undefined and
  treat that as the normal contents route. If index loading fails, catch the `unknown` with
  `errMessage()` for diagnostic logging and still continue to About contents; do not notify the user
  that no guide exists.
- For a matching path, await plain `pagesModel.showAboutPage()` so the current About browser
  location is not reset. Dynamically import the About module and narrow
  `pagesModel.activePage?.mainEditorInstance` with `instanceof AboutEditor`; do not use a
  structural cast, optional chaining on the method, or a silent absent-method branch. Call the
  shipped seam with its real signature:
  `editor.guideBrowser.openGuide({ kind: "guide", path: guidePath })`. The object has `kind`,
  `path`, and optional `fragment` fields. A failed `instanceof` invariant should be surfaced as a
  caught actionable failure, not silently ignored.
- For no matching path, call `pagesModel.showAboutPage({ atContents: true })`. This is the normal
  fallback because almost no guide page currently has `editorId`; it resets through the explicit
  option and must not notify the user that no guide exists.
- Do not statically import editor modules, create a second editor-id lookup, or modify
  `src/renderer/automation/input.ts`.

Before:

```ts
switch (e.code) {
    case "Tab":
        // existing global shortcuts
```

After:

```ts
switch (e.code) {
    case "F1":
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.defaultPrevented) break;
        if (e.target instanceof Element && e.target.closest(".monaco-editor")) break;
        e.preventDefault();
        void this.openActiveGuideOrContents();
        break;
    case "Tab":
        // existing global shortcuts
```

The helper owns the asynchronous index lookup and About handoff; its no-match result is an ordinary
`showAboutPage({ atContents: true })` call, not an error branch. The plain About button and the
matching-guide path use `showAboutPage()` without `atContents` so an existing guide is preserved
until the explicit guide location is opened.

### 4. Re-point the update card's link through the guide scheme

- Modify the shipped final version of `src/renderer/editors/about/AboutView.ts` after US-1367's
  split implementation. US-1367 restructured this file, so sequence US-1369 after that change (or
  manually integrate the one callback into the shipped result); do not apply a stale whole-file
  patch. The conflict surface is the update-card block around the surviving update-available
  What's New button.
- Add direct imports for `createLinkData` from `src/shared/link-data` and `guard` from
  `src/renderer/core/utils/guard` as needed. Replace only the `shell.openExternal()` call for the
  guide URL with `app.events.openRawLink.sendAsync(createLinkData("persephone-guide://whats-new"))`
  inside `guard("Failed to open What's New", ...)`. Keep the Download action external and preserve
  all update-state/layout/card behavior.
- This intentionally opens the stable guide identity in an ordinary in-app `md-view` tab. It does
  not call `RendererEventsService`, duplicate the What's New selector, or silently depend on the
  pane's private state. The pane can still expose its own full What's New entry through US-1367/8.

Before:

```ts
onClick: () => {
    void shell.openExternal("https://github.com/andriy-viyatyk/persephone/blob/main/assets/guides/whats-new.md");
},
children: "What's New",
```

After:

```ts
onClick: () => {
    void guard("Failed to open What's New", () =>
        app.events.openRawLink.sendAsync(
            createLinkData("persephone-guide://whats-new"),
        ),
    );
},
children: "What's New",
```

No changes are planned for `src/renderer/api/internal/RendererEventsService.ts`, the Download
button, or either repository/issues external link.

### 4. Verify live through the Persephone MCP `call` tool

No unit tests, fixtures, snapshots, or harnesses are added. The user runs the following against the
running `persephone` MCP surface:

- Open the Menu Bar, inspect `menubar-user-guide`, click it, and confirm the Menu Bar closes and
  About is shown at the contents view once US-1367 is present. Confirm `question` renders and the
  existing About item still behaves identically.
- On a screen with a known user guide mapping, press `F1` and confirm About opens directly at that
  guide. On a screen without a mapping, press `F1` and confirm About opens at contents with no
  warning/toast/error. Verify the current browser/notebook mappings if available and the expected
  grid fallback before EPIC-094's pages land.
- Focus the Monaco text area and press `F1`; confirm Monaco's Command Palette opens, the global
  handler does not open About, and text focus/contents are not changed. Then focus a non-Monaco
  screen and repeat the `F1` route check.
- Focus the content of a browser tab and press `F1`; confirm the renderer does not steal it from
  the guest page. Focus a board page and press `F1`; confirm the board remains the owner because
  its cross-origin iframe does not forward that key to the host.
- Put the app in an update-available state, click the card's *What's New*, and confirm an in-app
  `md-view` page for `persephone-guide://whats-new` opens. Confirm Download still opens the release
  URL externally and the update notification click still calls About through
  `RendererEventsService`.
- Confirm no user-directed `github.com/andriy-viyatyk/persephone/.../docs` or `.../guides` link
  remains in `src/`; leave the repo-side pointers listed above for EPIC-095.

## Concerns

- **AboutView merge ordering:** US-1367 restructures `AboutView.ts` in parallel, so this task must
  land after that change or be integrated manually into its final left-card update callback. A
  whole-file replacement risks discarding the split/browser work. US-1368 is needed for the final
  in-pane rendering, but the surgical What's New scheme link can be verified as a tab without
  waiting for private pane state.
- **US-1367 handoff:** `AboutEditor.guideBrowser.openGuide(location)` is the required runtime seam
  for `F1`, with `location` shaped as
  `Extract<AboutGuideLocation, { kind: "guide" }>` (`{ kind: "guide"; path: string; fragment?: string }`).
  The implementation must consume that seam rather than add a second location/history model.
  `PagesLifecycleModel.showAboutPage({ atContents: true })` is the explicit reset-to-contents
  route owned by US-1369; plain `showAboutPage()` preserves the browser location.
- **Duplicate editor mappings:** existing agent-only format pages duplicate browser/notebook ids.
  The `user` tree filter makes the user-facing choice deterministic and aligns with the About
  browser's default audience. EPIC-094's per-screen pages will become the authoritative mappings.
- **Async lookup and active-page changes:** capture the editor id before the index await, then open
  the captured guide or contents after About is shown. A missing/failed lookup must remain a quiet
  contents fallback, with caught values converted through `errMessage()`.
- **No styling change:** this task adds no CSS, colors, or new reusable component. Existing
  `IconButtonView`/`VanillaView` patterns and theme tokens remain authoritative.

## Acceptance Criteria

- [ ] `MenuBarView` has a sibling `IconButtonView` named `menubar-user-guide`, uses the verified
      `question` icon, appears next to About, closes the Menu Bar, and opens About/contents through
      `showAboutPage({ atContents: true })`; the plain About button still calls
      `showAboutPage()` without the option.
- [ ] The renderer's only new global `F1` binding is registered by `KeyboardService`'s existing
      document-bubble handler, accepts no modifier combination, and does not use a view listener.
- [ ] `F1` reads the active `mainEditorInstance.editorId`, searches the existing renderer
      `GuideIndex` tree for a matching `GuideTreePage.editorId`, opens that guide through the
      `AboutEditor.guideBrowser.openGuide({ kind: "guide", path })` seam, and otherwise calls
      `showAboutPage({ atContents: true })` without a user-facing failure.
- [ ] A focused Monaco editor retains Monaco's built-in `F1` Command Palette; the global guide
      shortcut never steals it.
- [ ] When focus is inside a browser `<webview>` or board `board://` `<iframe>`, the embedded page
      retains `F1`; the renderer shortcut claims only events that reach the renderer document.
- [ ] The update-available About-card *What's New* action opens
      `persephone-guide://whats-new` through the in-app pipeline, while Download and repository/
      issue links retain their existing external behavior.
- [ ] No other `src/` user link to the GitHub guide copy remains; repo-side pointers are unchanged
      and explicitly deferred to EPIC-095.
- [ ] No unit tests, harnesses, hardcoded colors, React components, prohibited direct imports, or
      static editor imports are introduced; caught values use `errMessage()` and notify-only paths
      use `guard()`.
- [ ] All behavior is verified live by the user through Persephone MCP `call` as listed above.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/ui/sidebar/MenuBarView.ts` | Add and mount the `menubar-user-guide` `IconButtonView` sibling using the existing About route. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Add the typed `showAboutPage({ atContents?: boolean })` option and reset the returned `AboutEditor` only when requested. |
| `src/renderer/api/internal/KeyboardService.ts` | Add the guarded global `F1` route, existing-index editor mapping, Monaco collision guard, and About-browser handoff. |
| `src/renderer/editors/about/AboutView.ts` | Replace only the update-available *What's New* external callback with the in-app guide-scheme opener, integrated after US-1367's shipped split. |

### Files verified and intentionally not changed

| File/area | Reason |
|---|---|
| `src/renderer/api/pages/PagesLifecycleModel.ts` (`showAboutPage`) | This task owns the typed optional contents reset; plain calls preserve the shipped About browser state. |
| `src/renderer/api/internal/RendererEventsService.ts` | Update notification click only opens About; it does not own the card link. |
| `src/renderer/guides/index.ts`, `src/shared/guides/index.ts` | Existing single renderer index, `GuideIndex.getTree()`, and `editorId` fields are consumed; no second lookup/index is added. |
| `src/renderer/api/setup/configure-monaco.ts` and installed Monaco keybinding sources | Configuration and built-in Command Palette behavior are verified; no Monaco binding is changed. |
| `src/renderer/automation/input.ts` | Its `F1` entry is automation input data, not a renderer shortcut handler. |
| `src/renderer/theme/icon-registry.ts`, `src/renderer/uikit/IconButton/IconButtonView.ts` | `question` is verified and the existing UIKit primitive is reused. |
| `README.md`, `CONTRIBUTING.md`, `build/README.txt`, `assets/board-template/CLAUDE.md`, `assets/script-library/autoload/register-all.ts` | Repo-side documentation/script pointers belong to EPIC-095. |
| `assets/guides/**` | No guide prose or guide assets are changed; external links inside guide prose are not GitHub copies of this corpus. |
| `doc/active-work.md` | US-1369 is already listed under EPIC-093; no dashboard entry is added or moved. |
