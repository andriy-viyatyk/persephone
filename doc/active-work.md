# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-028** — [Unified Editor Architecture — Editors as Standalone Models](epics/EPIC-028.md) *(Design phase complete 2026-05-20 — 28/30 walkthroughs resolved, 2 deferred per documented skip-rationale; all concerns resolved; foundation mockups stable. Implementation planning is the next phase. See [`EPIC-028-editor-architecture/progress.md`](epics/EPIC-028-editor-architecture/progress.md))*
- *(no epic)*
  - [ ] US-493: Fix Explorer panel not refreshing on `navigateUp` / `makeRoot` — subscribe `ExplorerSecondaryEditor` to `model.state.use()` so `rootPath` is reactive
  - [ ] US-494: Fix Open Tabs list — clicking a current-window document page does not activate it. `OpenTabsList` was passing `mainEditor.state.id` (editor UUID) instead of `page.id` (page UUID), so `pagesModel.showPage()` lookup silently failed for any page with a `mainEditor`
  - [ ] US-510: Fix TreeProviderView chevron click also triggering row navigation — custom `renderItem` wired `onChevronClick={ctx.toggleExpanded}` directly, but `ctx.toggleExpanded` has signature `() => void` and never stops propagation, so the click bubbled up to Tree's row `onClick` and fired `onItemClick`. Wrapped to call `e.stopPropagation()` first.
  - [ ] US-528: Fix browser URL bar mangling `file://` URLs into `https://file///…` — `BrowserEditorModel.navigate()` only special-cased `http://`, `https://`, and `about:`, so pasting `file:///D:/...` got prepended with `https://`. Replaced the hardcoded list with a generic `^[a-z][a-z0-9+.-]*://` scheme check so any well-formed scheme (`file`, `chrome`, `app-asset`, `safe-file`, …) passes through unchanged.
  - [ ] US-527: Fix `http://localhost:<port>` link in markdown viewer replacing main window contents — `will-navigate` handler in `src/main/open-window.ts` allowed any `http://localhost*` URL with pathname `/` to navigate, intended only for the Vite dev server. Now allowed only when origin matches `MAIN_WINDOW_VITE_DEV_SERVER_URL`; other localhost links go through `eOpenUrl` like any external URL.
  - [ ] US-526: Fix external https link ignoring active browser-page profile — two bugs combined. (1) `resolvers.ts` `browserMode === "internal"` branch called `openUrlInBrowserTab` with `{ profileName: "" }`, hardcoding the search to profile-less pages instead of signalling "external reuse". Now passes `{ external: true }`. (2) `PagesLifecycleModel.openUrlInBrowserTab` matcher for `external === true` still constrained the reuse search to `browser-default-profile`; matcher now reuses any non-incognito/non-tor browser regardless of profile. New-page fall-through still uses `browser-default-profile`.
  - [ ] US-540: Fix LinkEditor left panels (Hostnames / Tags / Categories) + PinnedLinksPanel scroll overflow into the page chrome in browser blank-page host — every offending panel used `<Panel flex={1} overflow=…>` which translates to `flex: 1 1 auto`. With `flex-basis: auto`, basis reads the panel content's intrinsic height (sum of all rows) so the panel computed to a huge height and Chrome's flex implementation didn't reliably shrink. In the standalone editor the parent's `overflow: hidden` clipped the visible result; in the browser blank-page host the page-level scrollbar appeared instead, dragging the URL bar out of view. Added `height={0}` per the documented `feedback_uikit_panel_height_zero` UIKit Panel pattern: outer `<Panel flex={1}>` in `LinkHostnamesPanel`, `LinkTagsPanel`, `LinkCategoryPanel` (left CollapsiblePanelStack children) AND the inner `pinned-links-list` Panel in `PinnedLinksPanel` (column-flex child of the outer panel-stretched-via-align-items wrapper). The PinnedLinksPanel outer Panel did NOT need the fix because it's stretched via `align-items: stretch` in its row-flex parent; `height={0}` there would collapse it.
  - [ ] US-541: Fix UIKit `CategoryList` missing custom scrollbar styling — `CategoryList`'s `Root` styled.div had `overflow: auto` (intrinsic to the primitive) but never applied `className="scroll-container"`, so the native browser scrollbar appeared instead of the global VSCode-style fade-in scrollbar that the `.scroll-container` CSS rule paints. Surfaced during US-540 LinkEditor testing once the Hostnames panel started scrolling correctly. UIKit `Panel` auto-applies the class when its `overflow` prop is `"auto"`/`"scroll"` (see `Panel.tsx:403`); `Menu`'s `ListRoot` also hardcodes it. CategoryList's Root now hardcodes `className="scroll-container"` since its overflow is baked into the styled definition (same idiom as Menu). UIKit `Textarea` has the same gap (`overflow-y: auto` without the class) — flagged as a potential consistency follow-up.

## Planned
- **EPIC-027** — [Script-Driven UI and Custom Editors](epics/EPIC-027.md) *(carved out of EPIC-025 Phase 6; blocked on EPIC-025 close)*
  - [ ] US-436: Script UI API — expose new component library to scripting engine
  - [ ] US-435: Storybook — script tab for building and testing UI via scripts
  - [ ] US-544: Script-registered custom editor framework — registration, lifecycle, persistence *(placeholder — task spec TBD when epic starts)*
- **EPIC-022** — [LinkEditor Embedded Scripts](epics/EPIC-022.md)
  - [ ] US-396: Data model — `LinkScriptItem` type and `scripts` field in `LinkEditorData`
  - [ ] US-397: ScriptRunner — `runWithScope()` for custom context variable injection
  - [ ] US-398: LinkEditorScriptProvider — virtual IProvider backed by LinkViewModel
  - [ ] US-399: Resolver — handle `link-editor-script://` URL scheme
  - [ ] US-400: Scripts panel UI — collapsible panel with tree view in LinkEditor
  - [ ] US-401: Add/Edit Script dialog
  - [ ] US-402: Script execution engine — event matching and execution in LinkViewModel
  - [ ] US-403: Script types and facade for script API
- **EPIC-014** — [Claude AI Chat Panel](epics/EPIC-014.md)
  - [ ] US-385: Right panel slot in Pages.tsx layout
  - [ ] US-386: ClaudeChatModel + SDK integration (query, streaming, abort)
  - [ ] US-387: Chat UI — message list, input, markdown rendering
  - [ ] US-388: MCP auto-registration + page context injection
  - [ ] US-389: Conversation persistence + session resume
  - [ ] US-390: Settings: API key, model, system prompt
  - [ ] US-391: PowerShell shortcut (Ctrl+\`) — open shell at cwd
- **EPIC-011** — [Chrome Extension Support for Built-in Browser](epics/EPIC-011.md)
- *(no epic)*
  - [ ] US-347: CategoryView / CategoryEditor Breadcrumb
  - [ ] US-453: Storybook property editor — fix scroll when prop list exceeds panel height
  - [ ] [US-454: DrawIO Viewer — read-only viewer for `.drawio` files](tasks/US-454-drawio-viewer/README.md)


---

## How This Dashboard Works

### Structure

Each section (Active / Planned) lists epics as top-level items and tasks as sub-items:

```
- **EPIC-XXX** — [Title](epics/EPIC-XXX.md)
  - [ ] US-YYY: Task title
  - [x] US-ZZZ: Completed task title
- *(no epic)*
  - [ ] US-AAA: Standalone task
```

### Starting work

1. Move an epic or task from **Planned** to **Active**
2. Mark the task `[ ]` → `[x]` when done

### Completing a standalone task (no epic)

1. Mark task `[x]` in Active section
2. Move it to [`/doc/tasks/completed.md`](tasks/completed.md)
3. Remove from this dashboard

### Completing an epic

1. All tasks under the epic should be `[x]`
2. Move the entire epic block (with tasks) to [`/doc/epics/completed.md`](epics/completed.md)
3. Remove from this dashboard

### Creating new work

- **New epic:** Add to Planned with link to its doc in `/doc/epics/`
- **New task (with epic):** Add as sub-item under the epic
- **New task (standalone):** Add under `*(no epic)*`

### Task ID Format

`US-XXX` — sequential number. `EPIC-XXX` — sequential number.
