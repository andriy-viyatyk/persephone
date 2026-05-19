# EPIC-028 — Editor Architecture Design Artifacts

Design-phase workspace for [EPIC-028](../EPIC-028.md).

**Live tracker:** [`progress.md`](progress.md) — flat checklist of every walkthrough we plan to do; mark as we go.

## Layout

```
EPIC-028-editor-architecture/
├── README.md            ← this file
├── concerns.md          ← live concerns log
├── mockups/             ← non-compiling TypeScript sketches of new classes/traits/helpers
└── walkthroughs/        ← page-core, UI-surface, and per-editor walkthroughs (one markdown per topic)
```

## Workflow

1. **Foundation mockups** — sketch the architectural primitives (`EditorModel`, `IContentHost`, `traits`, `editorRegistry`, `PageModel` switch, `TextFileModel`). Done (see [`mockups/`](mockups/)).
2. **Page-core walkthroughs first** — validate that the foundation supports existing page-level functionality (lifecycle, swap, secondaries, persistence, multi-window transfer, compare, grouping). The architecture must hold up under the core *before* we ever touch an editor.
3. **UI-surface walkthroughs** — tabs, toolbar, TextChrome.
4. **Special pages + cross-cutting** — empty/well-known pages, scripting facades, MCP integration.
5. **Editor walkthroughs** — one markdown file per editor, easy → hard, exercising what the prior tiers established.
6. **Concerns logged as they appear** — append rows to [`concerns.md`](concerns.md). Resolve in the same row when decided.
7. **Tier-end second pass** — at the end of each tier (especially Tier 1), revisit every walkthrough in the tier against the final mockup shape. Later walkthroughs in the tier may have invalidated earlier assumptions; the second pass catches that. Each walkthrough doc gets a "Second-pass review" section.
8. **Stable when the last 2–3 walkthroughs produce zero mockup changes** — design ready for implementation planning.

## Walkthrough order

### Tier 1 — Page core
1. `01-page-lifecycle.md` — create, restore, focus, close, dispose
2. `02-main-editor-swap.md` — view-switch vs. file-navigate paths
3. `03-secondary-editors.md` — PageNavigator, panel registration, lifecycle hooks
4. `04-persistence.md` — save/restore across app restart, edge cases (module not loaded yet)
5. `05-multi-window-transfer.md` — `PageDescriptor` IPC, cache-file preservation
6. `06-compare-mode.md` — pairing two text-bearing editors
7. `07-grouped-pages.md` — side-by-side layout

### Tier 2 — UI surfaces
8. `08-page-tabs.md` — tab strip, drag, pin, group, drag-out, compare
9. `09-page-toolbar.md` — page-level toolbar slot, switch widget
10. `10-text-chrome.md` — shared chrome (depends on C1 resolution)

### Tier 3 — Special page shapes
11. `11-empty-and-well-known-pages.md` — pages with no main editor, singletons

### Tier 4 — Cross-cutting
12. `12-scripting-facades.md` — `page.asX()` new shape
13. `13-mcp-integration.md` — MCP-created pages, `set_page_content`

### Tier 5 — Editors
20. `20-monaco.md`
21. `21-grid.md`
22. `22-preview-group.md` — markdown/svg/html/mermaid
23. `23-log.md`
24. `24-link.md`
25. `25-todo.md`
26. `26-rest-client.md`
27. `27-graph.md`
28. `28-draw.md`
29. `29-notebook.md` — note-level switching
30. `30-no-host-group.md` — PDF/Image/Archive/Video/Browser/Settings/About/McpInspector/Storybook/Compare

## Walkthrough template

### For Tier 1–4 (page core / UI surface / cross-cutting)

```markdown
# <topic> walkthrough

## What exists today
- File(s) involved, current responsibilities, key methods.

## What the new architecture needs to support
- Functional requirements (no regressions vs. today).

## How the foundation mockups handle this
- Map current behavior to new primitives. Reference specific mockup files.

## Gaps / required mockup changes
- Foundation gaps surfaced. Either patch the mockup or open a concern.

## Open questions
- Per-topic items flagged for later resolution.
```

### For Tier 5 (editors)

```markdown
# <EditorName> walkthrough

## State today
- Model class(es), view-model(s), what state each owns.

## State after refactor
- New EditorModel subclass — what state it owns.
- What lives on the IContentHost vs. on the editor itself.

## UI shape
- Toolbar, footer, sidebar panels, embedded chrome (TextChrome).

## Switch in / out
- What happens on `inheritContentHost` (parse content, subscribe, etc.).
- What happens on `extractContentHost` (unsubscribe but DON'T dispose the host).
- What `dispose()` cleans up.

## Lifecycle hooks
- Does it implement `beforeNavigateAway` / `onMainEditorChanged` / `setPage`? Why?

## Persistence
- What `getRestoreData` writes; what `applyRestoreData` reads.
- Migration shim from old session data (if needed).

## Scripting
- What the new facade looks like (or "no facade").

## Open questions
- Per-editor concerns flagged for later resolution.
```

## Foundation mockups (done)

| File | Purpose |
|------|---------|
| [`mockups/IContentHost.ts`](mockups/IContentHost.ts) | Simplified host interface |
| [`mockups/traits.ts`](mockups/traits.ts) | `CONTENT_HOST_TRAIT` + future capability sub-traits |
| [`mockups/EditorModel.ts`](mockups/EditorModel.ts) | Base class with `traits` field |
| [`mockups/TextFileModel.ts`](mockups/TextFileModel.ts) | Canonical `IContentHost` impl (file-backed) |
| [`mockups/editorRegistry.ts`](mockups/editorRegistry.ts) | Simplified registry — `createEditor`, `findEditorsAccepting` |
| [`mockups/PageModel.ts`](mockups/PageModel.ts) | `switchMainEditor` + `switchEditorViaContentHost` helper |

Editor-specific mockups (e.g., `MonacoEditor.ts`, `LinkEditor.ts`, `NotebookEditor.ts`) are written *during* their respective walkthroughs, not upfront, so each is grounded in the questions that walkthrough surfaces.
