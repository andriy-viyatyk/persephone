# 09 — Page-level toolbar & switch widget walkthrough

Scope: the toolbar surface that sits above the editor body inside a page — `EditorToolbar` / `PageToolbar` (the shared `Panel` wrapper at `src/renderer/editors/base/EditorToolbar.tsx`), `TextToolbar` (today's home of the switch widget), `RenderEditor` (the dispatch at `src/renderer/ui/app/RenderEditor.tsx` that picks between `AsyncEditor` and `TextEditorView`), and the four portal refs (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`, `editorOverlayRef`) that live on `TextEditorModel` today and let content editors push controls into TextEditor's chrome. Resolves the chrome-layer question for the toolbar specifically: where does the switch widget mount, where do per-editor contributions go, and what happens to today's portal-ref machinery.

**Out of scope** (own walkthroughs): the tab strip (`08` — done); the editor-specific chrome OTHER than the toolbar — `ScriptPanel`, `TextFooter`, encryption padlock body, overlay div — all of which lands in `10` (TextChrome); the per-editor toolbar contributions themselves (Grid filter buttons, Markdown view-mode toggle, etc.) which are touched by their respective Tier 5 walkthroughs; the page-level sidebar (`03` — done); the secondary-editor panel headers (`03` — done).

Relationship to C8: this walkthrough lands the toolbar half of C8's "no portal refs, no chrome wrapper; each editor's view composes shared chrome components" resolution. Walkthrough 10 lands the rest (ScriptPanel, footer, overlay, encryption padlock host-instanceof branching per C1).

**Status:** Done (2026-05-20). All concerns PT1–PT10 resolved; three mockup adjustments landed — B1 (new `mockups/PageToolbar.tsx` — page-level toolbar host auto-rendering NavPanel button on the left + switch widget on the right), B2 (`EditorModel.hasTextSelection?(): boolean` optional method — Run-all-script selection probe; Monaco-only override), B3 (`EditorModel.getNavigatorTarget(): { pipe?, filePath? } | null` accessor — per-editor declaration of NavPanel button target). Real-code work for implementation is split across `RenderEditor.tsx` (PT4 — collapses to a single uniform path), `TextEditorView.tsx` (PT1 dissolves — focus management hook, keyboard routing migrate to per-editor view), `TextToolbar.tsx` (deleted as a separate component — text-specific contributions move into walkthrough 10's `<TextChrome>`; switch widget logic migrates into B1's `<PageToolbar>`), six editors that today render the NavPanel IconButton inline (Text + PDF + Image + Video + Archive + Category — all retire the per-editor block in favor of `getNavigatorTarget()` overrides), ten editor views that today portal toolbar contributions via `editorToolbarRefFirst`/`Last` (Grid, Markdown, Mermaid, SVG, Todo, Link, LogView, Draw, Graph, Notebook + per-note — all rewrite to compose inline as children of `<PageToolbar>`), and Monaco (walkthrough 20 finalizes `hasTextSelection?()` override). Walkthrough 10's `<TextChrome>` consumes what's left over: NavPanel exits to `<PageToolbar>`; Compare, Run-script, Run-all-script, Show-resources stay text-host-specific.

---

## What exists today

### `RenderEditor.tsx` — the dispatch

`src/renderer/ui/app/RenderEditor.tsx:23-39`. Reads `model.state.use(s => s.type)`. Asks the registry for a definition with `editorType === type && category === "standalone"`:

- **Standalone** (PDF, Image, Browser, Settings, About, MCP-Inspector, Archive, Storybook, Compare, Category, Explorer): renders `<AsyncEditor>` directly — the editor's own React component takes over the page content area and supplies its OWN chrome inside (or no chrome at all).
- **Content-view** (Monaco, Grid, Markdown, Mermaid, SVG, HTML, Link, Todo, RestClient, Log, Notebook, Graph, Draw): renders `<TextEditorView model={model as TextFileModel}>` — TextEditorView is the chrome wrapper, the content editor mounts INSIDE it via `<ActiveEditor>`.

The two-branch dispatch is a direct artifact of the today-shape: `TextFileModel` IS the editor for content-view editors; the actual rendered "editor" (Grid, Markdown, …) is a "view model" inside it. The chrome wrapper exists once per `TextFileModel`. The split disappears after EPIC-028 (S10 / C1 + walkthrough 04 / P1 retire `IEditorState.type` and `IEditorState.editor`; the registry mockup at `mockups/editorRegistry.ts:240-243` notes "category collapses").

### `TextEditorView.tsx` — today's chrome wrapper

`src/renderer/editors/text/TextEditorView.tsx`. Renders, from top to bottom:

1. **Top `PageToolbar` (border-bottom)** — contains `<TextToolbar model={...} setEditorToolbarRefFirst={...} setEditorToolbarRefLast={...}>`.
2. **Body**: `<ActiveEditor model={...}>` (the actual editor view — Monaco for monaco, Grid for grid-json, etc.) once `restored` is true; otherwise a `<Spacer>` placeholder.
3. **`<ScriptPanel model={...}>`** — collapsed-by-default script editor.
4. **Bottom `PageToolbar` (border-top)** — contains `<TextFooter model={...}>` (line/col, language, encoding, modified, encryption padlock).
5. **Overlay div** — `model.setEditorOverlayRef` mounts here; consumers (mainly Notebook's expanded-note overlay) portal content into it.

The wrapper owns: focus management (subscribes to `pagesModel.onFocus` to refocus its root when the page becomes active), keyboard routing (`onKeyDown={model.handleKeyDown}`), the four toolbar/footer/overlay portal refs (mounted via `ref={setEditorToolbarRefFirst}` etc.). Only `TextFileModel`-backed pages get this wrapper; non-text editors render bare.

### `TextToolbar.tsx` — toolbar contents

`src/renderer/editors/text/TextToolbar.tsx`. Composes a flat array of `actions: ReactNode[]`:

1. **NavPanel `IconButton`** — visible when `model.page?.canOpenNavigator(model.pipe, filePath) || filePath`. Toggles the page sidebar's file explorer.
2. **Compare-with-left `IconButton`** — visible when the left grouped page is also a TextFileModel. Sets compareMode on both hosts (today's flag pattern, retired by walkthrough 06 / CK1 to `compareGroups`).
3. **Run-script `IconButton`** — visible when language is a script language (`isScriptLanguage(language)`). Calls `model.runScript()`.
4. **Run-all-script `IconButton`** — visible when language is script AND `hasSelection`. Calls `model.runScript(true)`.
5. **`<Spacer>`** — flex-spacer pushing remaining items to the right.
6. **Show-resources `IconButton`** — visible when language is HTML. Extracts resource links and opens them in a list page.
7. **Portal slots** — TWO empty `<div>`s with `ref={setEditorToolbarRefFirst}` (first, unshifted to position 0 — or 1 if NavPanel exists) and `ref={setEditorToolbarRefLast}` (pushed last) — when `editor && editor !== "monaco"`. Content editors (Grid, Markdown, Mermaid, SVG, Todo, Link, Graph, Draw, LogView, Notebook) use these to portal their own controls into the toolbar. `Monaco` doesn't use the portal — its toolbar contributions ARE the base toolbar.
8. **Switch `SegmentedControl`** — when `switchOptions.options.length > 1`. Renders the editor picker (Monaco, Grid, Markdown, …) for the current language + file. Today's `editorRegistry.getSwitchOptions(language, fileName)` builds the list; `detectedContentEditor` (today's TextFileModel state field) is woven in. Clicking calls `model.changeEditor(value)`.

The portal mechanism is the today-shape of "the editor that's actually rendering wants to add controls to the toolbar that exists one layer above it." After EPIC-028, the editor IS at the same layer as the toolbar — the wrapper-inside-wrapper structure is gone.

### `EditorToolbar.tsx` / `PageToolbar`

`src/renderer/editors/base/EditorToolbar.tsx`. A thin styled `<Panel>` with `direction="row"`, `background="dark"`, `paddingX="sm"`, `paddingY="xs"`, `gap="sm"`, `shrink={false}`, `hideWhenEmpty`. Borders optional. Renamed as an alias to PageToolbar (and exported as both). The wrapper itself has no editor semantics — just visual conformity. Survives EPIC-028 unchanged; it's a UI primitive.

### Today's portal-ref consumers

The portal refs (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`, `editorOverlayRef`) live on `TextEditorModel` (`src/renderer/editors/text/TextEditorModel.ts:159-178`) — the host. They're set imperatively by `TextEditorView` mounting `<div ref={setEditorToolbarRefFirst} />` etc., then EACH content editor's view renders a `createPortal(...)` into the captured DOM node. Today's consumers, found via grep:

- **Grid** (`GridEditor.tsx:60-155`) — uses all three (`First`, `Last`, `editorFooterRefLast`).
- **Markdown / Svg / Mermaid** (`MarkdownView.tsx:92-102`, `SvgView.tsx:48-74`, `MermaidView.tsx:41-77`) — `editorToolbarRefLast`.
- **Todo** (`TodoEditor.tsx:142-161`, `277-284`) — `editorToolbarRefLast`, `editorFooterRefLast`.
- **Link** (`LinkEditor.tsx:237-239`) — all three.
- **LogView** (`LogViewEditor.tsx:158-181`) — `editorToolbarRefLast`.
- **Draw** (`DrawView.tsx:291-338`) — `editorToolbarRefLast`.
- **Graph** (`GraphView.tsx:663-707`) — `editorToolbarRefLast`, `editorFooterRefLast`.
- **Notebook** (`NotebookEditor.tsx:130-304`) — all four, AND its own `NoteItemEditModel` (`note-editor/NoteItemEditModel.ts:193-244`) re-exposes the same refs for per-note embedded editors via `NoteItemToolbar.tsx`.

Today's pattern: ContentViewModel-style editor renders a `<EditorPortal>`-style wrapper that pushes its toolbar contributions into the parent's chrome. After EPIC-028 the editor's React component IS the page's main content — there is no parent chrome to portal INTO. The pattern dissolves; what each editor used to portal becomes inline composition.

### Cross-walkthrough touch points already known

- **Walkthrough 01 / A8** — unified `editors[]`. Each editor in the array is a peer; there's no `mainEditor` wrapper layer.
- **Walkthrough 02 / S5** — `mode: "edit" | "view"` on `AcceptanceInput`. Affects what the switch widget shows.
- **Walkthrough 02 / S10** — `IEditorState.type` and `IEditorState.editor` retired; `editorId` replaces both. The registry's `category: "standalone" | "content-view"` collapses (per `mockups/editorRegistry.ts:240-243`).
- **Walkthrough 03 / N1–N3** — secondary editor panels and PageNavigator. The page-level toolbar is parallel infrastructure on the OTHER side of the editor body.
- **Walkthrough 04 / P1** — `EditorDescriptor` / `HostDescriptor` shapes. No direct toolbar implications.
- **Walkthrough 06 / CK1, CK4** — Compare button rewires from `setCompareMode` on hosts to `pagesModel.layout.enterCompareMode(pageId)`.
- **Walkthrough 07 / GK2 + 08 / T2** — `pagesModel.query.getTextFileHost(pageId): TextFileModel | null` is the centralized host accessor. The Compare button visibility predicate uses `pagesModel.query.canCompare(leftId, rightId)` per CK3.
- **Walkthrough 08 / B2** — `EditorModel.contentHost: IContentHost | null` accessor. The switch widget visibility check reads `editor.contentHost != null`; the comment at `mockups/EditorModel.ts:381-383` says the switch widget reaches the host through this accessor.
- **Concerns log / C1** — TextChrome host-capability discovery via `instanceof TextFileModel` (TextFileModel → full chrome; NoteItemEditModel → minimal). Confirmed; walkthrough 10 carries the body.
- **Concerns log / C7 + C8** — TextFileModel's `detectedContentEditor` absorbed into `editorRegistry.findEditorsAccepting(host)` (no state field, no background timer); chrome refs `editorToolbarRefFirst`, etc. deleted; each editor composes shared chrome directly via `<PageToolbar model={...} firstPlace={...} lastPlace={...}>`. Walkthrough 09 + 10 nail the shape.

---

## What the new arch needs to support

Same observable behavior for every toolbar-bearing page:

- The page-level toolbar still shows: editor-specific controls (Grid filters, Markdown view modes, etc.), file-action controls (NavPanel for host-with-pipe), text-host-only actions (Compare-with-left, Run-script, Run-all-script, Show-resources), and the editor-switch widget on the right.
- The switch widget still picks among compatible editors for the host's content type, still highlights the current editor, still triggers `page.switchMainEditor(targetId)` (S1 / walkthrough 02 — replacing today's `model.changeEditor`).
- Non-text editors (PDF, Image, Browser, Settings, About, MCP-Inspector, Archive, Storybook, Compare, Category, Explorer) still render WITHOUT a text-chrome toolbar — many already provide their own controls inline.

What changes internally:

- The `category: "standalone" | "content-view"` distinction in `RenderEditor`'s dispatch goes away. Every editor's React component is loaded the same way; the chrome (or lack of it) is the editor's own composition concern.
- `TextEditorView` as a separate wrapper component dissolves. Today's TextEditor-view-is-the-chrome relationship was a side effect of TextFileModel-IS-the-editor; once the editor is a peer of the host, the chrome composes inside the editor's own view (per C8).
- The four portal refs (`editorToolbarRefFirst`, `Last`, `editorFooterRefLast`, `editorOverlayRef`) on TextFileModel disappear. Each editor's view directly renders its toolbar contributions inline with shared chrome components.
- The switch widget moves from being baked into `TextToolbar` to a shared component each editor's view renders (or to a uniform page-level slot — PT2 decides).
- `model.changeEditor(v)` → `page.switchMainEditor(v)` (walkthrough 02 / S1). The on-click handler in the switch widget updates accordingly.
- `detectedContentEditor` is no longer a stashed state field; the switch widget reads `editorRegistry.findEditorsAccepting(host)` directly (per C7).

What stays:

- `EditorToolbar` / `PageToolbar` (`src/renderer/editors/base/EditorToolbar.tsx`) — pure styled `<Panel>` row container; no editor coupling; survives verbatim.
- `IconButton`, `SegmentedControl`, `Spacer` (UIKit primitives) — unchanged.
- `editorRegistry.findEditorsAccepting(host)` (`mockups/editorRegistry.ts:166-179`) — the switch widget's data source.
- `EditorModel.findCompatibleEditors()` (`mockups/EditorModel.ts:329-331`) — base getter returning the registry result for the editor's host.
- `page.switchMainEditor(newEditorId)` (walkthrough 02 / S1) — the switch widget's onClick target.

---

## How mockups handle this

Most of walkthrough 09 is real-code wiring; very few new mockup primitives. The relevant mockup state:

- **`EditorModel.contentHost`** (`mockups/EditorModel.ts:392-394` — added by walkthrough 08 / B2). Returns `IContentHost | null`. The switch widget's first check: `editor.contentHost != null` (no host → no compatible alternatives → no switch).
- **`EditorModel.findCompatibleEditors()`** (`mockups/EditorModel.ts:329-331` — added by walkthrough 01 / A7). Returns the editor-id list the switch widget renders. Base returns `[]`; text-bearing editors override with `editorRegistry.findEditorsAccepting(this._host)`.
- **`editorRegistry.findEditorsAccepting(host)`** (`mockups/editorRegistry.ts:166-179`). Returns the editor-id list, mode-agnostic. The switch widget shows them; each editor's `accepts()` predicate already returns -1 for true incompatibility.
- **`PageModel.switchMainEditor(editorId)`** (walkthrough 02 / S1) — the page-level entry point the switch widget invokes.
- **`pagesModel.query.getTextFileHost(pageId): TextFileModel | null`** (GK2 / 08 / T2) — the helper any toolbar contribution that reads TextFileModel-specific state uses (e.g., the Run-script button checks `host?.state.get().language` is a script language; the Compare-with-left button uses `pagesModel.query.canCompare(leftId, rightId)`).
- **`pagesModel.query.canCompare(leftId, rightId)`** (CK3) — Compare button visibility predicate.
- **`pagesModel.layout.enterCompareMode(pageId)`** (CK4) — Compare button onClick target.

The proposed new shape is mostly compositional, not architectural. Two open questions land mockup adjustments:

- **B1 — Shared `<PageEditorToolbar>` component** (PT1 / PT2 resolution dependent). If the switch widget is "always there as a slot," a shared component owns the slot layout and embeds the switch logic.
- **B2 — `EditorView` props pattern for toolbar contributions** (PT3 resolution dependent). If editors push contributions via render props or via their own view rendering shared components, the EditorModule contract may grow a `renderToolbar?: (model) => ReactNode` field, or stay component-only.

Both depend on the concern resolutions below.

---

## Concerns

### PT1 — Page-level toolbar location: wrapper vs. composed-in-view

Where does the editor toolbar mount?

- **(a) Wrapper component in `RenderEditor`** — RenderEditor unconditionally renders `<PageEditorFrame>` around every editor's view. The frame owns the top toolbar, body slot for the editor, the footer, and the overlay. Each editor's view renders ONLY the editor body; toolbar contributions go through slots/callbacks (PT3). Uniform shape across all editors — PDFs and Browsers and Texts all sit inside the same frame.

- **(b) Each editor's view composes shared chrome directly** (C8's resolution). RenderEditor just renders `<editor.Component model={editor} />`. The editor's view chooses what chrome to compose: text-bearing editors render `<PageToolbar><TextToolbarContents model={...} /></PageToolbar>` + body + script panel + footer + overlay; PDF / Browser / etc. render their own bare content. Shared chrome components (`<PageToolbar>`, `<TextChrome>`, etc.) carry the host-instanceof branching internally.

- **(c) Hybrid** — RenderEditor renders the shared `<PageToolbar>` and `<PageFooter>` unconditionally; the editor's view fills slots in them. Editors that don't want a toolbar leave the slots empty (`<PageToolbar>` already has `hideWhenEmpty`).

**Recommendation: (b).** Aligns with the explicit C8 resolution on the concerns log ("each editor's React view composes shared chrome components directly"). Wrapper-in-RenderEditor (a) sounds elegant but pushes complexity into a frame-with-slots contract — every editor that wants ANY chrome variation has to express it through frame props or extension points. (c) pre-renders frames that many editors don't want; introduces dead UI for PDF/Browser/Settings/About etc. and forces toggling chrome via opt-out instead of opt-in. (b) keeps each editor's chrome local to its own view — Notebook's expanded-note overlay, Browser's no-chrome-at-all, MCP-Inspector's no-toolbar-but-yes-footer, all express as inline composition with no frame-shape negotiation. Today's TextEditorView is the proof-of-concept for (b); EPIC-028 just splits it into the shared chrome components C8 named (`<PageToolbar>`, `<ScriptPanel>`, `<PageFooter>`, `<EditorOverlay>`) and lets non-text editors compose subsets.

### PT2 — Switch widget mount point

Given PT1 (b), where does the switch widget render?

- **(a) Inside the shared `<PageToolbar>` component, auto-rendered when applicable** — `<PageToolbar model={editor}>` renders the switch widget on the right (after `<Spacer>`) when `editor.findCompatibleEditors().length > 0` (or — see PT10 — `>= 2`). The editor's own contributions sit before the spacer. The widget is uniform shape; every text-bearing editor gets it without opt-in.

- **(b) Separate `<SwitchWidget>` component each editor renders explicitly** — `<PageToolbar><EditorContributions /><Spacer /><SwitchWidget model={editor} /></PageToolbar>`. Same shape but the editor opts in. Pro: an editor that wants to suppress the widget can omit it. Con: every text-bearing editor copy-pastes the line.

- **(c) Page-level wrapper above the editor view (in RenderEditor)** — back to PT1 (a)-style for the switch only. The switch is the sole "page-level" piece, separate from the editor's own chrome. Pro: switch always shows in the same screen position regardless of editor. Con: forces a frame around the editor for one widget, contradicts PT1 (b).

**Recommendation: (a).** The switch widget is a uniform structural feature ("you can pick a different way to view this content") that applies to ALL text-bearing editors with the same shape (right side of the toolbar, SegmentedControl, calls page.switchMainEditor). Embedding it inside `<PageToolbar>` keeps the call-site collapsed to `<PageToolbar model={editor}>{contributions}</PageToolbar>`. Per (a), `<PageToolbar>` does:
```tsx
<EditorToolbar borderBottom>
    {children}
    <Spacer />
    <SwitchWidget model={model} />
</EditorToolbar>
```
The `<SwitchWidget>` reads `model.findCompatibleEditors()`, renders nothing if empty, otherwise renders a `SegmentedControl` with `model.editorId` as the current value and `(v) => model.page?.switchMainEditor(v)` as the change handler. (b) is appealing for opt-out but YAGNI — no editor today has a reason to hide a uniform UI affordance. (c) loses cohesion with the editor's own toolbar contributions.

### PT3 — Editor-specific toolbar contribution mechanism

Today's portal-ref pattern lets a content editor's view push controls INTO TextEditorView's chrome via React's `createPortal`. Under PT1 (b), the editor's view IS at the chrome layer — no portal needed. But the editor's view still has to express its toolbar contributions somewhere. Options:

- **(a) Inline composition inside each editor's view** — the editor's React component renders `<PageToolbar>` with its contributions as direct children:
  ```tsx
  function GridEditor({ model }) {
      return <>
          <PageToolbar model={model}>
              <GridFilterButton model={model} />
              <GridSortButton model={model} />
              {/* …text-host-specific actions injected by PageToolbar internals (NavPanel, Run, Compare) — PT4-PT7 */}
          </PageToolbar>
          <GridBody model={model} />
          {/* …other shared chrome */}
      </>;
  }
  ```
  Portal refs go away. Each editor's view owns its contributions explicitly.

- **(b) Slot prop on `<PageToolbar>`** — `<PageToolbar model={model} firstPlace={<GridFilter />} lastPlace={<GridSort />}>`. Matches C8's example sketch (which suggested `firstPlace` / `lastPlace` props). Pro: keeps separation between toolbar wrapper and editor contributions explicit. Con: introduces two named slots; what does an editor with three contributions do?

- **(c) Per-editor `renderToolbar?: (model) => ReactNode` field on `EditorModule`** — RenderEditor or the shared chrome calls `editor.module.renderToolbar?.(editor)` to get the contributions. Decouples toolbar contribution from the editor's main view component. Pro: separation of concerns. Con: adds a per-module concept that doesn't exist today.

**Recommendation: (a).** The cleanest "kill the portal refs" answer. Today's portal contortion exists ONLY because the editor view sits inside another component (TextEditorView) that owns the chrome — the editor reaches out via portals because it can't reach in via composition. Once the editor IS the chrome's parent (PT1 (b)), inline composition is the natural shape. (b)'s slot props re-introduce the two-bucket discipline of "first" vs. "last" that today's portal refs imply; per the audit above, only Grid and Notebook + per-note actually use `editorToolbarRefFirst` at all (most editors only push to `Last`). (c)'s per-module field formalizes a separation but adds API surface for a problem nobody has — no editor today has a reason for its toolbar contributions to live in a different file from its body. Slot ordering inside the row (NavPanel left, custom contributions in the middle, switch widget right) is handled by `<PageToolbar>` itself (PT2 (a) inserts `<Spacer />` and `<SwitchWidget />` after children); editor contributions go BEFORE the spacer, so they sit left/center.

### PT4 — `RenderEditor`'s category branch retirement

Today's `RenderEditor` branches between `AsyncEditor` (standalone) and `TextEditorView` (content-view). Per S10 and the registry mockup (`mockups/editorRegistry.ts:240-243`), `category` is removed. What does the new dispatch look like?

- **(a) Single uniform path: `<AsyncEditor>` for every editor** — RenderEditor just loads the editor's module via `editorRegistry.loadModule(editor.editorId)` and renders `<module.Component model={editor} />`. Today's `<AsyncEditor>` already does this for standalone editors; extend to all editors. Each editor's component composes its own chrome (PT1 (b)). TextEditorView dissolves; its current responsibilities (focus subscription, keyboard routing, shared chrome composition) move into the editor's view for text-bearing editors (or into a tiny shared `<TextChrome>` walkthrough-10 component that text-bearing editors render).

- **(b) Keep the two-branch dispatch with a different discriminator** — replace `category === "standalone"` with `traits.has(CONTENT_HOST_TRAIT)`. Content-host editors get the wrapper; others don't. Re-creates today's structure with new field names.

- **(c) Three branches** — text-bearing, text-bearing-with-host, no-host. Adds a third path for hypothetical specialization that doesn't exist.

**Recommendation: (a).** S10 / C1 retired `category` precisely because the wrapper-vs-bare distinction is an editor's own choice, not a registry classification. Every editor's React component receives the same `<{ model: EditorModel }>` shape and decides its own chrome composition. RenderEditor collapses to:
```tsx
export function RenderEditor({ model }: { model: EditorModel }) {
    return <AsyncEditor model={model} />;
}
```
(or AsyncEditor's logic inlines into RenderEditor — same effect). The `state.use(s => s.type)` subscription goes away (no `type` field; per S10). TextEditorView's responsibilities migrate: focus management becomes either a hook each text-bearing editor uses (`useEditorFocus(model)`) or absorbs into the shared `<TextChrome>` component (walkthrough 10). (b) re-creates a registry-driven dispatch the architecture explicitly chose to retire; (c) is over-design.

### PT5 — NavPanel button placement (REFRAMED 2026-05-20)

**Initial proposal corrected by user 2026-05-20**: NavPanel is NOT text-only. It is rendered today by SIX editors with the same predicate `page.canOpenNavigator(pipe, filePath) || filePath`:

- `text/TextToolbar.tsx:85-98` — TextFileModel (pipe + filePath on host)
- `pdf/PdfViewer.tsx:119-128` — PDF (pipe + filePath on editor)
- `image/ImageViewer.tsx:265-273` — Image (pipe + filePath on editor)
- `video/VideoPlayerEditor.tsx:441-449` — Video (filePath on editor; null pipe)
- `archive/ArchiveEditorView.tsx:37,67` — Archive (no args; panel already exists)
- `category/CategoryEditor.tsx:113,124,143` — Category (no args; PageNavigator already exists)

The predicate `PageModel.canOpenNavigator(pipe, filePath)` returns true when ANY of: (a) the Explorer panel is already attached, (b) the PageNavigator sidebar already exists, (c) the pipe is file-type, (d) `filePath` is set. NavPanel is a PAGE-LEVEL affordance — the button should appear for any editor whose page can open the navigator (existing panel/sidebar) OR provides a root folder from which to initialize the Explorer.

The reframed design question: where does the button COMPOSE in the new architecture? Editors expose `pipe`/`filePath` on different state shapes (host vs. editor state), and three editors don't need args at all. Options:

- **(a) Auto-render inside `<PageToolbar>` via a new `EditorModel.getNavigatorTarget()` accessor** — parallel to PT2's switch widget pattern. Base class:
  ```ts
  /**
   * What the NavPanel button should toggle when clicked. Returning null
   * hides the button. Empty object `{}` means "always show — toggle works
   * with no args" (Archive/Category — panel already attached).
   */
  getNavigatorTarget(): { pipe?: IContentPipe | null; filePath?: string | null } | null {
      return null;
  }
  ```
  Per-editor overrides:
  - Text-bearing editors: `{ pipe: this._host?.pipe ?? null, filePath: this._host?.state.get().filePath ?? null }`
  - PDF / Image: `{ pipe: this.pipe, filePath: this.state.get().filePath }`
  - Video: `{ pipe: null, filePath: this.state.get().filePath }`
  - Archive / Category: `{}` (predicate-via-PageModel still gates rendering)
  - Other editors (Settings, About, MCP Inspector, Browser, Storybook, Compare, Explorer-as-panel): inherit null default

  `<PageToolbar>` renders the button when `getNavigatorTarget()` returns non-null AND `page.canOpenNavigator(target.pipe, target.filePath)` (the page-level predicate still owns the existence check). onClick calls `page.toggleNavigator(target.pipe, target.filePath)`. Six per-editor copies of the IconButton block disappear.

- **(b) Per-editor inline via shared `<NavPanelButton model={editor} pipe={pipe} filePath={filePath} />` component** — factor today's pattern into a helper but keep the JSX call site per-editor. Each editor's view explicitly composes the button inside its `<PageToolbar>` children. Pro: explicit; each editor knows its own pipe/filePath. Con: still six call sites (down from six copy-pasted blocks, but the SAME number of compose-decisions).

- **(c) Auto-render in `<PageToolbar>` via two optional accessors on `EditorModel` (`editor.navigatorPipe?: IContentPipe | null`, `editor.navigatorFilePath?: string | null`)** — same as (a) but two fields instead of a returned object. Slightly more discoverable on the type; loses the single "is there a navigator concept here at all?" question that the `getNavigatorTarget() === null` answer expresses.

**Recommendation: (a).** Mirrors the switch widget shape from PT2 — page-level uniform affordances auto-render inside `<PageToolbar>`. NavPanel is even more uniform than the switch widget: not text-bearing-only, applies to any editor whose page can open the navigator. Eliminates the six copy-pasted IconButton blocks across editors; centralizes the predicate at `<PageToolbar>` querying `page.canOpenNavigator(...)`. The `getNavigatorTarget()` method per editor cleanly expresses the three behaviors (null = no button, `{}` = always-show, `{ pipe, filePath }` = check-and-show). (b) keeps six call sites and re-spreads the discipline of "does this editor have a navigator?" across editor views. (c) splits a single concept into two flat fields. Drives a B3 mockup adjustment (add `getNavigatorTarget()` to `mockups/EditorModel.ts`) and folds NavPanel rendering into B1's `<PageToolbar>` mockup alongside the switch widget. NavPanel is OUT of walkthrough 10's `<TextChrome>` — `<TextChrome>` keeps only text-host-specific actions (Compare, Run, Run-all, Show-resources).

### PT6 — Compare-with-left button placement

Same family as PT5. The Compare button today is in `TextToolbar.tsx:100-118`. Visibility predicate: the left grouped page exists AND its main editor is a `TextFileModel`. Action: sets `compareMode` on both hosts (today's pattern; replaced by `pagesModel.layout.enterCompareMode(pageId)` per walkthrough 06 / CK4).

Options:

- **(a) Lives inside `<TextChrome>` alongside NavPanel** — visibility via `pagesModel.query.canCompare(leftId, page.id)` (CK3); onClick calls `pagesModel.layout.enterCompareMode(page.id)` (CK4). Both helpers already exist in mockups from walkthrough 06.
- **(b) Page-level toolbar slot** — Compare is a page-pair feature, conceptually one layer above the editor; render in `<PageToolbar>` itself. Cons: same as PT5 (b) — couples toolbar with text-host concerns.
- **(c) Right-side action toolbar near switch widget** — separate visual group. Adds a third position to the toolbar; not motivated by user pain.

**Recommendation: (a).** Same reasoning as PT5. Compare is host-aware (only meaningful for TextFileModel pairs); `<TextChrome>` is the host-aware component (walkthrough 10). The CK3 + CK4 + CK6 trio already exists; walkthrough 09 just confirms Compare's position in the toolbar row (after NavPanel, before scripts).

### PT7 — Run-script / Run-all buttons placement

`TextToolbar.tsx:120-147`. Visible when `isScriptLanguage(language)`. Run-all shows additionally when `hasSelection`. Calls `model.runScript()` and `model.runScript(true)`. Reads `hasSelection` from `textVm?.state` (the Monaco view model — only exists when the Monaco editor is mounted).

After the refactor:
- `runScript` is a method on `TextFileModel` (the host, not the editor) — it reads the host's content.
- `hasSelection` is a Monaco-editor-view-model concept; Grid / Markdown / etc. don't have it.
- Show-resources (`TextToolbar.tsx:151-162`) is similar — only meaningful in Monaco-mode for HTML.

Options:

- **(a) Live in `<TextChrome>` alongside NavPanel + Compare** — `<TextChrome>` reads `host.state.use(s => s.language)`; renders Run / Run-all when script. Run-all visibility reads `editor` (the Monaco view) for hasSelection — but only Monaco has it. Today's `model.getTextViewModel()` returns null when non-Monaco; the Run-all button hides automatically. After EPIC-028 the equivalent is "is the current editor Monaco and does it have a selection?" — `editor.editorId === "monaco" && editor.queue.read('hasSelection')` is one shape; another is exposing `hasSelection` on the editor's state directly.

- **(b) Per-editor toolbar contribution** — only the Monaco editor view renders the script buttons. Cons: every script-language file in Grid mode (rare but possible — `.json` with `// @ts-check`) loses the buttons.

- **(c) `<TextChrome>` renders Run / Run-all (host-based); hasSelection check stays Monaco-specific** — `<TextChrome>` queries `host.state.get().language` for visibility; Run-all checks an editor-side capability ("does this editor have a selection?") via a small interface. Monaco implements; others don't. The Run-all button hides for non-Monaco editors regardless of script language.

**Recommendation: (c).** Script-execution is a host-level capability (runs against host.content); selection-aware UI is an editor-view capability (only Monaco has selection-as-toolbar-toggle today). Splitting along that line preserves today's behavior (Run-all only shows in Monaco) without leaking Monaco specifics into `<TextChrome>`. The "hasSelection" probe could live as an optional method on `EditorModel` (`editor.hasTextSelection?(): boolean`) overridden by Monaco only. Walkthrough 20 finalizes the exact accessor shape; walkthrough 09 just commits to position-in-toolbar (after Compare).

### PT8 — Show-resources button placement

`TextToolbar.tsx:151-162`. Visible when `language === "html"`. Extracts resource links from the HTML content. Same family as Run.

Options:

- **(a) Lives in `<TextChrome>` after the spacer (right-side, before switch)** — host-based predicate (`host.state.get().language === "html"`); no editor-view dependency.
- **(b) Move to a Monaco-only contribution** — only available when Monaco is rendering the HTML. Cons: same as PT7 (b); semantically wrong (the resource extraction operates on content, not on Monaco's view).

**Recommendation: (a).** Pure host-content operation; lives in `<TextChrome>`. Walkthrough 09 confirms position; walkthrough 10 implements.

### PT9 — Portal refs retirement under C8 — what does 09 own?

The four portal refs (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`, `editorOverlayRef`) all live on `TextEditorModel` today. C8 says they go away. Which one does this walkthrough actually retire?

- **(a) Walkthrough 09 retires `editorToolbarRefFirst` and `editorToolbarRefLast` only** — the toolbar pair. The footer ref and overlay ref live until walkthrough 10 (which handles ScriptPanel / TextFooter / overlay).

- **(b) Walkthrough 09 retires nothing; walkthrough 10 does it all at once** — 09 designs the shape; 10 ships the deletions. Cleaner per-walkthrough commit boundaries.

- **(c) Walkthrough 09 retires all four** — 09 owns the chrome refactor for everything inside `TextEditorView`. 10 just handles the host-instanceof body of `<TextChrome>`.

**Recommendation: (a).** Each walkthrough owns the portion of TextEditorView that it scopes. 09 scopes the toolbar; the toolbar refs (`editorToolbarRefFirst` / `Last`) retire here. The footer ref (`editorFooterRefLast`) is touched by `<TextFooter>` (walkthrough 10). The overlay ref (`editorOverlayRef`) is the Notebook expanded-note hook — touched by walkthrough 10 + walkthrough 29 (Notebook). (b) defers all the deletions to 10 making 10 unbearably large; (c) lumps in walkthrough 10's domain. Walkthrough 09's deliverable: ToolbarRef pair gone; every editor's view renders its toolbar contributions inline as children of `<PageToolbar>`. Walkthrough 10 picks up the footer + overlay + script panel + host-instanceof.

### PT10 — Switch widget visibility predicate

When does the SegmentedControl actually render? Today's predicate: `switchOptions.options.length > 1` (today's `getSwitchOptions` returns `options: [] | [...all]` — empty when only one editor available, full list otherwise). After EPIC-028, `editorRegistry.findEditorsAccepting(host)` returns `string[]` — could be empty, one, or many.

Options:

- **(a) Render when `findCompatibleEditors().length >= 2`** — at least two alternatives to choose between (matches today's "options.length > 1" semantics — implicit single Monaco doesn't render).
- **(b) Render when `>= 1`** — even a single alternative shows up as a one-button segmented control. Less idiomatic UX (a one-option picker is weird).
- **(c) Render when host is non-null AND `findEditorsAccepting(host)` includes the current editor in its list AND list.length >= 2** — strict version of (a); guarantees the current editor is among the alternatives so the SegmentedControl always has a non-null current value.

**Recommendation: (c).** Mirrors today's invariant (the current editor is always in the switch options, with Monaco as fallback). The check is one line — `const options = editor.findCompatibleEditors(); if (options.length < 2 || !options.includes(editor.editorId)) return null;`. (a) is too loose (would render a switch widget that has no current value if the current editor isn't in the list — a registry/host-incompatibility bug, but the widget itself shouldn't paper over it). (b) shows ugly one-option pickers. Single-editor-but-not-current cases shouldn't occur in well-formed registry; (c)'s strict check catches them cleanly.

---

## Proposed mockup adjustments

Three additions surface from this walkthrough. B1 + B3 depend on PT2 (a) + PT3 (a) + PT5 (a) landing; B2 depends on PT7's resolution.

### B1 — `<PageToolbar>` absorbs the switch widget AND the NavPanel button

Walkthrough 09 adds `mockups/PageToolbar.tsx` as the page-level uniform-affordance host. Two auto-rendered widgets: the NavPanel button (left of children — see PT5) and the switch widget (right of `<Spacer />` — see PT2). Editor-specific contributions sit as children between them.

```tsx
// mockups/PageToolbar.tsx — new
import { ReactNode } from "react";
import { EditorModel } from "./EditorModel";
import { EditorToolbar } from "../../../src/renderer/editors/base/EditorToolbar";
import { IconButton } from "../../../src/renderer/uikit/IconButton";
import { SegmentedControl } from "../../../src/renderer/uikit/SegmentedControl";
import { Spacer } from "../../../src/renderer/uikit/Spacer";
import { NavPanelIcon } from "../../../src/renderer/theme/icons";
import { editorRegistry } from "./editorRegistry";

interface PageToolbarProps {
    model: EditorModel;
    children?: ReactNode;
    borderTop?: boolean;
    borderBottom?: boolean;
}

/**
 * Page-level toolbar for an editor. Owns two auto-rendered page-level
 * affordances:
 *
 *   - NavPanel button (left) — when the editor exposes a non-null
 *     `getNavigatorTarget()` AND `page.canOpenNavigator(...)` returns true.
 *     See PT5 / B3.
 *   - Switch widget (right) — when `findCompatibleEditors()` has at least
 *     two editors including the current one. See PT2.
 *
 * Editor-specific contributions sit as children between the two slots.
 *
 * Replaces today's TextEditorView-internal toolbar + TextToolbar's portal
 * machinery (PT1 + PT3). See walkthrough 09 / PT1, PT2, PT3, PT5.
 */
export function PageToolbar({ model, children, borderTop, borderBottom }: PageToolbarProps) {
    return (
        <EditorToolbar borderTop={borderTop} borderBottom={borderBottom}>
            <NavPanelButton model={model} />
            {children}
            <Spacer />
            <SwitchWidget model={model} />
        </EditorToolbar>
    );
}

function NavPanelButton({ model }: { model: EditorModel }) {
    const target = model.getNavigatorTarget();
    if (target === null) return null;
    if (!model.page?.canOpenNavigator(target.pipe, target.filePath)) return null;
    return (
        <IconButton
            size="sm"
            title="File Explorer"
            icon={<NavPanelIcon />}
            onClick={() => model.page?.toggleNavigator(target.pipe, target.filePath)}
        />
    );
}

function SwitchWidget({ model }: { model: EditorModel }) {
    const options = model.findCompatibleEditors();
    if (options.length < 2 || !options.includes(model.editorId)) return null;
    const items = options.map((id) => ({ value: id, label: editorRegistry.getById(id)?.name ?? id }));
    return (
        <SegmentedControl
            items={items}
            value={model.editorId}
            onChange={(v) => model.page?.switchMainEditor(v)}
            size="sm"
        />
    );
}
```

The component is small but worth a mockup so Tier 5 editor walkthroughs (20–30) can reference the shape when each editor's view composes it. Six editors today (Text, PDF, Image, Video, Archive, Category) currently render the NavPanel IconButton inline; after this lands, all six retire that block in favor of inheriting it via `<PageToolbar>`.

### B2 — `EditorModel.hasTextSelection?(): boolean` optional method

Per PT7's recommendation, the Run-all-script button visibility depends on "does the current editor have a text selection?" — a Monaco-only concept today. Adding it to `mockups/EditorModel.ts`:

```ts
/**
 * Optional view-side capability: does this editor currently have a non-empty
 * selection? Used by the Run-all-script button (only renders when the host
 * is a script language AND the editor has a selection).
 *
 * Default: undefined (no selection capability). Monaco overrides via its
 * TextViewModel's hasSelection state. Walkthrough 09 / PT7; walkthrough 20
 * finalizes the Monaco-side wiring.
 */
hasTextSelection?(): boolean;
```

Lives on `EditorModel` rather than on a separate trait — single consumer (the script toolbar button), single provider (Monaco), method shape is trivial. If a second selection-aware editor lands later, promote to a `SELECTION_TRAIT` then.

### B3 — `EditorModel.getNavigatorTarget(): { pipe?, filePath? } | null` accessor

Per PT5's resolution, NavPanel button auto-renders inside `<PageToolbar>` via a uniform per-editor accessor. Each editor declares "do I want a NavPanel button, and what should it toggle?" Adding to `mockups/EditorModel.ts`:

```ts
/**
 * What the page-level NavPanel button should toggle when clicked, or null
 * if this editor has no notion of opening a file-explorer panel.
 *
 *   - Returning `null` (default): no NavPanel button (Settings, About,
 *     MCP-Inspector, Browser, Storybook, Compare, Explorer-as-panel).
 *   - Returning `{}` (empty target): NavPanel button always renders when
 *     the page's `canOpenNavigator` predicate accepts no-args. The page
 *     toggles its existing panel/sidebar (Archive, Category — panel
 *     already attached, no pipe/filePath needed).
 *   - Returning `{ pipe, filePath }`: the page predicate gates rendering;
 *     the button toggles by passing pipe/filePath as the explorer root
 *     hint (Text via host fields, PDF / Image via editor state, Video via
 *     `filePath` only with null pipe).
 *
 * The accessor reads the editor's CURRENT navigator-target snapshot. For
 * text-bearing editors the values live on the host; the editor reads
 * through `this._host?.pipe` / `this._host?.state.get().filePath`. For
 * standalone editors (PDF, Image, Video) the values live on the editor's
 * own state. Consumed by `<PageToolbar>`'s `<NavPanelButton>` slot — see
 * walkthrough 09 / PT5 / B1.
 */
getNavigatorTarget(): { pipe?: IContentPipe | null; filePath?: string | null } | null {
    return null;
}
```

The trio (B1 + B3 + the existing `page.canOpenNavigator` / `page.toggleNavigator`) makes the NavPanel button a single declarative read from `<PageToolbar>` against the editor — zero per-editor IconButton wiring.

No other mockup changes required.

---

## Open questions

None outstanding pending PT1–PT10 resolution. The two mockup additions (B1, B2) are conditional on PT2 (a) + PT3 (a) + PT7 (c) landing.

---

## Files NOT changing

- `mockups/IContentHost.ts` — host shape untouched by the toolbar refactor.
- `mockups/traits.ts` — no new traits introduced (PT7's `hasTextSelection?` stays a method on the base, not a trait).
- `mockups/PersistenceTypes.ts` — toolbar state is not persisted.
- `mockups/editorRegistry.ts` — `findEditorsAccepting`, `getById`, `createEditor` all consumed verbatim by the switch widget.
- `mockups/ComponentQueue.ts` / `TOneState.ts` — toolbar doesn't use the queue or selector subscriptions.
- `mockups/PageModel.ts` — `switchMainEditor`, `getDescriptor`, `editors[]`, `_mainEditorId` all already defined by earlier walkthroughs.
- `mockups/EditorModel.ts` for B2 only — the `contentHost` and `findCompatibleEditors` already landed by walkthrough 01 / 08.
- `src/renderer/editors/base/EditorToolbar.tsx` — the styled `<Panel>` row container survives verbatim (renamed import location possibly, but no logic change).
- `src/renderer/uikit/SegmentedControl/SegmentedControl.tsx`, `IconButton.tsx`, `Spacer.tsx`, `Panel/Panel.tsx` — UIKit primitives, untouched.
- `src/renderer/scripting/transpile.ts` `isScriptLanguage` — unchanged.
- `src/renderer/api/pages/PagesQueryModel.ts` `canCompare`, `getTextFileHost` — already added by walkthroughs 06 / 07 / 08.
- `src/renderer/api/pages/PagesLayoutModel.ts` `enterCompareMode`, `exitCompareMode` — added by walkthrough 06.
- `src/renderer/core/utils/html-resources.ts` `extractHtmlResources` — unchanged.

---

## Status checklist

- [x] PT1 — Page-level toolbar location — **(b)** each editor's view composes shared chrome components directly. Aligns with C8's resolution on the concerns log ("each editor's React view composes shared chrome components directly"). RenderEditor renders `<editor.Component model={editor} />`; the editor's view chooses what chrome to compose: text-bearing editors render `<PageToolbar>{contributions}</PageToolbar>` + body + script panel + footer + overlay; PDF / Browser / etc. render their own bare content. Shared chrome components carry the host-instanceof branching internally (per C1). Rejected (a) wrapper component in RenderEditor (pushes complexity into a frame-with-slots contract — every editor that wants chrome variation expresses it through frame props or extension points) and (c) hybrid pre-rendered frames (introduces dead UI for non-text editors; forces toggling chrome via opt-out instead of opt-in). Today's TextEditorView is the proof-of-concept for (b); EPIC-028 splits it into the shared chrome components C8 named (`<PageToolbar>`, `<ScriptPanel>`, `<PageFooter>`, `<EditorOverlay>`) and lets non-text editors compose subsets. No mockup change required.
- [x] PT2 — Switch widget mount point — **(a)** inside the shared `<PageToolbar>` component, auto-rendered. `<PageToolbar model={editor}>{children}</PageToolbar>` composes children (editor's own contributions) before `<Spacer />` and the `<SwitchWidget />` after — switch sits on the right side of the toolbar row, uniform across all text-bearing editors. `<SwitchWidget>` reads `model.findCompatibleEditors()`, gates visibility per PT10, calls `model.page?.switchMainEditor(v)` on change. Call site collapses to `<PageToolbar model={editor}>{contributions}</PageToolbar>` — no per-editor switch-widget boilerplate. Rejected (b) separate `<SwitchWidget>` each editor renders explicitly (every text-bearing editor copy-pastes the line; opt-out is YAGNI — no editor today has a reason to suppress a uniform UI affordance) and (c) page-level wrapper in RenderEditor (loses cohesion with the editor's own toolbar contributions, contradicts PT1 (b)). Drives B1 mockup (new `mockups/PageToolbar.tsx` absorbing the switch widget).
- [x] PT3 — Editor-specific toolbar contribution mechanism — **(a)** inline composition: each editor's view renders `<PageToolbar model={model}>{contributions}</PageToolbar>` with toolbar controls as direct children. Today's portal contortion exists ONLY because the editor view sits INSIDE TextEditorView, which owns the chrome — the editor reaches OUT via `createPortal` because it can't reach IN via composition. Once the editor is the chrome's parent (PT1 (b)), inline composition is the natural shape. The four portal refs on TextEditorModel (`editorToolbarRefFirst`/`Last`, `editorFooterRefLast`, `editorOverlayRef`) all retire — walkthrough 09 deletes the toolbar pair (per PT9); walkthrough 10 deletes the footer + overlay. Each editor's view receives toolbar contributions as JSX children at the call site, no portal indirection. Slot ordering inside the row (NavPanel left, custom contributions middle, switch widget right) is handled by `<PageToolbar>` itself — per PT2 (a), children render before `<Spacer />` so editor contributions sit left/center. Rejected (b) slot props `firstPlace` / `lastPlace` on `<PageToolbar>` (re-introduces the two-bucket discipline that today's portal refs imply — most editors only push to `Last`; first/last is a bucket pair that no longer has structural meaning) and (c) per-module `renderToolbar?(model): ReactNode` (adds API surface for a problem nobody has — no editor today has a reason for its toolbar contributions to live in a different file from its body). No new mockup primitive required; the inline composition shape is implicit in PT1 (b) + PT2 (a).
- [x] PT4 — `RenderEditor` category branch retirement — **(a)** single uniform path. RenderEditor loads the editor's module via `editorRegistry.loadModule(editor.editorId)` and renders `<module.Component model={editor} />` — the same shape today's `<AsyncEditor>` provides for standalone editors. The two-branch dispatch (`category === "standalone"` vs. content-view → TextEditorView) collapses. Today's `state.use(s => s.type)` subscription goes away (no `type` field; per S10). RenderEditor collapses to roughly: `export function RenderEditor({ model }: { model: EditorModel }) { return <AsyncEditor model={model} />; }` (or AsyncEditor's logic inlines — same effect). TextEditorView as a separate wrapper dissolves; its responsibilities migrate: focus management becomes a hook each text-bearing editor uses (`useEditorFocus(model)`) or absorbs into the shared `<TextChrome>` component (walkthrough 10); keyboard routing moves to the editor's view directly; shared chrome composes inline per PT1 (b) + PT3 (a). Rejected (b) keep two-branch dispatch with `traits.has(CONTENT_HOST_TRAIT)` discriminator (re-creates today's structure with new field names — S10 / C1 retired `category` precisely because the wrapper-vs-bare distinction is the editor's own choice, not a registry classification) and (c) three branches text-bearing / text-bearing-with-host / no-host (over-design for hypothetical specialization). No mockup change required.
- [x] PT5 — NavPanel button placement — **REFRAMED 2026-05-20 then resolved (a)**. Initial text-only proposal corrected by user: NavPanel is NOT text-only (Text + PDF + Image + Video + Archive + Category all render it today via the same `page.canOpenNavigator(pipe, filePath)` predicate; it is a page-level affordance, not a text-host-specific one). Resolved **(a)**: auto-render inside `<PageToolbar>` via new `EditorModel.getNavigatorTarget(): { pipe?, filePath? } | null` accessor. Each editor exposes its target uniformly — null = no button (default; Settings/About/MCP-Inspector/Browser/Storybook/Compare/Explorer-panel), `{}` = always-show with no-args toggle (Archive/Category — panel already attached), `{ pipe, filePath }` = page-level predicate gates rendering (Text via host fields, PDF / Image via editor fields, Video via editor `filePath` + null pipe). `<PageToolbar>` queries and renders the button when target is non-null AND `page.canOpenNavigator(target.pipe, target.filePath)`; onClick calls `page.toggleNavigator(target.pipe, target.filePath)`. Eliminates 6 copy-pasted IconButton blocks across editors. Parallel to PT2's switch widget pattern — page-level uniform affordances live inside `<PageToolbar>`. NavPanel is OUT of walkthrough 10's `<TextChrome>` — `<TextChrome>` keeps only text-host-specific actions (Compare, Run, Run-all, Show-resources). Drives B3 mockup (new `getNavigatorTarget()` accessor on `EditorModel` base — landed 2026-05-20 in `mockups/EditorModel.ts`) + B1 expansion (PageToolbar renders the NavPanel button alongside the switch widget). Rejected (b) per-editor inline `<NavPanelButton>` shared component (still six call sites; re-spreads the "does this editor have a navigator?" question across editor views) and (c) two-field accessor (`navigatorPipe` + `navigatorFilePath`) — splits a single concept into two flat fields, loses the "is there a navigator concept here at all?" answer that `getNavigatorTarget() === null` expresses cleanly.
- [x] PT6 — Compare-with-left button placement — **(a)** lives inside walkthrough 10's `<TextChrome>` shared component. Compare is host-aware — only meaningful when both pages of a grouped pair have TextFileModel hosts. Visibility predicate uses `pagesModel.query.canCompare(leftId, page.id)` (CK3 — the centralized two-id predicate); onClick calls `pagesModel.layout.enterCompareMode(page.id)` (CK4 — accepts either side, resolves leftId internally, single page-level entry point). Both helpers already exist on the PagesQueryModel / PagesLayoutModel mockups from walkthrough 06. NavPanel exits `<TextChrome>` (per PT5); Compare stays — it depends on the host type (TextFileModel only), not on the page-level navigator predicate. Walkthrough 09 confirms position in the toolbar row (after the NavPanel button's `<PageToolbar>` slot, inline as a `<TextChrome>` child); walkthrough 10 implements the wiring. Rejected (b) page-level `<PageToolbar>` slot (couples generic toolbar with text-host concerns; Compare doesn't apply to PDF/Image/Browser/etc.) and (c) right-side action group near the switch widget (adds a third visual position without user-pain justification). No mockup change required (`canCompare` + `enterCompareMode` already in mockups).
- [x] PT7 — Run-script / Run-all buttons placement — **(c)** split along host vs. editor-view capability boundary. Run-script visibility lives in `<TextChrome>` and reads the host language (`host.state.use(s => s.language)` → `isScriptLanguage(language)`); onClick calls `host.runScript()` (the host owns script execution against host.content). Run-all visibility additionally requires `editor.hasTextSelection?.() === true` — a Monaco-view-only capability (only Monaco surfaces a selection in the toolbar today). Other editors (Grid, Markdown, etc.) don't override `hasTextSelection?` so Run-all hides automatically even when the language is a script, matching today's behavior. Splitting along that line preserves today's UX (Run-all only renders in Monaco mode) without leaking Monaco specifics into `<TextChrome>` — the chrome stays editor-agnostic and queries the editor through the optional method. Walkthrough 09 confirms position in the toolbar row (after Compare, before the spacer); walkthrough 10 implements `<TextChrome>` itself; walkthrough 20 finalizes Monaco's `hasTextSelection?()` override (likely reads `textVm.state.get().hasSelection`). Drives B2 mockup adjustment (`hasTextSelection?(): boolean` optional method on `EditorModel` base — landed 2026-05-20 in `mockups/EditorModel.ts`). Rejected (a) `<TextChrome>` renders both buttons based on host language alone (Run-all would show for Grid/Markdown viewing script-language files — a Monaco-internal selection concept leaking out of Monaco) and (b) per-editor toolbar contribution (every script-language file rendered by Grid/Markdown loses the Run button — semantically wrong since script-execution operates on host.content, not on Monaco specifically).
- [x] PT8 — Show-resources button placement — **(a)** lives inside walkthrough 10's `<TextChrome>` shared component. Pure host-content operation (extracts resource links from HTML); no editor-view dependency. Visibility predicate reads the host language (`host.state.use(s => s.language === "html"`); onClick imports `extractHtmlResources` and opens the results via `pagesModel.openLinks(links, title)`. Same host-language-driven pattern as Run-script (PT7) but simpler — no selection probe, no editor-view capability. Walkthrough 09 confirms the slot (inside `<TextChrome>`, exact left/right position relative to Run / Run-all decided by walkthrough 10); walkthrough 10 implements. Rejected (b) Monaco-only contribution (semantically wrong — the resource extraction operates on host.content; HTML viewed in Grid mode or as Markdown should still expose the resources link). No mockup change required.
- [x] PT9 — Portal refs retirement scope — **(a)** walkthrough 09 retires `editorToolbarRefFirst` + `editorToolbarRefLast` only; `editorFooterRefLast` + `editorOverlayRef` land in walkthrough 10. Each walkthrough owns the portion of TextEditorView it scopes — 09 scopes the toolbar (both refs), 10 scopes the footer (`editorFooterRefLast`), the overlay (`editorOverlayRef` — Notebook expanded-note hook), and the script panel. Real-code consequences for walkthrough 09: delete `editorToolbarRefFirst`, `editorToolbarRefLast`, `setEditorToolbarRefFirst`, `setEditorToolbarRefLast` from `TextEditorModel.ts:159-178`; remove the matching props + portal `<div ref={…} />` markers from `TextToolbar.tsx`; delete `editorToolbarRefFirst`/`Last` from `NoteItemEditModel.ts:193-244`; rewrite the ten editor views that today portal into those refs (Grid, Markdown, Mermaid, SVG, Todo, Link, LogView, Draw, Graph, Notebook + per-note) to compose toolbar contributions inline as children of `<PageToolbar>` via PT3 (a). Rejected (b) defer all four refs to walkthrough 10 (lumps too much into one walkthrough; 09's toolbar refactor naturally retires the toolbar refs) and (c) retire all four in 09 (lumps walkthrough 10's domain — footer, overlay, script panel, host-instanceof — into the toolbar walkthrough). No mockup change required; mockup-side `TextEditorModel.ts` (if it exists at all) shouldn't reference the deleted refs anyway.
- [x] PT10 — Switch widget visibility predicate — **(c)** render only when `findCompatibleEditors().length >= 2` AND the current editor is in the list. Mirrors today's invariant where the current editor always sits among the switch options (with Monaco as fallback). The check is one line — `const options = editor.findCompatibleEditors(); if (options.length < 2 || !options.includes(editor.editorId)) return null;`. Strict version of "at least two compatible alternatives, current included" — guarantees the SegmentedControl always has a non-null current value. Rejected (a) `>= 2` without the "current in list" guard (would render a switch widget with no selected value if the current editor isn't in the alternatives — a registry/host-incompatibility bug, but the widget shouldn't paper over it by rendering an empty SegmentedControl) and (b) `>= 1` (one-option pickers are ugly UX — a single alternative offers no choice). Encoded inside `<PageToolbar>`'s `<SwitchWidget>` per B1.

Mockup adjustments (proposed):
- [x] B1 — Add `mockups/PageToolbar.tsx` shared component — landed 2026-05-20. New mockup file. Auto-renders NavPanel button per PT5 (a) on the left (via `editor.getNavigatorTarget()` accessor) + switch widget per PT2 (a) on the right (via `editor.findCompatibleEditors()` and PT10's `length >= 2 && includes(editorId)` predicate). Editor contributions sit as children between the slots per PT3 (a). Wraps real-code `EditorToolbar` (`src/renderer/editors/base/EditorToolbar.tsx`) as the row container. Replaces today's `TextToolbar`'s portal-ref + switch-widget machinery; six per-editor inline NavPanel IconButton blocks (Text + PDF + Image + Video + Archive + Category) all retire in favor of the auto-rendered slot.
- [x] B2 — Add `EditorModel.hasTextSelection?(): boolean` optional method — landed in `mockups/EditorModel.ts` 2026-05-20. Base shape is `hasTextSelection?(): boolean` (optional method, undefined by default). Monaco overrides to read `this.textVm?.state.get().hasSelection ?? false` (walkthrough 20 finalizes exact wiring). Other editors leave it unimplemented. Single consumer (`<TextChrome>`'s Run-all button visibility); single provider (Monaco). Promote to `SELECTION_TRAIT` only if a second selection-aware editor lands later.
- [x] B3 — Add `EditorModel.getNavigatorTarget(): { pipe?, filePath? } | null` accessor — landed in `mockups/EditorModel.ts` 2026-05-20. Base returns null (no NavPanel button); editors override per PT5: `{}` for Archive/Category, `{ pipe: host.pipe, filePath: host.filePath }` for text-bearing, `{ pipe, filePath }` for PDF/Image, `{ pipe: null, filePath }` for Video. Consumed by `<PageToolbar>`'s NavPanel slot via `page.canOpenNavigator(target.pipe, target.filePath)` predicate + `page.toggleNavigator(...)` onClick.
