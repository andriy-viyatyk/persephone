# US-1367: About page split and the contents view

## Goal

Turn the existing About editor into a two-pane guide-browser screen. Preserve the existing About
card's content on the left, add the renderer's existing guide index as a filtered contents view on
the right, and define the runtime pane/history state that US-1368 will use for in-pane guide
rendering.

This document is a plan only. No product code, guide prose, tests, or harnesses are changed by
US-1367 planning.

**Epic:** [EPIC-093 — About page as guide browser](../../epics/EPIC-093.md)

**Depends on:** [US-1366 — The `persephone-guide://` scheme, the guide pipe, and renderer guide
access](../US-1366-guide-link-scheme/README.md), whose committed outputs are the renderer
`GuideIndex`, `getGuideIndex()`, `getGuidePage()`, `persephone-guide://` identities, and the shared
release-note selector.

## Background

### Existing About editor and persistence

`src/renderer/editors/about/AboutEditor.ts` defines `AboutEditorState` with only the normal editor
state fields plus `type: "aboutPage"`; its default state uses the fixed `ABOUT_PAGE_ID` and title
`About`. `AboutEditor` is an `EditorModel<AboutEditorState>` with `editorId = "about-view"`,
`noLanguage = true`, `skipSave = true`, and `showBackgroundOrnament = true`. Its `restore()` calls
`super.restore()` and then restores the title to `About`.

`skipSave` does not mean “do not persist this editor.” `TextFileActionsModel.confirmRelease()` and
`canClose()` use it to bypass unsaved-change prompts/disposal for text hosts. The ordinary page
descriptor path still serializes every editor through `PageModel.getDescriptor()` →
`EditorModel.getRestoreData()`, and `PagesPersistenceModel.saveState()` writes those page
descriptors. On restore, `PagesPersistenceModel.restorePage()` treats `about-view` as a no-host
editor, dynamically creates it, assigns the persisted `d.state`, calls `applyRestoreData()`, and
calls `restore()`.

Therefore the split is intentional:

| State | Owner | Persistence | Contents |
|---|---|---|---|
| `AboutEditorState` | `AboutEditor.state` | Existing page descriptor | Identity/title/type only; no pane, toggle, history, tree, or notes |
| Guide-browser navigation | Runtime state owned by `AboutEditor` | Not persisted | `contents` or `guide(path, fragment?)`, history, `showAgentGuides` |
| Loaded corpus data | Browser view/model | Not persisted | Async tree, release-note projection, loading/error state, native children |
| Split width | `AboutEditorView` | Not persisted | Default left-card width for this view instance |

The runtime state is on the About editor, rather than in `app.settings`, so the future US-1370
facade and the view share one current pane/history. It must not be added to `AboutEditorState`,
because that state is persisted even though `skipSave` is true.

The fixed page identity matters for preserving browser state. `PagesLifecycleModel.showAboutPage()`
calls `showEditorPage("about-view", () => import("../../editors/about").ABOUT_PAGE_ID)`, and
`showEditorPage()` creates a `PageModel` with the fixed id; `PagesModel.addPage()` deduplicates an
already-open page. Re-opening About through that generic path can therefore return the existing
`AboutEditor` instance, so it must not reset the user's current guide. US-1369's explicit
`showAboutPage({ atContents: true })` entry-point contract resets the returned editor only for the
User Guide menu item and F1 fallback, narrowing `mainEditorInstance` with `instanceof AboutEditor`.
A new About editor after restart starts with default runtime state because the runtime state is not
in the descriptor.

### Existing About card content

`src/renderer/editors/about/AboutView.ts` currently builds the card in `AboutEditorView.mountContent()`.
The existing content is verified and must remain unchanged while moving into the left pane:

- Persephone icon, product name, and `Version ${app.version || "..."}`;
- Electron, Node.js, Chromium, and Available boards rows;
- Check for Updates and its status line/actions;
- GitHub Repository and Report Issue buttons, both opening external GitHub URLs with
  `shell.openExternal()`.

The update-available status currently also has a What's New button that opens the GitHub copy of
`assets/guides/whats-new.md`. Re-pointing that existing update-flow link is US-1369, not this task;
the contents view's own What's New entry is in-app as described below.

### Binding guide-index contract

US-1366 committed `src/renderer/guides/index.ts` with one module-level
`createGuideIndex(new RendererGuideSource())`. `getGuideIndex()` exposes that single index, and
`src/renderer/guides/guide-source.ts` reads the packaged/dev corpus through `app.fs` and
`api.getAssetsPath()` using `file-path`. The About browser must call that index; it must not parse
front matter, scan the corpus, build a second tree, call the main-process `guides` node for tree
data, or add a second renderer index.

`GuideIndex.getTree()` accepts `GuideAudienceFilter`: `"user"` includes `user` and `both` pages,
while `"all"` includes agent pages as well. The default browser mode calls `getTree("user")`; the
enabled mode calls `getTree("all")`. The committed `getGuideTree()` convenience has no audience
argument, so the About browser imports `getGuideIndex()` and calls its typed `getTree(filter)`.

### Splitter precedent and layout choice

There is a reusable vertical splitter. `src/renderer/uikit/Splitter/SplitterView.ts` is a
controlled `VanillaView` primitive with vertical orientation, numeric value, bounded min/max,
side, and `onChange`. It uses pointer capture, emits `data-type="splitter"`, `data-name`,
orientation and ARIA separator attributes, and its co-located CSS uses existing theme variables.
Real precedents are:

- `src/renderer/ui/sidebar/MenuBarView.ts`: category pane, right content pane, and controlled
  vertical splitter, with owner-held width updated after each drag;
- `src/renderer/ui/secondary-views/SecondaryViewsView.ts`: outer panel plus vertical splitter,
  width binding, and owner-side clamping;
- `src/renderer/editors/browser/BrowserView.ts` and `BookmarksDrawer.ts`: fixed side area plus
  flexible content using `SplitterView`.

`src/renderer/components/page-manager/ImperativeSplitter.ts` is an older page-manager-specific
implementation, not the primitive for this editor. `DividerView` in About is a horizontal-rule
primitive and is not a pane splitter.

US-1367 uses `SplitterView` with `name: "about-splitter"`, `orientation: "vertical"`,
`side: "before"`, a default left-pane width, and sensible min/max bounds. The left card is
non-shrinking, the splitter keeps its fixed handle width, and the guide pane is
`flex: 1`/`min-width: 0`.

No existing renderer stylesheet defines a narrow media breakpoint (verified across
`src/renderer` CSS), so choose a deliberate new About-local `@media (max-width: 760px)` breakpoint.
At narrow widths the About-owned static stylesheet deliberately stacks the panes: it changes the
wrapper to a column, hides the interactive vertical splitter, and gives the guide pane a top
border using `var(--color-border-default)`. The card becomes full-width up to its existing maximum
and the guide pane owns the remaining vertical scrolling. Desktop retains the resizable vertical
split. No new color token is needed; `color.ts` and every theme already define the background and
border tokens used by Splitter and the stacked separator.

### Tree/list reuse decision

`src/renderer/uikit/Tree/` is the appropriate primitive. `TreeView` is a native `VanillaView`
backed by `TreeModel` and the UIKit `DataGrid` boundary. It supports nested items, controlled
expansion, keyboard navigation/roving focus, selection callbacks, custom rendering, tooltips, and
fixed-height rows. Map `GuideTreeNode` into its item shape, use guide path as the stable value,
page title as label, folder children for hierarchy, and `renderTrailing` for page summaries. Use an
explicit `rowHeight: 24`: the title remains the primary one-line label, while the summary is a
same-row secondary projection taking the remaining width with ellipsis; the full summary is
available through the row tooltip. Long summaries are therefore truncated in the row but not lost,
and no variable-height measurement is needed. Folders are collapsed by default so root-level pages
remain visible.

`src/renderer/components/tree-provider/` is a Persephone-coupled filesystem/provider view. It
adds file-tree behavior that this static corpus does not need, so it is not reused. `ListBox` may
be used for a flat resource list, but it does not replace the hierarchy. No new reusable component
is needed; if one were required, the repository rule puts it in `src/renderer/uikit/` as a native
`VanillaView` with static CSS and a `data-type` root.

### Release notes and the upcoming section

`src/shared/guides/release-notes.ts` is the US-1366 selector used by `GuidesNode`. Its current
signature is `selectReleaseNotes(content, version)`, and its verified behavior prefers
`## Version <version> (Upcoming)` before `## Version <version>`. About uses this selector rather
than re-deriving version-section boundaries.

US-1367 makes an additive change to that helper: an optional `includeUpcoming` option, defaulting
to current behavior so `GuidesNode` is unchanged. About passes
`includeUpcoming: import.meta.env.DEV || showAgentGuides`. `import.meta.env.DEV` is the renderer's
existing Vite development-build discriminator; the source already uses it for development-only
settings and diagnostics. Packaged builds use false. Thus `(Upcoming)` is visible in dev, or in a
packaged build only after the same Show agent guides toggle is enabled.

The contents view loads `getGuidePage("whats-new")`, passes its front-matter-stripped `content`
and `app.version` to `selectReleaseNotes`, and shows a bounded headline projection. “Headline
entries” means each `###` subsection heading in the selected section followed by the first three
Markdown bullet entries in that subsection; a wrapped bullet displays its first source line. This
is at most three entries per subsection, not an arbitrary character truncation. “View full What's
New” opens `persephone-guide://whats-new` in the right pane, so remaining bullets and complete
history remain reachable in-app. The inline projection preserves the selector-returned
`## Version <version>` heading, including `(Upcoming)`, so an upcoming section is visibly
self-labelled; it does not strip that heading. If no allowed current-version section exists, show the selector's
existing no-notes result and still provide the full guide entry; never display hidden upcoming
notes in packaged default mode.

### Visual corrections

- The inline What's New projection strips inline Markdown into native text elements; it is explicitly
  not a Markdown renderer. Version and subsection markers become styled headings, while bullets are
  wrapped and ellipsized.
- Tree summaries sit immediately after their titles in the remaining row width, with the full value
  still available through the tooltip. Folders are collapsed by default so root-level guides remain
  visible; deeper folders expand on demand.
- The About card is top-aligned with the browser contents using the same outer top padding while
  retaining its existing max-width and horizontal centring.

### Resources routing

| Resource | Destination | Host |
|---|---|---|
| GitHub repository | `https://github.com/andriy-viyatyk/persephone` | External via `shell.openExternal()` |
| Issues | `https://github.com/andriy-viyatyk/persephone/issues` | External via `shell.openExternal()` |
| Boards catalogue | `persephone-guide://boards` | In-app guide pane |
| MCP setup | `persephone-guide://mcp-setup` | In-app guide pane |

Boards and MCP setup are guide pages in the shipped corpus, not external GitHub copies. The
existing About card keeps its two external buttons; Resources is an additional browser group.

### About data-name contract

`src/renderer/uikit/CLAUDE.md` requires UIKit primitives to emit `data-name` from their `name`
prop, and `doc/architecture/ui-element-contract.md` makes `data-name` the addressing contract.
The existing About views pass `name: "about-root"`, `"about-github"`, `"about-check-updates"`,
and `"about-report-issue"`; those names survive UIKit's render/update projection. US-1367 passes
new names through primitive props and never calls `setAttribute("data-name", ...)` or hand-writes
the attribute.

Names introduced by this task:

| Element | Name | Owner |
|---|---|---|
| Desktop split handle | `about-splitter` | `SplitterView` |
| Left card container | `about-card` | About view Panel |
| Right browser root | `about-guide-browser` | Browser view |
| Contents tree | `about-guide-tree` | `TreeView` |
| Show agent guides toggle | `about-show-agent-guides` | Controlled toggle primitive |
| What's New section | `about-whats-new` | Browser view |
| Full What's New action | `about-whats-new-open` | Browser view |
| Resources section | `about-resources` | Browser view |
| Repository resource | `about-resource-repository` | Resource action |
| Issues resource | `about-resource-issues` | Resource action |
| Boards resource | `about-resource-boards` | Resource action |
| MCP setup resource | `about-resource-mcp-setup` | Resource action |
| Guide-pane mount seam | `about-guide-page` | US-1368 handoff |

The names are stable handles only. CSS uses About-owned structural classes and existing
`data-type`/`data-part` markers, never `data-name` selectors. The `about-view` facade remains
US-1370; this task only names its future elements.

## Implementation Plan

### 1. Add runtime navigation state to the About editor

- Modify `src/renderer/editors/about/AboutEditor.ts`.
- Define the right-pane union:

  ```ts
  type AboutGuideLocation =
      | { kind: "contents" }
      | { kind: "guide"; path: string; fragment?: string };
  ```

- Add runtime-only state owned by `AboutEditor`, initialized to contents, empty history, and
  `showAgentGuides: false`. Keep it separate from the `AboutEditorState` given to `EditorModel`.
- Expose model actions for current location, history/back availability, toggle, opening a validated
  guide location while pushing the current location, and popping one history entry for Back. A
  failed/missing lookup leaves current/history unchanged; the view performs the shared-index lookup
  before the transition.
- Define the US-1368 history contract: contents → guide pushes contents; guide A → guide B pushes
  A; Back pops without pushing. A fragment belongs to the location for later anchor reveal.
- Add a reset method that restores contents, empty history, and false toggle without updating
  `this.state` or emitting persistence-worthy `descriptorChanged`.
- Do not change `AboutEditorState`, `getDefaultAboutEditorState()`, `skipSave`, `editorId`, or
  the existing `restore()` title reset.

Before:

  ```ts
  export class AboutEditor extends EditorModel<AboutEditorState> {
      readonly editorId = "about-view";
      skipSave = true;
      async restore(): Promise<void> { ... }
  }
  ```

After:

  ```ts
  export class AboutEditor extends EditorModel<AboutEditorState> {
      readonly editorId = "about-view";
      readonly guideBrowser = new AboutGuideBrowserState(); // runtime-only
      skipSave = true;
      resetGuideBrowser(): void { this.guideBrowser.reset(); }
      async restore(): Promise<void> { ... }
  }
  ```

The state primitive/class may remain co-located in `AboutEditor.ts`; it must stay framework-free
and must not be added to the persisted editor-state interface.

### 2. Define the explicit contents entry-point contract for US-1369

- US-1367 does not modify `src/renderer/api/pages/PagesLifecycleModel.ts` or reset from generic
  `showAboutPage()`; that method means “show About” and must preserve an existing browser location.
- Define the typed API contract for US-1369 as `showAboutPage(options?: { atContents?: boolean })`.
  The User Guide Menu Bar item and F1 fallback opt into `{ atContents: true }`; ordinary About,
  update-notification, and `pages.showAboutPage()` callers use the default and preserve state.
- US-1369 owns the implementation and its two callers. When `atContents` is true, it narrows the
  returned `page?.mainEditorInstance` with `instanceof AboutEditor` and calls the public
  `resetGuideBrowser()` method; no structural cast or silent optional no-op is permitted.
- Do not add an `app.settings` key. A restored About descriptor constructs a new editor, so after a
  restart runtime state starts at contents with the toggle off and empty history.

Before:

  ```ts
  showAboutPage = async (): Promise<void> => {
      await this.showEditorPage("about-view", async () =>
          (await import("../../editors/about")).ABOUT_PAGE_ID);
  };
  ```

US-1369's contract:

  ```ts
  showAboutPage = async (options?: { atContents?: boolean }): Promise<void> => { ... };
  ```

### 3. Split the About view while preserving the card

- Modify `src/renderer/editors/about/AboutView.ts`.
- Keep `AboutEditorView` as a native `VanillaView`; do not introduce React or a page/editor model
  inside the right pane. Continue requiring `AboutEditor` with the existing type guard.
- Change the root Panel from centered column to an About-owned split wrapper. Mount the existing
  card-building logic as the left pane with `name: "about-card"`; do not remove or rewrite the
  icon, version/runtime rows, update status, GitHub, or Report Issue behavior.
- Add and mount one `SplitterView` child with `name: "about-splitter"`, vertical orientation,
  controlled left width, `side: "before"`, bounds, and a stable `onChange` callback. Update it
  after width changes, following Menu Bar/Secondary Views. `SplitterView` imports its own
  co-located stylesheet.
- Add and claim the `AboutGuideBrowserView` child with the runtime state/actions and
  `name: "about-guide-browser"`. Dispose all new children through `VanillaView.child()`.
- Retain existing update-available, board-catalog, runtime-version subscriptions and disposal.
- Add `src/renderer/editors/about/AboutView.css` with static split/stacked rules. Use structural
  classes and existing spacing/color tokens; never use `data-name` as a selector.

### 4. Build contents from the existing index

- Add `src/renderer/editors/about/AboutGuideBrowserView.ts` as a framework-free native
  `VanillaView` (with a small co-located model only if async state crosses the simple-view
  threshold). It owns the contents projection and an empty typed guide-page mount seam; it does
  not render Markdown.
- Load `getGuideIndex().getTree(showAgentGuides ? "all" : "user")`. Use a request generation or
  equivalent liveness guard so an older toggle load cannot overwrite the current one. Caught
  failures use `errMessage(error, ...)`; notify-and-continue paths use `guard()`.
- Map shared `GuideTreeFolder`/`GuideTreePage` values into existing `TreeView` items without
  copying tree construction. Use path as stable value, title as label, children for hierarchy,
  and `renderTrailing` for a one-line summary. Set `rowHeight: 24`; constrain the summary with
  ellipsis and expose its complete value through the row tooltip. Folders expand; page rows invoke
  the guide-open action. Keep the tree keyboard-navigable and name it `about-guide-tree`.
- Use the existing controlled Checkbox/toggle primitive with `name: "about-show-agent-guides"`.
  Its value is runtime model state; changing it reloads the same index with `"all"`/`"user"`.
  Initial value is always false after reset/restart.
- Render What's New above the tree. Load `getGuidePage("whats-new")`, call shared
  `selectReleaseNotes()` with `app.version` and `includeUpcoming: import.meta.env.DEV ||
  showAgentGuides`, then project the first three bullet headlines per `###` subsection. Strip inline
  Markdown into styled native text elements; this projection is explicitly not a Markdown renderer.
  Preserve the
  selector-returned `## Version <version>` heading, including `(Upcoming)`, in the inline projection
  so the gated section announces itself. Do not call `findReleaseSection()` or duplicate section
  selection. Add `about-whats-new-open` to change location to `persephone-guide://whats-new`; the
  full history is reached in the guide page.
- Render Resources using the exact external/in-app routes above. Only repository/issues call
  `shell.openExternal()`. Boards/MCP use the same in-app guide-open callback as tree pages.
- Give root/sections/actions the names in the data-name table via `name` props, never hand-written
  attributes.

### 5. Define the US-1368 seam without implementing rendering

- A guide click changes runtime location to `{ kind: "guide", path }`; contents/resources/What's
  New use the same transition. The contents projection is replaced by a named guide-page mount
  region, but US-1367 creates no Markdown body and no user-facing placeholder text.
- Expose current location, back availability, `back()`, and the stable native host/name
  `about-guide-page`. US-1368 plugs in the guide-page view with path-derived breadcrumbs, the
  narrowed `MarkdownBodyView` host, guide-scheme and anchor navigation, Back consumption, and
  Open in tab. It owns all Markdown/page-host integration.
- US-1367 must not import `MarkdownBodyView`, instantiate `MarkdownEditor`/`PageModel`, add a
  second Markdown renderer, implement breadcrumbs, or implement Open in tab.

### 6. Verify live through Persephone MCP `call`

No unit tests, fixtures, or harnesses are added. The user verifies the running implementation via
the `persephone` MCP `call` tool:

- Open About with `pages.showAboutPage()` and inspect the live screen. Confirm unchanged left card,
  desktop vertical `about-splitter`, What's New, filtered tree summaries, and Resources.
- Confirm existing/new named elements and vertical separator semantics come from UIKit `name` props.
- Confirm default hides an agent-only page; toggle shows it; ordinary `pages.showAboutPage()` keeps
  the current location/toggle/history, while a restart creates fresh runtime state at contents with
  the toggle off and empty history. Verify US-1369's explicit `{ atContents: true }` entry points
  reset to contents.
- Confirm dev shows upcoming notes, packaged default hides them, and packaged toggle enables them.
  Confirm the inline projection retains the `(Upcoming)` heading, shows at most three bullet
  headlines per subsection, and full What's New opens in-app.
- Activate all resources: repository/issues external; boards/MCP in-app guide locations.
- Click a guide and inspect the browser state/history surface after US-1368's seam is present:
  contents → guide records contents, guide → guide records the prior guide, and Back pops only.
- Resize below the documented 760px narrow breakpoint and confirm stacked usable panes with a
  visible token-colored separator and no interactive vertical handle.
- Confirm no setting key, duplicate guide index/tree, Markdown renderer, or test harness was added.

## Concerns

- **The singleton finding is resolved by entry-point ownership.** `ABOUT_PAGE_ID` plus
  `showEditorPage()` deduplicates an existing About page, so generic `showAboutPage()` preserves
  browser state. US-1369's explicit `{ atContents: true }` User Guide/F1 entry points call the
  typed `AboutEditor.resetGuideBrowser()` after an `instanceof AboutEditor` check; a restart builds
  a fresh editor and naturally starts at contents.
- **The committed selector always prefers `(Upcoming)`.** That is the current main
  `guides.whatsNew` behavior, but it cannot satisfy the packaged-build rule by itself. The additive
  `includeUpcoming` option preserves main's default and gives About an explicit packaged choice;
  no local section selector is allowed.
- **Contents-to-page is intentionally incomplete here.** A click changes modeled location/history
  but has no Markdown body until US-1368 supplies the guide view. This task accepts the seam, not a
  placeholder rendering.
- **Async corpus loading** can race a toggle or disposal; generation/liveness checks and
  `errMessage`/`guard` handling are required.
- **Split width** is view-only. Do not persist it or add a setting without a later state decision.
- **Summary layout is deliberately fixed and single-line.** `TreeView` receives `rowHeight: 24`;
  the trailing summary is width-constrained and ellipsized, with the complete text in the tooltip.
- **US-1370 ownership:** this task names elements but does not add the `about-view` facade.

## Acceptance Criteria

- [ ] About is a native desktop two-pane view using existing `SplitterView`; the left card retains
      icon, product/version, runtime rows, update control/status, GitHub, and Report Issue behavior.
- [ ] Narrow windows use the documented `max-width: 760px` stacked layout with a token-colored separator and no
      unusable vertical drag handle.
- [ ] The right contents view uses the single renderer index and shared `GuideIndex.getTree()`;
      no duplicate parser/tree/index or main-process tree IPC exists.
- [ ] Default contents show `user`/`both` pages and summaries; agent pages require the toggle.
- [ ] Toggle is runtime About-editor browser state, not `app.settings`; ordinary
      `pages.showAboutPage()` preserves location/toggle/history, restart creates fresh
      false/contents/empty runtime state, and US-1369's explicit `{ atContents: true }` entry points
      reset to contents.
- [ ] What's New uses `src/shared/guides/release-notes.ts`, shows at most three bullet headlines
      per `###` subsection inline, preserves the selector's `(Upcoming)` heading, reaches the full
      in-app guide, and gates Upcoming by `import.meta.env.DEV || showAgentGuides`.
- [ ] Repository/issues use `shell.openExternal()`; boards/MCP use
      `persephone-guide://boards` and `persephone-guide://mcp-setup` in-app.
- [ ] Guide clicks update current location and push prior location; Back pops without pushing.
      The guide mount is a clean US-1368 seam with no Markdown renderer or placeholder here.
- [ ] Existing/new names come from `name` props; no hand-written `data-name`; facade remains
      US-1370.
- [ ] No hardcoded colors, React outside draw, or prohibited direct imports are introduced.
- [ ] No unit tests/harnesses are added; behavior is verified live through Persephone MCP `call`.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/about/AboutEditor.ts` | Runtime-only location/history/toggle state, actions, and reset; persisted state unchanged. |
| `src/renderer/editors/about/AboutView.ts` | Split card/browser, mount controlled splitter, preserve card, compose browser view. |
| `src/renderer/editors/about/AboutView.css` | New static desktop split and narrow stacked layout. |
| `src/renderer/editors/about/AboutGuideBrowserView.ts` | New native filtered tree, summaries, toggle, What's New, Resources, and US-1368 seam. |
| `src/shared/guides/release-notes.ts` | Additive upcoming-inclusion option; current main default preserved. |

### Files verified and intentionally not changed

| File/area | Reason |
|---|---|
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Generic `showAboutPage()` preserves browser state; US-1369 owns its typed `{ atContents?: boolean }` contract and explicit User Guide/F1 reset callers. |
| `src/renderer/guides/index.ts`, `guide-source.ts` | US-1366's single renderer index/source are consumed as-is. |
| `src/shared/guides/index.ts`, `front-matter.ts`, `guide-links.ts` | Existing tree/filter/parser/URL contracts are reused; no duplicate implementation. |
| `src/renderer/uikit/Splitter/SplitterView.ts`, `src/renderer/uikit/Splitter/Splitter.css`, and `src/renderer/uikit/Divider/DividerView.ts` | Existing splitter is reused; Divider remains the card rule. |
| `src/renderer/uikit/Tree/TreeView.ts`, `src/renderer/uikit/Tree/TreeModel.ts`, and `src/renderer/components/tree-provider/TreeProviderViewImpl.ts` | Existing Tree is reused; the file-tree provider is not forced onto the static corpus. |
| `src/renderer/theme/color.ts` and `src/renderer/theme/themes/` | Existing tokens cover split/separator; no token is missing. |
| `src/renderer/editors/markdown/MarkdownBodyView.ts`, `src/renderer/editors/markdown/MarkdownEditor.ts`, `src/renderer/editors/markdown/markdown-nav.ts`, and `src/renderer/editors/markdown/rehypeMarkdownOverrides.ts` | In-pane rendering/navigation is US-1368; this task defines only the state seam. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | The `about-view` facade is US-1370; this task only names elements. |
| `src/renderer/ui/sidebar/MenuBarView.ts` | User Guide/F1 entry points are US-1369; this task does not modify the Menu Bar. |
| `doc/active-work.md` | US-1367 dashboard entry already exists under EPIC-093; no entry is added or moved. |
| `assets/guides/**` | No guide prose or assets are changed. |
