# EPIC-028: Unified Editor Architecture — Editors as Standalone Models

## Status

**Status:** Active (Design phase)
**Created:** 2026-05-19

## Overview

Collapse the current two-tier editor system — content-views over `TextFileModel` versus standalone editors — into a single uniform architecture where every editor is a top-level `EditorModel`. Text-bearing editors compose an `IContentHost` and expose a `CONTENT_HOST_TRAIT` so any owner (the page, a notebook note, a future container) can switch editors by transferring the host. The dual-meaning `state.editor` field, the `category: "content-view" | "standalone"` registry flag, and the entire `ContentViewModel` / `ContentViewModelHost` / `useContentViewModel` subsystem are removed.

This epic enters its **design phase first**. Implementation tasks are not planned until per-editor mockups and walkthroughs stabilize.

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

This epic is in design first. Implementation tasks are not enumerated until the mockups stabilize.

### Approach

1. **Foundation mockups** — sketch the architectural primitives (`EditorModel`, `IContentHost`, traits, `editorRegistry`, `PageModel` switch, `TextFileModel`). Non-compiling TypeScript under [`EPIC-028-editor-architecture/mockups/`](EPIC-028-editor-architecture/mockups/). Done.
2. **Page-core walkthroughs** — validate the foundation against existing page-level functionality (lifecycle, swap, secondaries, persistence, multi-window, compare, grouping) **before** touching any editor. If the architecture doesn't hold up at the page level, fix the mockups first.
3. **UI-surface walkthroughs** — tabs, page toolbar, `TextChrome`.
4. **Special pages and cross-cutting** — empty / well-known pages, scripting facades, MCP integration.
5. **Per-editor walkthroughs** — easy → hard, each grounded in the contracts established by prior tiers.
6. **Concerns logged in [`concerns.md`](EPIC-028-editor-architecture/concerns.md)** — resolution captured in the same row.
7. **Iterate** until the last 2–3 walkthroughs produce zero mockup changes. That's the stability signal for moving to task planning.

### Walkthrough order

Full list and template live in [`EPIC-028-editor-architecture/README.md`](EPIC-028-editor-architecture/README.md). Five tiers, evaluated in order:

| Tier | Topic | Files |
|------|-------|-------|
| 1 | Page core | lifecycle, main-editor swap, secondary editors, persistence, multi-window transfer, compare mode, grouped pages |
| 2 | UI surfaces | page tabs, page toolbar, TextChrome |
| 3 | Special page shapes | empty pages, well-known pages |
| 4 | Cross-cutting | scripting facades, MCP integration |
| 5 | Editors | Monaco → Grid → previews → Log → Link → Todo → RestClient → Graph → Draw → Notebook → no-host editors |

Tiers 1–4 must produce a stable design before Tier 5 begins. Editor walkthroughs that surface foundation issues bounce back to the relevant Tier-1 walkthrough.

## Implementation Phases (rough sketch — to be detailed after design stable)

1. **Foundation** — add `traits` to `EditorModel` base, simplify `IContentHost`, register `CONTENT_HOST_TRAIT`, write `editorRegistry.createEditor` and `findEditorsAccepting`, write `switchEditorViaContentHost` helper.
2. **PageModel switch** — add `switchMainEditor`; render switch widget driven by trait presence.
3. **Editors, easiest first** — Monaco → Grid → previews → Log → Link → Todo → RestClient → Graph → Draw → Notebook (with embedded-editor refactor) → PDF → … each in its own task.
4. **`TextChrome` component** — refactored out of `TextEditorView`, consumed by all text-bearing editors.
5. **Cleanup** — delete `ContentViewModel`, `ContentViewModelHost`, `useContentViewModel`, `createViewModel`, `category` flag, `detectedContentEditor`, etc.
6. **Scripting** — rewrite facades; update `.d.ts`.
7. **Persistence breaking-change handling** — detect-and-skip old session data; per-page try/catch with `console.warn` on individual failures. No migration. Bump major version. Document in release notes.

## Open Concerns

Live concerns log lives at [`EPIC-028-editor-architecture/concerns.md`](EPIC-028-editor-architecture/concerns.md). The epic README links the active set; concerns close out as they're resolved during the design phase.

Initial set (will grow):

| # | Concern | Status |
|---|---------|--------|
| C1 | `TextChrome` host-capability discovery — `instanceof TextFileModel` vs. capability sub-traits like `IFileBacked`, `IEncryptable`, `IScriptable` on the host | **Resolved 2026-05-19** — instanceof; sub-traits rejected as YAGNI |
| C2 | Persistence migration for existing sessions (`type: "textFile" + editor: "link-view"` → new shape) | **Resolved 2026-05-19** — no migration; detect-and-skip + major-version bump |
| C3 | Monaco's `monaco.editor.ITextModel` (undo history) on switch — accept loss as today, or attach to `IContentHost` for survival across switches | **Resolved 2026-05-19** — keep current behavior (loss on switch); cross-editor undo deferred to future epic |
| C4 | `NoteItemEditModel` today implements `IContentHost` AND owns embedded view models — exactly how does it decompose in the new architecture | **Resolved 2026-05-19** — transient IContentHost; embedded editor is a standalone `EditorModel` wrapping it; initial host injection via `setContentHost(host)` (walkthrough 29 codifies the exact shape) |
| C5 | Where the embedded-editor switch widget renders inside a Notebook (per-note toolbar? floating?) | **Resolved 2026-05-19** — per-note; each NoteItem React component renders its own switch widget |
| C6 | Compare mode — currently a flag on `TextFileModel`. Where does it live now? | **Deferred to walkthrough 06** — host-level compare, valid only for grouped pages with two `TextFileModel` hosts; flag likely moves to page-pair / groupings level |
| C7 | `TextFileModel`'s `temp`, `restored`, `_pendingRevealLine`, `_pendingHighlightText`, `compareMode`, `detectedContentEditor` — which stay on the host, which move to specific editors, which go away | **Deferred 2026-05-19** — tentative: `temp` + `restored` stay; `_pendingRevealLine` + `_pendingHighlightText` → MonacoEditor (walkthrough 20); `compareMode` → walkthrough 06; `detectedContentEditor` deleted |
| C8 | The current `TextEditorView` hosts toolbar, script panel, footer, encryption padlock together. After split, which editors get which subset? | **Resolved 2026-05-19 (high-level)** — no refs / no portals / no wrapper; each editor view composes shared chrome components directly (`EditorPageView`, `PageToolbar`, `ScriptPanel`, `PageFooter`, `EditorOverlay`) which read `model`/`model.host` to decide what to render; layout details to walkthrough 10 |
| C9 | `IContentHost.stateStorage` placement — host or editor? | **Resolved 2026-05-19** — moved to `EditorModel`, keyed by `editor.id`; host receives via `setStorage()` on adoption; on switch the new editor copies the old's id so cache survives; cache cleanup is page-driven at "id release" moments (setMainEditor without id transfer, reconcileVisibility, PageModel.dispose) |

## Linked Tasks

*(none yet — to be planned after design phase)*

## Notes

### 2026-05-19 — epic created
- Triggered by a duplicate-secondary-editor bug in `LinkEditor` that exposed the lack of lifecycle hooks on structured editors using plain `TextFileModel`.
- Initial architecture proposals (split into structured vs. content-view tiers; structured wrappers around `TextFileModel`) were rejected for not delivering "one architecture for all editors."
- Converged design: every editor is a standalone `EditorModel`; text-bearing editors compose `IContentHost` via `CONTENT_HOST_TRAIT`; switching is owner-orchestrated host-ownership transfer.
- Decision to enter a design phase before task planning, building mockups and per-editor walkthroughs first.
