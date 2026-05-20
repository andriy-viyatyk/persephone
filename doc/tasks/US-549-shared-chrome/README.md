# US-549: Shared chrome — PageToolbar + TextChrome

**Epic:** [EPIC-028 — Unified Editor Architecture](../../epics/EPIC-028.md)
**Phase:** A — Foundation
**Status:** Ready to implement (all concerns resolved 2026-05-21)
**Depends on:** US-547 (foundation primitives, commit `abead6f`), US-548 (PageModel adapter layer, commit `26ecc8d`)
**Blocks:** US-550 (MCP + scripting facades), Phase C per-editor migrations (US-551+)
**Walkthroughs:** [09 — Page-level toolbar & switch widget](../../epics/EPIC-028-editor-architecture/walkthroughs/09-page-toolbar.md), [10 — TextChrome](../../epics/EPIC-028-editor-architecture/walkthroughs/10-text-chrome.md)
**Mockups:** [`PageToolbar.tsx`](../../epics/EPIC-028-editor-architecture/mockups/PageToolbar.tsx), [`TextChrome.tsx`](../../epics/EPIC-028-editor-architecture/mockups/TextChrome.tsx)

---

## Goal

Introduce the two shared chrome components — `<PageToolbar>` (page-level toolbar host with auto-rendered NavPanel + switch widget) and `<TextChrome>` (host-aware wrapper around text-bearing editor bodies) — and rewire `TextEditorView.tsx` to delegate to them internally. After this task:

- `<PageToolbar>` is the canonical row container for every editor's toolbar contributions. It auto-inserts the NavPanel button on the left (via the editor's `getNavigatorTarget()` accessor) and the switch widget on the right (via `findCompatibleEditors()`).
- `<TextChrome>` wraps text-bearing editor bodies, owns focus + key-down routing, composes `<PageToolbar>` with text-host-specific buttons (Compare / Run / Run-all / Show-resources), the script panel, the footer, and the overlay div.
- `TextEditorView` is rewritten to compose `<TextChrome>` internally — its outer responsibilities migrate into the chrome. `TextToolbar.tsx`, `TextFooter.tsx`, and `ActiveEditor.tsx` dissolve (their bodies absorb into chrome sub-components and the editor module's component prop).
- `LegacyEditorAdapter` gains `getNavigatorTarget()` + `hasTextSelection?()` so the v4 base accessors return correct values for the wrapped legacy editor (host's pipe/filePath for text editors; editor state's filePath for PDF/Image/Video; `{}` for Archive/Category).
- Six per-editor inline NavPanel `IconButton` blocks (`TextToolbar.tsx`, `PdfViewer.tsx`, `ImageViewer.tsx`, `VideoPlayerEditor.tsx`, `ArchiveEditorView.tsx`, `CategoryEditor.tsx`) collapse into one auto-rendered slot inside `<PageToolbar>`.
- The toolbar portal refs (`editorToolbarRefFirst` / `editorToolbarRefLast`) move from `TextEditorModel` and `NoteItemEditModel` into `<TextChrome>` / `<NoteItemToolbar>` internally. Editor consumers (Grid, Markdown, Mermaid, SVG, Todo, Link, LogView, Draw, Graph, Notebook + per-note) keep their `createPortal(...)` blocks unchanged — they still target the same `model.editorToolbarRefLast` etc. fields, which now reflect refs owned by the chrome instead of by the host. **No per-editor rewrite happens in US-549**; that lands during each editor's Phase C migration.
- `editorFooterRefLast` and `editorOverlayRef` are NOT touched in US-549 — they remain on `TextEditorModel`. Walkthrough 10's full footer + overlay refactor lands incrementally with each editor's per-editor migration; the final ref deletion happens during US-559 cleanup.

User-visible behavior is unchanged: every editor still renders with its today-shape toolbar, footer, script panel, switch widget, and NavPanel button — just driven by new shared components.

---

## Background

### What US-547 + US-548 left in place

- **v4 EditorModel base** (`src/renderer/editors/base/v4/EditorModel.ts`): exposes `editorId`, `contentHost` getter, `findCompatibleEditors()`, `getNavigatorTarget()`, optional `hasTextSelection?()`. Base implementations return null / empty / undefined; subclasses (and the LegacyEditorAdapter) override.
- **LegacyEditorAdapter** (`src/renderer/editors/base/v4/LegacyEditorAdapter.ts`): wraps every legacy editor; `findCompatibleEditors()` already implemented via `legacyRegistry.getSwitchOptions(language, filePath).options`. `getNavigatorTarget()` and `hasTextSelection?()` are NOT yet overridden — both return base defaults.
- **PageModel.editors / mainEditorId / panelEditors** + the unified array shape are live; the switch widget's `onChange` will eventually call `page.switchMainEditor(...)`. Under US-548 that path is wired but for adapter-wrapped editors it still falls through to legacy `model.changeEditor(view)` (host-preserving in-place mutation). US-549 keeps the same behavior — switching is still legacy-style under the hood.

### Current chrome shape (legacy)

- **`RenderEditor.tsx`** (`src/renderer/ui/app/RenderEditor.tsx`): two-branch dispatch.
  - `category === "standalone"` (PDF, Image, Browser, Settings, About, MCP-Inspector, Archive, Storybook, Compare, Category, Explorer): renders `<AsyncEditor>` directly — editor owns its own chrome inline (PDF/Image/Video/Archive/Category render `<PageToolbar>` + NavPanel + body inline today).
  - else (content-view text editors): renders `<TextEditorView model={...} />` which wraps Monaco / Grid / Markdown / etc.
- **`TextEditorView.tsx`** (`src/renderer/editors/text/TextEditorView.tsx`): focused root panel with onKeyDown=model.handleKeyDown + 200ms onFocus refocus + top `<PageToolbar><TextToolbar /></PageToolbar>` + `restored ? <ActiveEditor /> : <Spacer />` + `<ScriptPanel />` + bottom `<PageToolbar><TextFooter /></PageToolbar>` + overlay `<div ref={model.setEditorOverlayRef} className="editor-overlay" />`.
- **`TextToolbar.tsx`** (`src/renderer/editors/text/TextToolbar.tsx`): NavPanel button (text + host-pipe/filePath gate) → Compare-with-left (`canCompare` predicate) → Run-script / Run-all-script (host language + selection) → `<Spacer />` → Show-resources (HTML only) → `<div ref={setEditorToolbarRefFirst}>` portal slot → `<div ref={setEditorToolbarRefLast}>` portal slot → switch `SegmentedControl` (calls legacy `model.changeEditor`).
- **`TextFooter.tsx`** (`src/renderer/editors/text/TextFooter.tsx`): script toggle button → `<Spacer />` → footer portal slot (`setFooterRefLast`) → encoding label.
- **`ActiveEditor.tsx`** (`src/renderer/editors/text/ActiveEditor.tsx`): three-way dispatch: encrypted → `<TextEditor>` (Monaco); editor !== "monaco" → `<AsyncEditor>` for the chosen alternative; default → `<TextEditor>`.
- **`ScriptPanel.tsx`** (`src/renderer/editors/text/ScriptPanel.tsx`): owned by `TextFileModel.script: ScriptPanelModel`. Hidden when `state.open === false`. Stays unchanged in shape.
- **`EditorToolbar.tsx`** (`src/renderer/editors/base/EditorToolbar.tsx`): the styled `<Panel>` row container, exported as both `EditorToolbar` and the legacy alias `PageToolbar`. Pure UIKit primitive; survives verbatim. The NEW `<PageToolbar>` shared component (this task) wraps it.
- **`NoteItemToolbar.tsx`** (`src/renderer/editors/notebook/note-editor/NoteItemToolbar.tsx`): per-note toolbar inside Notebook. Has its own copy of the language menu + Run buttons + portal slots + switch widget. Will eventually adopt `<PageToolbar>` per walkthrough 29, but US-549's job is only to migrate the page-level toolbar; per-note migration happens later.
- **Portal refs on `TextEditorModel`** (`src/renderer/editors/text/TextEditorModel.ts:156-176`): `editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`, `editorOverlayRef` + setters. Consumed by:
  - **Toolbar pair** (10 editors): `GridEditor.tsx`, `MarkdownView.tsx`, `MermaidView.tsx`, `SvgView.tsx`, `TodoEditor.tsx`, `LinkEditor.tsx`, `LogViewEditor.tsx`, `DrawView.tsx`, `GraphView.tsx`, `NotebookEditor.tsx` (+ `NoteItemToolbar.tsx` for per-note).
  - **Footer ref** (5 editors): `GridEditor.tsx`, `TodoEditor.tsx`, `LinkEditor.tsx`, `GraphView.tsx`, `NotebookEditor.tsx`.
  - **Overlay ref** (1 editor): `NotebookEditor.tsx` (`createPortal(<ExpandedNoteView/>, model.editorOverlayRef)`).
- **Portal refs on `NoteItemEditModel`** (`src/renderer/editors/notebook/note-editor/NoteItemEditModel.ts:192-245`): toolbar pair + footer + setters. Consumed by `NoteItemToolbar.tsx` and per-note alternative editors via `createPortal`.

### Inherited design decisions (walkthroughs 09 + 10)

All concerns logged in [`concerns.md`](../../epics/EPIC-028-editor-architecture/concerns.md). Load-bearing for US-549:

- **PT1 (b)** — Each editor's view composes shared chrome directly (not RenderEditor-driven). For US-549 this is half-true: text-bearing editors still go through `TextEditorView` (which composes `<TextChrome>` internally); standalone editors keep their own inline composition. Full per-editor inline composition is a Phase C migration concern.
- **PT2 (a)** — Switch widget lives inside `<PageToolbar>`, auto-rendered. Reads `editor.findCompatibleEditors()`; onChange calls `editor.page?.switchMainEditor(v)`.
- **PT3 (a)** — Inline composition for editor-specific toolbar contributions, as children of `<PageToolbar>`. US-549 defers the rewrite of the 10 portaling editor views to Phase C; `<TextChrome>` instead exposes equivalent portal refs internally so the legacy `createPortal(...)` calls keep working unchanged.
- **PT4 (a)** — RenderEditor's category branch retirement is deferred — `RenderEditor.tsx` still dispatches between `<TextEditorView>` (content-view) and `<AsyncEditor>` (standalone) for US-549. US-558 retires the branch when the no-host group migrates and `TextEditorView` is finally deleted.
- **PT5 (a) / B3** — NavPanel auto-renders inside `<PageToolbar>` via `editor.getNavigatorTarget()`. `LegacyEditorAdapter` implements this by special-casing on the wrapped legacy editor's type (TextFileModel / PDF / Image / Video / Archive / Category / other).
- **PT6 / PT7 / PT8** — Compare / Run / Run-all / Show-resources buttons live inside `<TextChrome>`, gated on host capability (`canCompare`, `isScriptLanguage(host.language)`, `host.language === "html"`).
- **PT7 (c) / B2** — Run-all visibility requires `editor.hasTextSelection?.() === true`. `LegacyEditorAdapter` overrides to forward to Monaco's `TextViewModel.state.hasSelection` when the wrapped legacy editor is a `TextFileModel` with an attached textVm. For non-Monaco views, returns false (matching today's behavior — Run-all only shows in Monaco).
- **PT9 (a)** — US-549 retires the toolbar pair refs FROM `TextEditorModel` ONLY in the sense that the refs are owned by `<TextChrome>` rather than the host. The model still exposes `editorToolbarRefFirst` / `editorToolbarRefLast` fields and setter methods (compat shims); `<TextChrome>` wires them via callback refs so the 10 portaling editor consumers continue to work without any per-editor change. The `editorFooterRefLast` and `editorOverlayRef` refs stay fully on the host until each consumer's per-editor migration relocates them.
- **PT10 (c)** — Switch widget visibility predicate: `findCompatibleEditors().length >= 2 && includes(editorId)`. Strict — guarantees the SegmentedControl always has a non-null current value.
- **TC1 (a)** — Single `<TextChrome>` wrapper with `toolbarContributions?` + `footerContributions?` named slots. US-549 introduces the wrapper but only consumes `toolbarContributions` via `TextEditorView`'s internal `TextToolbar`-equivalent contributions; `footerContributions` slot is defined on the props but not used by `TextEditorView` yet (current footer slot stays portal-based).
- **TC2 / C1** — Host-capability discovery via `host instanceof TextFileModel` (full chrome) vs. `host instanceof NoteItemEditModel` (minimal chrome). US-549 wires the `TextFileModel` branch only; the `NoteItemEditModel` branch is NOT exercised in US-549 because Notebook's per-note chrome still lives in `NoteItemToolbar.tsx` and only relocates during US-557 (Notebook migration).
- **TC5 / TC10** — NoteItemToolbar / footer migration → US-557 / Phase C, not US-549.
- **TC6** — Script panel stays host-owned (`TextFileModel.script: ScriptPanelModel`). Chrome renders `<ScriptPanel model={host} />` when `host instanceof TextFileModel && host.script != null`.
- **TC7 (c)** — Notebook's expanded-note overlay inlines into Notebook's own view eventually. Not in US-549; `editorOverlayRef` survives.
- **TC8 (b)** — Focus management: `<TextChrome>`'s outer panel owns the `pagesModel.onFocus` subscription + tabIndex + ref + 200ms refocus. Replaces today's TextEditorView ownership.
- **TC9 (a)** — Keyboard delegation: `<TextChrome>`'s root binds `onKeyDown` and delegates to `host.handleKeyDown?.(e)`. For TextFileModel host, that's `TextFileActionsModel.handleKeyDown` via `TextFileModel.handleKeyDown` — same as today.
- **TC11 (a)** — No new encryption UI. The `encrypted → <TextEditor>` fallback in today's `ActiveEditor.tsx` is preserved: `<TextChrome>` either renders the editor's body as-is and lets each editor handle encrypted state, or short-circuits with a Monaco fallback before rendering children. **Decision:** keep the fallback inside whatever component replaces `ActiveEditor.tsx` (see Step 7 below); `<TextChrome>` does not branch on encryption.

---

## Implementation plan

The plan lands in 9 chunks. Each chunk leaves the codebase compiling, lintable, and visually identical. The agent should run `npm run typecheck` and `npm run lint` after each chunk.

### Step 1 — Add `<PageToolbar>` shared component

**New file:** `src/renderer/editors/base/v4/PageToolbar.tsx`

Implements the auto-rendering toolbar shell per [walkthrough 09 / B1](../../epics/EPIC-028-editor-architecture/mockups/PageToolbar.tsx). Three sub-components:

- `PageToolbar` (default export): wraps `EditorToolbar` (from `src/renderer/editors/base/EditorToolbar.tsx`), renders `<NavPanelButton /> {children} <Spacer /> <SwitchWidget />`. Accepts `model: EditorModel` (v4 base, accepts adapter), `children?`, `borderTop?`, `borderBottom?`.
- `NavPanelButton`: reads `model.getNavigatorTarget()`; returns null if null. Otherwise reads `model.page` (from v4 base) and checks `model.page.canOpenNavigator(target.pipe, target.filePath)`. Renders `<IconButton name="page-nav-panel" size="sm" title="File Explorer" icon={<NavPanelIcon/>} onClick={() => model.page?.toggleNavigator(target.pipe, target.filePath)} />`.
- `SwitchWidget`: reads `model.findCompatibleEditors()`; returns null if `length < 2 || !options.includes(model.editorId)`. Renders `<SegmentedControl items={...} value={model.editorId} onChange={(v) => model.page?.switchMainEditor(v)} size="sm" />` where each item's label comes from the legacy `editorRegistry.getById(id)?.name` (the v4 registry only has metadata-shimmed entries in US-548, so `getById` lookups will also work; preferring the legacy registry keeps name fidelity).

Imports: `EditorToolbar` (legacy real-code primitive — unchanged), `IconButton`, `SegmentedControl`, `Spacer`, `NavPanelIcon`, `editorRegistry` from `../../registry` (legacy registry — has the editor `name` fields).

**Note:** `model.editorId` for adapter-wrapped editors is the value set by `deriveEditorId(legacyState)` in US-548. For text-bearing editors this is `state.editor` ("monaco", "grid-json", etc.); for non-text editors it's the legacy registry id. `findCompatibleEditors()` (LegacyEditorAdapter line 128-132) returns `legacyRegistry.getSwitchOptions(language, filePath).options`. The current `editorId` is in that list because `getSwitchOptions` enumerates every editor's `switchOption(language, filePath)` predicate which includes Monaco (which always returns 0 for any language).

**Export site:** add to `src/renderer/editors/base/v4/index.ts` — `export { PageToolbar } from "./PageToolbar";`.

### Step 2 — Add `getNavigatorTarget()` + `hasTextSelection?()` overrides to `LegacyEditorAdapter`

**Modify:** `src/renderer/editors/base/v4/LegacyEditorAdapter.ts`.

After `findCompatibleEditors()` (line 128), add:

```ts
getNavigatorTarget(): { pipe?: IContentPipe | null; filePath?: string | null } | null {
    const legacy = this.legacy as unknown as {
        type?: string;
        pipe?: IContentPipe | null;
        state: { get(): { filePath?: string; type?: string } };
    };
    const legacyState = legacy.state.get();
    const filePath = legacyState.filePath;
    const pipe = legacy.pipe ?? null;
    const type = legacyState.type ?? legacy.type;

    switch (type) {
        case "textFile":
            // Text editors — predicate `page.canOpenNavigator(pipe, filePath) || filePath`
            // is preserved via the standard target shape. Empty target if neither
            // pipe nor filePath, so the button shows when an Explorer panel is
            // already attached.
            if (!pipe && !filePath) return {};
            return { pipe, filePath };
        case "pdf":
        case "image":
            return { pipe, filePath };
        case "video":
            // Video has no pipe — null explicit.
            return { pipe: null, filePath };
        case "archive":
        case "category":
            // Archive/Category panels are already attached; always-show empty
            // target. Editor's own `toggleNavigator()` accepts no args.
            return {};
        default:
            // Settings, About, MCP-Inspector, Storybook, Browser, Compare,
            // Explorer-as-panel, etc. — no NavPanel button.
            return null;
    }
}

hasTextSelection(): boolean {
    // Monaco view-model exposes hasSelection; defer to it. For non-Monaco
    // editors (Grid, Markdown, etc.) the textVm is null — return false.
    const legacy = this.legacy as unknown as {
        getTextViewModel?: () => { state: { get(): { hasSelection?: boolean } } } | null | undefined;
    };
    const textVm = legacy.getTextViewModel?.();
    return textVm?.state.get().hasSelection === true;
}
```

(Adjust the `getTextViewModel()` shape lookup to match the actual signature in `TextFileModel`.)

**Test note:** when the adapter is the v4 surface for the page's main editor, `getNavigatorTarget()` mirrors today's per-editor predicate exactly. `hasTextSelection()` is read by `<TextChrome>` and (eventually) by Monaco-specific Run-all visibility.

### Step 3 — Add `<TextChrome>` shared component

**New file:** `src/renderer/editors/base/v4/TextChrome.tsx`

Implements per [walkthrough 10 / B1](../../epics/EPIC-028-editor-architecture/mockups/TextChrome.tsx). For US-549 only the `TextFileModel`-host branch is exercised; the `NoteItemEditModel` branch stays dormant until US-557.

Signature:

```ts
interface TextChromeProps {
    model: EditorModel;          // v4 EditorModel (adapter or future native)
    children: ReactNode;          // editor body
    toolbarContributions?: ReactNode;
    footerContributions?: ReactNode;
}
```

Structure (TextFileModel branch only — the only branch US-549 activates):

```tsx
<Panel ref={rootRef} direction="column" flex={1} height={0} position="relative" gap="xs" tabIndex={0} onKeyDown={(e) => host?.handleKeyDown?.(e)}>
    <PageToolbar model={model} borderBottom>
        <CompareButton model={model} host={host} />
        <RunButtons model={model} host={host} />
        {toolbarContributions}
        <ShowResourcesButton host={host} />
        {/* Toolbar portal targets — wired via callback refs that update host.editorToolbarRefFirst / Last */}
        <ToolbarPortalSlots host={host} />
    </PageToolbar>
    {children}
    {host.script && <ScriptPanel model={host} />}
    <PageToolbar model={model} borderTop>
        <ScriptToggleButton host={host} />
        <Spacer />
        {footerContributions && <>{footerContributions}<Divider orientation="vertical" /></>}
        {/* Footer portal target — wired via callback ref that updates host.editorFooterRefLast.
            For US-549 the legacy host-side setFooterRefLast stays alive; the chrome simply forwards. */}
        <FooterPortalSlot host={host} />
        <EncodingLabel host={host} />
    </PageToolbar>
    {/* Overlay portal target — wired via callback ref that updates host.editorOverlayRef. */}
    <div ref={(node) => host?.setEditorOverlayRef?.(node)} className="editor-overlay" />
</Panel>
```

Sub-components:

- `CompareButton`: reads `pagesModel.findPage(model.id)` to resolve owner page, `pagesModel.getLeftGroupedPage(model.id)` to get the left, gates on `pagesModel.canCompare(left.id, owner.id)`. Replicates `TextToolbar.tsx:100-119`. (Use the existing legacy methods on `pagesModel` exposed by US-548 — `findPage`, `getLeftGroupedPage`, `canCompare` are all on the `query` slice already.)
- `RunButtons`: subscribes to `host.state.use(s => s.language)`; uses `model.hasTextSelection?.() ?? false`. Renders Run + (when hasSelection) Run-all.
- `ShowResourcesButton`: subscribes to `host.state.use(s => s.language)`; gates on `=== "html"`. onClick invokes the same `showHtmlResources(model)` body as `TextToolbar.tsx:205-215` (relocate the helper next to `<TextChrome>` or keep at `TextToolbar.tsx` and import).
- `ScriptToggleButton`: subscribes to `host.script.state.use(s => s.open)`; mirrors `TextFooter.tsx:35-48`.
- `EncodingLabel`: subscribes to `host.state.use(s => s.encoding)`; mirrors `TextFooter.tsx:62-67`.
- `ToolbarPortalSlots`: renders `<>{editor && editor !== "monaco" && (<><div ref={node => host.setEditorToolbarRefFirst(node)} /><div ref={node => host.setEditorToolbarRefLast(node)} /></>)}</>` (matches today's conditional rendering in `TextToolbar.tsx:166-187` — slots only mount when an alternative editor is active so Monaco doesn't get phantom DOM nodes).
- `FooterPortalSlot`: same pattern; mounts only when editor !== "monaco". Wires `host.setFooterRefLast`.

Focus subscription mirrors `TextEditorView.tsx:22-33`: `useEffect` subscribing to `pagesModel.onFocus` with 200ms refocus.

`onKeyDown` delegates to `host.handleKeyDown` — same as `TextEditorView.tsx:45`.

`host` is obtained as: `const host = model.contentHost as TextFileModel | null` and `if (!host) return null;` early-out. For adapter-wrapped TextFileModel-backed editors, `contentHost` defaults to null on the v4 base — **add a getter override in `LegacyEditorAdapter`**:

```ts
get contentHost(): IContentHost | null {
    // For text-bearing legacy editors, the host IS the wrapped legacy model
    // (TextFileModel implements IContentHost in a duck-typed sense — it has
    // state, content, language, encoding, runScript, handleKeyDown, etc.).
    // For non-text legacy editors, no host.
    const type = (this.legacy.state.get() as { type?: string }).type;
    if (type === "textFile") {
        return this.legacy as unknown as IContentHost;
    }
    return null;
}
```

**Note:** TextFileModel today is NOT a literal `IContentHost` implementation — `IContentHost` is the v4 interface from US-547. But for US-549 the duck-typed cast is sufficient because `<TextChrome>` only accesses fields TextFileModel already exposes (`state`, `script`, `setEditorToolbarRefFirst/Last`, `setFooterRefLast`, `setEditorOverlayRef`, `handleKeyDown`, `runScript`, `language`, `encoding`). Per-editor migration (US-551) replaces this with a real `TextFileModel implements IContentHost`.

**Export site:** add to `src/renderer/editors/base/v4/index.ts` — `export { TextChrome } from "./TextChrome";`.

### Step 4 — Rewire `TextEditorView` to compose `<TextChrome>` internally

**Modify:** `src/renderer/editors/text/TextEditorView.tsx`

Replace the existing body with:

```tsx
import { TextChrome } from "../base/v4/TextChrome";
import { ActiveEditor } from "./ActiveEditor";
import { TextFileModel } from "./TextEditorModel";
import { LegacyEditorAdapter } from "../base/v4";
import { pagesModel } from "../../api/pages";

interface TextEditorViewProps {
    model: TextFileModel;
}

export function TextEditorView({ model }: TextEditorViewProps) {
    const { restored } = model.state.use((s) => ({ restored: s.restored }));
    // Resolve the page's main v4 editor (an adapter wrapping `model`). TextChrome
    // reads `model.contentHost` / `findCompatibleEditors()` / `getNavigatorTarget()`
    // through the v4 surface, so we pass the adapter, not the raw TextFileModel.
    const page = pagesModel.findPage(model.id);
    const v4Main = page?.mainEditorV4 ?? null;
    if (!v4Main) {
        // Defensive — should not happen post US-548. Render bare body so user
        // isn't blocked.
        return restored ? <ActiveEditor model={model} /> : null;
    }
    return (
        <TextChrome model={v4Main}>
            {restored ? <ActiveEditor model={model} /> : null}
        </TextChrome>
    );
}
```

(Adjust signature of `mainEditorV4` to match what US-548 actually exposes — confirm via `pagesModel.findPage(model.id)?.mainEditorV4`.)

The outer `<Panel>` + onKeyDown + onFocus subscription move INTO `<TextChrome>` (Step 3). The bottom `<PageToolbar>` + `<TextFooter>` + overlay div all move INTO `<TextChrome>`. `<TextToolbar>` is consumed by `<TextChrome>`'s internal sub-components.

### Step 5 — Trim `TextToolbar.tsx` (relocate text-host buttons into `<TextChrome>` sub-components)

**Modify:** `src/renderer/editors/text/TextToolbar.tsx`

Two paths to choose between (see [Open Question Q3](#concerns--open-questions)):

- **(a) Delete `TextToolbar.tsx` entirely** and inline its NavPanel / Compare / Run / Show-resources / SegmentedControl logic into `<TextChrome>` sub-components. Cleanest. NavPanel goes to `PageToolbar`'s `<NavPanelButton>` (already), Compare goes to `CompareButton`, Run/Run-all to `RunButtons`, Show-resources to `ShowResourcesButton`, SegmentedControl to `<SwitchWidget>`. Portal-target divs (`ToolbarPortalSlots`) live inside `<TextChrome>`. Nothing left of `TextToolbar.tsx`.

- **(b) Keep `TextToolbar.tsx` as a stub** that just renders `null` or re-exports nothing. Eases git-blame continuity.

**Recommendation: (a)** — delete it. The component dissolves with `TextEditorView`'s rewrite.

### Step 6 — Delete `TextFooter.tsx`

**Delete:** `src/renderer/editors/text/TextFooter.tsx`

All its responsibilities (script toggle, footer portal, encoding label) move into `<TextChrome>`'s bottom `<PageToolbar>` sub-components per Step 3. The host-side `setFooterRefLast` setter on `TextEditorModel` stays alive — the chrome's `<FooterPortalSlot>` wires into it.

### Step 7 — Decide `ActiveEditor.tsx` fate

`ActiveEditor.tsx` (`src/renderer/editors/text/ActiveEditor.tsx`) dispatches Monaco vs. alternative vs. encrypted. Options:

- **(a) Keep as-is** — `<TextChrome>` renders `<ActiveEditor model={model} />` as its child. Encryption fallback continues to work; alternative editors continue to load via `<AsyncEditor>`. Smallest scope; US-549 doesn't touch the editor module dispatch.
- **(b) Inline into `<TextChrome>`** — TextChrome's `children` slot is replaced by the dispatch logic; ActiveEditor.tsx is deleted. Harder because `<TextChrome>` would become text-editor-specific and lose generality.

**Recommendation: (a)** — keep ActiveEditor. US-549 doesn't touch the editor body dispatch; that's a Phase C concern.

### Step 8 — Remove the six inline NavPanel `IconButton` blocks

**Modify (delete the `(canOpenNavigator || filePath) && <IconButton>` block in each):**

1. `src/renderer/editors/text/TextToolbar.tsx` — already gone via Step 5.
2. `src/renderer/editors/pdf/PdfViewer.tsx` (lines ~118-130) — the NavPanel button inside the page's `<PageToolbar>`. Replace by switching from the **legacy** `PageToolbar` import (`base/EditorToolbar`) to the **new** `<PageToolbar model={editor}>` shared component. The model passed needs to be the v4 adapter — resolve via `pagesModel.findPage(model.id)?.mainEditorV4` analogous to Step 4. Remove the manual `<IconButton>` block. Keep the existing `<Spacer />` and any other contents.
3. `src/renderer/editors/image/ImageViewer.tsx` (lines ~263-274) — same pattern. Note: uses `Toolbar` import alias (line 264) — switch to the v4 `<PageToolbar>`. Keep the `<Spacer />` + Save + zoom buttons unchanged.
4. `src/renderer/editors/video/VideoPlayerEditor.tsx` (lines ~440-449) — same pattern.
5. `src/renderer/editors/archive/ArchiveEditorView.tsx` (lines ~62-69) — same pattern.
6. `src/renderer/editors/category/CategoryEditor.tsx` (lines ~119-128 and ~138-148 — two render branches). Same pattern. **Note:** Category passes no args to `toggleNavigator()`. The new `<NavPanelButton>` inside `<PageToolbar>` calls `model.page?.toggleNavigator(target.pipe, target.filePath)`; for Category, `getNavigatorTarget()` returns `{}` (empty target), so `target.pipe === undefined` and `target.filePath === undefined` — `toggleNavigator(undefined, undefined)` should behave as no-args. **Verify** `PageModel.toggleNavigator` accepts undefined args without misbehaving; if not, special-case via parameter check inside `toggleNavigator`.

Verification per editor: launch the app, open a PDF / image / video / archive / category, click the NavPanel button. Behavior should be identical to today.

### Step 9 — Defer `editorFooterRefLast` + `editorOverlayRef` retirement

US-549 does NOT touch:
- `editorFooterRefLast` field, `setFooterRefLast` setter on `TextEditorModel` and `NoteItemEditModel`.
- `editorOverlayRef` field, `setEditorOverlayRef` setter on `TextEditorModel`.
- The 5 editor consumers of `editorFooterRefLast` (`createPortal` blocks).
- The 1 editor consumer of `editorOverlayRef` (`NotebookEditor.tsx`'s expanded-note portal).
- `NoteItemToolbar.tsx` — stays unchanged (its migration into `<TextChrome>`'s NoteItemEditModel branch is US-557).

These are walkthrough-10 / TC5 / TC7 / TC10 territory; they migrate during per-editor Phase C work.

---

## Files changed summary

| File | Change | Lines (approx) |
|------|--------|----------------|
| `src/renderer/editors/base/v4/PageToolbar.tsx` | **NEW** — shared toolbar shell with NavPanel + switch widget auto-slots | ~80 |
| `src/renderer/editors/base/v4/TextChrome.tsx` | **NEW** — host-aware chrome wrapper (TextFileModel branch only for US-549) | ~250 |
| `src/renderer/editors/base/v4/LegacyEditorAdapter.ts` | Add `getNavigatorTarget()`, `hasTextSelection()`, `contentHost` getter overrides | +50 |
| `src/renderer/editors/base/v4/index.ts` | Add `PageToolbar`, `TextChrome` exports | +2 |
| `src/renderer/editors/text/TextEditorView.tsx` | Rewrite to compose `<TextChrome>` internally | -60 / +30 |
| `src/renderer/editors/text/TextToolbar.tsx` | **DELETE** (responsibilities absorbed by `<TextChrome>` sub-components) | -215 |
| `src/renderer/editors/text/TextFooter.tsx` | **DELETE** (responsibilities absorbed by `<TextChrome>` sub-components) | -70 |
| `src/renderer/editors/pdf/PdfViewer.tsx` | Switch to v4 `<PageToolbar>`; delete inline NavPanel block | -15 |
| `src/renderer/editors/image/ImageViewer.tsx` | Switch to v4 `<PageToolbar>`; delete inline NavPanel block | -15 |
| `src/renderer/editors/video/VideoPlayerEditor.tsx` | Switch to v4 `<PageToolbar>`; delete inline NavPanel block | -15 |
| `src/renderer/editors/archive/ArchiveEditorView.tsx` | Switch to v4 `<PageToolbar>`; delete inline NavPanel block | -10 |
| `src/renderer/editors/category/CategoryEditor.tsx` | Switch to v4 `<PageToolbar>` (×2 branches); delete inline NavPanel blocks | -25 |
| `doc/tasks/US-549-shared-chrome/README.md` | **NEW** — this task doc | — |
| `doc/active-work.md` | Link US-549 entry to task doc | +1 / -1 |

## Files NOT changing (so the implementer doesn't go searching)

- `src/renderer/editors/base/EditorToolbar.tsx` — pure styled `<Panel>` primitive; survives. The new `<PageToolbar>` wraps it.
- `src/renderer/editors/text/TextEditorModel.ts` — portal refs (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`, `editorOverlayRef`) and setters stay. Field reachable from new chrome via callback refs.
- `src/renderer/editors/text/ScriptPanel.tsx` — unchanged.
- `src/renderer/editors/text/ActiveEditor.tsx` — unchanged.
- `src/renderer/editors/text/TextFileActionsModel.ts` — unchanged. `handleKeyDown` is still on the host.
- `src/renderer/editors/notebook/note-editor/NoteItemToolbar.tsx` — unchanged. Per-note migration belongs to US-557.
- `src/renderer/editors/notebook/note-editor/NoteItemEditModel.ts` — unchanged.
- The 10 portaling editor views: `GridEditor.tsx`, `MarkdownView.tsx`, `MermaidView.tsx`, `SvgView.tsx`, `TodoEditor.tsx`, `LinkEditor.tsx`, `LogViewEditor.tsx`, `DrawView.tsx`, `GraphView.tsx`, `NotebookEditor.tsx`. Their `createPortal(..., model.editorToolbarRefLast)` calls continue to work because the refs are still on `TextEditorModel` and `<TextChrome>` wires the same setters.
- `src/renderer/ui/app/RenderEditor.tsx` — unchanged. Two-branch dispatch (standalone vs. content-view → TextEditorView) survives. PT4's collapse to a single uniform `<AsyncEditor>` path lands during the final no-host group migration (US-558).
- `src/renderer/api/pages/PagesModel.ts` / `PagesQueryModel.ts` / `PagesLayoutModel.ts` — `findPage`, `getLeftGroupedPage`, `canCompare`, `enterCompareMode`, `exitCompareMode` already exist from US-548. No change.
- Legacy `editorRegistry` at `src/renderer/editors/registry.ts` — unchanged. `getSwitchOptions`, `getById` consumed by `<SwitchWidget>` / `LegacyEditorAdapter.findCompatibleEditors()` as-is.
- v4 `editorRegistry` at `src/renderer/editors/base/v4/editorRegistry.ts` — unchanged.
- `src/renderer/scripting/transpile.ts` `isScriptLanguage` — unchanged.
- `src/renderer/core/utils/html-resources.ts` `extractHtmlResources` — unchanged.
- All UIKit primitives (`Panel`, `Spacer`, `Divider`, `IconButton`, `Button`, `Splitter`, `SegmentedControl`) — unchanged.

---

## Concerns / Open questions

### Q1 — Scope of toolbar portal-ref retirement in US-549 — **RESOLVED: (b)** move-not-retire

**Question:** Walkthrough 09 / PT9 mandates that `editorToolbarRefFirst` + `editorToolbarRefLast` retire fully in US-549 — which requires rewriting all 10 portaling editor views (Grid, Markdown, Mermaid, SVG, Todo, Link, LogView, Draw, Graph, Notebook + per-note) to inline-compose their toolbar contributions instead of using `createPortal`. EPIC-028.md's US-549 scope summary says the same. But Phase A is supposed to be foundation-only — per-editor view rewrites belong to Phase C migrations (US-551–US-558).

**Options:**

- **(a) Full retirement now** — US-549 rewrites all 10 editor views to inline composition (delete every `createPortal(model.editorToolbarRefLast)` block, render contributions as JSX children inside the editor's own component which it returns up to TextEditorView via a new mechanism). Means US-549 touches 10 editor files, plus needs a way for each editor to express its toolbar contributions to its parent (since editors don't yet compose `<TextChrome>` directly under PT4 (a) — that's PhaseC). Workable but invents an intermediate API.

- **(b) Move-not-retire** — US-549 keeps the toolbar ref fields on `TextEditorModel`, but `<TextChrome>` is the one that wires them via callback refs. The 10 editor views continue to portal into `model.editorToolbarRefLast` exactly as today. Full retirement happens incrementally during each editor's Phase C migration (the migrated editor's view composes `<TextChrome>` directly with inline contributions); final ref deletion is US-559 cleanup. *(This is what the plan above proposes.)*

- **(c) Retire only the first ref pair** — delete `editorToolbarRefFirst` (used by only Grid + Link + Notebook), keep `editorToolbarRefLast`. Sub-set of (a). Saves rewriting the 3 First-using editors but doesn't pay for itself.

**Recommendation: (b).** The strangler-fig model's value is exactly this: the new architecture lands without forcing simultaneous rewrites of every consumer. (a) is a Phase A → Phase C scope creep; (b) keeps US-549 boundaries clean and lets per-editor migrations remove portals one editor at a time. Walkthrough 09 / PT9's "real-code consequences" list describes the **eventual** retirement target, not the US-549 scope.

### Q2 — Location of new shared chrome components — **RESOLVED: (a)** `src/renderer/editors/base/v4/`

**Question:** Where should `PageToolbar.tsx` and `TextChrome.tsx` live?

**Options:**

- **(a) `src/renderer/editors/base/v4/`** — alongside `EditorModel.ts`, `LegacyEditorAdapter.ts`, `IContentHost.ts`. The whole v4 architecture is consolidated under one folder; chrome is part of v4. *(What the plan above proposes.)*

- **(b) `src/renderer/uikit/`** — they're UIKit-style shared components (no editor-specific state). Reusable across whatever needs the shape.

- **(c) `src/renderer/editors/base/`** (alongside legacy `EditorToolbar.tsx`) — pre-existing chrome folder.

**Recommendation: (a).** The components depend on v4 `EditorModel`, `getNavigatorTarget()`, `findCompatibleEditors()`, `contentHost`. Coupling to v4 is tight; keeping them in `base/v4/` makes the dependency boundary explicit. (b) is wrong — these components query an `EditorModel`, which is a `editors/` concept. (c) blurs the v4-vs-legacy line that US-547 introduced.

### Q3 — Delete vs. stub `TextToolbar.tsx` / `TextFooter.tsx` — **RESOLVED: (a)** delete outright

**Question:** When their bodies relocate, do we delete the files outright or keep stub re-exports?

**Options:**

- **(a) Delete outright** — no consumers outside `TextEditorView` (verified via grep). Cleanest. *(Plan default.)*

- **(b) Keep as one-line stubs** — easier to see what was where in git blame.

**Recommendation: (a).** No external consumers; git history is sufficient for blame.

### Q4 — `contentHost` getter on `LegacyEditorAdapter` — **RESOLVED: (a)** duck-typed cast

**Question:** The plan adds a duck-typed `contentHost` getter on `LegacyEditorAdapter` that returns the wrapped `TextFileModel` cast as `IContentHost`. Per US-547 / C1, `IContentHost` is a v4 interface. TextFileModel doesn't implement it (no v4 fields). The cast works because `<TextChrome>` only reads fields TextFileModel exposes natively. Acceptable strangler-fig shortcut or risky?

**Options:**

- **(a) Duck-typed cast** — acceptable; the chrome contract is "host has state/script/etc."; TextFileModel happens to match. *(Plan default.)*

- **(b) Wrap with adapter** — create a `LegacyContentHostAdapter` that wraps `TextFileModel` and implements `IContentHost` formally. More code; no behavioral benefit until US-551 retires it anyway.

- **(c) Keep `contentHost` returning null on `LegacyEditorAdapter`; `<TextChrome>` reads `(model as LegacyEditorAdapter).legacy as TextFileModel` directly** — bypasses the v4 abstraction entirely for US-549.

**Recommendation: (a).** The duck-typed cast is honest about what the strangler period is: temporary cohabitation. Per-editor migrations (US-551 specifically) will turn the cast into a real `class TextFileModel implements IContentHost`; until then the cast documents the contract.

### Q5 — Switch widget for adapter-wrapped editors — `switchMainEditor` vs. `model.changeEditor` — **RESOLVED: (c)** verify during Step 1; fall back to (b) special-case if (a) doesn't already work

**Question:** `<SwitchWidget>` calls `model.page?.switchMainEditor(v)`. For text-bearing legacy editors that switch IS still legacy `model.changeEditor(view)` (US-548 left this in place because LegacyEditorAdapter throws in `switchFrom`). Does `PageModel.switchMainEditor` correctly route to `model.changeEditor` for the LegacyEditorAdapter case?

**Investigation needed:** read `PageModel.switchMainEditor` from US-548 and confirm the fallback path. If it throws (because `switchFrom` throws), the switch widget breaks. The plan assumes `switchMainEditor` short-circuits when the new editor id matches the current adapter's wrapped legacy view — needs verification.

**Options:**

- **(a) US-548's `switchMainEditor` already does the right thing for adapter-wrapped editors** — verify, fix if not.

- **(b) `<SwitchWidget>` special-cases LegacyEditorAdapter** — if `model instanceof LegacyEditorAdapter`, call `model.legacy.changeEditor(v)` directly. Bypass the v4 path until per-editor migration.

- **(c) Defer to US-549 implementation — investigate during Step 1 of the plan**

**Recommendation: (c).** Mark as a Step-1 verification task. The right behavior is (a); falling back to (b) is acceptable insurance.

### Q6 — `pagesModel.canOpenNavigator` / `toggleNavigator` for `{}` empty target — **RESOLVED: (b)** defensive guard for empty target; drop if verification confirms (a) suffices

**Question:** For Archive/Category, `getNavigatorTarget()` returns `{}` (empty target). `<PageToolbar>`'s `<NavPanelButton>` calls `model.page?.canOpenNavigator(target.pipe, target.filePath)` with both `undefined`. Today Archive/Category render NavPanel unconditionally (no `canOpenNavigator` guard) because their panel is always attached. Does `canOpenNavigator(undefined, undefined)` return true when the panel is attached?

**Investigation needed:** read `PageModel.canOpenNavigator` and confirm. If it requires non-null pipe or filePath, Archive/Category will lose their NavPanel button after the refactor — visual regression.

**Options:**

- **(a) `canOpenNavigator(undefined, undefined)` already returns true when a sidebar/panel exists** — verify; if true, plan stands.

- **(b) Special-case empty-target handling in `<NavPanelButton>`** — if `Object.keys(target).length === 0`, skip the `canOpenNavigator` predicate and always render.

- **(c) Add a `predicate` field to the target shape** — `{ predicate: "always" | "has-explorer" }` — overcomplex.

**Recommendation: (b)** as defensive guard. If verification (a) succeeds, drop the special case.

### Q7 — Pages that don't have an adapter-wrapped main editor — **RESOLVED:** defensive early return in `TextEditorView` when `mainEditorV4` is null

**Question:** Step 4's `TextEditorView` rewrite resolves `v4Main = pagesModel.findPage(model.id)?.mainEditorV4`. Per US-548, every page's main editor IS an adapter-wrapped editor (the auto-bridge in `register-editors.ts` ensures it). Is there a window between `addPage` and the main editor's `restore()` where `mainEditorV4` is null?

**Investigation needed:** verify the timing in `PagesLifecycleModel.attachPage` / `restorePage`.

**Recommendation:** Add a defensive early return in TextEditorView when `mainEditorV4` is null (render bare body or null). Documented in the plan; should be a no-op in practice.

### Q8 — `<TextChrome>` consumed by `TextEditorView` only — **RESOLVED: (a)** introduce now

**Question:** US-549 introduces `<TextChrome>` but the only consumer is the rewired `TextEditorView`. Is the abstraction warranted now, or should we wait?

**Options:**

- **(a) Introduce `<TextChrome>` now** — Phase A foundation. The component shape is locked-in by walkthrough 10; Phase C editor migrations will compose it directly. Landing it now means Phase C migrations don't have to invent the wrapper. *(Plan default.)*

- **(b) Skip `<TextChrome>` for US-549; only land `<PageToolbar>`** — defer TextChrome to US-551 (Monaco migration). Cleaner Phase A boundary.

**Recommendation: (a).** EPIC-028.md / Phase A explicitly lists "Add `<PageToolbar>` and `<TextChrome>` shared components" as US-549 scope. Per-editor migrations are easier when the shared chrome already exists.

### Q9 — Where does `showHtmlResources` live? — **RESOLVED: (a)** inline into `<ShowResourcesButton>`

**Question:** Today's helper is a private function at the bottom of `TextToolbar.tsx` (lines 205-215). When `TextToolbar.tsx` is deleted, the helper needs a new home.

**Options:**

- **(a) Inline into `<ShowResourcesButton>` inside `<TextChrome>`** — small enough; one consumer.

- **(b) Move to `src/renderer/core/utils/html-resources.ts`** (alongside `extractHtmlResources`) — modularize.

**Recommendation: (a).** One call site, ~10 lines.

### Q10 — Naming: `<PageToolbar>` vs. legacy `PageToolbar` alias — **RESOLVED: (a)** delete the legacy alias; migrate six imports

**Question:** `src/renderer/editors/base/EditorToolbar.tsx` exports `EditorToolbar as PageToolbar` (legacy alias). The new shared component is also `PageToolbar`. Name clash in any consumer that imports both.

**Investigation:** grep `import { PageToolbar }` — six standalone editors today import it (PDF, Image, Video, Archive, Category — and from any text-related file). After Step 8 migrates them to the new `<PageToolbar>`, the legacy alias becomes dead code. Decision: either keep the legacy alias (no migration; just re-export from the new path) or delete the alias and update all six imports.

**Options:**

- **(a) Delete the legacy `PageToolbar` alias in `EditorToolbar.tsx`** and update all six standalone editor imports to the new path (`from "../base/v4/PageToolbar"`). Cleanest. *(Plan default — Step 8 already does this.)*

- **(b) Keep the legacy alias** as a thin re-export of the new shared component. Backward-compat shim; eases git blame.

**Recommendation: (a).** Six imports is a small migration; alias-mismatch in editor code is a confusion magnet during the strangler period.

---

## Acceptance criteria

1. `npm run typecheck` passes with zero NEW errors. (Baseline US-548: 18 errors, all pre-existing.)
2. `npm run lint` passes with zero NEW errors. (Baseline US-548: 49 errors, all pre-existing.)
3. App launches; opening a `.md`, `.json` (grid + monaco), `.csv` (grid), `.log`, `.todo`, `.link`, `.pdf`, image, video, archive, category each renders with identical chrome to before the task (toolbar buttons, footer, script panel, switch widget all in same positions).
4. Switch widget on a `.json` page switches between Monaco and grid-json correctly (same behavior as today via legacy `changeEditor`).
5. NavPanel button works on TextFile, PDF, Image, Video, Archive, Category pages — identical to today's behavior.
6. Compare-with-left button appears on grouped TextFile pairs; enters compare mode when clicked.
7. Run-script / Run-all-script buttons appear and execute correctly on JS/TS pages; Run-all only when Monaco shows a selection.
8. Show-resources button appears on HTML pages; extracts and opens resource links.
9. Script panel toggle works; script panel opens/closes/persists across editor switch.
10. Footer encoding label shows correct encoding; per-editor footer status (Grid row count, Notebook "N notes", etc.) still renders correctly via the preserved `editorFooterRefLast` portal.
11. Notebook expanded-note overlay still works (preserved `editorOverlayRef`).
12. Per-note editor (NoteItemToolbar in Notebook) unchanged.
13. Ten portaling editor views (Grid, Markdown, Mermaid, SVG, Todo, Link, LogView, Draw, Graph, Notebook + per-note) still render their toolbar contributions correctly via the preserved `editorToolbarRefLast` portal.
14. Restart preserves all state correctly (no persistence change in US-549).
