# US-550: MCP + scripting facades partial

**Epic:** [EPIC-028 — Unified Editor Architecture](../../epics/EPIC-028.md)
**Phase:** B — Cross-cutting (single task)
**Status:** Ready to implement (all concerns resolved 2026-05-21)
**Depends on:** US-547 (foundation primitives, commit `abead6f`), US-548 (PageModel adapter layer, commit `26ecc8d`), US-549 (shared chrome, commit `f5a9c1b`)
**Blocks:** Phase C per-editor migrations (US-551+)
**Walkthroughs:** [12 — Scripting facades](../../epics/EPIC-028-editor-architecture/walkthroughs/12-scripting-facades.md), [13 — MCP integration](../../epics/EPIC-028-editor-architecture/walkthroughs/13-mcp-integration.md)

---

## Goal

Apply the cross-cutting MCP + scripting-facade changes that the per-editor migrations (US-551+) need to land cleanly. Three concrete deliverables:

1. **MCP wire-shape cleanup** — `getPages` / `getActivePage` / `createPage` row shape drops the legacy `type` discriminator (MI1 / MI5); `editor` / `language` / `filePath` route through the v4 surface (`editor.editorId`, `editor.contentHost?.state.get().language`, `pagesModel.getTextFileHost(p.id)?.state.get().filePath`).
2. **`page.asX(force?: boolean)` parameter** — 11 ViewModel-backed facade methods gain an optional `force` argument (SF1). Default behavior throws when the page isn't already the target editor; `force = true` checks `model.findCompatibleEditors()` and switches the page (using the same legacy-adapter path US-549's `<SwitchWidget>` already uses).
3. **`PageWrapper.type` retirement + `set editor(v)` rewrite** — drop `get type()` from `PageWrapper`; drop `readonly type: string` from `IPage` (SF5). `set editor(v)` adopts `page.switchMainEditor(v).catch(ui.notify)` with the same `LegacyEditorAdapter`-special-case as the switch widget (SF4). `asBrowser()` / `asMcpInspector()` flip from `state.type === "..."` gates to `instanceof` checks (SF8).

What does **not** land in US-550 (deferred to later tasks):

- `acquireViewModel` / `releaseViewModel` / `ContentViewModelHost` retirement (SF2) — full retirement falls out as each editor migrates in Phase C; US-553's LogView migration retires the final renderer-side `acquireViewModelSync` call site.
- `releaseList` parameter drop from `PageWrapper` + `PageCollectionWrapper` (SF3) — the 11 `asX()` push sites are still load-bearing because `acquireViewModel` hasn't retired yet. SF3 lands when SF2 is fully done.
- `EditorView` literal-string union retirement from `src/shared/types.ts` (SF10) — moves to `api/types/page.d.ts` only when the internal type retires; that's Phase D (US-559).
- `ComponentQueue.execute` / `register` request/reply half + `TextEditorFacade` async migration (SF6) — landing in US-551 (Monaco walkthrough 20 / MO finalizes the `MonacoQueueRequest` union).
- `EditorDefinition.category` → `hasContentHost` flip on the legacy registry (MI3) — the v4 registry already has `hasContentHost`; the legacy registry's `category` field stays until full migration. The `create_page` filter keeps `category === "standalone"` for US-550.

User-visible behavior changes:

- `page.asGrid()` without `true` on a JSON-in-Monaco page now **throws** instead of silently switching to Grid. Existing scripts that relied on implicit promotion must be updated to `page.asGrid(true)`. **This is a breaking change for scripts.** Documented in the release notes for the EPIC-028 cut-over (US-559).
- MCP clients reading the `type` field from `get_pages` / `get_active_page` / `create_page` row shape will see the field disappear. The `editor` field carries the canonical discriminator and matches today's mapping verbatim. **Breaking change for external MCP clients.** Mirrors SF5 — zero documented consumers (`notepad://guides/pages` doesn't mention `type`).
- `page.type` from scripts: same drop. Zero internal callers; release notes flag.

---

## Background

### What US-547 / US-548 / US-549 left in place

- **v4 EditorModel base** exposes `editorId` (string), `contentHost: IContentHost | null` (default null; adapter overrides for textFile-typed legacy editors), `findCompatibleEditors(): string[]`, `getNavigatorTarget()`, optional `hasTextSelection?()` (US-549).
- **LegacyEditorAdapter** at `src/renderer/editors/base/v4/LegacyEditorAdapter.ts`:
  - `get editorId(): string` — re-derives via `deriveEditorId(state.get())` on every read (US-549's fix for the SegmentedControl stale-state bug).
  - `get contentHost(): IContentHost | null` — for legacy state.type === "textFile", returns the wrapped `TextFileModel` via duck-typed cast.
  - `findCompatibleEditors(): string[]` — `legacyRegistry.getSwitchOptions(language, filePath).options`. Returns `[]` when only one editor would match (today's UI behavior — switch widget hides).
  - `switchFrom(...)` — throws. US-549's `<SwitchWidget>` and `PageModel.switchMainEditor` both special-case `LegacyEditorAdapter` and call `legacy.changeEditor(view)` directly.
- **`PageModel.switchMainEditor(newEditorId: string)`** (US-548) — at `src/renderer/api/pages/PageModel.ts:392`. Short-circuits when `oldEditor.editorId === newEditorId`. For the strangler period it ALSO special-cases `LegacyEditorAdapter` so adapter-wrapped editors switch via legacy `changeEditor(view)`. **Verify during Step 1** that this path is the one we want `page.editor = "..."` to use; US-549's switch-widget code in `PageToolbar.tsx:94-106` already proves the shape works.
- **`pagesModel.getTextFileHost(pageId): TextFileModel | null`** (US-548) at `PagesQueryModel.ts:80`. Already used by `mcp-handler.ts` in five sites (`getPageContent`, `setPageContent`, `getOrCreateMcpLogViewModel`, `logIncomingRequest`, `showMcpRequestLog`).

### Current shape of mcp-handler.ts

`src/renderer/api/mcp-handler.ts` — already partly migrated by earlier tasks:

- `getPageContent` / `setPageContent` already route through `pagesModel.getTextFileHost(...)`. **MI2 is effectively already done.** US-550 needs only confirmation comments and a TypeScript-level guarantee (no `isTextFileModel` calls remain in the handler).
- LogView VM acquisition (`getOrCreateMcpLogViewModel`, `logIncomingRequest`, `showMcpRequestLog`) also routes through `getTextFileHost`. The `acquireViewModelSync("log-view")` call stays — under EPIC-028 it's a temporary bridge. Full retirement (MI4's `instanceof LogViewEditorModel`) lands in US-553.
- `getPages` / `getActivePage` row shape still pulls `type`, `editor`, `language`, `filePath` from the editor's flat state (`s = editor.state.get()` where state is a `IEditorState`). This is the MI1 / MI5 cleanup target.
- `createPage` standalone-editor filter uses `editorDef.category === "standalone"`. MI3's flip to `!hasContentHost` is **deferred**.

### Current shape of PageWrapper.ts (`src/renderer/scripting/api-wrapper/PageWrapper.ts`)

- Constructor takes `(model, releaseList, outputFlags?)`. **`releaseList` stays** — 11 push sites inside `asX()` methods still depend on it because `acquireViewModel` is still in use.
- 11 ViewModel-backed `asX()` methods today:
  - Pattern: `if (!isTextFileModel(model)) throw ...; const vm = await model.acquireViewModel("X-view") as XViewModel; releaseList.push(() => model.releaseViewModel("X-view")); return new XEditorFacade(vm);`
  - Methods: `asText`, `asGrid`, `asNotebook`, `asTodo`, `asLink`, `asMarkdown`, `asSvg`, `asHtml`, `asMermaid`, `asGraph`, `asDraw`.
  - `asGrid` has the extra `resolveGridEditorId()` step that reads `model.state.get().editor` + `model.state.get().language`.
- 2 direct-model `asX()` methods today (no acquireViewModel):
  - `asBrowser`: `if (this.model.state.get().type !== "browserPage") throw ...; return new BrowserEditorFacade(this.model as unknown as BrowserEditorModel);`
  - `asMcpInspector`: same shape with `"mcpInspectorPage"` and `McpInspectorEditorModel`.
- `get editor(): EditorView` reads `state.get().editor ?? "monaco"`. `set editor(v)` calls `model.changeEditor(v)` after `isTextFileModel` gate.
- `get type()` reads `state.get().type` (just the field — used by zero callers per SF5's grep).

### Current shape of `IPage` type (`src/renderer/api/types/page.d.ts`)

11 ViewModel-backed facade methods + 2 direct-model facade methods. `readonly type: string` field exists but has zero documented consumers. The script-API `EditorView` literal union is imported from `./common.d.ts` (which re-exports from `src/shared/types.ts:26-48`).

### Inherited design decisions (walkthroughs 12 + 13)

All concerns logged in [`concerns.md`](../../epics/EPIC-028-editor-architecture/concerns.md). Load-bearing for US-550:

- **MI1 (a)** — Drop `type` from `get_pages` / `get_active_page` rows. Source `editor` from `editor.editorId` (S10); `language` from `editor.contentHost?.state.get().language` (P4); `filePath` from `pagesModel.getTextFileHost(p.id)?.state.get().filePath` for host-backed pages, fall back to `state.get().filePath` for non-text editors (PDF / Image / Video carry it on the editor state).
- **MI2 (b)** — Confirmed-already-done. `getPageContent` + `setPageContent` use `getTextFileHost`.
- **MI3 (a)** — Flip `category === "standalone"` to `!hasContentHost`. **Deferred** for US-550 — needs `hasContentHost` on every editor in the legacy registry. Lands during full registry retirement (US-559). For US-550 the `category === "standalone"` check stays; the `log-view` hint table entry (per MI3) lands now anyway as a defensive forward.
- **MI4 (a)** — `acquireViewModelSync("log-view")` → `instanceof LogViewEditorModel`. **Deferred** to US-553 (LogView migration creates the `LogViewEditorModel` class).
- **MI5 (a)** — `createPage` return shape: `editor: page.mainEditor?.editorId`, `language: page.mainEditor?.contentHost?.state.get().language`. Drop `s?.editor` / `s?.language` reads.
- **SF1 (d)** — Eleven ViewModel-backed facades gain `force?: boolean`. Default throws; `force = true` checks `model.findCompatibleEditors().includes(targetId)`, throws if not compatible, else calls `page.switchMainEditor(targetId)` and continues. Two direct-model facades (`asBrowser`, `asMcpInspector`) stay throw-only.
- **SF2** — `acquireViewModel*` retirement. **Deferred** — full retirement happens per-editor as each facade migrates in Phase C. US-550 keeps the `acquireViewModel(...) → releaseViewModel(...)` machinery unchanged; the `force = true` branch just calls `page.switchMainEditor(targetId)` first, then re-runs the existing `acquireViewModel` flow on the (still adapter-wrapped) editor.
- **SF3** — `releaseList` constructor parameter retirement. **Deferred** — depends on SF2.
- **SF4** — `set editor(v)` becomes `page.switchMainEditor(v).catch(ui.notify)`. Apply the same `LegacyEditorAdapter` special-case US-549's `<SwitchWidget>` uses (call `legacy.changeEditor(v)` directly when the model is adapter-wrapped, since `PageModel.switchMainEditor` already does this internally per US-548). One-line change at the setter.
- **SF5** — `PageWrapper.type` getter removal + `IPage.type` field removal. Mechanical.
- **SF6** — `ComponentQueue.execute` / `register` + `TextEditorFacade` async. **Deferred** to US-551 (Monaco's request union finalization).
- **SF7** — `resolveGridEditorId()` mechanical translation: `model.state.get().editor` → `model.editorId`; `model.state.get().language` → `model.contentHost?.state.get().language ?? model.state.get().language`. For the adapter the legacy state IS the host state (`TextFileModel.state`); the cleanup is purely a path clarification.
- **SF8** — `asBrowser` / `asMcpInspector` gates: `state.type === "..."` → `instanceof XEditorModel`. Drop `as unknown as` cast. The `BrowserEditorModel` / `McpInspectorEditorModel` classes are still legacy editor models — but the adapter-wrap surface preserves the prototype chain (the adapter holds them as `this.legacy: LegacyEditorModel`; we need to `instanceof` against `(model instanceof LegacyEditorAdapter ? model.legacy : model)`). **See Q7.**
- **SF9** — `modified` getter. No change in US-550; today's `this.model.modified` works via the adapter's base inherited from `EditorStateBase.modified`.
- **SF10** — `EditorView` union retirement. **Deferred** to US-559.

---

## Implementation plan

The plan lands in 5 chunks. Each chunk leaves the codebase compiling, lintable, and behaviorally equivalent (modulo the documented breaking-changes above). Run `npm run typecheck` and `npm run lint` after each chunk.

### Step 1 — MCP wire-shape cleanup (MI1 + MI5)

**Modify:** `src/renderer/api/mcp-handler.ts`

Rewrite `getPages()`:

```ts
function getPages(): any[] {
    const pages = pagesModel.state.get().pages;
    return pages.map((p) => {
        const editor = p.mainEditor;
        const textHost = pagesModel.getTextFileHost(p.id);
        const editorState = editor?.state.get() as { filePath?: string } | undefined;
        return {
            id: p.id,
            title: p.title,
            editor: editor?.editorId,
            language: editor?.contentHost?.state.get().language
                ?? (editor?.state.get() as { language?: string })?.language,
            filePath: textHost?.state.get().filePath ?? editorState?.filePath,
            modified: p.modified,
            pinned: p.pinned,
            active: p === pagesModel.activePage,
        };
    });
}
```

Rewrite `getActivePage()`:

```ts
function getActivePage(): any {
    const page = pagesModel.activePage;
    if (!page) return null;
    const editor = page.mainEditor;
    const textHost = pagesModel.getTextFileHost(page.id);
    const editorState = editor?.state.get() as { filePath?: string } | undefined;
    const content = textHost ? textHost.state.get().content : "";
    return {
        id: page.id,
        title: page.title,
        editor: editor?.editorId,
        language: editor?.contentHost?.state.get().language
            ?? (editor?.state.get() as { language?: string })?.language,
        filePath: textHost?.state.get().filePath ?? editorState?.filePath,
        modified: page.modified,
        content,
    };
}
```

Rewrite `createPage()` return shape (MI5):

```ts
return {
    result: {
        id: page.id,
        title: page.title,
        editor: page.mainEditor?.editorId,
        language: page.mainEditor?.contentHost?.state.get().language
            ?? (page.mainEditor?.state.get() as { language?: string })?.language,
    },
};
```

Add a `log-view` entry to the `hints` table in `createPage` (forward MI3 hint even though the gate flip is deferred):

```ts
const hints: Record<string, string> = {
    "browser-view": "Use the open_url tool to open a URL in the built-in browser.",
    "pdf-view": 'Use execute_script with: await app.pages.openFile("/path/to/file.pdf")',
    "image-view": 'Use execute_script with: await app.pages.openFile("/path/to/image.png")',
    "mcp-view": "Use execute_script with: await app.pages.showMcpInspectorPage() ..."
        ,
    "about-view": "Use execute_script with: await app.pages.showAboutPage()",
    "settings-view": "Use execute_script with: await app.pages.showSettingsPage()",
    "log-view": 'Use ui_push to write entries to the MCP log page, or execute_script with: '
        + 'await app.pages.requireWellKnownPage("mcp-ui-log")',
};
```

The `log-view` hint is dormant today (`log-view` is `category: "content-view"` in the legacy registry → not rejected by `category === "standalone"`). It activates if a future LogView definition is `category: "standalone"` — relevant once MI3 fires in US-559.

### Step 2 — `IPage` type cleanup (SF5 + SF1 method signatures)

**Modify:** `src/renderer/api/types/page.d.ts`

Drop `readonly type: string` field from `IPage`.

Add `force?: boolean` to each of the 11 ViewModel-backed facade methods. Add a brief JSDoc note explaining the parameter. Example:

```ts
/**
 * Get grid editor interface (data manipulation). Only for text pages with JSON/CSV content.
 *
 * @param force - If true and the page isn't currently a Grid editor, attempt to switch
 *                using the same compatibility source as the UI switch widget. Throws if
 *                the page can't switch. Default false (throws if not already a Grid editor).
 */
asGrid(force?: boolean): Promise<IGridEditor>;
```

Add `force?: boolean` to: `asText`, `asGrid`, `asNotebook`, `asTodo`, `asLink`, `asMarkdown`, `asSvg`, `asHtml`, `asMermaid`, `asGraph`, `asDraw`.

`asBrowser()` and `asMcpInspector()` stay throw-only — no `force` parameter (no switch path).

### Step 3 — PageWrapper.ts rewrite (SF1 + SF4 + SF5 + SF7 + SF8)

**Modify:** `src/renderer/scripting/api-wrapper/PageWrapper.ts`

Drop `get type()` getter.

Update `get editor()` to source from v4 surface:

```ts
get editor(): EditorView {
    return (this.model.editorId as EditorView) ?? "monaco";
}
```

Rewrite `set editor(v)` per SF4:

```ts
set editor(value: EditorView) {
    const page = this.model.page;
    if (!page) return;
    // Mirror US-549's SwitchWidget special-case: adapter-wrapped editors
    // switch via the legacy `changeEditor(view)` path on the wrapped
    // TextFileModel because LegacyEditorAdapter.switchFrom throws.
    // PageModel.switchMainEditor handles this internally for adapter-wrapped
    // pages but we keep the catch for parity with the UI widget shape.
    page.switchMainEditor(value).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        // ui.notify is the same error-surfacing path the switch widget uses.
        // Import inline to avoid threading another dep.
        const { app } = require("../../api/app");
        app.ui?.notify?.(message, "error");
    });
}
```

(The `require("../../api/app")` could be replaced by a static import at the top of the file — the only reason to defer to runtime is to avoid touching the import list. Decide during implementation; behavioral parity is the criterion.)

Update SF7's `resolveGridEditorId()`:

```ts
private resolveGridEditorId(): EditorView {
    const id = this.model.editorId;
    if (id === "grid-json" || id === "grid-csv" || id === "grid-jsonl") return id as EditorView;
    const language = this.model.contentHost?.state.get().language
        ?? this.model.state.get().language;
    if (language === "json") return "grid-json";
    if (language === "csv") return "grid-csv";
    if (language === "jsonl") return "grid-jsonl";
    throw new Error("asGrid(): content is not JSON, CSV, or JSONL");
}
```

Add the SF1 `force?: boolean` parameter to each of the 11 ViewModel-backed facades. **Use a private helper** that takes a plain string targetId (Q5 — inline the asGrid resolver outside the helper):

```ts
/**
 * If the page is already at `targetId`, return. If not and `force` is true,
 * check compatibility against the same source as the UI switch widget and
 * switch the page. Throws on incompatible or detached.
 */
private async ensureEditor(
    targetId: string,
    expectedClassName: string,
    methodName: string,
    force: boolean,
): Promise<void> {
    if (this.model.editorId === targetId) return;
    if (!force) {
        throw new Error(
            `${methodName}() requires the page to already be a ${expectedClassName} editor. `
            + `Pass true to attempt a switch.`,
        );
    }
    const page = this.model.page;
    if (!page) throw new Error(`${methodName}(true): editor is not attached to a page`);
    const compatible = this.model.findCompatibleEditors();
    if (!compatible.includes(targetId)) {
        throw new Error(
            `${methodName}(true): cannot switch to '${targetId}' — not in the page's compatible editors list`,
        );
    }
    await page.switchMainEditor(targetId);
}
```

Each `asX()` method becomes (illustrated on `asGrid`):

```ts
async asGrid(force = false): Promise<GridEditorFacade> {
    const targetId = this.resolveGridEditorId();    // throws if content isn't JSON/CSV/JSONL
    await this.ensureEditor(targetId, "Grid", "asGrid", force);
    // After switch the model is still the same TextFileModel (adapter wrap survives).
    // acquireViewModel returns the requested ViewModel against that host.
    if (!isTextFileModel(this.model)) {
        throw new Error("asGrid(): page lost its text host during switch");
    }
    const vm = await this.model.acquireViewModel(targetId) as GridViewModel;
    this.releaseList.push(() => this.model.releaseViewModel(targetId));
    return new GridEditorFacade(vm);
}
```

Apply the same pattern to all 11 facades:
- `asText` — targetId = "monaco"
- `asGrid` — targetId via `resolveGridEditorId()`
- `asNotebook` — targetId = "notebook-view"
- `asTodo` — targetId = "todo-view"
- `asLink` — targetId = "link-view"
- `asMarkdown` — targetId = "md-view"
- `asSvg` — targetId = "svg-view"
- `asHtml` — targetId = "html-view"
- `asMermaid` — targetId = "mermaid-view"
- `asGraph` — targetId = "graph-view"
- `asDraw` — targetId = "draw-view"

Rewrite `asBrowser` and `asMcpInspector` per SF8 (Q7 — use `editorId` gate instead of `instanceof` until US-558):

```ts
async asBrowser(): Promise<BrowserEditorFacade> {
    if (this.model.editorId !== "browser-view") {
        throw new Error("asBrowser() is only available for browser pages");
    }
    const underlying = this.unwrapLegacy(this.model);
    return new BrowserEditorFacade(underlying as unknown as BrowserEditorModel);
}

async asMcpInspector(): Promise<McpInspectorFacade> {
    if (this.model.editorId !== "mcp-view") {
        throw new Error("asMcpInspector() is only available for MCP Inspector pages");
    }
    const underlying = this.unwrapLegacy(this.model);
    return new McpInspectorFacade(underlying as unknown as McpInspectorEditorModel);
}

private unwrapLegacy(model: EditorModel): EditorModel {
    // During the strangler period, the v4 surface is the adapter; the legacy
    // editor model (BrowserEditorModel / McpInspectorEditorModel) is on
    // `adapter.legacy`. Per-editor migrations (US-558) replace this with a
    // direct `instanceof` check and drop the unwrap helper.
    if (model instanceof LegacyEditorAdapter) return model.legacy;
    return model;
}
```

Imports: add `LegacyEditorAdapter` (value import) to the top of the file. `BrowserEditorModel` and `McpInspectorEditorModel` stay as `import type` — the `as unknown as` cast survives Q7's choice because the runtime gate now uses `editorId`. The cast is dropped during US-558 when the `instanceof` shape lands.

### Step 4 — Verify MCP `isTextFileModel` is fully replaced (MI2 + MI4 confirmation)

**Modify:** `src/renderer/api/mcp-handler.ts`

Grep for `isTextFileModel` — there should be zero results in mcp-handler.ts after this step (it's already absent today; verify and add a comment if needed). Also remove the import `import { isTextFileModel } from "../editors/text/TextEditorModel";` at line 5 if it's now unused.

**Note for MI4 partial:** The `acquireViewModelSync("log-view") as LogViewModel | undefined` calls at three sites stay verbatim — they still route through `getTextFileHost` which is the correct strangler-period shape. Full retirement to `editor instanceof LogViewEditorModel` lands in US-553. Add a short `// US-553: replace with `instanceof LogViewEditorModel`` comment above each site.

### Step 5 — Documentation + release-note pointer

**Modify:** `notepad://guides/pages` (sourced from `assets/mcp-res-pages.md` per the well-known list in `src/main/mcp-http-server.ts`).

Find the resource file:

```powershell
ls D:\projects\persephone\assets\mcp-res-*
```

Open `assets/mcp-res-pages.md` (or whichever file documents the `get_pages` row shape). If it references the `type` field, remove that line. The `editor` field semantics are unchanged.

**Modify:** `doc/active-work.md` — link the US-550 dashboard entry to this task doc:

```diff
- [ ] US-550: MCP + scripting facades partial — `mcp-handler.ts` MI1–MI5; `page.asX()` gains `force?: boolean`; `PageWrapper.type` retires
+ [ ] [US-550: MCP + scripting facades partial](tasks/US-550-mcp-and-scripting-facades/README.md) — `mcp-handler.ts` MI1–MI5; `page.asX()` gains `force?: boolean`; `PageWrapper.type` retires
```

---

## Files changed summary

| File | Change | Lines (approx) |
|------|--------|----------------|
| `src/renderer/api/mcp-handler.ts` | `getPages` / `getActivePage` / `createPage` row-shape rewrite (drop `type`, route `language`/`filePath` through v4 surface); add `log-view` hint entry; drop `isTextFileModel` import if unused; add three MI4-pointer comments | ~50 |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Drop `get type()`; rewrite `set editor()` per SF4; add `ensureEditor` helper; add `force?: boolean` to 11 facade methods; rewrite `asBrowser` / `asMcpInspector` per SF8 with adapter unwrap helper; rewrite `resolveGridEditorId` per SF7 | +120 / -90 |
| `src/renderer/api/types/page.d.ts` | Drop `readonly type: string`; add `force?: boolean` to 11 facade methods with JSDoc | +30 / -1 |
| `assets/mcp-res-pages.md` | Drop `type` field mention from documented `get_pages` row shape (if present) | -1 to -3 |
| `doc/tasks/US-550-mcp-and-scripting-facades/README.md` | **NEW** — this task doc | — |
| `doc/active-work.md` | Link US-550 entry to task doc | +1 / -1 |

## Files NOT changing (so the implementer doesn't go searching)

- `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` — `releaseList` parameter stays (SF3 deferred). `addEditorPage` signature unchanged.
- `src/renderer/scripting/ScriptContext.ts` — `releaseList` field stays; `PageWrapper` / `PageCollectionWrapper` constructor calls unchanged; `initializeUiFacade`'s LogView acquisition stays (retired in US-553).
- `src/renderer/scripting/api-wrapper/AppWrapper.ts` — `releaseList` parameter stays.
- All 11 ViewModel-backed facade files (`TextEditorFacade`, `GridEditorFacade`, `NotebookEditorFacade`, `TodoEditorFacade`, `LinkEditorFacade`, `MarkdownEditorFacade`, `SvgEditorFacade`, `HtmlEditorFacade`, `MermaidEditorFacade`, `GraphEditorFacade`, `DrawEditorFacade`) — unchanged. The facades continue to wrap ViewModels; the per-editor migrations (US-551+) rewrite each one to wrap the v4 EditorModel directly.
- `BrowserEditorFacade.ts` + `McpInspectorFacade.ts` — unchanged. The `as unknown as` cast on the input still works because the underlying class hasn't moved; PageWrapper's new `unwrapLegacy` extracts the legacy model from the adapter before passing.
- `src/renderer/editors/text/TextEditorModel.ts` — `acquireViewModel` / `releaseViewModel` / `acquireViewModelSync` survive (SF2 deferred).
- `src/renderer/editors/base/ContentViewModelHost.ts` — survives (SF2 deferred).
- `src/renderer/editors/base/useContentViewModel.ts` — survives (SF2 deferred).
- `src/renderer/editors/registry.ts` — `category` field stays (MI3 deferred).
- `src/renderer/editors/base/v4/editorRegistry.ts` — `hasContentHost` flag already present per US-547.
- `src/renderer/editors/base/v4/LegacyEditorAdapter.ts` — already has the needed v4 surface from US-548 / US-549.
- `src/shared/types.ts` — `EditorView` union stays (SF10 deferred).
- `src/main/mcp-http-server.ts` — transport layer unchanged.

---

## Concerns / Open questions

### Q1 — `set editor(v)` adapter special-case — **RESOLVED: (a)** call `page.switchMainEditor(v)` and trust PageModel's internal handling

**Background:** US-549's `<SwitchWidget>` (`src/renderer/editors/base/v4/PageToolbar.tsx:94-106`) special-cases `LegacyEditorAdapter` and calls `legacy.changeEditor(v)` directly. US-548's `PageModel.switchMainEditor` *also* documents (`PageModel.ts:386-390`) that it routes adapter-wrapped switches through the legacy path. The question: in `PageWrapper.set editor(v)`, do we call `page.switchMainEditor(v)` (relying on the PageModel's internal special-case) or replicate the adapter check at the script-API surface?

**Options:**

- **(a)** Call `page.switchMainEditor(v)` and trust PageModel's internal handling. The setter shape becomes exactly what SF4 prescribes; the special-case lives in one place (PageModel) and is removed cleanly during Phase D.
- **(b)** Replicate the US-549 special-case at the script-API surface — if the model is adapter-wrapped, call `legacy.changeEditor(v)` directly; otherwise call `switchMainEditor`. Matches the switch-widget shape verbatim.
- **(c)** Just call legacy `changeEditor(v)` like today (no v4 routing). Skip SF4 entirely for US-550.

**Recommendation: (a).** Cleanest. PageModel is the right level for the adapter knowledge. If verification during Step 3 shows `switchMainEditor` doesn't actually handle the adapter case (bug deferred from US-548), fall back to (b) and file a follow-up to fix PageModel.

### Q2 — MI1 `filePath` field source — **RESOLVED: (a)** host-first with legacy fallback for PDF / Image / Video

**Background:** Today's `getPages` returns `filePath: s?.filePath` from the editor state directly. The plan above sources from `getTextFileHost(p.id)?.state.get().filePath` first, falls back to `editor.state.get().filePath` (for PDF / Image / Video / Archive — which carry it on the editor itself).

**Options:**

- **(a) Host-first with fallback** — three lines of logic; covers every today's editor shape correctly. *(Plan default.)*
- **(b) Host-only (strict)** — pages without a TextFileModel host return `filePath: undefined`. Cleaner but a wire-shape regression for PDF / Image / Video.
- **(c) Keep legacy `s?.filePath`** — works today via `IEditorState.filePath` on all flat-state shapes. Trivial; defers MI1's "host-routing" cleanup.

**Recommendation: (a).** MI1 specifies host-routing for text-bearing pages but the resolution explicitly mentions PDF/Image/Video as "non-text" cases — they keep their filePath on the editor state under EPIC-028 (host doesn't apply). Two-tier fallback documents the intent without breaking existing MCP consumers.

### Q3 — `acquireViewModel` push sites in `asX()` — **RESOLVED: (a)** inline `releaseList.push` per facade method

**Background:** SF3 is deferred (releaseList still in use), so PageWrapper still pushes `() => model.releaseViewModel(...)` to `releaseList`. The plan above keeps the push inline at each call site.

**Options:**

- **(a) Inline `releaseList.push` per facade method** — same shape as today; reads cleanly per method. *(Plan default.)*
- **(b) Move the push into a helper (`acquireAndTrack(editorId)`)** — slightly less boilerplate per facade. The push happens at one site.

**Recommendation: (a).** Inline is more legible during a strangler period. The methods retire wholesale during Phase C per-editor migrations.

### Q4 — `MCP_UI_LOG_ID` + MI4 partial vs. defer the comments — **RESOLVED: (a)** add three `// US-553: replace with instanceof LogViewEditorModel` pointer comments

**Background:** The plan adds three `// US-553: replace with `instanceof LogViewEditorModel`` markers at the `acquireViewModelSync("log-view")` sites. Cost: three comments. Benefit: when US-553 lands, the agent has explicit pointers.

**Options:**

- **(a) Add the three TODO-style comments** — slightly noisy but locks in the cleanup hint. *(Plan default.)*
- **(b) Skip the comments** — US-553 will surface them via grep on `acquireViewModelSync`. Cleaner code in the interim.

**Recommendation: (a).** EPIC-028 is a long-running migration; three comments are cheap insurance against US-553 forgetting to clean these.

### Q5 — SF1 `ensureEditor` helper — **RESOLVED: (c)** inline the asGrid resolver outside `ensureEditor`; helper accepts a plain string targetId

**Background:** Only `asGrid` needs runtime resolution (the editor id depends on language). The other 10 methods pass a constant string. The plan above accepts `string | (() => string)`.

**Options:**

- **(a) Accept `string | (() => string)`** — slightly clever; covers both cases. *(Plan default.)*
- **(b) Two methods: `ensureEditor(id, ...)` + `ensureEditorVia(resolver, ...)`** — explicit two-arity. Slightly more code.
- **(c) Inline the asGrid resolver outside `ensureEditor`** — resolver call happens BEFORE `ensureEditor`. Plain string everywhere.

**Recommendation: (c).** Simplest. The resolver call gates on content shape and throws first; `ensureEditor(targetId, ...)` then handles the switch decision. Two-line caller shape, no union type.

### Q6 — `unwrapLegacy` helper — **RESOLVED: (a)** private helper on `PageWrapper`

**Background:** Only `asBrowser` and `asMcpInspector` use it. The plan above makes it `private`.

**Options:**

- **(a) Private helper** — encapsulated; one consumer pair. *(Plan default.)*
- **(b) Inline `model instanceof LegacyEditorAdapter ? model.legacy : model`** — three-line consumer site per facade. No helper.
- **(c) Export from `LegacyEditorAdapter`** as a static utility — overkill for two callers.

**Recommendation: (a).** Private helper. Two consumers and the cast logic is identical; centralizing is correct.

### Q7 — `asBrowser` / `asMcpInspector` gate — **RESOLVED: (b)** use `model.editorId === "browser-view"` / `"mcp-view"` instead of `instanceof` until per-editor migration in US-558

**Background:** `BrowserEditorModel` and `McpInspectorEditorModel` are imported into PageWrapper today as `import type`. They become real value imports under SF8 (so `instanceof` works). The classes haven't been migrated to v4 yet (US-558), but they ARE legacy `EditorModel` subclasses — `instanceof BrowserEditorModel` works against `adapter.legacy`.

**Concern:** Are these classes single-instance modules? Multiple imports (e.g., across the worker context) might produce different module identities, breaking `instanceof`. Today's `state.type === "browserPage"` is identity-agnostic.

**Options:**

- **(a) Use `instanceof` as planned** — `adapter.legacy` is created in the renderer's main module; `instanceof` works.
- **(b) Keep the string-discriminator check via `model.editorId === "browser-view"`** — equivalent semantics; doesn't depend on module identity. Less brittle.
- **(c) Use `state.type === "browserPage"` until US-558** — defer SF8 entirely.

**Recommendation: (b).** `model.editorId === "browser-view"` (or `"mcp-view"`) is the canonical v4 discriminator. It survives the strangler period without coupling to a specific class import path. The `instanceof` shape that walkthrough 12 / SF8 prescribed assumes the post-migration world where each editor IS a v4 subclass with stable identity. Today the `editorId` check is strictly more robust. The `as unknown as BrowserEditorModel` cast on the return path stays the same (the type assertion is unchanged; only the runtime gate switches from `state.type` to `editorId`).

### Q8 — SF1 `force = true` on a fresh empty page — **RESOLVED: (a)** accept the throw; mirror the UI switch widget verbatim. Script must set `page.language = "json"` first

**Background:** When the user opens an empty grouped page that just rendered (mainEditor = newly-created adapter wrapping a fresh TextFileModel), a script calling `await page.asGrid(true)` should succeed. The page's `findCompatibleEditors()` reads `legacyRegistry.getSwitchOptions(language ?? "", filePath)` — for a fresh empty page with `language = ""` and no filePath, what does `getSwitchOptions` return?

**Investigation needed:** check `getSwitchOptions("", undefined)` — likely returns `[]` because Monaco is the only matcher and the function returns `[]` when only one option exists. Means `compatible.includes("grid-json")` is false → throw. **Consistent with the UI widget** (a fresh empty page can't switch to Grid because there's nothing to interpret as JSON).

**Options:**

- **(a) Accept the throw** — matches the UI widget exactly. Script can call `page.language = "json"; page.asGrid(true);` to set up the language first.
- **(b) Special-case empty pages** — if `language` is empty, look at content shape. Bigger scope; pulls content sniffing into PageWrapper.

**Recommendation: (a).** Mirror the UI widget verbatim. Document the workaround (`page.language = "json"; await page.asGrid(true);`) in the script API guide.

### Q9 — `set editor(v)` async behavior — **RESOLVED: (a)** fire-and-forget with `.catch(ui.notify)` — matches today's `model.changeEditor(v)` shape

**Background:** SF4's resolution says the setter is fire-and-forget. The setter signature is sync (assignment is sync); `switchMainEditor` is async. We `.catch(ui.notify)` but don't `await`.

**Options:**

- **(a) Fire-and-forget with `.catch(ui.notify)`** — same shape as today's `model.changeEditor(v)` (sync). *(Plan default.)*
- **(b) Expose a method form `await page.setEditor(v)`** — useful when scripts need to wait. New API surface; not in scope for US-550.

**Recommendation: (a).** Matches today's behavior. If scripts need to await, they can read `page.editor === "grid-json"` after assignment OR use `page.asGrid(true)` which does await the switch.

### Q10 — Test surface — **RESOLVED:** add the 10-item smoke-test checklist below to the PR description

**Background:** US-550 has no behavioral changes beyond the documented breaking ones. Smoke-test coverage should hit:

1. **MCP**: `get_pages` row shape from an MCP client (e.g., Claude Code). Verify `type` is gone; `editor`, `language`, `filePath` look right for a JSON file + a PDF + a Browser tab.
2. **MCP**: `create_page({ editor: "monaco", language: "json", title: "test", content: "{}" })` — verify return shape (`editor: "monaco"`, `language: "json"`).
3. **MCP**: `get_page_content` / `set_page_content` — verify still works on a JSON file.
4. **MCP**: `ui_push` — verify still writes to mcp-ui-log.
5. **Script**: `page.editor` getter on a JSON-in-Monaco page returns `"monaco"`.
6. **Script**: `page.editor = "grid-json"` — verify the UI flips to Grid (fire-and-forget; no await).
7. **Script**: `await page.asGrid()` on a JSON-in-Monaco page — verify it throws.
8. **Script**: `await page.asGrid(true)` on a JSON-in-Monaco page — verify the UI flips and the facade returns.
9. **Script**: `await page.asBrowser()` on a Browser tab — verify it returns; on a JSON page, verify it throws.
10. **Script**: `page.type` access — verify TypeScript error (the property is gone).

**Recommendation:** add these as a "Test plan" checklist at the bottom of the PR description when this lands.

---

## Acceptance criteria

1. `npm run typecheck` passes with zero NEW errors. (Baseline US-549: 18 errors, all pre-existing in `automation/commands.ts` and `WorkerRunner.ts`.)
2. `npm run lint` passes with zero NEW errors. (Baseline US-549: 49 errors, all pre-existing.)
3. App launches; all editors still load, switch, and persist as before.
4. MCP `get_pages` response no longer contains the `type` field. `editor`, `language`, `filePath` carry the same semantic values as before for every editor type (JSON, PDF, Image, Browser, MCP Inspector, About, Settings, Archive, Video, Category).
5. MCP `get_active_page` follows the same shape and now includes `content` sourced via `getTextFileHost`.
6. MCP `create_page({ editor: "monaco", language: "json", ... })` returns `{ editor: "monaco", language: "json" }`.
7. MCP `create_page({ editor: "log-view", ... })` continues to succeed (today's behavior — MI3 deferred). Hint table contains `log-view` entry but is not exercised.
8. MCP `set_page_content` on a Browser page returns the "not a text-based page" error message.
9. Script `page.type` is undefined / TypeScript error (property removed).
10. Script `page.editor = "grid-json"` on a JSON-in-Monaco page flips the UI to Grid (fire-and-forget).
11. Script `await page.asGrid()` on a JSON-in-Monaco page throws `"asGrid() requires the page to already be a Grid editor. Pass true to attempt a switch."`.
12. Script `await page.asGrid(true)` on a JSON-in-Monaco page returns a `GridEditorFacade` and flips the UI to Grid.
13. Script `await page.asGrid(true)` on a Markdown page throws `"asGrid(true): cannot switch to 'grid-json' — not in the page's compatible editors list"` (or similar — error text matches the plan).
14. Script `await page.asBrowser()` on a Browser tab returns a `BrowserEditorFacade`; on a JSON page throws `"asBrowser() is only available for browser pages"`.
15. Script `await page.asMcpInspector()` mirrors `asBrowser` behavior.
16. Script `runWithCapture` (executed via MCP `execute_script` or F5) continues to work; the `page` wrapper inside the script has all 13 `asX()` methods with the new signatures.
17. Restart preserves all page state correctly (no persistence change in US-550).
