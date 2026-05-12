# US-522: UIKit `name` debug-attribute rollout across migrated screens

## Status

**Implemented — awaiting epic-close review.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 — comprehensive adoption of the [US-521](../US-521-uikit-name-debug-attribute/README.md) `name` prop across already-migrated surfaces.

All 10 phases applied. tsc + lint baselines unchanged (zero new errors). Skipped: `TreeProviderViewModel.tsx` (no JSX), `FolderItem.tsx` (per-row tooltip), `PageTab.tsx` row root (per-row, unique by data-type), per-row template elements in `NoteItemView`/`TodoItemView`/`NoteItemToolbar`. `Toolbar` primitive does not currently expose `name` — its `data-type="toolbar"` is unique per screen so naming it was deferred to a follow-up that extends `ToolbarProps`.

## Goal

Walk every migrated screen and assign meaningful `name="…"` props to its UIKit primitives so DevTools-driven debugging can disambiguate Panels, IconButtons, Splitters, Inputs, and other repeated primitives. This is opportunistic adoption that US-521 ships the *capability* for; US-515 demonstrated the *pattern*; this task extends that pattern to **everything else already on UIKit**.

After this task, every Panel/IconButton/Splitter/Input/Button/WithMenu/Spinner/Dot/Text rendered in a migrated surface that plays a debuggable role carries a `name` prop; the inspector reveals a clear `data-name="…"` on each one.

## Background

### Why this task exists

US-521 added optional `name?: string` to every UIKit primitive (emitted as `data-name` on the root). US-515 was the first migration to opportunistically adopt it. Everything else migrated before US-521 shipped (sidebar, page tabs, dialogs, settings, etc.) renders generic `<div data-type="panel">` / `<button data-type="icon-button">` chains that are very hard to tell apart in DevTools.

This task is **not** a code refactor — it doesn't change behavior, layout, or types. It adds optional `name` props at call sites.

### Authoring rules (from `src/renderer/uikit/CLAUDE.md`)

Every site that gets a name follows the same conventions:

- Use lowercase-kebab strings (`browser-toolbar-content`, `bookmarks-backdrop`).
- Namespace by surface so names don't clash globally (`settings-search-input`, not just `search-input` when other screens have search inputs).
- The `name` is a debug label — never used for styling or lookup-by-name. Cross-component selectors must still use stable `data-*` attributes (e.g. `data-url-bar`), not `data-name`.

### When to set / when to skip

**Set `name` when:**
- A `Panel` defines a layout region (toolbar, body, sidebar pane, footer, modal section, drawer, list container, etc.).
- An `IconButton` or `Button` represents a named action and is one of several in the same toolbar/row.
- A `Splitter`, `Input`, `Select`, `Tree`, `ListBox`, or other primitive appears more than once on the screen.
- A `Tooltip`, `Popover`, `WithMenu`, or `Menu` whose anchor type alone doesn't reveal its purpose.

**Skip `name` when:**
- A primitive is a trivial inline spacer (`<Panel flex={1} />`).
- The `data-type` alone uniquely identifies it (e.g. the only `<Spinner>` on a loading screen).
- A primitive is buried inside a list/grid row template — naming each row is noise, not signal.

### Inventory snapshot (2026-05-12)

- **83 files** in `src/renderer/` already import from UIKit.
- **37 files** still import legacy `components/{basic,form,layout,overlay}/` paths — those are out of scope (need full UIKit migration first via their own tasks).
- **6 files** today have any `name=` props: the 3 browser editor files from US-515 plus 3 programmatic/script files.

The 80 in-scope files break down into 7 phases below.

## Implementation plan

Each phase is an independent unit. Run them in **order 1 → 7** for best ROI (always-visible chrome first), but no hard dependencies between phases. Each phase stays `[ ]` in the dashboard per EPIC-025 deferred review.

For every phase the work is the same:

1. Open each file listed.
2. Walk the JSX tree top-down. For each UIKit primitive, decide using the "when to set / when to skip" rules above.
3. Add `name="<kebab-namespaced>"` immediately after `data-type` would appear in the rendered DOM (i.e. as the first or last prop on the primitive — pick one style and stick to it per file).
4. Run `npx tsc --noEmit` and `npm run lint` — there should be **zero new errors** since `name` is optional and typed `string`.
5. Smoke-test the surface in dev: open the screen, hit F12, confirm key panels/buttons carry distinguishable `data-name`.

Suggested names below are **starters** — they capture the obvious roles. Implementer should add more if a primitive matters and isn't listed; conversely, skip any starter that turns out to not exist anymore (codebase may have drifted).

---

### Phase 1 — App shell (always-visible chrome)

The chrome the user sees on every screen. Highest debug-ROI because these elements appear in *every* inspector session.

**Files (11):**
- `src/renderer/ui/sidebar/MenuBar.tsx`
- `src/renderer/ui/sidebar/FileList.tsx`
- `src/renderer/ui/sidebar/RecentFileList.tsx`
- `src/renderer/ui/sidebar/OpenTabsList.tsx`
- `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx`
- `src/renderer/ui/sidebar/ScriptLibraryPanel.tsx`
- `src/renderer/ui/sidebar/FolderItem.tsx`
- `src/renderer/ui/tabs/PageTabs.tsx`
- `src/renderer/ui/tabs/PageTab.tsx`
- `src/renderer/components/tree-provider/TreeProviderView.tsx`
- `src/renderer/components/tree-provider/TreeProviderViewModel.tsx`

**Suggested name namespaces:**

| File | Primitive role | Suggested `name` |
|---|---|---|
| `MenuBar.tsx` | menu-bar root container | `sidebar-menubar` |
| | each top-level menu trigger button | `menubar-file`, `menubar-edit`, etc. (use the menu's label as the suffix) |
| `FileList.tsx` | list container `Panel` | `sidebar-file-list` |
| | filter `Input` | `sidebar-file-filter` |
| | each toolbar `IconButton` | `file-list-up`, `file-list-refresh`, `file-list-new-folder`, … |
| | the `ListBox` | `sidebar-file-list-box` |
| `RecentFileList.tsx` | root list container | `sidebar-recent-list` |
| `OpenTabsList.tsx` | root `ListBox` | `sidebar-open-tabs` |
| `ToolsEditorsPanel.tsx` | tools `ListBox` | `sidebar-tools-list` |
| | each header `IconButton` | `tools-collapse-all`, `tools-expand-all`, etc. |
| `ScriptLibraryPanel.tsx` | root `Panel` | `sidebar-script-library` |
| | the "Set up library" `Button` | `script-library-setup` |
| `FolderItem.tsx` | `Tooltip` wrapping the row | `folder-item-tooltip` (skip if only used once per row — the row's data-type chain identifies it) |
| `PageTabs.tsx` | tabs strip root | `page-tabs` |
| | overflow menu `WithMenu` | `page-tabs-overflow-menu` |
| | each `Divider` between tab groups | skip — single-instance |
| `PageTab.tsx` | per-tab root | skip (`data-type="page-tab"` is unique per row; would be noise) |
| | close `IconButton` | `tab-close` |
| | menu `WithMenu` | `tab-context-menu` |
| `TreeProviderView.tsx` | root `Tree` | `tree-provider` (a generic name — overridden per host: bookmarks tree, file tree, etc. — but the host already wraps this with its own context; safe to keep generic) |

**Test surface:** Open the app; sidebar + page tabs always visible. F12, inspect each panel — every Panel/IconButton/Splitter at the top of the DOM tree should reveal its role from `data-name` alone.

---

### Phase 2 — Dialogs

All US-432 dialogs. Modal overlays are often nested (e.g. a confirmation dialog spawned by a settings dialog) and DevTools shows them stacked — naming reveals which is which.

**Files (6):**
- `src/renderer/ui/dialogs/ConfirmationDialog.tsx`
- `src/renderer/ui/dialogs/InputDialog.tsx`
- `src/renderer/ui/dialogs/PasswordDialog.tsx`
- `src/renderer/ui/dialogs/OpenUrlDialog.tsx`
- `src/renderer/ui/dialogs/TextDialog.tsx`
- `src/renderer/ui/dialogs/LibrarySetupDialog.tsx`

**Convention:** every `Dialog` root gets `name="<short-dialog-id>"`. The `DialogContent` inside it can stay unnamed (the parent's `data-name` already identifies it). Inner buttons get `name` only when there are multiple (e.g. confirmation has OK + Cancel — name them `confirm-ok`, `confirm-cancel`).

**Suggested names:**

| File | `name` on `<Dialog>` |
|---|---|
| `ConfirmationDialog.tsx` | `confirmation-dialog` |
| `InputDialog.tsx` | `input-dialog` |
| `PasswordDialog.tsx` | `password-dialog` |
| `OpenUrlDialog.tsx` | `open-url-dialog` |
| `TextDialog.tsx` | `text-dialog` |
| `LibrarySetupDialog.tsx` | `library-setup-dialog` |

Inside each, name the primary `Input`/`Textarea`/`RadioGroup`/`Checkbox` (`<dialog-id>-input`, `<dialog-id>-radio`, etc.) and the OK / Cancel buttons.

**Test surface:** Trigger each dialog (File → Open URL, ⌘+S over an unnamed file, etc.). F12, confirm each Dialog root has a unique `data-name`.

---

### Phase 3 — Top-level pages (Settings, About, Storybook)

Full-screen pages with many panels. The biggest naming wins per file.

**Files (7):**
- `src/renderer/editors/settings/SettingsPage.tsx`
- `src/renderer/editors/about/AboutPage.tsx`
- `src/renderer/editors/storybook/StorybookEditorView.tsx`
- `src/renderer/editors/storybook/ComponentBrowser.tsx`
- `src/renderer/editors/storybook/PropertyEditor.tsx`
- `src/renderer/editors/storybook/LivePreview.tsx`
- `src/renderer/editors/storybook/storyRegistry.ts` *(read-only — exports MenuItem-typed data; check if it renders or only declares; likely no rendering, skip)*

**Settings page conventions:**

| Primitive role | `name` |
|---|---|
| root | `settings-root` |
| left rail (categories) | `settings-categories` |
| right detail pane | `settings-detail` |
| search `Input` | `settings-search` |
| each category `ListBox`/`Tree` | `settings-categories-list` |
| each form `Panel` row | `settings-row-<setting-id>` (only for rows with multiple inputs; skip for single-line rows) |

**About page:** root → `about-root`; sections → `about-version`, `about-credits`, `about-links`.

**Storybook:**
- `StorybookEditorView.tsx` root → `storybook-root`; left rail wrap → `storybook-sidebar`; main pane → `storybook-main`.
- `ComponentBrowser.tsx` → `storybook-component-browser`.
- `PropertyEditor.tsx` → `storybook-property-editor`; per-prop row wrappers → `prop-<name>` only if multiple props share the same primitive type and would otherwise look identical.
- `LivePreview.tsx` → `storybook-live-preview`; the preview viewport `Panel` → `storybook-preview-viewport`.

**Test surface:** Open Settings (gear icon), About (Help → About), Storybook. Inspect each.

---

### Phase 4 — Browser overlays + shared FindBar

The browser surfaces split out of US-515. They're already on UIKit but predate US-521. Plus the shared `FindBar` used by browser + text editors.

**Files (5):**
- `src/renderer/editors/browser/UrlSuggestionsDropdown.tsx`
- `src/renderer/editors/browser/BrowserDownloadsPopup.tsx`
- `src/renderer/editors/browser/DownloadButton.tsx`
- `src/renderer/editors/browser/TorStatusOverlay.tsx`
- `src/renderer/editors/shared/FindBar.tsx`

**Suggested names:**

| File | Primitive role | `name` |
|---|---|---|
| `UrlSuggestionsDropdown.tsx` | root `Popover` | `url-suggestions` |
| | suggestions `ListBox` | `url-suggestions-list` |
| | "Clear visible" `Button` | `url-suggestions-clear` |
| `BrowserDownloadsPopup.tsx` | root `Popover` | `downloads-popup` |
| | each toolbar `IconButton` | `downloads-clear`, `downloads-open-folder`, etc. |
| `DownloadButton.tsx` | the trigger `IconButton` | `toolbar-downloads` |
| `TorStatusOverlay.tsx` | root `Panel` | `tor-overlay` |
| | close `IconButton` | `tor-overlay-close` |
| | retry `Button` | `tor-overlay-retry` |
| `FindBar.tsx` | root `Panel` | `find-bar` |
| | search `Input` | `find-input` |
| | prev/next/close `IconButton`s | `find-prev`, `find-next`, `find-close` |

**Test surface:** Open the browser editor, exercise URL bar suggestions, downloads popup, find bar; if a Tor session is configured, open the Tor overlay.

---

### Phase 5 — Text editor surfaces

The text editor is the default content surface — its toolbar and footer are always visible. Naming pays off heavily here.

**Files (4):**
- `src/renderer/editors/text/TextEditorView.tsx`
- `src/renderer/editors/text/TextToolbar.tsx`
- `src/renderer/editors/text/TextFooter.tsx`
- `src/renderer/editors/text/ScriptPanel.tsx`

**Suggested names:**

| File | Primitive role | `name` |
|---|---|---|
| `TextEditorView.tsx` | root `Panel` | `text-editor-root` |
| | toolbar host `Panel` (above editor) | `text-editor-toolbar-host` |
| | footer host `Panel` | `text-editor-footer-host` |
| | Monaco container `Panel` | `text-editor-monaco-host` |
| `TextToolbar.tsx` | root `Toolbar` | `text-toolbar` |
| | each named action `IconButton` | `text-format`, `text-run-script`, `text-save`, etc. (match the action) |
| `TextFooter.tsx` | root `Panel` | `text-footer` |
| | language `Button` / dropdown | `text-footer-language` |
| | encoding `Button` | `text-footer-encoding` |
| | line/col `Text` | `text-footer-position` |
| `ScriptPanel.tsx` | root `Panel` | `script-panel` |
| | each control row | `script-panel-controls` |

**Test surface:** Open any `.txt`/`.md`/`.js` file. Confirm the toolbar, footer, and (if open) script panel reveal named primitives.

---

### Phase 6 — Heavy editors (split into 6a-d)

Each heavy editor is its own phase to keep PRs small and testing scoped.

#### Phase 6a — Graph editor

**Files (8):**
- `src/renderer/editors/graph/GraphView.tsx`
- `src/renderer/editors/graph/GraphViewModel.ts` *(only `alertsBarModel` import — no rendering; verify and skip naming if no JSX)*
- `src/renderer/editors/graph/GraphDetailPanel.tsx`
- `src/renderer/editors/graph/GraphLegendPanel.tsx`
- `src/renderer/editors/graph/GraphExpansionSettings.tsx`
- `src/renderer/editors/graph/GraphTuningSliders.tsx`
- `src/renderer/editors/graph/GraphTooltip.tsx`
- `src/renderer/editors/graph/GraphContextMenu.ts` *(MenuItem type only — no rendering; skip)*

**Suggested namespace:** `graph-<role>`. Roots: `graph-root`, `graph-detail-panel`, `graph-legend`, `graph-expansion-settings`, `graph-tuning`, `graph-tooltip`. Each `Slider` inside `GraphTuningSliders.tsx` → `tuning-<param>` (e.g. `tuning-repulsion`, `tuning-link-distance`).

**Test surface:** Open a graph editor page; expand panels; hover nodes to see the tooltip.

#### Phase 6b — Notebook editor

**Files (6):**
- `src/renderer/editors/notebook/NotebookEditor.tsx`
- `src/renderer/editors/notebook/NoteItemView.tsx`
- `src/renderer/editors/notebook/ExpandedNoteView.tsx`
- `src/renderer/editors/notebook/TagsListView.tsx`
- `src/renderer/editors/notebook/category-tree.tsx` *(type-only ITreeItem — verify; likely skip)*
- `src/renderer/editors/notebook/note-editor/NoteItemToolbar.tsx`

**Suggested namespace:** `notebook-<role>`. Roots: `notebook-root`, `notebook-tags-list`, `notebook-expanded-note`, `notebook-note-toolbar`. `NoteItemView` row root → skip (one per row; would clutter).

**Test surface:** Open a notebook file; expand a note; toggle tag panels.

#### Phase 6c — MCP Inspector

**Files (7):**
- `src/renderer/editors/mcp-inspector/McpInspectorView.tsx`
- `src/renderer/editors/mcp-inspector/ToolsPanel.tsx`
- `src/renderer/editors/mcp-inspector/ResourcesPanel.tsx`
- `src/renderer/editors/mcp-inspector/ResourceContentView.tsx`
- `src/renderer/editors/mcp-inspector/PromptsPanel.tsx`
- `src/renderer/editors/mcp-inspector/ToolArgForm.tsx`
- `src/renderer/editors/mcp-inspector/ToolResultView.tsx`

**Suggested namespace:** `mcp-<role>`. Roots: `mcp-inspector-root`, `mcp-tools-panel`, `mcp-resources-panel`, `mcp-prompts-panel`, `mcp-tool-arg-form`, `mcp-tool-result`, `mcp-resource-content`. The 3-pane tabbed surface really benefits from naming here.

**Test surface:** Open MCP Inspector; switch between Tools/Resources/Prompts tabs; invoke a tool; view results.

#### Phase 6d — Video / Audio editor

**Files (5):**
- `src/renderer/editors/video/VideoPlayerEditor.tsx`
- `src/renderer/editors/video/VPlayer.tsx`
- `src/renderer/editors/video/AudioPlayer.tsx`
- `src/renderer/editors/video/AudioControls.tsx`
- `src/renderer/editors/video/AudioVisualizer.tsx`

**Suggested namespace:** `video-<role>` / `audio-<role>`. Roots: `video-player`, `vplayer-root`, `audio-player`, `audio-controls`, `audio-visualizer`. Each control button in `AudioControls` → `audio-play`, `audio-pause`, `audio-prev`, `audio-next`, `audio-volume`, `audio-mute`. Sliders → `audio-seek`, `audio-volume-slider`.

**Test surface:** Open an audio file (mp3) and a video file (mp4). Exercise play/pause/seek.

---

### Phase 7 — Lightweight editors (mechanical batch)

Small editor surfaces with a handful of primitives each. Group these into one PR if convenient — the per-file work is so small that splitting further adds overhead.

**Files (~20):**
- `src/renderer/editors/grid/GridEditor.tsx`
- `src/renderer/editors/grid/components/CsvOptions.tsx`
- `src/renderer/editors/grid/components/ColumnsOptions.tsx`
- `src/renderer/editors/todo/TodoEditor.tsx`
- `src/renderer/editors/todo/components/TodoItemView.tsx`
- `src/renderer/editors/todo/components/TodoListPanel.tsx`
- `src/renderer/editors/archive/ArchiveEditorView.tsx`
- `src/renderer/editors/archive/ArchiveSecondaryEditor.tsx`
- `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx`
- `src/renderer/editors/explorer/SearchSecondaryEditor.tsx`
- `src/renderer/editors/category/CategoryEditor.tsx`
- `src/renderer/editors/draw/DrawView.tsx`
- `src/renderer/editors/pdf/PdfViewer.tsx`
- `src/renderer/editors/image/ImageViewer.tsx`
- `src/renderer/editors/svg/SvgView.tsx`
- `src/renderer/editors/html/HtmlView.tsx`
- `src/renderer/editors/mermaid/MermaidView.tsx`
- `src/renderer/editors/compare/CompareEditor.tsx`
- `src/renderer/editors/shared/BaseImageView.tsx`
- `src/renderer/editors/link-editor/EditLinkDialog.tsx` *(dialog, but lives next to link-editor; group here so dialogs phase isn't bloated)*

**Convention:** every editor's root `Panel` gets `name="<editor>-root"` (e.g. `grid-editor-root`, `pdf-viewer-root`, `archive-root`). Each toolbar `IconButton` → `<editor>-<action>` (e.g. `grid-add-row`, `pdf-zoom-in`, `image-rotate`). Secondary editors (Archive/Explorer/Search secondary) → `<surface>-secondary` (e.g. `archive-secondary`, `explorer-secondary`, `search-secondary`).

**Test surface:** Open one file per editor type and inspect. This phase is best done with a checklist — file by file.

---

## Concerns

### C1 — Naming consistency across phases `[recommendation: kebab + namespace prefix]`

Risk: implementer A names `toolbar-back` in one phase, implementer B names `back-button` in another. **Resolution:** the **first** word of every name is the surface namespace (`sidebar-`, `settings-`, `mcp-`, `graph-`, `audio-`, `text-`, `find-`, etc.). The remaining words describe the role. This is already how US-515 named its primitives. Stick to it across phases.

### C2 — Don't over-name `[recommendation: accept skip rules]`

Naming every `<Panel flex={1} />` spacer adds noise without helping the inspector. The "when to skip" rules above are deliberately permissive — if a primitive's role is obvious from its `data-type` chain (e.g. a single `Spinner` on a loading screen, a `Panel` whose parent already has a unique name), skip it.

### C3 — Per-row template primitives `[recommendation: skip]`

`PageTab.tsx`, `NoteItemView.tsx`, `TodoItemView.tsx` etc. render one row per data item. Adding a `name` to the row's root `Panel`/`<div>` doesn't help — every row would share that name. **Resolution:** skip per-row roots; only name the *list container* and per-row buttons that are stateful (close, mute, more-menu).

### C4 — Files with no rendering `[recommendation: verify and skip]`

Some files in the inventory only import UIKit types (`type MenuItem`) or use `alertsBarModel` programmatically — they don't render UIKit primitives. Examples: `GraphContextMenu.ts`, `GraphViewModel.ts` (model only), `category-tree.tsx` (likely a type file), `storyRegistry.ts`. **Resolution:** open each, confirm no JSX rendering of UIKit primitives, skip.

### C5 — Unmigrated surfaces are out of scope `[recommendation: defer]`

The 37 files still importing `components/{basic,form,layout,overlay}/` are NOT in scope: log-view editor + items, link-editor + panels, rest-client editor, markdown editor, parts of `ui/app/` (`MainPage.tsx`, `Pages.tsx`, `AsyncEditor.tsx`), `PageNavigator.tsx`. They will adopt `name` opportunistically as they migrate via their own per-screen tasks (same pattern US-515 set).

### C6 — No type or behavior changes `[recommendation: verify in CI]`

Since `name` is optional and typed `string`, this task should produce **zero** new TypeScript or lint errors. Any error during a phase indicates a typo (forgot quotes, used a variable instead of a string literal, etc.). **Resolution:** every phase ends with `npx tsc --noEmit` + `npm run lint` — both should match baseline.

## Acceptance criteria

Per-phase (each phase has its own criteria):

- [ ] All files in the phase's file list have been opened and reviewed.
- [ ] Every primitive matching the "when to set" rules carries a `name` prop with a kebab-namespaced value.
- [ ] No primitive matching the "when to skip" rules has a `name` (avoid noise).
- [ ] `npx tsc --noEmit` shows no new errors vs. baseline.
- [ ] `npm run lint` shows no new errors vs. baseline.
- [ ] Manual smoke (per phase's "Test surface" section) passes — open the surface, F12, confirm key primitives have distinguishable `data-name`.

Phase-tracking checklist (each phase stays `[ ]` per EPIC-025 deferred review until user explicitly requests review):

- [ ] Phase 1 — App shell *(implemented — sidebar 7 + tabs 2 + tree-provider; FolderItem + RecentFileList + TreeProviderViewModel skipped per rules)*
- [ ] Phase 2 — Dialogs *(implemented — 6 dialogs; primary inputs + OK/Cancel buttons named)*
- [ ] Phase 3 — Top-level pages *(implemented — Settings root + view-file button; AboutPage root + buttons; Storybook root + body + 2 Splitters + 3 sub-panels; Storybook Toolbar deferred — needs name prop)*
- [ ] Phase 4 — Browser overlays + FindBar *(implemented — UrlSuggestions, DownloadsPopup, DownloadButton, TorStatusOverlay, FindBar)*
- [ ] Phase 5 — Text editor surfaces *(implemented — TextEditorView root + TextToolbar 5 IconButtons + SegmentedControl + TextFooter + ScriptPanel)*
- [ ] Phase 6a — Graph editor *(implemented — GraphView 7 toolbar IconButtons + Input; GraphDetailPanel root; GraphExpansionSettings root + 3 inputs; GraphTuningSliders root + 3 Sliders + Reset)*
- [ ] Phase 6b — Notebook editor *(implemented — NotebookEditor portal toolbar + body + Splitter + Tree; ExpandedNoteView 3 Panels + collapse button; TagsListView root + ListBox)*
- [ ] Phase 6c — MCP Inspector *(implemented — McpInspectorView root + connection bar + 3 panels (Tools/Resources/Prompts) with sidebars + splitters + action buttons)*
- [ ] Phase 6d — Video / Audio editor *(implemented — VideoPlayerEditor root + URL input + IconButtons; VPlayer root; AudioPlayer root; AudioControls with 4 IconButtons + Slider; AudioVisualizer effects switcher)*
- [ ] Phase 7 — Lightweight editors *(implemented — GridEditor + CsvOptions + ColumnsOptions; TodoEditor + TodoListPanel; Archive + Explorer + Search secondary editors; CategoryEditor; DrawView; PdfViewer; ImageViewer; SvgView; HtmlView; MermaidView; CompareEditor; EditLinkDialog; BaseImageView skipped per rules)*

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at EPIC-025 close per the epic's deferred review model.

## Files Changed

By phase (no behavior changes; `name` props added at call sites only):

| Phase | Files | Count |
|---|---|---|
| 1 | sidebar (7) + tabs (2) + tree-provider (2) | 11 |
| 2 | dialogs/ | 6 |
| 3 | settings + about + storybook | 7 |
| 4 | browser overlays + shared/FindBar | 5 |
| 5 | text editor surfaces | 4 |
| 6a | graph editor | up to 8 (some are type-only, skipped) |
| 6b | notebook editor | up to 6 |
| 6c | mcp-inspector | 7 |
| 6d | video editor | 5 |
| 7 | lightweight editors | ~20 |

## Dependencies

- **US-521** (UIKit `name` debug attribute) — **shipped**. Provides the prop on every primitive plus the CLAUDE.md rule. No other dependencies.
- Each phase is independent; no inter-phase ordering required, though phases 1–5 are ordered by inspector-frequency ROI.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Pattern source: [US-521 UIKit `name` debug attribute](../US-521-uikit-name-debug-attribute/README.md)
- Pattern demo: [US-515 Browser editor chrome migration](../US-515-browser-editor-chrome-migration/README.md) — first migration to fully apply `name` props
- Authoring rules: `src/renderer/uikit/CLAUDE.md` § "Debug naming via `data-name`"
