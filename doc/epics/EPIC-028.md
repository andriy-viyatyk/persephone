# EPIC-028: Unified Editor Architecture — Editors as Standalone Models

## Status

**Status:** Design phase complete (2026-05-20). Ready for implementation planning.
**Created:** 2026-05-19

## Overview

Collapse the current two-tier editor system — content-views over `TextFileModel` versus standalone editors — into a single uniform architecture where every editor is a top-level `EditorModel`. Text-bearing editors compose an `IContentHost` and expose a `CONTENT_HOST_TRAIT` so any owner (the page, a notebook note, a future container) can switch editors by transferring the host. The dual-meaning `state.editor` field, the `category: "content-view" | "standalone"` registry flag, and the entire `ContentViewModel` / `ContentViewModelHost` / `useContentViewModel` subsystem are removed.

This epic ran a **design phase first**. The design phase completed 2026-05-20 — 28 walkthroughs resolved, 2 deferred (Graph and Draw, documented skip-rationale: structurally similar to walked Tier-5 editors; investigated first-principles during implementation). All architectural concerns logged in [`concerns.md`](EPIC-028-editor-architecture/concerns.md) are resolved. Mockups stabilized (last eight walkthroughs in a row produced zero mockup changes). Implementation planning is the next phase.

## Goals

- One `EditorModel` hierarchy. Every editor (Monaco, Grid, Link, Notebook, PDF, Browser, …) is a standalone subclass.
- `IContentHost` is the shared abstraction for text-bearing editors. Two concrete implementations: `TextFileModel` (file-backed) and `NoteItemEditModel` (notebook-note-backed). New implementations can be added without touching editor code.
- A `CONTENT_HOST_TRAIT` exposes `extractContentHost()` / `inheritContentHost(host)` on text-bearing editors. Editor switching is a host-ownership transfer — content, file path, modifications, I/O, encryption all survive untouched.
- Switching is owner-orchestrated. `PageModel.switchMainEditor` and notebook-level note switching both call the same helper. Editors don't switch themselves.
- Lifecycle hooks (`beforeNavigateAway`, `onMainEditorChanged`, `setPage`) work uniformly because every editor is a real `EditorModel`. The LinkEditor secondary-editor-survival bug resolves naturally.
- No backward compatibility with the current script API. Persistence is **not** migrated — EPIC-028 is a major-version breaking change; existing session data is detect-and-skipped on first launch of the new version. See [C2 in concerns.md](EPIC-028-editor-architecture/concerns.md).

## Non-Goals

- New editors. This is a refactor of existing editors only.
- New scripting capabilities. Facades are rewritten to match the new shape; no new APIs.
- Performance tuning. The new switch path may be marginally heavier than today's view-model swap; that's acceptable.

## Architecture

### Layered shape

```
EditorModel (base — uniform for every editor)
  ├─ MonacoEditor       (has CONTENT_HOST_TRAIT)
  ├─ GridEditor         (has CONTENT_HOST_TRAIT)
  ├─ MarkdownEditor     (has CONTENT_HOST_TRAIT)
  ├─ SvgEditor          (has CONTENT_HOST_TRAIT)
  ├─ HtmlEditor         (has CONTENT_HOST_TRAIT)
  ├─ MermaidEditor      (has CONTENT_HOST_TRAIT)
  ├─ LogEditor          (has CONTENT_HOST_TRAIT)
  ├─ LinkEditor         (has CONTENT_HOST_TRAIT + sidebar panels)
  ├─ NotebookEditor     (has CONTENT_HOST_TRAIT + sidebar panels + per-note embedded editors)
  ├─ TodoEditor         (has CONTENT_HOST_TRAIT + sidebar panels)
  ├─ RestClientEditor   (has CONTENT_HOST_TRAIT + sidebar panels)
  ├─ GraphEditor        (has CONTENT_HOST_TRAIT)
  ├─ DrawEditor         (has CONTENT_HOST_TRAIT)
  ├─ PdfEditor          (no trait)
  ├─ ImageEditor        (no trait)
  ├─ ArchiveEditor      (no trait + sidebar panel)
  ├─ VideoEditor        (no trait)
  ├─ BrowserEditor      (no trait)
  └─ AboutEditor / SettingsEditor / McpInspectorEditor / StorybookEditor / CompareEditor

IContentHost (interface — minimal)
  ├─ TextFileModel       (file-backed; owns I/O, encryption, script, pipe)
  ├─ NoteItemEditModel   (notebook-note-backed; lighter, no file I/O)
  └─ (future hosts)
```

### Trait

```ts
const CONTENT_HOST_TRAIT = TraitRegistry.register<IContentHostTrait>("content-host");

interface IContentHostTrait {
    extractContentHost(): IContentHost;     // detach — old editor must not dispose it
    inheritContentHost(host: IContentHost): void;
}
```

### Owner-side switch helper

```ts
async function switchEditorViaContentHost(
    oldEditor: EditorModel | null,
    newEditorId: string,
    swap: (newEditor: EditorModel) => Promise<void>,
): Promise<void> {
    const oldTrait = oldEditor?.traits.get(CONTENT_HOST_TRAIT);
    if (!oldTrait) return;
    const host = oldTrait.extractContentHost();
    const newEditor = await editorRegistry.createEditor(newEditorId);
    newEditor.traits.get(CONTENT_HOST_TRAIT)!.inheritContentHost(host);
    await swap(newEditor);
}
```

Called by `PageModel.switchMainEditor` for top-level switching and by a notebook for note-level embedded-editor switching. Same helper, two owners.

### Shared chrome

`TextChrome` is a React component that renders host-capability-aware UI (encryption padlock, save indicator, footer, script panel) given an `IContentHost`. Text-bearing editors compose it. Host capabilities (e.g., "is file-backed", "supports encryption", "supports scripts") surface either via additional sub-traits on the host or via interface checks — to be decided in the design phase.

### What goes away

- `ContentViewModel`, `ContentViewModelHost`, `useContentViewModel`, `createViewModel`, `getViewModelFactory`, `loadViewModelFactory`, `prepareViewModel`, `acquireViewModelSync`.
- The `editor` field on `IContentHostState`. The active editor is the model wrapping the host, not a property of the host.
- The `category` field on `EditorDefinition`.
- `detectedContentEditor` state field, scheduled-detection timer, and "open as X?" prompt UI. Content-based detection is absorbed into each editor's `accepts()` predicate inside `editorRegistry.findEditorsAccepting(host)` — predicates receive the host and can peek at content (e.g., `content.startsWith('{"type":"notebook"')`). Detection happens on-demand when the switch widget queries; no persistent detected-state.
- `TextEditorView` — replaced by a set of shared chrome components (`EditorPageView`, `PageToolbar`, `ScriptPanel`, `PageFooter`, `EditorOverlay`) that each editor view composes directly. No central chrome wrapper, no refs, no portals.
- Scripting facades' acquire/release pattern. `page.asGrid()` becomes `mainEditor instanceof GridEditor ? mainEditor : null`.

### What stays

- `PageModel`, `EditorModel` base, secondary editor system, content pipe system, trait system, `TextFileModel` as the file-backed `IContentHost` implementation, `NoteItemEditModel` as the notebook-note implementation.

## Design Phase

**Complete.** 2026-05-19 → 2026-05-20. The progress dashboard with full per-walkthrough resolution notes lives at [`EPIC-028-editor-architecture/progress.md`](EPIC-028-editor-architecture/progress.md). The concerns log lives at [`EPIC-028-editor-architecture/concerns.md`](EPIC-028-editor-architecture/concerns.md). The README + walkthrough template at [`EPIC-028-editor-architecture/README.md`](EPIC-028-editor-architecture/README.md).

### Approach (followed)

1. **Foundation mockups** — sketched the architectural primitives (`EditorModel`, `IContentHost`, traits, `editorRegistry`, `PageModel` switch, `TextFileModel`, `ComponentQueue`, `TOneState`, `PersistenceTypes`). Non-compiling TypeScript under [`EPIC-028-editor-architecture/mockups/`](EPIC-028-editor-architecture/mockups/). All nine foundation mockups landed before Tier-1 walkthroughs began.
2. **Page-core walkthroughs (Tier 1, 01–07)** — validated the foundation against page-level functionality. Tier-1 second pass at the end confirmed zero decision drift across walkthroughs 01–07.
3. **UI-surface walkthroughs (Tier 2, 08–10)** — page tabs, page toolbar, TextChrome.
4. **Special pages and cross-cutting (Tier 3 + Tier 4, 11–13)** — empty / well-known pages, scripting facades, MCP integration.
5. **Per-editor walkthroughs (Tier 5, 20–30)** — Monaco → Grid → Preview group → LogView → Link → Todo → RestClient → (Graph + Draw skipped) → Notebook → no-host group (Browser + Compare + Explorer in depth; other nine no-host editors deferred to implementation).
6. **Concerns logged in [`concerns.md`](EPIC-028-editor-architecture/concerns.md)** — resolutions captured in the same row. Initial C1–C9 set grew to ~25 concern blocks (L1–L7, S1–S10, N1–N7, P1–P10, M1–M10, CK1–CK10, GK1–GK10, B1–B3, T1–T10, PT1–PT10, TC1–TC11, EW1–EW10, SF1–SF10, MI1–MI10, MO1–MO10, GR1–GR10, PV1–PV10, LV1–LV10, LK1–LK10, TD1–TD10, RC1–RC10, NB1–NB10, NH1–NH10, CP1–CP5, EX1–EX10). All resolved or explicitly deferred.
7. **Iterated** until the last eight walkthroughs in a row (Grid → Preview group → LogView → Link → Todo → RestClient → Notebook → No-host group) produced zero mockup changes — the stability signal for moving to task planning.

### Walkthrough order (final)

Five tiers, evaluated in order:

| Tier | Topic | Walkthroughs | Status |
|------|-------|--------------|--------|
| 1 | Page core | 01 lifecycle, 02 main-editor swap, 03 secondary editors, 04 persistence, 05 multi-window, 06 compare, 07 grouped pages | All `[x]` |
| 2 | UI surfaces | 08 page tabs, 09 page toolbar, 10 TextChrome | All `[x]` |
| 3 | Special page shapes | 11 empty & well-known pages | `[x]` |
| 4 | Cross-cutting | 12 scripting facades, 13 MCP integration | All `[x]` |
| 5 | Editors | 20 Monaco, 21 Grid, 22 Preview group, 23 Log View, 24 Link, 25 Todo, 26 Rest Client, 29 Notebook, 30 No-host group (Browser + Compare + Explorer) | 9 `[x]` |
| 5 | Editors (skipped for design) | 27 Graph, 28 Draw | `[~]` SKIPPED — structurally similar to walked Tier-5 editors; investigated first-principles during implementation |

### Outcome

- **30 walkthroughs total:** 28 resolved (`[x]`), 2 deferred (`[~]`) with documented skip-rationale.
- **Foundation mockups stable** — last eight walkthroughs produced zero mockup edits. The Tier 5 template (state slice + queue unions + view + accepts + lifecycle overrides + persistence + optional overrides + CONTENT_HOST_TRAIT) carries cleanly across nine text-bearing editors, two host implementations (TextFileModel + NoteItemEditModel), two switch scopes (page-level + per-note), three sidebar topologies (sidebar-owning Link / non-sidebar-owning Grid-Todo-RC-Notebook / secondary-only Explorer), and three no-host shapes (page-mainEditor Browser / not-an-EditorModel Compare / secondary-only Explorer).
- **Five Tier-5 patterns standardized** — (1) per-editor cache file → descriptor.state consolidation (six instances); (2) self-write-guard flag (five instances); (3) three-site lifecycle split (five instances); (4) `leftPanelWidth`-equivalent silent-today-bug incidental fix (five instances); (5) `acquireViewModel` quartet retired across the entire codebase.
- **Two architectural reframings** — (a) walkthrough 24's "LK7 + LK8 recipe" reframed as two separable hooks by walkthrough 30 / EX5; (b) `EditorConstructorArgs.initialHost` reframed by walkthrough 29 / NB7 as canonical injection mechanism (supersedes C4's tentative `setContentHost()` separate-call shape), confirmed across two distinct embedding patterns by walkthrough 30 / NH4.

## Implementation Phases (rough sketch — to be detailed after design stable)

1. **Foundation** — add `traits` to `EditorModel` base, simplify `IContentHost`, register `CONTENT_HOST_TRAIT`, write `editorRegistry.createEditor` and `findEditorsAccepting`, write `switchEditorViaContentHost` helper.
2. **PageModel switch** — add `switchMainEditor`; render switch widget driven by trait presence.
3. **Editors, easiest first** — Monaco → Grid → previews → Log → Link → Todo → RestClient → Graph → Draw → Notebook (with embedded-editor refactor) → PDF → … each in its own task.
4. **`TextChrome` component** — refactored out of `TextEditorView`, consumed by all text-bearing editors.
5. **Cleanup** — delete `ContentViewModel`, `ContentViewModelHost`, `useContentViewModel`, `createViewModel`, `category` flag, `detectedContentEditor`, etc.
6. **Scripting** — rewrite facades; update `.d.ts`.
7. **Persistence breaking-change handling** — detect-and-skip old session data; per-page try/catch with `console.warn` on individual failures. No migration. Bump major version. Document in release notes.

## Concerns

The full concerns log — every architectural concern surfaced during the design phase with the resolution captured in the same row — lives at [`EPIC-028-editor-architecture/concerns.md`](EPIC-028-editor-architecture/concerns.md).

**State as of 2026-05-20:** Open section is empty. Resolved section contains all concern rows raised during the design phase, including the initial C1–C9 set (which formerly lived inline in this epic doc) and the larger set of per-walkthrough concerns (L1–L7, S1–S10, N1–N7, P1–P10, M1–M10, CK1–CK10, GK1–GK10, B1–B3, T1–T10, PT1–PT10, TC1–TC11, EW1–EW10, SF1–SF10, MI1–MI10, MO1–MO10, GR1–GR10, PV1–PV10, LV1–LV10, LK1–LK10, TD1–TD10, RC1–RC10, NB1–NB10, NH1–NH10, CP1–CP5, EX1–EX10). All rows resolved.

The initial C1–C9 entries moved to concerns.md during their walkthroughs and are no longer duplicated here; see concerns.md for the resolution text on each.

## Linked Tasks

*(none yet — to be planned after design phase)*

## Notes

### 2026-05-20 — design phase complete
- All 30 walkthroughs landed (`[x]` for 28; `[~]` SKIPPED for walkthroughs 27 Graph and 28 Draw with documented skip-rationale — structurally similar to walked Tier-5 editors; investigated first-principles during implementation).
- Last eight walkthroughs in a row (Grid → Preview group → LogView → Link → Todo → RestClient → Notebook → No-host group) produced **zero mockup changes** — stability signal for moving to task planning.
- Concerns log fully resolved — no open concerns at end of design phase.
- Foundation mockups stabilized at nine files (`IContentHost`, `traits`, `EditorModel`, `TextFileModel`, `editorRegistry`, `PageModel`, `ComponentQueue`, `TOneState`, `PersistenceTypes`).
- Tier 5 template proven across nine text-bearing editors + two host implementations + two switch scopes (page-level + per-note) + three sidebar topologies + three no-host shapes.
- Implementation planning is the next phase.

### 2026-05-19 — epic created
- Triggered by a duplicate-secondary-editor bug in `LinkEditor` that exposed the lack of lifecycle hooks on structured editors using plain `TextFileModel`.
- Initial architecture proposals (split into structured vs. content-view tiers; structured wrappers around `TextFileModel`) were rejected for not delivering "one architecture for all editors."
- Converged design: every editor is a standalone `EditorModel`; text-bearing editors compose `IContentHost` via `CONTENT_HOST_TRAIT`; switching is owner-orchestrated host-ownership transfer.
- Decision to enter a design phase before task planning, building mockups and per-editor walkthroughs first.
