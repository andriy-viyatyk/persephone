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
  - [ ] US-432: Dialog component — new implementation + migration *(Phase 4, first)*
  - [ ] [US-452: About screen — UIKit migration](tasks/US-452-about-screen-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-455: MermaidView — UIKit migration](tasks/US-455-mermaid-view-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-456: SvgView — UIKit migration](tasks/US-456-svg-view-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-457: HtmlView — UIKit migration](tasks/US-457-html-view-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-458: ImageViewer — UIKit migration](tasks/US-458-image-viewer-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-459: BaseImageView — UIKit adoption](tasks/US-459-base-image-view-adoption/README.md) *(Phase 5 — adopt-in-place)*
  - [ ] [US-460: MarkdownSearchBar — UIKit migration](tasks/US-460-markdown-search-bar-migration/README.md) *(Phase 4 — per-screen migration)*
  - [ ] [US-461: Shared FindBar — consolidate MarkdownSearchBar + BrowserFindBar](tasks/US-461-shared-findbar-consolidation/README.md) *(Phase 4 — per-screen migration)*
  - [ ] US-462: TorStatusOverlay — UIKit migration *(Phase 4 — per-screen migration)*
  - [ ] US-463: BrowserDownloadsPopup + DownloadButton — UIKit migration *(Phase 4 — per-screen migration)*
  - [ ] US-464: UrlSuggestionsDropdown — UIKit migration *(Phase 4 — per-screen migration)*
  - [ ] US-465: CompareEditor — UIKit migration *(Phase 4 — per-screen migration)*
  - [ ] US-436: Script UI API — expose new component library to scripting engine *(Phase 6)*
  - [ ] US-435: Storybook — script tab for building and testing UI via scripts *(Phase 6)*

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
