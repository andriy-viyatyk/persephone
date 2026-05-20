# 10 — TextChrome walkthrough

Scope: the host-aware chrome that wraps text-bearing editors — `TextEditorView`'s remaining responsibilities after walkthrough 09 retired the toolbar pair (PT9), specifically the body-around-editor frame (focus + keyboard routing), the script panel (`ScriptPanel.tsx`), the footer row (`TextFooter.tsx` — script-toggle, encoding, editor footer slot), the overlay portal (`editor-overlay` div consumed by Notebook's expanded-note), and the text-host-specific toolbar contributions (Compare-with-left, Run-script, Run-all-script, Show-resources) that PT6–PT8 deferred here. Also resolves C1 (host-capability discovery via `instanceof TextFileModel` vs. `NoteItemEditModel`) and C8's final body (each editor's view composes shared chrome directly; no portal refs, no wrapper-of-editor frame).

**Out of scope** (own walkthroughs): the page-level toolbar host `<PageToolbar>` and switch widget (`09` — done); the NavPanel button (`09` — done, moved out of TextChrome per PT5 reframe); the tab strip (`08` — done); persistence of script panel state (`04` — done via `<editor.id>-script-panel.json` per C9); secondary editor panel headers (`03` — done); per-editor toolbar/footer contributions (Grid filter UI, Notebook stats footer, etc. — touched by their respective Tier 5 walkthroughs); the Monaco editor body itself + `hasTextSelection?()` override (`20`); per-note embedded editor switching (`29`).

Relationship to C8: lands the rest of "no portal refs, no chrome wrapper; each editor's view composes shared chrome directly" that walkthrough 09 started. After this walkthrough, the four portal refs (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`, `editorOverlayRef`) are all deleted from `TextEditorModel.ts` and `NoteItemEditModel.ts`; `TextEditorView.tsx` and `TextToolbar.tsx` cease to exist as separate components; each text-bearing editor's view renders `<TextChrome model>{editor.body}</TextChrome>` (or composes the chrome pieces directly) inline.

Relationship to C1: lands the host-capability-discovery resolution. `<TextChrome>` (or its sub-components) branches on `instanceof TextFileModel` to render the full chrome (script panel, encoding footer, Compare/Run/Show-resources buttons) vs. `instanceof NoteItemEditModel` to render the minimal chrome (per-note toolbar with Run-script, language selector, no script panel, no encoding footer, no overlay). A future third host type adds a new branch.

**Status:** Done (2026-05-20). All concerns TC1–TC11 resolved; two mockup adjustments landed — B1 (new `mockups/TextChrome.tsx` — single shared chrome wrapper with `toolbarContributions` + `footerContributions` slot props, host-instanceof branching internal) and B2 (optional `handleKeyDown?(e): void` added to `IContentHost` interface so the chrome's TC9 delegation is type-safe). B3 dropped (script panel stays host-owned per TC6 — no `EditorModel.script?` accessor needed). Real-code work for implementation: `TextEditorView.tsx` + `TextToolbar.tsx` + `TextFooter.tsx` + `ActiveEditor.tsx` + `NoteItemToolbar.tsx` all dissolve; the four portal refs fully retire across both `TextEditorModel` and `NoteItemEditModel` (toolbar pair retired by walkthrough 09; footer + overlay retired here); 13 text-bearing editors each export a React module composing `<TextChrome>` inline around their body; five editors' `createPortal(…, editorFooterRefLast)` blocks rewrite to pass JSX through `footerContributions` (Grid row count, Todo counts, Link status, Graph node count, Notebook note count); Notebook's expanded-note overlay relocates from page-level portal to inline composition over its own body; encrypted-content fallback to Monaco becomes a one-line per-editor view guard or a `<TextChrome>` short-circuit (exact placement decided in walkthrough 20). Walkthrough 10 closes Tier 2; Tier 3 (Special page shapes) begins next with walkthrough 11.

---

## What exists today

### `TextEditorView.tsx` — the chrome wrapper that survives walkthrough 09

After walkthrough 09 retires the top toolbar pair (the `<PageToolbar borderBottom><TextToolbar … /></PageToolbar>` block and its portal refs), `TextEditorView.tsx` still owns:

1. **Root `<Panel>`** — `name="text-editor-root"`, `direction="column"`, `flex={1}`, `height={0}`, `position="relative"`, `gap="xs"`, `tabIndex={0}`. Focusable container; absorbs keyboard input.
2. **Focus subscription** — `useEffect` subscribes to `pagesModel.onFocus`; when the page becomes active, refocuses the root after a 200ms delay (to outlive Monaco's own focus dance).
3. **Keyboard routing** — `onKeyDown={model.handleKeyDown}` on the root. Today's `model.handleKeyDown` delegates to `TextFileActionsModel.handleKeyDown` — Ctrl+S, Ctrl+Shift+S, F5, F2, etc.
4. **Body slot** — `restored ? <ActiveEditor model={model} /> : <Spacer />`. `ActiveEditor` reads `model.state.s.editor` and either renders `<TextEditor>` (Monaco) directly, falls back to `<TextEditor>` when `encrypted`, or wraps the chosen editor's module via `<AsyncEditor>`.
5. **`<ScriptPanel model>`** — collapsed-by-default script editor (Monaco-based; F5 to run; library save/load).
6. **Bottom `<PageToolbar borderTop>`** — wraps `<TextFooter model>` which renders the script toggle button, the encoding label, and the `editorFooterRefLast` portal slot for per-editor footer status (Grid row count, Notebook "N of M notes", etc.).
7. **Overlay div** — `<div ref={model.setEditorOverlayRef} className="editor-overlay" />`. A portal target for Notebook's expanded-note view.

Only `TextFileModel`-backed pages render this wrapper — `RenderEditor.tsx`'s `category === "content-view"` branch picks `<TextEditorView>` over `<AsyncEditor>` for the page's main editor. After walkthrough 09's PT4 collapses that branch to a single uniform `<AsyncEditor>` path, the wrapper no longer has a natural caller; each editor's loaded module would need to provide its own chrome composition.

### `TextToolbar.tsx` — the four text-host-specific buttons that survive walkthrough 09

After walkthrough 09 retires NavPanel (PT5 → `<PageToolbar>`'s auto-rendered slot), the toolbar pair (PT9 → inline children of `<PageToolbar>`), and the switch widget (PT2 → `<PageToolbar>`'s right-side slot), `TextToolbar.tsx` still owns:

- **Compare-with-left** (`text/TextToolbar.tsx:100-118`) — visible when the left grouped page is also a TextFileModel. Today calls `model.setCompareMode(true)` on both hosts; walkthrough 06 / CK4 retires that for `pagesModel.layout.enterCompareMode(page.id)`. Visibility predicate flips from inline `isTextFileModel(leftGroupedEditor)` to `pagesModel.query.canCompare(leftId, page.id)` per CK3.
- **Run-script** (`text/TextToolbar.tsx:120-134`) — visible when `isScriptLanguage(host.language)`. Calls `host.runScript()`.
- **Run-all-script** (`text/TextToolbar.tsx:135-146`) — visible additionally when the editor has a selection. Today reads `textVm?.state.s.hasSelection` (Monaco-only). Walkthrough 09 / B2 added `EditorModel.hasTextSelection?(): boolean` as an optional method; Monaco overrides.
- **Show-resources** (`text/TextToolbar.tsx:151-162`) — visible when `host.language === "html"`. Extracts resource links via `extractHtmlResources` and opens them via `pagesModel.openLinks`.

These four are the entire `TextChrome` toolbar contribution. Compare is host-pair-aware (needs grouped pair + both TextFileModel); Run / Run-all / Show-resources are pure host-content operations (read `host.content`).

### `TextFooter.tsx` — the script toggle + encoding + footer portal slot

`src/renderer/editors/text/TextFooter.tsx`:

- **Script toggle button** (`TextFooter.tsx:35-48`) — renders a label-only button ("script") that calls `model.script.toggleOpen`. Highlighted when the panel is open. Subscribes to `model.script.state.use(s => ({ open: s.open }))`.
- **`<Spacer />`** — flex push (note: today's TextFooter pushes the spacer right AFTER the script button, putting the footer portal + encoding label on the RIGHT side of the row).
- **Editor footer portal slot** (`TextFooter.tsx:50-60`) — `<div ref={model.setFooterRefLast} className="footer-portal-target" />` when `editor && editor !== "monaco"`. Today's portal target for Grid (row count), Todo (counts), Link (status), Graph (node count), Notebook (note count). The footer slot is rendered via `setFooterRefLast` on `TextFileModel` AND on `NoteItemEditModel` (the latter for per-note embedded editors that contribute footer status).
- **Encoding label** (`TextFooter.tsx:62-67`) — `<span>{encoding || "utf-8"}</span>`. Reads `host.encoding`. Always rendered.

### `ScriptPanel.tsx` — the embedded script editor

`src/renderer/editors/text/ScriptPanel.tsx`. A `<Panel>` with a `<Splitter>` at the top (drag to resize), a `<PageToolbar>` row (Run-script / Run-all / library Select / Save / Open-in-new-tab / Close), and a Monaco editor body. The panel's `open`/`height` state lives on `ScriptPanelModel` (a `TModel<ScriptPanelState>`) owned by `TextFileModel` as `model.script`. The panel only renders when `state.open === true`.

Today's host coupling: `ScriptPanelModel` constructor takes the `TextFileModel` directly. `model.script.handleKeyDown` covers F5 + Ctrl+S in script-mode keystrokes. `model.runRelatedScript(all?)` executes whichever script is currently in the panel against the host's content. `ScriptPanelModel.restore(id)` reads from the editor's cache file via `fs.getCacheFile(id, "script")` — per C9, keyed on `editor.id`.

The script panel is text-host-specific: NoteItemEditModel does NOT carry a `script` field; per-note embedded editors run scripts via `model.runScript()` directly (the note's content becomes the script's `page.content`), without a dedicated panel.

### `editor-overlay` div — Notebook's expanded-note hook

`TextEditorView.tsx:59`: `<div ref={model.setEditorOverlayRef} className="editor-overlay" />`. The div is absolutely positioned (via CSS class) inside the `position="relative"` root panel; consumers portal full-page content into it.

Today's single consumer: `NotebookEditor.tsx:293-306` portals an `<ExpandedNoteView>` into `model.editorOverlayRef` when `pageState.expandedNoteId` is set. The expanded-note view covers the notebook body while the user edits a single note in full-page mode.

The overlay is page-level (not per-note); only `TextFileModel` carries the ref. `NoteItemEditModel` doesn't expose an overlay.

### Cross-walkthrough touch points already known

- **Walkthrough 09 / PT4** — `RenderEditor` collapses to a single `<AsyncEditor>` path. TextEditorView no longer has a natural caller in the dispatch.
- **Walkthrough 09 / PT9** — `editorToolbarRefFirst` + `editorToolbarRefLast` retired; this walkthrough retires the remaining two (`editorFooterRefLast`, `editorOverlayRef`).
- **Walkthrough 09 / PT6, PT7, PT8** — Compare / Run / Run-all / Show-resources placement in TextChrome confirmed; this walkthrough decides the exact JSX shape.
- **Walkthrough 09 / B2** — `EditorModel.hasTextSelection?(): boolean` already on the mockup; Run-all gates on it.
- **Walkthrough 06 / CK3, CK4** — `pagesModel.query.canCompare(leftId, rightId)` + `pagesModel.layout.enterCompareMode(pageId)`. Compare button uses both.
- **Walkthrough 04 / C9** — script panel state persists via `<editor.id>-script-panel.json`. Survives switchFrom (id transfers).
- **Concerns log / C1** — `<TextChrome>` branches on host class. TextFileModel → full; NoteItemEditModel → minimal.
- **Concerns log / C7** — `_pendingRevealLine` / `_pendingHighlightText` migrate to MonacoEditor's ComponentQueue (S4 — walkthrough 20 territory). `<TextChrome>` doesn't carry them.
- **Concerns log / C8** — chrome refs deleted; shared components read `model` + `model.contentHost` to decide what to render. Each text-bearing editor's view composes the chrome inline.

---

## What the new arch needs to support

Same observable behavior for every text-bearing page:

- The script panel still opens via the footer's "script" toggle, still resizes via splitter, still runs script against host content on F5, still loads/saves from the library.
- The encoding label still shows in the footer row.
- Per-editor footer status (Grid row count, Notebook stats, etc.) still appears in the footer when an editor wants to contribute.
- Notebook's expanded-note view still covers the page body when a note is expanded.
- Compare / Run / Run-all / Show-resources toolbar buttons still render with the same visibility rules.
- Page focus management still re-focuses the editor when the tab becomes active.
- Keyboard shortcuts (Ctrl+S = save, Ctrl+Shift+S = save-as, F5 = run, F2 = rename) still work when the editor is focused.
- Per-note embedded editors in Notebook still render their minimal chrome (per-note toolbar with language selector + Run / Run-all when script + switch widget for the note's embedded editor).

What changes internally:

- `TextEditorView.tsx` dissolves as a separate component. Its responsibilities migrate into either a single shared `<TextChrome>` component each text-bearing editor's view composes around the editor body, or into a small set of separately-imported chrome pieces (`<TextChrome>`, `<ScriptPanel>`, `<PageFooter>`, `<EditorOverlay>`) — TC1 decides.
- `TextToolbar.tsx` ceases to exist as a separate component (already half-emptied by walkthrough 09). Its four remaining buttons become inline contributions inside `<TextChrome>`.
- `TextFooter.tsx` ceases to exist as a separate component. Its responsibilities (script toggle, encoding label, footer portal slot replacement) become part of the new `<PageFooter>` or fold into `<TextChrome>` — TC1 decides.
- The four portal refs on `TextEditorModel` (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`, `editorOverlayRef`) and the three on `NoteItemEditModel` (toolbar pair + footer) are all deleted. Each editor's view composes its footer/toolbar contributions inline.
- The `editor-overlay` div becomes a shared component `<EditorOverlay>` that Notebook (or any future overlay consumer) renders inside its own view at a specific spot; the overlay's contents come from the consumer's own state, not a portal-into-ref pattern.
- Host-instanceof branching (per C1) is centralized inside the chrome components. `<TextChrome>` (or its sub-components) `if (host instanceof TextFileModel) … else if (host instanceof NoteItemEditModel) …`. A future third host type adds a branch.
- Focus management + keyboard routing migrate. The root `tabIndex={0}` + `onKeyDown={model.handleKeyDown}` + `pagesModel.onFocus` subscription are no longer "owned by TextEditorView" — they become a shared hook (`useEditorFocus(model)`) or absorb into `<TextChrome>`, depending on TC8.

What stays:

- `<PageToolbar>` from walkthrough 09 — the page-level toolbar host with auto-rendered NavPanel + switch widget. `<TextChrome>` composes inside it (Compare / Run / Run-all / Show-resources sit as children of `<PageToolbar>` per PT3 (a) inline composition).
- `ScriptPanelModel` class — survives unchanged in shape (today's `TModel<ScriptPanelState>` + cache file persistence + library wiring). Its attachment to the host evolves (TC6).
- `<ScriptPanel>` React component — survives in shape; its internal `<PageToolbar>` row stays (`Run` / library `Select` / `Save` / `Open-in-new-tab` / `Close`).
- `extractHtmlResources` utility — unchanged.
- `isScriptLanguage` from `transpile.ts` — unchanged.
- `pagesModel.openLinks(links, title)` — unchanged (Show-resources's onClick target).
- All UIKit primitives (`Panel`, `Spacer`, `Divider`, `IconButton`, `Button`, `Splitter`, `Select`) — unchanged.

---

## How mockups handle this

Most of walkthrough 10 is real-code refactor; few new mockup primitives. The relevant mockup state:

- **`EditorModel.contentHost: IContentHost | null`** (`mockups/EditorModel.ts:392-394` — walkthrough 08 / B2). The chrome reads `editor.contentHost` to decide what to render. Returns null for editors without a host (PDF, Image, Browser, etc.); returns the typed host for text-bearing editors.
- **`EditorModel.hasTextSelection?(): boolean`** (`mockups/EditorModel.ts` — walkthrough 09 / B2). Run-all-script visibility predicate. Monaco overrides; other editors leave undefined.
- **`EditorModel.handleKeyDown?(e): void`** — already exists today on `TextEditorModel` via `model.handleKeyDown`; the question is whether it stays a per-editor optional method on the EditorModel base, or migrates into a shared keyboard-handling hook. TC9 decides.
- **`pagesModel.query.canCompare(leftId, rightId)`** (CK3) — Compare button visibility.
- **`pagesModel.layout.enterCompareMode(pageId)`** (CK4) — Compare button onClick target.
- **`pagesModel.onFocus` Subscription** — page-activation event the chrome subscribes to for focus restoration. Stays unchanged.

Proposed mockup additions depend on TC1 / TC2 / TC6 resolution:

- **B1 — `mockups/TextChrome.tsx`** (TC1 (a) — single shared component). New file defining the wrapper component each text-bearing editor renders around its body. Host-instanceof branching internal.
- **B2 — `IContentHost` capability discovery surface** (TC2 — if non-instanceof branching wins). Adds sub-trait fields or capability flags to `IContentHost`. Reverses C1's instanceof choice.
- **B3 — `EditorModel.script?: ScriptPanelModel` accessor** (TC6 — if the script panel migrates from host-owned to editor-attached).

---

## Concerns

### TC1 — Shape of the shared chrome — single `<TextChrome>` wrapper vs. separately-composed pieces

Walkthrough 09 / PT1 (b) committed to "each editor's view composes shared chrome components directly." That leaves the question of granularity. Options:

- **(a) Single `<TextChrome model>{editor.body}</TextChrome>` wrapper component** — text-bearing editor views render one component that internally renders the toolbar contributions, body slot (children), script panel, footer, and overlay. Host-instanceof branching is internal. Call site is minimal:
  ```tsx
  function MarkdownEditor({ model }: { model: EditorModel }) {
      return (
          <TextChrome model={model}>
              <MarkdownBody model={model} />
          </TextChrome>
      );
  }
  ```
  The editor's view never sees the script panel, footer, or overlay — they're inside the wrapper.

- **(b) Separately-imported chrome pieces** — `<PageToolbar>` (walkthrough 09), `<TextChromeButtons model />` (Compare/Run/Run-all/Show-resources contributions), `<ScriptPanel model />`, `<PageFooter model />`, `<EditorOverlay model />`. Each editor's view composes them explicitly:
  ```tsx
  function MarkdownEditor({ model }: { model: EditorModel }) {
      return (
          <Panel direction="column" flex={1} height={0} {...useEditorFocus(model)}>
              <PageToolbar model={model}>
                  <TextChromeButtons model={model} />
                  <MarkdownViewModeToggle model={model} />
              </PageToolbar>
              <MarkdownBody model={model} />
              <ScriptPanel model={model} />
              <PageFooter model={model} />
              <EditorOverlay model={model} />
          </Panel>
      );
  }
  ```
  Editor controls what appears (could omit `<ScriptPanel>` if it doesn't want one); host-instanceof branching lives inside each piece.

- **(c) Hybrid** — single `<TextChrome>` wrapper that internally renders all the chrome pieces, BUT exposes the toolbar contribution slot via `toolbar={<MarkdownViewModeToggle … />}` prop. Editor body is `children`. Wrapper owns the rest:
  ```tsx
  function MarkdownEditor({ model }: { model: EditorModel }) {
      return (
          <TextChrome model={model} toolbar={<MarkdownViewModeToggle model={model} />}>
              <MarkdownBody model={model} />
          </TextChrome>
      );
  }
  ```

**Recommendation: (a).** Single wrapper component. The chrome pieces always appear together for text-bearing editors (toolbar contributions, script panel, footer, overlay) — no editor wants Markdown's toolbar but not the script panel. Embedding them inside `<TextChrome>` collapses the editor's view to "TextChrome wraps my body"; the editor's own toolbar contributions go as children of `<TextChrome>` (which forwards them inside `<PageToolbar>`'s children slot). (b)'s explicit composition is more flexible but spreads 5+ component imports across every text-bearing editor — a 10x repetition tax for no real opt-out benefit. (c)'s `toolbar` prop is a slot-prop variant that PT3 already rejected (single-named slot, ordering ambiguity if the editor wants both pre-spacer and post-spacer contributions). The single-wrapper shape mirrors today's TextEditorView pattern — every text-bearing editor mounted inside it — but without the registry-driven dispatch, and with explicit composition at the editor's view layer.

The wrapper signature (proposal):
```tsx
interface TextChromeProps {
    model: EditorModel;
    children: ReactNode;  // editor body
    toolbarContributions?: ReactNode;  // sits inside <PageToolbar> before the spacer
    footerContributions?: ReactNode;   // sits inside the footer row before the encoding label
}
```
Most editors pass only `children`; editors that contribute toolbar buttons (Markdown's view-mode, Grid's filter/sort) pass `toolbarContributions`; editors with footer status (Grid row count, Notebook note count) pass `footerContributions`. Two named slots — same logical bucket as the retired First/Last portal refs, but now structurally meaningful (toolbar vs. footer, not first vs. last).

### TC2 — Host-capability discovery — instanceof vs. trait-on-host vs. capability flags on EditorModel

C1 already resolved this — **instanceof**. TextChrome branches on `host instanceof TextFileModel` vs. `host instanceof NoteItemEditModel`. But this walkthrough is where the branching code actually lands, so the question is worth re-confirming:

- **(a) instanceof (C1's resolution)** — `<TextChrome>` reads `editor.contentHost`, branches `if (host instanceof TextFileModel) … else if (host instanceof NoteItemEditModel) …`. Simple, type-narrowed, two branches today.
- **(b) Sub-traits on host** — `IFileBacked`, `IEncryptable`, `IScriptable` capability traits. `<TextChrome>` queries `host.traits.has(SCRIPTABLE_TRAIT)`. More extensible if a third host shape lands.
- **(c) Capability flags on EditorModel** — `editor.hasScriptPanel?: boolean`, `editor.hasEncoding?: boolean`, etc. Editor declares which chrome pieces it wants; chrome consumes the flags.

**Recommendation: (a) — confirm C1.** Sub-traits (b) only pay off with several independently-composable hosts; today's two-host design (TextFileModel for file-backed pages, NoteItemEditModel for notebook notes) doesn't justify the trait machinery. (c) moves the decision to the wrong layer — whether a chrome piece renders is a host-shape question, not an editor-preference question (e.g., Markdown viewing a `.md` file gets a script panel because the HOST has script-execution capability; Markdown viewing a notebook note doesn't, because the HOST is different). Branching at the host level matches the conceptual model.

The branches inside `<TextChrome>`:
- `host instanceof TextFileModel` → full chrome (Compare button via canCompare, Run/Run-all via host.runScript, Show-resources via host.language === "html", `<ScriptPanel model.script>` if `model.script` exists, `<PageFooter>` with script-toggle + encoding label + footer portal, `<EditorOverlay model.editorOverlayRef>` for Notebook overlay)
- `host instanceof NoteItemEditModel` → minimal chrome (Run/Run-all via note's runScript, language selector via NoteItemToolbar's existing language menu, switch widget per PT2, no script panel, no encoding label, no overlay)
- `host === null` → no chrome at all (the editor's body fills the page; PDF/Image/Browser pattern — but these editors don't render `<TextChrome>` at all, so this case is theoretical)

### TC3 — `TextEditorView` dissolution — single-line per-editor replacement vs. inline-template per editor

Today's `TextEditorView` is the chrome wrapper. After PT4 collapses RenderEditor to a single `<AsyncEditor>` path, each text-bearing editor's loaded module IS the page. Where does the chrome get composed?

- **(a) Each text-bearing editor's loaded module renders `<TextChrome>` around its body** — Monaco's `TextEditor.tsx` module exports a component that renders `<TextChrome model><MonacoBody model /></TextChrome>`. Same for Grid, Markdown, Mermaid, SVG, HTML, Link, Todo, RestClient, Log, Graph, Draw, Notebook. Each editor's module owns its chrome composition.

- **(b) A higher-level "text-bearing editor wrapper" intercepts in `<AsyncEditor>`** — `<AsyncEditor>` checks `editor.contentHost != null` and wraps the loaded module's component in `<TextChrome>` automatically. Editor module exports just the body.

- **(c) The editor module declares "I want TextChrome" via a flag** — `EditorModule.usesTextChrome?: boolean`; `<AsyncEditor>` wraps when true.

**Recommendation: (a).** PT1 (b) committed to "each editor's view composes shared chrome components directly" — pushing the wrap into AsyncEditor (b) would re-create the wrapper-driven dispatch PT1 explicitly rejected. (a) keeps the choice at the editor's own view, matching the inline-composition shape that walkthrough 09's `<PageToolbar>` already uses. A text-bearing editor's view is literally 10-15 lines: `<TextChrome model toolbarContributions={...}>{body}</TextChrome>`. (c)'s declarative flag adds a registry-side concept for a per-editor view-level decision. (b)'s automatic wrap is the kind of "magic frame" PT1 rejected for the wrapper-in-RenderEditor pattern.

Concrete migration: `TextEditorView.tsx` is DELETED. Each of the 13 text-bearing editors that today render via `<ActiveEditor>` inside `TextEditorView` gets its own React module exporting a component that composes the chrome around its body. Today's `<ActiveEditor>` (which dispatches between Monaco and the alternative editors based on `state.editor`) also dissolves — each editor IS the editor; `state.editor` is gone per S10.

### TC4 — Toolbar contribution order in the `<PageToolbar>` row

`<TextChrome>` puts toolbar contributions into `<PageToolbar>`'s children slot. The row layout left-to-right:

1. (auto-inserted by `<PageToolbar>`) NavPanel button — via `editor.getNavigatorTarget()`
2. **Compare-with-left** (when `canCompare`)
3. **Run-script** (when `isScriptLanguage(host.language)`)
4. **Run-all-script** (when above + `editor.hasTextSelection?.()`)
5. (editor's own `toolbarContributions` prop — Markdown view-mode toggle, Grid filter buttons, etc.)
6. (auto-inserted `<Spacer />`)
7. **Show-resources** (when `host.language === "html"`)
8. (auto-inserted by `<PageToolbar>`) switch widget — via `editor.findCompatibleEditors()`

Today's order in `TextToolbar.tsx`:
1. NavPanel
2. Compare
3. Run
4. Run-all (after Run when hasSelection)
5. `<Spacer />`
6. Show-resources
7. Editor portal slots (First / Last)
8. Switch widget

So Show-resources sits on the right side of the spacer (between the spacer and the switch widget) today; Compare / Run / Run-all sit on the left. The proposed new order preserves this.

Open question: where do editor-specific contributions go relative to Compare / Run / Run-all? Today's portal slots `First` and `Last` could place editor contributions before NavPanel (rare) or after Compare/Run/Run-all (common). The proposed order (5) puts editor contributions AFTER the text-host-specific buttons but BEFORE the spacer.

Options:

- **(a) Text-host buttons first, editor contributions after (before spacer)** — matches today's `Last` portal slot semantics (most editors only use `Last`, which sits right before the spacer after the Run buttons). Show-resources moves to right of spacer.
- **(b) Editor contributions first, text-host buttons after** — uncommon today's `First` portal slot semantics (only Grid + Link + Notebook used `First`).
- **(c) Editor contributions split into two slots (`leftToolbar`, `rightToolbar`)** — re-creates today's First/Last bucket pair. PT3 already rejected slot props in favor of inline composition; this would walk that back.

**Recommendation: (a).** Today's dominant pattern (most editors use only `Last`) suggests text-host buttons → editor contributions → spacer → Show-resources → switch widget. Drops the rare `First` slot (Grid's filter button can sit after Run buttons; Link's badges can sit after; Notebook's per-note controls aren't toolbar-bound here since walkthrough 29 handles per-note chrome). Show-resources stays on the right side of the spacer per today.

### TC5 — `<TextChrome>` minimal-chrome contract for `NoteItemEditModel`

NoteItemEditModel hosts per-note embedded editors inside Notebook. Today's per-note chrome (`NoteItemToolbar.tsx`) renders:
- Language selector menu (left)
- Children (title bar passed by parent)
- Run / Run-all when script language
- editor-toolbar portal slots (`First` / `Last`)
- Switch widget (SegmentedControl)

There is NO script panel, NO encoding label, NO overlay for a note. The note is embedded inside the page; the page-level overlay (Notebook's expanded-note view) is owned by the page's TextFileModel, not the note.

When the embedded editor's view renders `<TextChrome>`, what does it look like for a NoteItemEditModel host?

- **(a) Full `<TextChrome>` with host-instanceof branching dropping pieces** — `<TextChrome>` for a NoteItemEditModel host renders: `<PageToolbar>` (with note's Run / language menu / switch widget) + body + nothing else (no script panel, no footer, no overlay). All four "page-level" pieces (script panel, footer, overlay, Compare button) hide automatically because the host isn't TextFileModel.
- **(b) Per-host chrome variants** — `<TextChrome>` for TextFileModel; `<NoteChrome>` for NoteItemEditModel. Each is a separate component. Editor views import the right one… but the editor doesn't know which host it has at compile time (Monaco runs against both TextFileModel-as-page-host and NoteItemEditModel-as-note-host). The dispatch HAS to happen at render time inside one shared wrapper.
- **(c) `<TextChrome>` only branches the inner pieces; the outer wrapper is the same** — single component, host-instanceof inside. Mirror of (a) but with the framing made explicit: "one wrapper, two render modes; the SHAPE of the wrapper is the same."

**Recommendation: (a) (= (c) functionally).** Single `<TextChrome>` component. Internal branches drop the pieces that don't apply to NoteItemEditModel (no script panel, no encoding, no overlay, no Compare — note pairs are never grouped pages). The note's per-note language menu (today in `NoteItemToolbar.tsx`) and Run-script buttons remain — they're rendered inside `<TextChrome>`'s `<PageToolbar>` slot for NoteItemEditModel branch. Switch widget per PT2 still auto-renders (the editor's `findCompatibleEditors()` is queried regardless of host class).

This means `NoteItemToolbar.tsx` ALSO dissolves — its responsibilities migrate into `<TextChrome>` (for NoteItemEditModel branch). The per-note title that `NoteItemToolbar` accepts as children moves to the editor view's `toolbarContributions` prop on `<TextChrome>`.

### TC6 — Script panel ownership — host-owned vs. editor-attached vs. chrome-owned

Today: `TextFileModel.script: ScriptPanelModel` (owned by host). The panel's state persists per-page (via cache file keyed by page id). When the editor switches (Monaco → Grid), the script panel persists across the switch because it lives on the host.

Under the new arch, does the panel stay host-owned?

- **(a) Stay host-owned** — `TextFileModel.script: ScriptPanelModel` survives unchanged. The chrome reads `(editor.contentHost as TextFileModel).script` to render `<ScriptPanel model.script>`. Persists across editor switch automatically (host transfers via switchFrom, the script panel rides along).

- **(b) Migrate to editor-attached** — each text-bearing editor's instance has its own `script?: ScriptPanelModel`. On switchFrom, the new editor either takes over the script panel from the old editor or starts fresh. More work; loses the "panel survives switch" property.

- **(c) Chrome-owned** — `<TextChrome>` instantiates its own ScriptPanelModel per render-mount. Loses persistence; doesn't survive switch; throwaway.

**Recommendation: (a).** Script execution is conceptually tied to the file (host.content + host.filePath context); switching editors shouldn't dump the in-progress script. Per C9, the cache file `<editor.id>-script-panel.json` is keyed on `editor.id` — but the EDITOR id transfers across switchFrom (P6), so the cache file survives editor swap. Today's host-owned shape already gives this for free; keeping it minimizes refactor scope. The chrome's read site is `(editor.contentHost as TextFileModel).script` — typed via the instanceof branch. NoteItemEditModel has no `script`, so the script-panel render is gated by both `host instanceof TextFileModel` AND `host.script != null`.

One nit: today `ScriptPanelModel.restore(id)` is called from `TextFileModel.restore()` with the host's id. Under C9, the cache file is `<editor.id>-script-panel.json`. The host transfers across switchFrom but the editor id transfers too (P6's `instanceId`); the ScriptPanel's restore key needs to come from the editor at restore time, not the host. Real-code refactor will need `ScriptPanelModel.restore(editorId)` called from the editor's `restore()` method, not the host's. Mockup change minimal; flagged for walkthrough 20.

### TC7 — `<EditorOverlay>` shape and lifetime

Today: a portal div on TextFileModel that Notebook portals expanded-note content INTO. Under the new arch, the portal indirection goes away.

- **(a) `<EditorOverlay>` is a slot component inside `<TextChrome>` that consumers populate via React context** — Notebook's component pushes overlay content into a context provider that `<EditorOverlay>` reads. Loose coupling.

- **(b) `<EditorOverlay>` reads overlay content from the editor's state directly** — Notebook's editor stashes overlay content (`expandedNoteId`) in its own state; the overlay queries `editor.getOverlayContent?.(): ReactNode`. Direct.

- **(c) `<EditorOverlay>` doesn't exist as a chrome piece; Notebook renders its own overlay inline in its view** — Notebook's view renders `<NotebookBody />` + `{expanded && <ExpandedNoteView />}` directly. The overlay is Notebook-internal, not part of `<TextChrome>`.

**Recommendation: (c).** Today's overlay is Notebook-specific (only consumer; no other editor uses it). Pulling it out of `<TextChrome>` removes a chrome surface that exists for one editor. Notebook's view renders its own overlay as part of its body composition. The `editorOverlayRef` portal is deleted; Notebook restructures to inline-compose `<ExpandedNoteView>` over its body when `expandedNoteId` is set. CSS handles the absolute positioning (the `editor-overlay` class survives, just applied to Notebook's own div rather than a TextChrome-owned div).

The `editor-overlay` div ALSO went on TextFileModel's `position="relative"` root — Notebook's inline overlay needs the same positioning context. Notebook's root panel becomes the positioned ancestor; the expanded-note overlay sits absolutely-positioned inside it. Real-code: Notebook's view renders `<Panel position="relative" flex={1}>{body}{expandedNote && <div className="editor-overlay">…</div>}</Panel>`.

Deletes from mockups: nothing to add. `setEditorOverlayRef` and `editorOverlayRef` retire on the real-code TextEditorModel.

### TC8 — Focus management migration

Today: `TextEditorView` subscribes to `pagesModel.onFocus`, refocuses its root when its page becomes active. Where does this go?

- **(a) Shared hook `useEditorFocus(model)`** — each text-bearing editor's view calls the hook at the top of its component. Hook subscribes to `pagesModel.onFocus`, manages a ref the editor's root element binds via `useRef + tabIndex={0}`. Reusable across editors; small surface.

- **(b) Inside `<TextChrome>`** — the chrome's outer panel owns the focus subscription. Editor body doesn't manage focus; the chrome's root absorbs focus.

- **(c) Skip; rely on browser default focus** — the editor's body is focusable on its own (Monaco autofocuses; Grid has its own cell focus; React's default focus restoration after tab switch handles most cases). Drop the explicit refocus pattern.

**Recommendation: (b).** `<TextChrome>` is already the outer panel (per TC1 (a)) — making its root focusable + handling onFocus subscription centralizes the behavior. The chrome's outer `<Panel>` gets `tabIndex={0}` + a `ref` + the `pagesModel.onFocus` subscription. Editor body renders inside; focus delegation works the same as today. Avoids forcing every text-bearing editor to remember the hook (a). (c) regresses: today's 200ms refocus is needed because Monaco's own focus dance can take a moment after mount; without explicit refocus, users see the editor mounted but the tab indicator says the page is active and the editor isn't responding to keystrokes.

For non-text editors (PDF, Image, Browser, etc.) that don't use `<TextChrome>`, focus is handled per-editor. Today's PDF and Image editors don't subscribe to onFocus; the user clicks into them. Same behavior post-refactor.

### TC9 — `model.handleKeyDown` migration

Today: `TextEditorView` binds `onKeyDown={model.handleKeyDown}` on its root. `TextFileModel.handleKeyDown` delegates to `TextFileActionsModel.handleKeyDown`: Ctrl+S = save, Ctrl+Shift+S = save-as, F5 = runScript, F2 = rename. The shortcuts are host-bound (the model holds the action methods).

- **(a) `<TextChrome>` binds `onKeyDown` on its root, delegates to `editor.contentHost?.handleKeyDown?.(e)`** — host owns keyboard handling. Same shape as today but at a slightly different layer (chrome's root, not TextEditorView's root).

- **(b) `<TextChrome>` binds `onKeyDown`, delegates to a shared `handleTextEditorShortcuts(e, model)` helper that internally branches on host type** — chrome owns the dispatch logic; host provides the action methods.

- **(c) Each editor's view binds `onKeyDown` on its own root** — no shared handling. Repeats the same Ctrl+S logic across 13 editors. Bad.

**Recommendation: (a).** Host owns the actions (save, save-as, run, rename — all host-content operations). `<TextChrome>` binds the listener and delegates. For NoteItemEditModel, `host.handleKeyDown?.(e)` may handle a different subset (notes don't save-as-file; they save into the notebook's data). Each host class implements what it cares about; the chrome doesn't know the difference. (b) splits the logic; (c) duplicates.

The keystroke set today (Ctrl+S, Ctrl+Shift+S, F5, F2) all map cleanly to host methods. `TextFileActionsModel.handleKeyDown` survives as-is; `NoteItemEditModel` adds its own `handleKeyDown?` if it wants editing-mode shortcuts (today it doesn't seem to — its keystrokes are handled inside Monaco itself).

### TC10 — Footer portal retirement and per-editor footer status

Today: `editorFooterRefLast` on TextFileModel + NoteItemEditModel. Consumers (Grid, Todo, Link, Graph, Notebook) portal status content into the footer slot. With portal refs deleted, how do editors contribute footer status?

- **(a) `<TextChrome>`'s `footerContributions?: ReactNode` prop** — editor's view passes a node to be rendered inside the footer row before the encoding label:
  ```tsx
  <TextChrome
      model={model}
      footerContributions={<GridFooterStatus model={model} />}
  >
      <GridBody model={model} />
  </TextChrome>
  ```

- **(b) Per-editor `getFooterStatus?: () => ReactNode` method on EditorModel** — chrome calls `editor.getFooterStatus?.()`. Side-by-side with `getNavigatorTarget()` pattern.

- **(c) Each editor's view renders its own footer inline** — no shared footer at all. Drops the encoding-label-on-the-right pattern; each editor has its own footer.

**Recommendation: (a).** Consistent with TC1 (a)'s `toolbarContributions` prop — same shape, same call-site pattern. Editor's view declaratively says "here's my footer status, render it inside the chrome's footer row." Chrome handles the layout (status on left of encoding label, divider between them). (b) goes through an indirection (method-on-model) that doesn't compose with React (a method can't subscribe to state on its own — needs to be a component anyway). (c) loses the encoding label's consistent right-side placement across editors.

For NoteItemEditModel, there's no footer row at all (per TC5) — `footerContributions` is ignored when host isn't TextFileModel. Per-note status (the today-portal-into-NoteItemEditModel-footer-ref consumers) doesn't have a footer slot — but per-note status is also vanishingly rare today (I'd verify against the grep; today's `NoteItemEditModel.setFooterRefLast` may be wired but rarely populated). If a per-note footer is desired post-refactor, the embedded editor can render its own status inline; not a shared chrome concern.

### TC11 — Encryption indicator placement

C8's example sketch mentioned "PageToolbar renders the encryption padlock when host.encrypted." Today there's no padlock in the page chrome — the encryption indicator lives in `PageTab.tsx` (tab strip), and there's an unrelated encryption banner inside the editor when content is decrypted. So C8's "padlock" is hypothetical, not a today-shape needing migration.

The actual today-state:
- `PageTab.tsx` renders a lock icon on the tab when the host is encrypted/decrypted (a tab-strip concern; walkthrough 08 / T2 covered).
- `ActiveEditor.tsx` falls back to `<TextEditor>` (Monaco) when `host.encrypted === true`, regardless of which editor was requested. Encrypted bytes show as Monaco text; user can decrypt via context menu.
- No padlock inside `TextEditorView`'s body chrome.

Question: does `<TextChrome>` need any new encryption UI?

- **(a) No** — encryption indicator stays in PageTab; the body's encrypted fallback (Monaco) is per-editor concern (each editor's view checks `host.encrypted` and decides whether to render its real body or fall back). Same as today.

- **(b) Add a padlock to `<PageFooter>`** — small visual reminder next to the encoding label. New UI element.

- **(c) Add a padlock to `<PageToolbar>`** — C8's hypothetical placement. Same as (b) but in toolbar.

**Recommendation: (a).** No new UI. EPIC-028 is a structural refactor; introducing a new encryption padlock falls outside scope. The encrypted-fallback dispatch (`ActiveEditor`'s today-job) needs to move somewhere — under TC3 (a)'s shape, each text-bearing editor's loaded module checks `host.encrypted` and either renders its body or falls back to Monaco-mode-on-the-host. The most ergonomic placement: the loaded editor module's component does `if ((model.contentHost as TextFileModel).encrypted) return <MonacoFallback model={model} />; return <ActualEditorBody model={model} />;`. Or `<TextChrome>` does the check before rendering children — `children` is conditionally suppressed when encrypted and `<MonacoFallback>` rendered instead. Either works; defer the exact shape to walkthrough 20 (Monaco) since the fallback is a Monaco call.

Real-code note: today's `ActiveEditor.tsx` dissolves entirely (it was the dispatch between Monaco and other editors based on `state.editor`; with `state.editor` retired per S10, there's no dispatch left to do). The encrypted-fallback is its only surviving responsibility, and that's a one-line guard inside each editor's view or inside `<TextChrome>`.

---

## Proposed mockup adjustments

One new file plus optional touches depending on concern resolutions.

### B1 — `mockups/TextChrome.tsx` (TC1 (a) — single shared chrome wrapper)

```tsx
// =============================================================================
// MOCKUP — TextChrome (shared host-aware chrome wrapper)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Wraps a text-bearing editor's body with the chrome that text-bearing
// pages share: the page-level toolbar (from walkthrough 09), text-host-
// specific buttons (Compare / Run / Run-all / Show-resources), an optional
// script panel, and a footer row.
//
// Each text-bearing editor's view composes it directly:
//
//     function MarkdownEditor({ model }: { model: EditorModel }) {
//         return (
//             <TextChrome model={model}
//                 toolbarContributions={<MarkdownViewModeToggle model={model} />}
//                 footerContributions={null}
//             >
//                 <MarkdownBody model={model} />
//             </TextChrome>
//         );
//     }
//
// Host-instanceof branching (per C1, TC2) lives inside this component:
//   - host instanceof TextFileModel → full chrome (script panel + footer +
//     Compare button + Show-resources)
//   - host instanceof NoteItemEditModel → minimal chrome (no script panel,
//     no footer, no Compare)
//   - host === null → caller should not be rendering TextChrome
// =============================================================================

import { ReactNode, useRef, useEffect } from "react";
import { EditorModel } from "./EditorModel";
import { TextFileModel } from "./TextFileModel";
// NoteItemEditModel lives in real code only; mockup signature uses unknown.
import { PageToolbar } from "./PageToolbar";
import { ScriptPanel } from "../../../src/renderer/editors/text/ScriptPanel";
import { Panel } from "../../../src/renderer/uikit/Panel/Panel";
import { Spacer } from "../../../src/renderer/uikit/Spacer/Spacer";
import { Button } from "../../../src/renderer/uikit/Button/Button";
import { Divider } from "../../../src/renderer/uikit/Divider/Divider";
import { IconButton } from "../../../src/renderer/uikit/IconButton/IconButton";
import { CompareIcon, RunAllIcon, RunIcon, WebScraperIcon } from "../../../src/renderer/theme/icons";
import { pagesModel } from "../../../src/renderer/api/pages";
import { isScriptLanguage } from "../../../src/renderer/scripting/transpile";

interface TextChromeProps {
    model: EditorModel;
    children: ReactNode;
    toolbarContributions?: ReactNode;
    footerContributions?: ReactNode;
}

export function TextChrome({ model, children, toolbarContributions, footerContributions }: TextChromeProps) {
    const host = model.contentHost;
    const rootRef = useRef<HTMLDivElement>(null);

    // TC8 — focus management: refocus root when this page becomes active
    useEffect(() => {
        const subscription = pagesModel.onFocus.subscribe((pageModel) => {
            if (pageModel !== model.page) return;
            setTimeout(() => {
                const root = rootRef.current;
                if (root && !root.contains(document.activeElement)) root.focus();
            }, 200);
        });
        return () => subscription.unsubscribe();
    }, [model]);

    if (host instanceof TextFileModel) {
        return (
            <Panel
                ref={rootRef}
                direction="column"
                flex={1}
                height={0}
                position="relative"
                gap="xs"
                tabIndex={0}
                onKeyDown={(e) => host.handleKeyDown?.(e)}  // TC9
            >
                <PageToolbar model={model} borderBottom>
                    <CompareButton model={model} host={host} />
                    <RunButtons model={model} host={host} />
                    {toolbarContributions}
                    {/* PageToolbar inserts <Spacer /> automatically after children — PT2 */}
                    <ShowResourcesButton host={host} />
                </PageToolbar>
                {children}
                {host.script && <ScriptPanel model={host} />}
                <PageToolbar model={model} borderTop>
                    <ScriptToggleButton host={host} />
                    <Spacer />
                    {footerContributions && <>{footerContributions}<Divider orientation="vertical" /></>}
                    <EncodingLabel host={host} />
                </PageToolbar>
            </Panel>
        );
    }

    // NoteItemEditModel branch — minimal chrome (TC5)
    return (
        <Panel
            ref={rootRef}
            direction="column"
            flex={1}
            height={0}
            position="relative"
            gap="xs"
            tabIndex={0}
            onKeyDown={(e) => (host as any)?.handleKeyDown?.(e)}
        >
            <PageToolbar model={model}>
                <NoteLanguageMenu host={host as any} />
                {toolbarContributions}
                <RunButtons model={model} host={host as any} />
            </PageToolbar>
            {children}
        </Panel>
    );
}

// ----- sub-components (sketches) -----

function CompareButton({ model, host }: { model: EditorModel; host: TextFileModel }) {
    if (!model.page) return null;
    const leftId = pagesModel.query.getLeftGroupedPageId?.(model.page.id);
    if (!leftId || !pagesModel.query.canCompare(leftId, model.page.id)) return null;
    return (
        <IconButton
            size="sm"
            title="Compare with Left Page"
            icon={<CompareIcon />}
            onClick={() => pagesModel.layout.enterCompareMode(model.page!.id)}
        />
    );
}

function RunButtons({ model, host }: { model: EditorModel; host: { language?: string; runScript?: (all?: boolean) => void } }) {
    const language = host.language;  // subscribed via host.state.use() in real code
    if (!isScriptLanguage(language)) return null;
    const hasSelection = model.hasTextSelection?.() ?? false;
    return (
        <>
            <IconButton
                size="sm"
                title={hasSelection ? "Run Selected Script (F5)" : "Run Script (F5)"}
                icon={<RunIcon />}
                onClick={() => host.runScript?.()}
            />
            {hasSelection && (
                <IconButton
                    size="sm"
                    title="Run All Script"
                    icon={<RunAllIcon />}
                    onClick={() => host.runScript?.(true)}
                />
            )}
        </>
    );
}

function ShowResourcesButton({ host }: { host: TextFileModel }) {
    const language = host.state.use((s) => s.language);
    if (language !== "html") return null;
    return (
        <IconButton
            size="sm"
            title="Show Resources"
            icon={<WebScraperIcon />}
            onClick={() => showHtmlResources(host)}
        />
    );
}

function ScriptToggleButton({ host }: { host: TextFileModel }) {
    if (!host.script) return null;
    const open = host.script.state.use((s) => s.open);
    return (
        <Button variant="ghost" size="sm" onClick={host.script.toggleOpen}>
            <span style={{ opacity: open ? 1 : 0.6 }}>script</span>
        </Button>
    );
}

function EncodingLabel({ host }: { host: TextFileModel }) {
    const encoding = host.state.use((s) => s.encoding);
    return <span>{encoding || "utf-8"}</span>;
}

function NoteLanguageMenu({ host }: { host: any }) {
    // Today's NoteItemToolbar's language WithMenu — moves here per TC5
    return null;  // sketch placeholder
}

async function showHtmlResources(host: TextFileModel) {
    const { extractHtmlResources } = await import("../../../src/renderer/core/utils/html-resources");
    const { content, filePath, title } = host.state.get();
    const baseUrl = filePath ? "file:///" + filePath.replace(/\\/g, "/").replace(/\/[^/]*$/, "/") : undefined;
    const links = extractHtmlResources(content, { baseUrl });
    pagesModel.openLinks(links, (title || "HTML") + " — Resources");
}
```

The component is non-trivial enough to warrant a mockup so Tier 5 editor walkthroughs (20–30) can reference the shape. Sub-components are sketches; final wiring decided in walkthrough 20 (Monaco) and walkthrough 29 (Notebook).

### B2 — no `IContentHost` changes

Per TC2 (a) — instanceof branching, no sub-traits, no capability flags. `IContentHost` mockup unchanged.

### B3 — no `EditorModel` script accessor

Per TC6 (a) — script panel stays host-owned (`TextFileModel.script`). No `EditorModel.script?` accessor added. The chrome reads `(host as TextFileModel).script` inside the instanceof branch.

---

## Open questions

None outstanding pending TC1–TC11 resolution. The single proposed mockup adjustment (B1 — `mockups/TextChrome.tsx`) lands when TC1 (a) + TC2 (a) + TC3 (a) + TC4 (a) + TC5 (a) + TC6 (a) + TC7 (c) + TC8 (b) + TC9 (a) + TC10 (a) + TC11 (a) all confirm.

---

## Files NOT changing

- `mockups/IContentHost.ts` — no new traits or capability flags; instanceof branching at the consumer per TC2 (a).
- `mockups/traits.ts` — no new traits (no `SCRIPTABLE_TRAIT`, `ENCRYPTABLE_TRAIT`, etc.).
- `mockups/PersistenceTypes.ts` — chrome composition is not persisted state; the script panel's persistence (via `<editor.id>-script-panel.json`) was already settled by walkthrough 04 / C9.
- `mockups/editorRegistry.ts` — no new registry fields; each editor decides chrome composition at its view layer.
- `mockups/ComponentQueue.ts` / `TOneState.ts` — chrome doesn't use ComponentQueue or new selector subscriptions.
- `mockups/PageModel.ts` — `switchMainEditor`, `getDescriptor`, etc. all unaffected.
- `mockups/EditorModel.ts` — `contentHost`, `hasTextSelection?`, `getNavigatorTarget`, `findCompatibleEditors` all already in place from walkthroughs 01 / 08 / 09; no new fields.
- `mockups/TextFileModel.ts` — `script: ScriptPanelModel`, `encrypted`/`decrypted`, `runScript`, `handleKeyDown`, `encoding`, `language` all survive in shape. Only deleted: the four portal ref fields + setters (`editorToolbarRefFirst`/`Last`, `editorFooterRefLast`, `editorOverlayRef`).
- `mockups/PageToolbar.tsx` — landed by walkthrough 09; `<TextChrome>` composes it as a row container, no shape change.
- `src/renderer/editors/text/ScriptPanel.tsx` — the React component and `ScriptPanelModel` class survive unchanged in shape (TC6 (a)). Only call site moves from inside `TextEditorView` to inside `<TextChrome>`.
- `src/renderer/editors/base/EditorToolbar.tsx` — pure styled `<Panel>` row container survives verbatim.
- `src/renderer/uikit/*` primitives — all unchanged.
- `src/renderer/core/utils/html-resources.ts` `extractHtmlResources` — unchanged.
- `src/renderer/scripting/transpile.ts` `isScriptLanguage` — unchanged.
- `src/renderer/api/pages/PagesQueryModel.ts` `canCompare`, `getTextFileHost` — already added by walkthroughs 06 / 07 / 08.
- `src/renderer/api/pages/PagesLayoutModel.ts` `enterCompareMode`, `exitCompareMode` — added by walkthrough 06.

---

## Status checklist

- [x] TC1 — Shape of shared chrome — **(a)** single `<TextChrome model>{body}</TextChrome>` wrapper component with `toolbarContributions?: ReactNode` and `footerContributions?: ReactNode` slot props. The chrome owns page-level uniform pieces (text-host action buttons, script panel, footer row, overlay branching) and renders the body as children. Editor-specific contributions go through the two named slots — `toolbarContributions` sits inside `<PageToolbar>` between the text-host buttons (Compare/Run/Run-all) and the auto-inserted spacer; `footerContributions` sits in the footer row before the encoding label. Fragments work (`<>...</>` for N buttons); conditional contributions work (`condition ? <Btn /> : null`); reactivity is the editor's internal concern (each contribution component subscribes to `model.state.use()` as needed). Single wrapper collapses each text-bearing editor's view to 10–15 lines. Rejected (b) separately-imported chrome pieces (`<PageToolbar>` + `<TextChromeButtons>` + `<ScriptPanel>` + `<PageFooter>` + `<EditorOverlay>` composed explicitly per editor — 5+ component imports per editor for no real opt-out benefit; no editor wants Markdown's toolbar without the script panel) and (c) hybrid `toolbar={...}` slot prop on a wrapper (single-named slot collides with the "before/after spacer" question PT3 rejected). Constraint accepted: only one toolbar slot before the spacer. If a future editor wants post-spacer placement (right side, before Show-resources), grow into a second `rightToolbarContributions?` slot then — YAGNI today. Drives B1 mockup (`mockups/TextChrome.tsx` — new file).
- [x] TC2 — Host-capability discovery — **(a)** confirm C1's instanceof. `<TextChrome>` reads `model.contentHost` and branches inline: `if (host instanceof TextFileModel) { … } else if (host instanceof NoteItemEditModel) { … } else { return null; }`. Type narrowing happens at the consumer. Considered following GK2's "centralized helper" pattern with new editor-keyed helpers (`getTextFileHost(model): TextFileModel | null` + `getNoteItemHost(model): NoteItemEditModel | null` — same shape as GK2 but EditorModel-keyed rather than pageId-keyed, because the chrome reads through `model.contentHost` directly while GK2's pageId-keyed helper resolves to the page's main editor's host — which for embedded note editors gives the notebook's TextFileModel, not the note's NoteItemEditModel). Decision: keep inline instanceof — the chrome has only two host-class branches and one consumer (`<TextChrome>` + its sub-components); the centralization that paid off for GK2's 14 PageTab callsites doesn't have the same gravitational pull at one consumer. Sub-components receive the typed host as a prop (`<CompareButton host={textHost} … />`) so the instanceof doesn't recur. If a future third host class lands and the branching scatters across multiple chrome consumers, revisit by promoting to editor-keyed helpers then. Rejected (b) sub-traits on `IContentHost` (only pays off with several independently-composable hosts) and (c) capability flags on `EditorModel` (moves the decision to the wrong layer — whether a chrome piece renders is a host-shape question, not an editor-preference question). No mockup change required; no `IContentHost` change; no helper module added.
- [x] TC3 — `TextEditorView` dissolution — **(a)** each text-bearing editor's loaded module composes `<TextChrome>` around its body directly. PT1 (b) committed to "each editor's view composes shared chrome components directly" — pushing the wrap into `<AsyncEditor>` (b) would re-create the wrapper-driven dispatch PT1 explicitly rejected; declaring "I want TextChrome" via an `EditorModule.usesTextChrome?: boolean` flag (c) adds a registry-side concept for a per-editor view-level decision. (a) keeps the choice at each editor's own view layer; a text-bearing editor's view becomes literally 10–15 lines wrapping its body in `<TextChrome model toolbarContributions={…}>{body}</TextChrome>`. `TextEditorView.tsx` is DELETED. `ActiveEditor.tsx` ALSO dissolves — it was the dispatch between Monaco and other editors based on `state.editor`, which S10 retired (no `state.editor` field anymore); each editor IS the editor. The 13 text-bearing editors that today render via `<ActiveEditor>` inside `TextEditorView` each get their own React module exporting a component that composes the chrome inline. Rejected (b) `<AsyncEditor>` checks `editor.contentHost != null` and wraps automatically (the "magic frame" pattern PT1 rejected) and (c) per-module declarative flag (adds API surface for a per-editor view decision). No mockup change required; the inline composition shape is implicit in PT1 (b) + PT3 (a).
- [x] TC4 — Toolbar contribution order in `<PageToolbar>` row — **(a)** text-host buttons → editor contributions → spacer → Show-resources → switch widget. Concrete left-to-right order: (1) NavPanel (auto by `<PageToolbar>` per PT5), (2) Compare-with-left (when `canCompare`), (3) Run-script (when `isScriptLanguage(host.language)`), (4) Run-all-script (when above + `editor.hasTextSelection?.()`), (5) editor's `toolbarContributions` prop (Markdown view-mode, Grid filters, Markdown compact-mode button, etc.), (6) auto-inserted `<Spacer />`, (7) Show-resources (when `host.language === "html"`), (8) auto-inserted switch widget (by `<PageToolbar>` per PT2). Matches today's dominant pattern in `TextToolbar.tsx` (Show-resources sits on the right side of the spacer; Compare/Run/Run-all on the left). Drops the rare `First` portal slot today's Grid/Link/Notebook used — those editors' contributions now sit AFTER Run buttons (in the `toolbarContributions` position), which is fine because no editor today actually needs to appear before Run buttons. Rejected (b) editor contributions first / text-host buttons after (only Grid + Link + Notebook used today's `First` slot, and even there the visual difference is negligible) and (c) split into `leftToolbar` / `rightToolbar` slot pair (re-creates the First/Last bucket pair PT3 already rejected in favor of inline composition). Encoded inside `<TextChrome>`'s `<PageToolbar>` children — sub-component render order in B1's mockup follows this list.
- [x] TC5 — `<TextChrome>` minimal-chrome contract for `NoteItemEditModel` — **(a)** single `<TextChrome>` component, internal host-instanceof branch drops the page-level pieces. The NoteItemEditModel branch renders: outer focusable `<Panel>` (TC8) + `<PageToolbar>` containing the note's language menu (from today's `NoteItemToolbar`) + editor's `toolbarContributions` + Run/Run-all (when `isScriptLanguage(host.language)`) + auto-inserted switch widget (PT2 via `editor.findCompatibleEditors()`) + body (`children`). NO script panel (per-note doesn't carry a `ScriptPanelModel`), NO footer row (no encoding label, no script-toggle button — neither makes sense for a note inside a notebook), NO overlay (overlay is page-level via TC7), NO Compare button (notes are never grouped pages). `NoteItemToolbar.tsx` dissolves — its responsibilities (language menu + Run buttons + portal slots + switch widget) migrate into `<TextChrome>`'s NoteItemEditModel branch; the note's title that today's `NoteItemToolbar` accepts as children moves to the editor view's `toolbarContributions` prop. The three portal refs on `NoteItemEditModel` (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`) retire — toolbar pair retired by walkthrough 09 / PT9 already; the footer ref retires here too since the NoteItemEditModel branch has no footer (nobody to portal INTO). Rejected (b) per-host chrome variants `<TextChrome>` vs. `<NoteChrome>` (the editor doesn't know its host class at compile time — Monaco runs against both TextFileModel-as-page-host AND NoteItemEditModel-as-note-host; the dispatch HAS to happen at render time inside one shared wrapper) and (c) explicit framing variant naming (functionally identical to (a)). No mockup change beyond B1's existing two-branch sketch.
- [x] TC6 — Script panel ownership — **(a)** stay host-owned. `TextFileModel.script: ScriptPanelModel` survives unchanged in shape (today's `TModel<ScriptPanelState>` + cache file persistence + library wiring + F5/Ctrl+S key bindings). The chrome reads `(host as TextFileModel).script` inside the TextFileModel instanceof branch (TC2); the render is additionally gated by `host.script != null` so editors mounted against hosts that didn't initialize a script panel render no panel. Script execution is conceptually tied to the file (host.content + host.filePath); switching editors (Monaco → Grid) shouldn't dump in-progress script work. Today's cache file `<editor.id>-script-panel.json` (walkthrough 04 / C9) keys on `editor.id` which transfers across `switchFrom` per P6 — so the panel survives editor swap for free. One real-code nit deferred to walkthrough 20: today `ScriptPanelModel.restore(id)` is called from `TextFileModel.restore()` with the host's id; under C9 the cache file is `<editor.id>-script-panel.json`, so the restore key must come from the editor at restore time, not the host. The wiring change is small (`ScriptPanelModel.restore(editorId)` called from the editor's `restore()` method) and lives in walkthrough 20's mechanics. NoteItemEditModel has no `script` field — `host.script != null` guard hides the panel for the NoteItemEditModel branch (orthogonal to TC5's "no script panel for notes"). Rejected (b) migrate to editor-attached (more work; loses the "panel survives switch" property — would need to choose between inherit-from-old-editor and start-fresh on every switch) and (c) chrome-owned (loses persistence; doesn't survive switch; throwaway state). No mockup change; no `EditorModel.script?` accessor (B3 dropped per walkthrough doc's open-question section).
- [x] TC7 — `<EditorOverlay>` shape and lifetime — **(c)** drop `<EditorOverlay>` as a chrome piece entirely. Notebook is the ONLY consumer today; pulling the overlay out of `<TextChrome>` removes a shared surface that exists for one editor. Notebook restructures to inline-compose `<ExpandedNoteView>` over its body when `pageState.expandedNoteId` is set: Notebook's view becomes `<Panel position="relative" flex={1}>{notebookBody}{expandedNote && <div className="editor-overlay">…</div>}</Panel>`. The `editor-overlay` CSS class (which provides absolute positioning) survives — only the portal indirection goes away. Notebook's outer panel becomes the positioned ancestor (already is, via `<TextChrome>`'s root if Notebook composes it; or via Notebook's own `position="relative"` root for the embedded case). Concrete deletions from real code: `editorOverlayRef: HTMLDivElement | null` field on `TextEditorModel.ts:162` + `setEditorOverlayRef` setter on `TextEditorModel.ts:176-178`; the `<div ref={model.setEditorOverlayRef} className="editor-overlay" />` line at `TextEditorView.tsx:59` (TextEditorView dissolves entirely per TC3 — line goes away with the file); the `createPortal(<ExpandedNoteView … />, model.editorOverlayRef!)` block at `NotebookEditor.tsx:293-306` (replaced by inline JSX rendering `<ExpandedNoteView>` as a sibling of the notebook body inside Notebook's own positioned root). Rejected (a) chrome slot component reading from React context populated by consumers (still adds a context boundary for one editor; over-engineered) and (b) `editor.getOverlayContent?(): ReactNode` (moves the indirection from a portal to a method call; same one-consumer problem). No mockup change; no chrome piece named `<EditorOverlay>`.
- [x] TC8 — Focus management migration — **(b)** `<TextChrome>` owns the focus subscription on its outer panel. Per TC1 (a), `<TextChrome>` already renders the outer `<Panel>` wrapping the editor body; making that panel focusable (`tabIndex={0}` + a `ref` + the `useEffect` that subscribes to `pagesModel.onFocus`) centralizes the focus-restoration behavior at the chrome layer. When the page becomes active, the chrome's `setTimeout(refocus, 200)` runs against its own root ref — same shape as today's `TextEditorView` subscription, just at a slightly different layer. Editor body renders as children; focus delegation works identically (clicking into Monaco/Grid/whatever moves focus inside the chrome's root; tab-switch returns focus to the root which lets the embedded editor's internal autofocus take over). NoteItemEditModel branch also gets the same focus subscription on its outer panel (one shared hook inside `<TextChrome>` regardless of host class) — although the per-note case rarely triggers (the embedded editor lives inside the Notebook page which is already the focused page; `pagesModel.onFocus` firing for the notebook page is what re-focuses the whole chrome anyway, including the embedded ones). Rejected (a) shared hook `useEditorFocus(model)` called by each text-bearing editor's view (forces every editor to remember the hook; 13 imports for one behavior) and (c) skip / rely on browser default focus (regresses today's 200ms refocus pattern that exists because Monaco's mount dance can take a moment to settle — without explicit refocus, users see editor mounted but keystrokes don't reach it). For non-text editors (PDF, Image, Browser, etc.) that don't compose `<TextChrome>`, focus is handled per-editor — same as today (PDF/Image don't subscribe to `onFocus`; user clicks in). No mockup change required beyond B1's existing `useEffect` sketch.
- [x] TC9 — `model.handleKeyDown` migration — **(a)** `<TextChrome>` binds `onKeyDown` on its root and delegates to `editor.contentHost?.handleKeyDown?.(e)`. Host owns the keystroke handling — the four shortcuts (Ctrl+S = save, Ctrl+Shift+S = save-as, F5 = run, F2 = rename) all read or mutate host content, so the host is the natural owner. TextFileModel's existing `TextFileActionsModel.handleKeyDown` survives as-is; just the binding layer moves from TextEditorView's root (deleted per TC3) to the chrome's root. For the NoteItemEditModel branch, `host.handleKeyDown?.(e)` is also called — NoteItemEditModel can implement its own subset (today's per-note shortcuts mostly live inside Monaco's internal handlers; the per-note host can opt in to additional shortcuts via the optional method). Each host class implements what it cares about; the chrome doesn't know the difference, just `host.handleKeyDown?.(e)` regardless of branch. Rejected (b) shared helper `handleTextEditorShortcuts(e, model)` branching internally on host type (splits the logic: chrome owns dispatch decisions but host owns action methods — better to keep both inside the host) and (c) each editor's view binds `onKeyDown` on its own root (duplicates Ctrl+S etc. across 13 editors). One small mockup adjustment: confirm `IContentHost.handleKeyDown?(e: React.KeyboardEvent): void` is part of the host contract (today it's on `TextFileModel`; promote to `IContentHost` so the chrome's delegation is type-safe). Walkthrough 20 finalizes Monaco's actual handler body; walkthrough 29 (Notebook) decides whether NoteItemEditModel adds its own per-note shortcuts.
- [x] TC10 — Footer portal retirement and per-editor footer status — **(a)** `<TextChrome>`'s `footerContributions?: ReactNode` prop (already part of B1's signature). Editor's view passes a node rendered inside the footer row before the encoding label. Same shape and call-site pattern as TC1 (a)'s `toolbarContributions` — declarative, fragment-friendly, conditional-friendly, reactivity-is-the-editor's-concern. Concrete deletions: `editorFooterRefLast: HTMLDivElement | null` field on `TextEditorModel.ts:161` + `setFooterRefLast` setter on `TextEditorModel.ts:172-174` + the matching field/setter on `NoteItemEditModel.ts:195,243-245`; the `<div ref={model.setFooterRefLast} className="footer-portal-target" … />` block at `TextFooter.tsx:50-60` (TextFooter dissolves entirely with TextEditorView per TC3); five editors' `createPortal(…, model.editorFooterRefLast)` blocks rewrite to pass JSX through `footerContributions` instead (Grid's row count, Todo's counts, Link's status, Graph's node count, Notebook's note count). For the NoteItemEditModel branch (per TC5), `footerContributions` is ignored — the minimal chrome has no footer row at all; per-note status is rare today and any embedded editor that wants it renders inline in its own body. Rejected (b) per-editor `getFooterStatus?: () => ReactNode` method on EditorModel (a method can't subscribe to state on its own — needs to be a component anyway; adds API surface for what's already expressible as a child prop) and (c) each editor renders its own footer inline (drops the consistent right-side encoding label across editors). No mockup change beyond B1's existing `footerContributions` prop.
- [x] TC11 — Encryption indicator placement — **(a)** no new UI. C8's "encryption padlock in PageToolbar" example was a hypothetical illustration of host-instanceof branching, not a today-shape needing migration — today there's no padlock inside `TextEditorView`'s body chrome at all. The actual today-state: `PageTab.tsx` renders a lock icon on the tab when the host is encrypted/decrypted (walkthrough 08 / T2 covered); `ActiveEditor.tsx:24` falls back to `<TextEditor>` (Monaco) when `host.encrypted === true` regardless of which editor was requested (encrypted bytes show as Monaco text; user decrypts via context menu); no padlock inside the editor body. EPIC-028 is a structural refactor; introducing a new padlock falls outside scope. `ActiveEditor.tsx` dissolves entirely per TC3 (no `state.editor` to dispatch on per S10), and its only surviving responsibility — the encrypted-content fallback — becomes a one-line guard inside each text-bearing editor's view: `if ((model.contentHost as TextFileModel).encrypted) return <MonacoFallback model={model} />; return <ActualEditorBody model={model} />;`. Walkthrough 20 (Monaco) decides whether the guard lives in each editor's view directly or inside `<TextChrome>` before rendering `children` (functionally equivalent — defer the exact JSX placement). Rejected (b) padlock in `<PageFooter>` (new UI element outside epic scope) and (c) padlock in `<PageToolbar>` (C8's hypothetical — same out-of-scope concern). No mockup change required.

Mockup adjustments:
- [x] B1 — Add `mockups/TextChrome.tsx` shared component — landed 2026-05-20. New mockup file. Single host-aware chrome wrapper with `toolbarContributions?: ReactNode` + `footerContributions?: ReactNode` slot props per TC1. Two host-instanceof branches (TextFileModel full chrome vs. NoteItemEditModel minimal chrome) per TC2 + TC5. Renders auto-NavPanel + auto-switch via `<PageToolbar>` (walkthrough 09 / PT2 + PT5); text-host buttons (Compare/Run/Run-all/Show-resources) per TC4; `<ScriptPanel host.script>` per TC6 (host-owned); script-toggle button + encoding label in the bottom `<PageToolbar borderTop>` per TC10; focus subscription on outer panel per TC8; `onKeyDown` delegation to `host.handleKeyDown?(e)` per TC9. "What's gone vs. today's pattern" footer enumerates the 11 today-shape mechanisms it retires (TextEditorView, TextToolbar, TextFooter, ActiveEditor, NoteItemToolbar, two portal-ref fields/setters, footer-portal div, five createPortal blocks, Notebook overlay portal, handleKeyDown delegation through TextEditorView, focus subscription inside TextEditorView).
- [x] B2 — Add optional `handleKeyDown?(e: React.KeyboardEvent): void` to `IContentHost` — landed 2026-05-20 in `mockups/IContentHost.ts`. Repurposed from the originally-dropped B2 slot (no host-capability surface needed for TC2). Makes the chrome's `host.handleKeyDown?.(e)` delegation type-safe without an instanceof cast. Hosts implement what they care about; chrome doesn't know the host class at the delegation site. TextFileModel delegates to existing `TextFileActionsModel.handleKeyDown` (Ctrl+S / Ctrl+Shift+S / F5 / F2 unchanged); NoteItemEditModel optionally adds its own per-note shortcuts (walkthrough 29 finalizes).
- [x] B3 — Dropped — no `EditorModel.script?` accessor. Script panel stays host-owned per TC6 (a); chrome reads `(host as TextFileModel).script` inside the instanceof branch (TC2).
