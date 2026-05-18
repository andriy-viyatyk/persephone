# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-025** — [Unified Component Library and Storybook Editor](epics/EPIC-025.md)
  - [x] US-437: Design system HTML — closed; exploration complete
  - [ ] [US-438: Pattern research — adopted patterns + component naming table](tasks/US-438-pattern-research/README.md) *(Phase 0)*
  - [ ] US-439: New components folder setup + CLAUDE.md *(Phase 1)*
  - [ ] US-426: Design tokens — spacing, sizing, border-radius, font-size constants *(Phase 1)*
  - [ ] [US-427: Layout primitives — Flex, HStack, VStack, Panel, Card, Spacer](tasks/US-427-layout-primitives/README.md) *(Phase 1)*
  - [ ] [US-440: Bootstrap component set — minimal components needed for Storybook](tasks/US-440-bootstrap-components/README.md) *(Phase 2)*
  - [ ] [US-434: Storybook editor — component browser, live preview, property editor](tasks/US-434-storybook-editor/README.md) *(Phase 3)*
  - [ ] [US-450: UIKit Toolbar — semantic landmark, roving tabindex, Storybook adoption](tasks/US-450-uikit-toolbar/README.md) *(Phase 3 polish)*
  - [ ] [US-451: UIKit layout refactor — unified Panel + Storybook lighthouse](tasks/US-451-uikit-panel-refactor/README.md) *(Phase 3 polish)*
  - [ ] [US-432: Dialog component — new implementation + migration](tasks/US-432-dialog-component/README.md) *(Phase 4, first)*
  - [ ] [US-466: UIKit Popover — overlay primitive](tasks/US-466-uikit-popover/README.md) *(Phase 4 — overlay infrastructure; blocks US-463)*
  - [ ] [US-467: UIKit Tooltip — overlay primitive](tasks/US-467-uikit-tooltip/README.md) *(Phase 4 — overlay infrastructure)*
  - [ ] [US-468: UIKit ListBox — virtualized list primitive](tasks/US-468-uikit-listbox/README.md) *(Phase 4 — list infrastructure; blocks US-464)*
  - [ ] [US-469: UIKit RadioGroup — selection primitive](tasks/US-469-uikit-radiogroup/README.md) *(Phase 4 — form infrastructure; blocks US-432 Phase 2)*
  - [ ] [US-470: UIKit Textarea — multi-line text input primitive](tasks/US-470-uikit-textarea/README.md) *(Phase 4 — form infrastructure; blocks US-432 Phase 4)*
  - [ ] [US-471: UIKit Input — start/end slots](tasks/US-471-uikit-input-slots/README.md) *(Phase 4 — form infrastructure; blocks US-472)*
  - [ ] [US-472: UIKit Select — searchable single-value combobox](tasks/US-472-uikit-select/README.md) *(Phase 4 — form infrastructure; blocked on US-471)*
  - [ ] [US-473: UIKit Popover — resizable mode](tasks/US-473-uikit-popover-resizable/README.md) *(Phase 4 — overlay infrastructure; follow-up to US-466)*
  - [ ] [US-474: UIKit PathInput — hierarchical-path autocomplete input](tasks/US-474-uikit-pathinput/README.md) *(Phase 4 — form infrastructure; blocks US-432 Phase 4)*
  - [ ] [US-475: UIKit Tag and TagsInput — pill primitive + tag-row composite](tasks/US-475-uikit-tag/README.md) *(Phase 4 — form infrastructure; blocks US-432 Phase 4)*
  - [ ] [US-452: About screen — UIKit migration](tasks/US-452-about-screen-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-455: MermaidView — UIKit migration](tasks/US-455-mermaid-view-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-456: SvgView — UIKit migration](tasks/US-456-svg-view-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-457: HtmlView — UIKit migration](tasks/US-457-html-view-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-458: ImageViewer — UIKit migration](tasks/US-458-image-viewer-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-459: BaseImageView — UIKit adoption](tasks/US-459-base-image-view-adoption/README.md) *(Phase 5 — adopt-in-place)*
  - [ ] [US-460: MarkdownSearchBar — UIKit migration](tasks/US-460-markdown-search-bar-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-461: Shared FindBar — consolidate MarkdownSearchBar + BrowserFindBar](tasks/US-461-shared-findbar-consolidation/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-462: TorStatusOverlay — UIKit migration](tasks/US-462-tor-status-overlay-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-463: BrowserDownloadsPopup + DownloadButton — UIKit migration](tasks/US-463-browser-downloads-migration/README.md) *(Phase 4 — per-screen migration; blocked on US-466)*
  - [ ] [US-464: UrlSuggestionsDropdown — UIKit migration](tasks/US-464-url-suggestions-dropdown-migration/README.md) *(Phase 4 — per-screen migration; blocked on US-468)*
  - [ ] [US-465: CompareEditor — UIKit migration](tasks/US-465-compare-editor-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-476: AlertsBar + AlertItem — UIKit migration](tasks/US-476-alerts-bar-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-477: Progress dialog — UIKit migration](tasks/US-477-progress-dialog-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-481: UIKit Menu + WithMenu](tasks/US-481-uikit-menu-with-menu/README.md) *(Phase 4 — UIKit primitive)*
  - [ ] [US-484: UIKit ListBox extensions — row tooltip, context menu, predicate selection, section rows](tasks/US-484-uikit-listbox-extensions/README.md) *(Phase 4 — list infrastructure; blocks US-479)*
  - [ ] [US-485: UIKit Tree — virtualized expand/collapse tree primitive](tasks/US-485-uikit-tree/README.md) *(Phase 4 — list infrastructure)*
  - [ ] [US-488: UIKit Tree extensions — drag-and-drop via traits](tasks/US-488-uikit-tree-dnd/README.md) *(Phase 4 — list infrastructure; blocked on US-485)*
  - [ ] [US-489: UIKit Tree extensions — lazy children loading](tasks/US-489-uikit-tree-lazy-load/README.md) *(Phase 4 — list infrastructure; blocked on US-485)*
  - [ ] [US-486: UIKit Splitter — resizable divider primitive](tasks/US-486-uikit-splitter/README.md) *(Phase 4 — layout infrastructure)*
  - [ ] [US-487: UIKit model-view migrations — Select, Menu, Popover, PathInput](tasks/US-487-uikit-model-view-migrations/README.md) *(Phase 4 — UIKit primitive cleanup; 4 phases)*
  - [ ] [US-478: PageTabs / PageTab — UIKit migration](tasks/US-478-page-tabs-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-479: FileList + RecentFileList — UIKit migration](tasks/US-479-filelist-migration/README.md) *(Phase 4 — per-screen migration; implemented in commit `082f974` (sidebar bundle) — awaiting user testing + epic-close review)*
  - [ ] [US-490: OpenTabsList — UIKit migration](tasks/US-490-opentabslist-migration/README.md) *(Phase 4 — per-screen migration; implemented in commit `082f974` (sidebar bundle) — awaiting user testing + epic-close review)*
  - [ ] [US-491: FolderItem + MenuBar left list — UIKit migration](tasks/US-491-folderitem-migration/README.md) *(Phase 4 — per-screen migration; implemented in commit `082f974` (sidebar bundle) — awaiting user testing + epic-close review)*
  - [ ] [US-495: ScriptLibraryPanel — UIKit migration](tasks/US-495-scriptlibrarypanel-migration/README.md) *(Phase 4 — per-screen migration; implemented in commit `082f974` (sidebar bundle) — awaiting user testing + epic-close review)*
  - [ ] [US-496: ToolsEditorsPanel — UIKit migration](tasks/US-496-toolseditorspanel-migration/README.md) *(Phase 4 — per-screen migration; implemented in commit `082f974` (sidebar bundle) — awaiting user testing + epic-close review)*
  - [ ] [US-497: TreeProviderView — UIKit Tree migration](tasks/US-497-treeproviderview-migration/README.md) *(Phase 4 — shared component; implemented in commit `082f974` (sidebar bundle) — awaiting user testing + epic-close review; `TreeProviderView` flipped from legacy `components/TreeView` to UIKit `Tree` + `TREE_ITEM_KEY` trait set; unblocks US-532 deletion of `components/TreeView/`)*
  - [ ] [US-492: Sidebar — final integration testing and cleanup](tasks/US-492-sidebar-integration-testing/README.md) *(Phase 4 — per-screen migration; implemented in commit `082f974` (sidebar bundle) — awaiting user testing + epic-close review)*
  - [ ] [US-480: MarkdownView — UIKit migration](tasks/US-480-markdown-view-migration/README.md) *(Phase 4 — per-screen migration; plan ready for review; bundles Minimap relocation to `uikit/Minimap/` per US-532 delegation)*
  - [ ] [US-503: UIKit `Dot` primitive — colored circle for status / swatch / palette](tasks/US-503-uikit-dot/README.md) *(Phase 4 — UIKit primitive infrastructure; plan ready for review; primitive only — per-screen retrofits live in US-498/US-499/US-502; unblocks US-498)*
  - [ ] [US-498: Settings page — UIKit migration](tasks/US-498-settings-page-migration/README.md) *(Phase 4 — per-screen migration; plan ready for implementation; US-503 Dot primitive in place)*
  - [ ] [US-504: UIKit ghost variants + hover-reveal pattern](tasks/US-504-uikit-ghost-and-hover-reveal/README.md) *(Phase 4 — UIKit primitive infrastructure; plan ready for review; primitive only — per-screen retrofits live in US-499; unblocks US-499)*
  - [ ] [US-499: TodoEditor — UIKit migration](tasks/US-499-todoeditor-migration/README.md) *(Phase 4 — per-screen migration; plan ready for implementation; US-504 ghost variants + hover-reveal in place)*
  - [ ] [US-500: TextEditor chrome — UIKit migration](tasks/US-500-text-editor-chrome-migration/README.md) *(Phase 4 — per-screen migration; plan ready for implementation)*
  - [ ] [US-533: UIKit `Autocomplete` primitive — free-text input with suggestions dropdown](tasks/US-533-uikit-autocomplete/README.md) *(Phase 4 — UIKit primitive infrastructure; implemented — awaiting user testing + epic-close review; primitive only — per-screen retrofits live in US-501 + future Browser URL bar migration; unblocks US-501; tsc + lint baselines unchanged)*
  - [ ] [US-534: UIKit primitive extensions — `Text.color` free-form, `Textarea` width/flex, `Panel.dimmed`](tasks/US-534-uikit-primitive-extensions/README.md) *(Phase 4 — UIKit primitive infrastructure; implemented — awaiting user testing + epic-close review; primitive-only bundle; resolves US-501 Concerns B/C/F; unblocks US-501; tsc + lint baselines unchanged)*
  - [ ] [US-501: RestClient editor — UIKit migration](tasks/US-501-rest-client-migration/README.md) *(Phase 4 — per-screen migration; implemented — awaiting user testing + epic-close review; bundles Textarea `onKeyDown`/`onPaste` retrofit needed by the URL bar)*
  - [ ] [US-502: MCP Inspector — UIKit migration](tasks/US-502-mcp-inspector-migration/README.md) *(Phase 4 — per-screen migration; plan ready for review)*
  - [ ] [US-505: Archive editor — UIKit migration](tasks/US-505-archive-editor-migration/README.md) *(Phase 4 — per-screen migration; placeholder)*
  - [ ] [US-506: Category editor — UIKit migration](tasks/US-506-category-editor-migration/README.md) *(Phase 4 — per-screen migration; placeholder)*
  - [ ] [US-507: Explorer + Search secondary editors — UIKit migration](tasks/US-507-explorer-secondary-editors-migration/README.md) *(Phase 4 — per-screen migration; placeholder)*
  - [ ] [US-508: Draw editor — UIKit migration](tasks/US-508-draw-editor-migration/README.md) *(Phase 4 — per-screen migration; plan ready for review)*
  - [ ] [US-509: Grid editor chrome — UIKit migration](tasks/US-509-grid-editor-chrome-migration/README.md) *(Phase 4 — per-screen migration; implemented in commit `e506c81` — awaiting user testing + epic-close review; chrome only — sub-component popovers `ColumnsOptions`/`CsvOptions` deliberately scoped out and tracked by US-542)*
  - [ ] [US-511: PDF Viewer — UIKit migration](tasks/US-511-pdf-viewer-migration/README.md) *(Phase 4 — per-screen migration; placeholder)*
  - [ ] [US-516: UIKit Breadcrumb primitive](tasks/US-516-uikit-breadcrumb/README.md) *(Phase 4 — UIKit primitive infrastructure; plan ready for review; primitive only — per-screen retrofits live in US-512 + future LinkEditor migration; unblocks US-512)*
  - [ ] [US-517: UIKit CollapsiblePanelStack primitive](tasks/US-517-uikit-collapsible-panel-stack/README.md) *(Phase 4 — UIKit primitive infrastructure; plan ready for review; primitive only — per-screen retrofits live in US-512 + future LinkEditor migration + opportunistic PageNavigator; unblocks US-512)*
  - [ ] [US-512: Notebook editor — UIKit migration](tasks/US-512-notebook-editor-migration/README.md) *(Phase 4 — per-screen migration; plan ready for implementation — US-516 Breadcrumb and US-517 CollapsiblePanelStack delivered)*
  - [ ] [US-519: UIKit primitive additions for Graph editor migration](tasks/US-519-uikit-graph-editor-precursors/README.md) *(Phase 4 — UIKit primitive infrastructure; plan ready for review; bundles Slider primitive + IconButton.strikethrough + Text link variant; unblocks US-513)*
  - [ ] [US-513: Graph editor — UIKit migration](tasks/US-513-graph-editor-migration/README.md) *(Phase 4 — per-screen migration; plan ready; blocked on US-519 precursors; scope expanded to include GraphLegendPanel)*
  - [ ] [US-520: UIKit primitive additions for Video / Audio editor migration](tasks/US-520-uikit-video-editor-precursors/README.md) *(Phase 4 — UIKit primitive infrastructure; plan ready for review; bundles Slider.showProgress + IconButton.variant="chip"; unblocks US-514)*
  - [ ] [US-514: Video / Audio Player editor — UIKit migration](tasks/US-514-video-audio-player-migration/README.md) *(Phase 4 — per-screen migration; plan ready; blocked on US-520 precursors)*
  - [ ] [US-521: UIKit `name` debug attribute for all primitives](tasks/US-521-uikit-name-debug-attribute/README.md) *(Phase 4 — UIKit primitive infrastructure; implemented — awaiting epic-close review; adds optional `name` prop emitting `data-name` on every primitive's root + uikit/CLAUDE.md rule for new components; opportunistic adoption during per-screen migrations)*
  - [ ] [US-515: Browser editor chrome — UIKit migration](tasks/US-515-browser-editor-chrome-migration/README.md) *(Phase 4 — per-screen migration; implemented — awaiting epic-close review; first migration to adopt US-521 `name` prop opportunistically; tsc + lint baselines unchanged)*
  - [ ] [US-522: UIKit `name` debug-attribute rollout across migrated screens](tasks/US-522-uikit-debug-naming-rollout/README.md) *(Phase 4 — comprehensive `name` adoption across migrated files; implemented — awaiting epic-close review; all 10 phases done (1 app shell, 2 dialogs, 3 top-level pages, 4 browser overlays + FindBar, 5 text editor, 6a-d heavy editors, 7 lightweight editors); tsc + lint baselines unchanged)*
  - [ ] [US-523: LinkEditor — UIKit migration](tasks/US-523-link-editor-migration/README.md) *(Phase 4 — per-screen migration; implemented — awaiting user testing + epic-close review; adds `uikit/CategoryList` primitive + `uikit/Input` `tone="accent"` prop; all 12 files in `editors/link-editor/` purged of legacy basic|form|layout|overlay imports and `@emotion/styled`; tsc + lint baselines unchanged)*
  - [ ] [US-529: UIKit ProgressBar primitive — inline linear progress](tasks/US-529-uikit-progress-bar/README.md) *(Phase 4 — UIKit primitive infrastructure; plan ready for review; primitive only — consumed by US-524; unblocks US-524)*
  - [ ] [US-524: LogView editor — UIKit migration](tasks/US-524-log-view-editor-migration/README.md) *(Phase 4 — per-screen migration; plan ready for implementation; blocked on US-529 ProgressBar precursor; concerns resolved; ~17 files including all script-runtime dialog + output item views; high-risk surface — script API consumer; includes inline `Panel.accent` extension)*
  - [ ] [US-525: App shell + PageNavigator — chrome migration](tasks/US-525-app-shell-chrome-migration/README.md) *(Phase 4 — per-screen migration; implemented — awaiting user testing + epic-close review; MainPage / Pages / AsyncEditor / PageNavigator migrated to UIKit `IconButton` / `Panel` / `Splitter` / `Spinner` / `CollapsiblePanelStack`; `EditorErrorBoundary` relocated to `ui/app/`; fulfils US-517 opportunistic PageNavigator retrofit; tsc + lint baselines unchanged)*
  - [ ] [US-530: Editor base shared chrome — UIKit migration](tasks/US-530-editor-base-chrome-migration/README.md) *(Phase 4 — per-screen migration; implemented in commit `7746de8` — awaiting user testing + epic-close review; `editors/base/EditorError` + `EditorToolbar` migrated; public API preserved)*
  - [ ] [US-531: `showPopupMenu` — UIKit Menu migration](tasks/US-531-show-popup-menu-migration/README.md) *(Phase 4 — per-screen migration; implemented in commit `6e3f332` — awaiting user testing + epic-close review; `ui/dialogs/poppers/showPopupMenu.tsx` + `types.ts` flipped to UIKit Menu + added Menu forwardRef)*
  - [ ] [US-535: `MenuItem` caller-import flips](tasks/US-535-menuitem-import-flips/README.md) *(Phase 4 — overlay infrastructure cleanup; implemented in commit `f7aa6a6` — awaiting user testing + epic-close review; remaining callers flipped from `components/overlay/PopupMenu` to `uikit/Menu`; shape-identical type swap)*
  - [ ] [US-536: `components/data-grid/` → `uikit/AVGrid/` migration](tasks/US-536-uikit-datagrid/README.md) *(Phase 4 — UIKit composite primitive; implemented — awaiting user testing + epic-close review; moved 29 files via `git mv` (history preserved); `FilterPoper.tsx` → `FilterPopover.tsx` renamed; added `name?: string` + dropped `className?: string` on `AVGridProps`; built `uikit/TruncatedText/` + `uikit/AVGrid/CellInput.tsx` + `uikit/AVGrid/CellSelect.tsx`; extended `uikit/Select` with `onEscape` callback (Phase 2 audit gap); rewrote `FilterBar` (Tag + IconButton), `FilterPopover` (Popover), `OptionsFilterContent` (MultiListBox built-in search + select-all); retargeted internal legacy imports inside `uikit/AVGrid/` (`basic/Button`→IconButton, `basic/CircularProgress`→Spinner, `basic/useHighlightedText`→`uikit/shared/highlight`, `basic/OverflowTooltipText`→TruncatedText, `overlay/PopupMenu MenuItem`→`uikit/Menu`, `form/utils beep`→new `core/utils/audio.ts`); flipped all 6 callers to `uikit` barrel; removed `export * from './data-grid'` from `components/index.ts`; tsc + lint baselines unchanged; grep clean — zero `components/data-grid` imports remaining)*
  - [ ] [US-538: UIKit `RenderGrid` — virtualization primitive promotion](tasks/US-538-uikit-rendergrid/README.md) *(Phase 4 — UIKit foundational primitive; implemented — awaiting user testing + epic-close review; **US-536 prerequisite #1**; relocated `components/virtualization/RenderGrid/` (7 files, ~2,150 LOC) to `uikit/RenderGrid/` via `git mv`; resolves UIKit `ListBox`/`Tree` cross-folder import smell; 24 consumer files flipped (6 UIKit internal + 9 external editor callers + 9 legacy `components/` consumers); adds `name?: string` + `data-type="render-grid"` per US-521/Rule 1; documents Rule 7 exemption for compositional `className`/`blockStyles`/`contentProps` slots; tsc + lint baselines unchanged; unblocks US-536 AVGrid migration AND US-532 deletion of `components/virtualization/`)*
  - [ ] [US-539: UIKit `MultiSelect` — multi-value selection primitive](tasks/US-539-uikit-multiselect/README.md) *(Phase 4 — UIKit primitive infrastructure; implemented — awaiting user testing + epic-close review; **US-536 prerequisite #2**; ships TWO primitives — `MultiListBox` (standalone: Input search + tri-state select-all + per-row checkbox over ListBox via renderItem; select-all targets currently-visible items only, preserving out-of-filter selections) and `MultiSelect` (thin Popover wrapper around MultiListBox, mirroring the existing ListBox/Select parallel); replaces legacy `form/ListMultiselect`; unblocks US-536 OptionsFilterContent)*
  - [ ] [US-537: RestClient `TreeView` → UIKit `Tree` flip](tasks/US-537-treeview-flip-restclient/README.md) *(Phase 4 — per-screen migration cleanup; implemented — awaiting user testing + epic-close review; single-file flip in `RestClientEditor.tsx` from `components/TreeView/` to UIKit `Tree` + `TREE_ITEM_KEY` trait set; mirrors `TreeProviderView` reference impl; preserves drag-drop, context menus, selection; carried forward from US-501 scope; unblocks US-532 deletion of `components/TreeView/`; tsc + lint baselines unchanged; grep clean — zero `components/TreeView` imports outside the folder)*
  - [ ] [US-542: Grid options popovers — `Popper` → UIKit `Popover` flip](tasks/US-542-grid-options-popover-flip/README.md) *(Phase 4 — overlay infrastructure cleanup; implemented — awaiting user testing + epic-close review; 2-file import swap in `editors/grid/components/{ColumnsOptions,CsvOptions}.tsx`; grep clean — zero `components/overlay/` imports remain via `from "components/..."` paths; tsc + lint baselines unchanged; unblocks US-532 deletion of `components/overlay/` once US-543 also lands)*
  - [ ] [US-543: KEEP folders — UIKit migration of legacy primitive consumers](tasks/US-543-keep-folders-uikit-migration/README.md) *(Phase 4 — per-screen migration; implemented — awaiting user testing + epic-close review; surfaced when US-532's first delete attempt broke tsc — KEEP folders use relative `../basic/`/`../overlay/` imports that the original Concern B grep missed; migrates 4 files: 2 trivial `MenuItem` type-flips in `tree-provider/{CategoryViewModel,TreeProviderViewModel}.tsx` + 2 per-screen UIKit migrations of `tree-provider/CategoryView.tsx` and `file-search/FileSearch.tsx` (TextField→Input with `tone="accent"` on FileSearch query, Button→IconButton, endButtons array→endSlot ReactNode conditional render); FileSearch styled-block `.text-field` color override removed since `tone="accent"` owns blue now; styled.div layout blocks retained under Rule 7's compositional-primitive exemption; tsc + lint baselines unchanged; KEEP-folder grep clean — zero `../basic/`/`../overlay/` imports remain in `file-search/` or `tree-provider/`; unblocks US-532 deletion of `components/basic/` + `components/overlay/`)*
  - [ ] [US-532: Final `components/` sweep — empty the legacy folder](tasks/US-532-legacy-components-removal/README.md) *(Phase 4 — last code task before EPIC-025 close; implemented — awaiting user testing + epic-close review; `git rm -r` removed all five primitive folders `components/{basic,form,layout,overlay,TreeView}/` (35 files) + `components/index.ts`; the four persephone-coupled folders `components/{icons,page-manager,file-search,tree-provider}/` remain in place per the agreed split; verification: Concern-B grep `from "[^"]*(components/|\.\./)(basic|form|layout|overlay|TreeView)/` returns zero matches outside intra-legacy references (all in deleted folders); tsc unchanged at 20-error baseline; lint unchanged at 20 errors / 853 warnings; `npm run dist` succeeded — Vite production build + NSIS installer + ZIP both produced; documentation explicitly out of scope per the plan — deferred to dedicated post-epic doc tasks)*
  - [ ] US-518: UIKit ListBox `selectionStyle="accent"` + Storybook left-panel migration — adds an `accent` selection-marker variant on `ListBox`/`ListItem` (3px blue left-edge stripe, matches `CollapsiblePanelStack` active panel; orthogonal to `variant`). Rewrites `ComponentBrowser` (Storybook left rail) to use `ListBox` with `variant="browse"` + `selectionStyle="accent"` so story names sit left-aligned instead of as centered block buttons. *(Phase 4 — UIKit primitive extension + per-screen migration)*
  - [ ] US-436: Script UI API — expose new component library to scripting engine *(Phase 6)*
  - [ ] US-435: Storybook — script tab for building and testing UI via scripts *(Phase 6)*
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
