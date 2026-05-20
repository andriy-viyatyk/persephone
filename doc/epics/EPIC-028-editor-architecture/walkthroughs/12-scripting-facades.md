# 12 — Scripting facades

**Status:** Done (2026-05-20)

Maps today's `page.asX()` / `pages.X()` script-API surface onto the EPIC-028 editor architecture. Resolves the long-standing `ContentViewModelHost` ref-counting machinery (`acquireViewModel` / `releaseViewModel`) and the `EditorView` literal-string union retired by S10. Concern prefix: **SF** (Scripting Facades).

## What exists today

### PageWrapper (`src/renderer/scripting/api-wrapper/PageWrapper.ts`)

Script-safe wrapper around `EditorModel`. Implements `IPage`.

```typescript
class PageWrapper {
    constructor(
        private readonly model: EditorModel,
        private readonly releaseList: Array<() => void>,  // ← drained on script teardown
        private readonly outputFlags?: ScriptOutputFlags,
    ) {}

    get type() { return this.model.state.get().type; }       // ← IEditorState.type union (S10 retires)
    get title() { return this.model.title; }
    get modified() { return this.model.modified; }
    get pinned() { return this.model.page?.pinned ?? false; }
    get filePath() { return this.model.filePath; }            // ← will move to host (P1/P4)
    get content() { if (isTextFileModel(this.model)) return this.model.state.get().content; return ""; }
    set content(v) { if (isTextFileModel(this.model)) this.model.changeContent(v); }
    get language() { return this.model.state.get().language ?? ""; }
    set language(v) { if (!this.model.noLanguage) this.model.changeLanguage(v); }
    get editor() { return this.model.state.get().editor ?? "monaco"; }      // ← S10 retires the field
    set editor(v) { if (isTextFileModel(this.model)) this.model.changeEditor(v); } // ← S7 replaces with switchMainEditor

    async asText():    Promise<TextEditorFacade>     { /* acquireViewModel("monaco") */ }
    async asGrid():    Promise<GridEditorFacade>     { /* acquireViewModel("grid-json"|"grid-csv"|"grid-jsonl") */ }
    async asNotebook(): Promise<NotebookEditorFacade>{ /* acquireViewModel("notebook-view") */ }
    async asTodo():    Promise<TodoEditorFacade>     { /* acquireViewModel("todo-view") */ }
    async asLink():    Promise<LinkEditorFacade>     { /* acquireViewModel("link-view") */ }
    async asMarkdown(): Promise<MarkdownEditorFacade>{ /* acquireViewModel("md-view") */ }
    async asSvg():     Promise<SvgEditorFacade>      { /* acquireViewModel("svg-view") */ }
    async asHtml():    Promise<HtmlEditorFacade>     { /* acquireViewModel("html-view") */ }
    async asMermaid(): Promise<MermaidEditorFacade>  { /* acquireViewModel("mermaid-view") */ }
    async asGraph():   Promise<GraphEditorFacade>    { /* acquireViewModel("graph-view") */ }
    async asDraw():    Promise<DrawEditorFacade>     { /* acquireViewModel("draw-view") */ }
    async asBrowser():       Promise<BrowserEditorFacade>     { /* direct model wrap */ }
    async asMcpInspector():  Promise<McpInspectorFacade>      { /* direct model wrap */ }
}
```

### Two facade families

| Family | Examples | Construction | Cleanup |
|--------|----------|--------------|---------|
| **ViewModel-backed** | TextEditorFacade, GridEditorFacade, NotebookEditorFacade, TodoEditorFacade, LinkEditorFacade, MarkdownEditorFacade, SvgEditorFacade, HtmlEditorFacade, MermaidEditorFacade, GraphEditorFacade, DrawEditorFacade | `model.acquireViewModel("xxx-view")` returns a ViewModel for the named editor view; facade wraps the ViewModel | `releaseList.push(() => model.releaseViewModel("xxx-view"))` drained at script end via `ScriptContext` |
| **Direct-model** | BrowserEditorFacade, McpInspectorFacade | Cast `EditorModel` to subclass directly; no ViewModel | Nothing to release |

### "Shadow ViewModel" pattern (only for ViewModel-backed family)

`acquireViewModel("grid-json")` on a `TextFileModel` displayed in Monaco creates a Grid ViewModel that lives off-screen against the same content string. The script can `addRows(5)` / `editCell(...)` and the content updates without the UI flipping to Grid view. Today's `ContentViewModelHost` handles this via per-editor view-model registry and ref-counting.

### PageCollectionWrapper.addEditorPage (`src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`)

```typescript
addEditorPage(editor: EditorView, language: string, title: string): PageWrapper {
    const page = this.pages.addEditorPage(editor, language, title);  // EditorView union retired by S10
    return this.wrap(page)!;
}
```

Plus `pages.addEmptyPage()`, `pages.openDiff()`, `pages.showBrowserPage()`, etc. — all delegate one-to-one onto `PagesModel`.

### Cleanup mechanism

`ScriptContext` builds the wrapper:
- `const releaseList: Array<() => void> = []` per script run
- `page = new PageWrapper(editor, releaseList, outputFlags)`
- After script body completes (or throws): `for (const fn of releaseList) fn()` — releases every acquired ViewModel

## What the new architecture needs to support

Functional contract (must not regress):

1. Scripts read `page.title`, `page.filePath`, `page.modified`, `page.pinned`, `page.content`, `page.language`, `page.editor`, `page.data`.
2. Scripts write `page.content = "..."`, `page.language = "..."`, `page.editor = "grid-json"`.
3. Scripts call `page.asX()` to mutate editor-specific state (rows, columns, todos, links, mermaid source, notebook notes).
4. Scripts catch and report helpful errors when an `asX()` call is meaningless against the current page shape (e.g., `asGrid()` on a Markdown file).
5. `page.grouped` returns the right-side page wrapper, auto-creating a grouped text page if none exists.
6. `pages.addEditorPage(editorId, language, title)` opens a typed empty page.
7. `pages.X()` collection methods continue to delegate.

Things that retire (per S10 / P1 / P4 / A7):

- `model.state.get().type` (the `IEditorState.type` union)
- `model.state.get().editor` (the `IEditorState.editor` field)
- `model.state.get().filePath` (moves to host per P4)
- `isTextFileModel(model)` type-guard
- `model.changeEditor(view)` method
- `model.acquireViewModel(id)` / `model.releaseViewModel(id)` / `ContentViewModelHost`
- `EditorView` literal-string union in `src/shared/types.ts`
- `PageDescriptor.type` field in persisted state

What's new from earlier walkthroughs:

- `EditorModel.editorId: string` (S10) — the registry key, stable per editor class
- `EditorModel.contentHost: IContentHost | null` (08 / B2) — base returns null, text-bearing subclasses override
- `pagesModel.query.getTextFileHost(pageId): TextFileModel | null` (GK2 / T2) — single helper for the host-instanceof predicate
- `page.switchMainEditor(editorId)` (S1) — throws on incompatible editor; PageWrapper catches per S7
- `ComponentQueue<E>` (S4) — model → view mailbox primitive; "Future extension `register` / `execute` for view-context queries deferred to walkthrough 12 or 20" (this walkthrough)

## How the foundation mockups handle this

### Identity / read surface

```typescript
// PageWrapper getters, host-split shape
get id()       { return this.model.page?.id ?? this.model.id; }
get title()    { return this.model.title; }                                     // editor-owned
get modified() { return this.model.modified; }                                  // editor base — text-bearing override delegates to host
get pinned()   { return this.model.page?.pinned ?? false; }
get filePath() { return this.model.contentHost?.state.get().filePath ?? ""; }   // host-owned per P4
get content()  { return this.model.contentHost?.state.get().content ?? ""; }    // host-owned
set content(v) { this.model.contentHost?.changeContent(v); }                    // IContentHost method
get language() { return this.model.contentHost?.state.get().language
                     ?? this.model.state.get().language ?? ""; }
set language(v){ if (!this.model.noLanguage) this.model.contentHost?.changeLanguage(v); }
get editor()   { return this.model.editorId; }                                  // S10 editorId
set editor(v)  { this.model.page?.switchMainEditor(v)
                     .catch(err => ui.notify(err.message, "error")); }          // S7
get data()     { return this.model.scriptData; }
```

### `asX()` semantics flip

Under EPIC-028, each `EditorModel` IS its own viewmodel — there is no "off-screen viewmodel against the same content." A Grid editor and a Monaco editor are two distinct `EditorModel` instances; they never coexist for the same page.

Two candidate shapes:

**A — Direct narrow (matches Browser/McpInspector today):**
```typescript
async asGrid(): Promise<GridEditorFacade> {
    if (!(this.model instanceof GridEditor)) {
        throw new Error("asGrid() requires the page to already be a Grid editor");
    }
    return new GridEditorFacade(this.model);
}
```

**B — Auto-switch on demand (closest match to today's acquireViewModel intent):**
```typescript
async asGrid(): Promise<GridEditorFacade> {
    if (!(this.model instanceof GridEditor)) {
        const target = this.resolveGridEditorId();  // "grid-json" | "grid-csv" | "grid-jsonl"
        await this.model.page!.switchMainEditor(target);
        const editor = this.model.page!.mainEditor;
        if (!(editor instanceof GridEditor)) {
            throw new Error("asGrid(): content is not JSON, CSV, or JSONL");
        }
        return new GridEditorFacade(editor);
    }
    return new GridEditorFacade(this.model);
}
```

(B) gives existing scripts a path that doesn't immediately break — `page.asGrid().addRows(5)` works, with the page UI flipping to Grid as a visible side effect. (A) is strictly more honest but breaks every existing script that wrote against today's shadow-ViewModel pattern.

### Browser / McpInspector facades

`instanceof BrowserEditorModel` replaces `state.get().type === "browserPage"`. No other change — direct model wrap survives.

### Cleanup

`releaseList` becomes dead — there's nothing to release. The constructor parameter retires from PageWrapper; `ScriptContext` stops building one.

### `pages.addEditorPage(editorId, language, title)`

`EditorView` retires; `editorId: string` per S10. PageCollectionWrapper.addEditorPage forwards `editorId` straight to `PagesLifecycleModel.addEditorPage`, which is itself rewritten in walkthrough 11 / EW2 (async `createEditor + applyRestoreData + restore`).

### TextEditorFacade view-context methods

`TextEditorFacade` today wraps `TextViewModel` and exposes view-context probes:
- `revealLine(n)` — already migrated to ComponentQueue per S4 (sender → receiver via mailbox)
- `setHighlightText(t)` — already migrated to ComponentQueue per S4
- `getSelectedText()` — sync read of view state; needs a view → model query path
- `getCursorPosition()` — sync read of view state
- `insertText(t)` — issues a Monaco command; needs view context
- `replaceSelection(t)` — issues a Monaco command; needs view context

S4 deferred this: *"Future extension `register` / `execute` for view-context queries deferred to walkthrough 12 or 20."*

## Concerns

### SF1 — `asX()` behavior when the page isn't already X — RESOLVED 2026-05-20

**Resolution:** option (d) — opt-in switch via `force?: boolean` parameter. Default throws; `force = true` attempts the switch using `editor.findCompatibleEditors()` (the same compatibility source the UI switch widget reads per PT2 / PT10 / S1), then throws if not compatible. Scope: eleven ViewModel-backed facades (`asText`, `asGrid`, `asNotebook`, `asTodo`, `asLink`, `asMarkdown`, `asSvg`, `asHtml`, `asMermaid`, `asGraph`, `asDraw`); two direct-model facades stay throw-only (`asBrowser`, `asMcpInspector`). Mirrored on `IPage.d.ts` method signatures.



Today's `model.acquireViewModel("grid-json")` creates a Grid ViewModel without changing the displayed editor. Under EPIC-028, each EditorModel IS its own viewmodel — that shape can't survive.

Four options:
- **(a)** Direct narrow — throw if `mainEditor` isn't the target class. Pure but breaks `page.asGrid()` scripts.
- **(b)** Auto-switch via `page.switchMainEditor(targetId)` — visible UI flip, preserves script ergonomics.
- **(c)** Hybrid — auto-switch for "view family" editors (Grid / Markdown / Mermaid / Svg / Html / Notebook / Todo / Link / Graph / Draw — all wrap the same `TextFileModel` host); direct narrow for Browser / McpInspector / Compare / PDF / Image / etc. (no shared host).
- **(d)** Opt-in switch via `force?: boolean` parameter. Default throws (same as (a)); `force = true` attempts the switch using the same compatibility source the UI switch widget reads (`editor.findCompatibleEditors()` per PT2 / PT10 / S1), then throws if not compatible.

Recommend **(d)**. Default behaviour is predictable (no hidden UI side effects); auto-switch becomes script-author-visible at the call site via the explicit `true` argument; "can switch?" semantics match the UI switch widget verbatim (a script can switch iff a user could pick the editor from the widget). Trade-off: existing scripts that today rely on `page.asGrid()` implicitly promoting a JSON-in-Monaco page must update to `page.asGrid(true)` — clean break that forces explicit acknowledgement of the visible UI side effect.

Shape (illustrated on `asGrid`; identical pattern across the eleven ViewModel-backed facades):

```typescript
async asGrid(force = false): Promise<GridEditorFacade> {
    if (this.model instanceof GridEditor) {
        return new GridEditorFacade(this.model);
    }
    if (!force) {
        throw new Error("asGrid() requires the page to already be a Grid editor. Pass true to attempt a switch.");
    }
    const page = this.model.page;
    if (!page) throw new Error("asGrid(true): editor is not attached to a page");

    const targetId = this.resolveGridEditorId();              // throws if content isn't JSON/CSV/JSONL
    const compatible = this.model.findCompatibleEditors();    // SAME source as the UI switch widget
    if (!compatible.includes(targetId)) {
        throw new Error(`asGrid(true): cannot switch to '${targetId}' — not in the page's compatible editors list`);
    }
    await page.switchMainEditor(targetId);
    const editor = page.mainEditor;
    if (!(editor instanceof GridEditor)) {
        throw new Error("asGrid(true): switch did not produce a Grid editor");
    }
    return new GridEditorFacade(editor);
}
```

Scope of the parameter:
- **Eleven ViewModel-backed facades** gain `force?: boolean`: `asText`, `asGrid`, `asNotebook`, `asTodo`, `asLink`, `asMarkdown`, `asSvg`, `asHtml`, `asMermaid`, `asGraph`, `asDraw`.
- **Two direct-model facades** stay throw-only (no force parameter): `asBrowser`, `asMcpInspector` — there's no switch path to/from those page shapes.
- Mirrored on the IPage.d.ts script-API type for each facade method.

### SF2 — `ContentViewModelHost` / `acquireViewModel` / `releaseViewModel` retirement — RESOLVED 2026-05-20

**Resolution:** confirmation. Direct consequence of SF1 (d) — under the explicit-force design, the page IS the editor at all times; no shadow ViewModel exists for an off-screen editor to live in. The retirement scope:
- `model.acquireViewModel(editorId)` — gone
- `model.releaseViewModel(editorId)` — gone
- `ContentViewModelHost` (`src/renderer/editors/base/ContentViewModelHost.ts`) — gone
- Per-host viewmodel registry / ref-count machinery — gone
- `useContentViewModel` React hook (`src/renderer/editors/base/useContentViewModel.ts`) — gone

Each EditorModel subclass owns its viewmodel-equivalent state directly. Walkthroughs 20–29 confirm per editor.

### SF3 — `releaseList` constructor parameter on PageWrapper — RESOLVED 2026-05-20

**Resolution:** option (a) — drop `releaseList` from `PageWrapper` + `PageCollectionWrapper` constructors only; keep it alive in `ScriptContext` and `AppWrapper`. Verification surfaced three consumers (not one): PageWrapper `asX()` push sites (retire under SF2), AppWrapper event-channel subscriptions (stay — load-bearing for `app.events.X.subscribe` cleanup), `initializeUiFacade` Log View viewmodel (retires under SF2; new shape in walkthrough 13). `ScriptContext.releaseList` field unchanged; `AppWrapper` continues to receive and use it; PageWrapper / PageCollectionWrapper no longer take it as a constructor parameter (no push sites remain after SF2). If a future PageWrapper method ever needs script-end cleanup, re-thread at that one well-understood site rather than preemptively across two classes.



Initial draft proposed dropping `releaseList` entirely on the assumption SF2 retired its only consumer. Verification surfaced **three** consumers, not one:

1. **`PageWrapper.asX()` push sites** (11 of them) — `() => model.releaseViewModel(...)`. ✅ Retire under SF2.
2. **`AppWrapper.events` proxy** (`api-wrapper/AppWrapper.ts:8-14` — `wrapEventChannel`) — pushes `() => sub.unsubscribe()` for every `app.events.X.subscribe(...)` call. ⚠️ **Stays.** When a script does `app.events.openLink.subscribe(handler)`, the wrapper auto-removes the subscription on script teardown via this hook. Load-bearing — without it, every script subscription leaks.
3. **`initializeUiFacade`** (`ScriptContext.ts:253`) — pushes `() => logEditor.releaseViewModel("log-view")` for the Log View page used by `ui.push`. ✅ Retires under SF2; new cleanup shape lands in walkthrough 13 (MCP integration).

Also load-bearing: `AutoloadRunner.ts:21-25` documents that autoload scripts share one `ScriptContext` and rely on `releaseList` for event-subscription disposal across reload/error.

So `releaseList` itself stays alive in `ScriptContext`. The narrower question is whether `PageWrapper` / `PageCollectionWrapper` still need to receive it.

Options:
- **(a)** Drop `releaseList` from `PageWrapper` + `PageCollectionWrapper` constructors only. No push sites remain in either after SF2; AppWrapper's event subscriptions don't flow through PageWrapper. `AppWrapper` continues to own and pass `releaseList` to its event-channel proxy. `ScriptContext` continues to build the list and drain it at teardown.
- **(b)** Keep threading `releaseList` through `PageWrapper` / `PageCollectionWrapper` for forward-compat — preserves a hook surface for hypothetical future PageWrapper-level script-end cleanup.

Recommend **(a)**. Two-tier scope:
- `ScriptContext.releaseList` survives — drains event-channel subscriptions + (until walkthrough 13) Log View viewmodel.
- `AppWrapper` constructor keeps the parameter — `wrapEventChannel` / `createEventsProxy` still push.
- `PageWrapper` + `PageCollectionWrapper` drop the parameter — no push sites remain. `AppWrapper` builds its `PageCollectionWrapper` without passing the list.

Constructor signatures after:
```typescript
class ScriptContext {
    readonly releaseList: Array<() => void> = [];                 // unchanged
    constructor(page?: EditorModel, ...) {
        this.app  = new AppWrapper(this.releaseList);             // unchanged — events use it
        this.page = page ? new PageWrapper(page, this.outputFlags) : undefined;  // ← dropped
    }
}

class AppWrapper {
    constructor(releaseList: Array<() => void>) {                 // unchanged
        this._pages = new PageCollectionWrapper(app.pages);       // ← dropped
        // ...
    }
}

class PageWrapper {
    constructor(model: EditorModel, outputFlags?: ScriptOutputFlags) {  // ← releaseList removed
        // ...
    }
}

class PageCollectionWrapper {
    constructor(pages: PagesModel) {                              // ← releaseList removed
        // ...
    }
}
```

If a future PageWrapper method ever needs script-end cleanup, re-thread the parameter at that point — at one well-understood site, not preemptively across two classes.

### SF4 — `set editor(value)` setter — error handling — RESOLVED 2026-05-20

**Resolution:** confirmation. S7 (walkthrough 02) already pinned this down — `switchMainEditor` throws on (1) `newEditorId` not registered, (2) current main lacks `CONTENT_HOST_TRAIT`, (3) `newEditorId` not in `findEditorsAccepting(host)`; PageWrapper catches throws and calls `ui.notify(err.message, "error")`. Setter is fire-and-forget — script assignment is sync, switchMainEditor is async; matches today's `model.changeEditor(v)` shape (no regression). Missing `model.page` (detached editor) → silent no-op, confirm during real-code rewrite. No new design here; no mockup change required.



S7 spec: *"`switchMainEditor` throws on: (1) `newEditorId` not registered; (2) current main lacks `CONTENT_HOST_TRAIT`; (3) `newEditorId` not in `findEditorsAccepting(host)`. ... script PageWrapper catches throws and calls `ui.notify(err.message, "error")`."*

Mechanics:
```typescript
set editor(value: string) {
    this.model.page?.switchMainEditor(value)
        .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            ui.notify(message, "error");
        });
}
```

Considerations:
- Setter is fire-and-forget (assignment is sync; switchMainEditor is async). Script can't `await` the assignment. If scripts need to wait for the switch, they must call a method form like `await page.setEditor(value)`. Today's behavior is the same fire-and-forget shape — no regression.
- Missing `model.page` (detached editor) — silent no-op. Today's `model.changeEditor` likely silently no-ops in the same case. Confirm during real-code rewrite.

Recommend confirmation. No new design here — S7 already resolved.

### SF5 — `PageWrapper.type` getter under S10 — RESOLVED 2026-05-20

**Resolution:** option (b) — drop the `type` getter entirely. Scripts branch on `page.editor` (the editorId string) when they need to discriminate page shape. Verification grep across the repo (outside `doc/`) returned zero `page.type` consumers — only the type declaration at `src/renderer/api/types/page.d.ts:35`. Clean removal with no script breakage risk.

Real-code surface:
- Delete `get type()` from `PageWrapper`.
- Delete `readonly type: string` from `IPage` in `src/renderer/api/types/page.d.ts`.
- Scripts that hypothetically branch like `if (page.type === "browserPage")` would flip to `if (page.editor === "browserPage")` — none exist today.

Rejected (a) derive type at the wrapper layer (preserves a contract no script currently consumes; adds three `instanceof` branches for dead UX) and (c) per-EditorModel `pageWrapperType?: string` field (registry-side concept for zero callers). The "is this text-backed?" abstraction is genuinely useful but no script needs it today — re-add as `page.hasContentHost: boolean` (or similar) when a concrete consumer appears.



Today reads `model.state.get().type` (the `"textFile" | "browserPage" | "mcpInspectorPage"` union retired by S10). Script API consumers (and `IPage.type` in `api/types/page.d.ts`) branch on this.

Options:
- **(a)** Derive at the wrapper layer:
  ```typescript
  get type(): string {
      const m = this.model;
      if (m.contentHost) return "textFile";  // any host-backed editor
      if (m instanceof BrowserEditorModel) return "browserPage";
      if (m instanceof McpInspectorEditorModel) return "mcpInspectorPage";
      return m.editorId;  // catch-all (PDF/Image/Compare/Settings/About/...) — same shape as today's view editors
  }
  ```
  Preserves today's script-API contract verbatim.
- **(b)** Drop the `type` getter entirely; scripts must branch on `page.editor` (the editorId string). Clean but breaks `IPage.type`.
- **(c)** Add `EditorModel.pageWrapperType?: string` field per subclass for declarative override. Overkill — only three discrete values matter.

Recommend **(a)**. Script-API surface is a contract; preserving it via a one-site derivation costs nothing and keeps every existing script working. Three discrete `instanceof` branches at the PageWrapper layer.

### SF6 — `ComponentQueue.register` / `.execute` for view-context queries — RESOLVED 2026-05-20

**Resolution:** option (a) — extend `ComponentQueue` with `register(handler)` (view side, programmatic) + `useRequest(handler)` (view side, React hook) + `execute(req)` (model side) request/reply half, symmetric with the existing `subscribe` / `use` / `send` mailbox. Mockup adjustment B1 landed in `mockups/ComponentQueue.ts`: second generic param `Req = never`; private `_pendingRequests` / `_requestHandler` fields; `execute(req): Promise<unknown>` queues if no handler, resolves on `register` drain; `register(handler)` drains pending and returns unregister function; `useRequest(handler)` wraps `useEffect(() => this.register(handler), [this])` per the existing `use()` convention so view code stays a one-liner; `dispose` rejects pending requests so awaiting scripts don't hang; mirrors single-handler-at-a-time discipline. Walkthrough 20 finalizes Monaco's request union (`MonacoQueueRequest`) covering `getSelectedText` / `getCursorPosition` / `insertText` / `replaceSelection`; TextEditorFacade collapses to thin Promise-returning delegates over `editor.queue.execute(...)`. Lands S4's "future extension deferred to walkthrough 12 or 20" within walkthrough 12 — keeps walkthrough 20 focused on Monaco specifics rather than primitive design.

**Script-API impact:** `TextEditorFacade.getSelectedText` / `getCursorPosition` / `insertText` / `replaceSelection` become async (return `Promise`); today they're sync. Scripts that do `const sel = (await page.asText()).getSelectedText()` flip to `const sel = await (await page.asText()).getSelectedText()` — one extra await. Acceptable breaking change for the architecture cleanup. `revealLine` / `setHighlightText` stay sync (fire-and-forget via `send`, not `execute`).

Rejected (b) separate `ComponentBridge` primitive for req/reply (two primitives where one mailbox suffices — same FIFO discipline, same single-consumer rule, same dispose semantics) and (c) defer to walkthrough 20 (would land primitive design in an editor-specific walkthrough that should be focused on Monaco internals).



`TextEditorFacade.getSelectedText` / `getCursorPosition` / `insertText` / `replaceSelection` need view-context. Two execution shapes:

| Today | New |
|-------|-----|
| `vm.getSelectedText()` — sync call on ViewModel; ViewModel reads `editorRef.current?.getSelection()` | `?` |
| `vm.insertText(t)` — sync call; ViewModel issues `editor.executeEdits(...)` | `?` |

S4 introduced `ComponentQueue` as a one-way mailbox (`send` from model, `subscribe` from view) for fire-and-forget commands like `revealLine` / `highlightText`. For value-returning queries, options:

- **(a)** Extend ComponentQueue with `register(handler: (req) => res)` (view side) + `execute(req): Promise<res>` (model side). Request/reply over the same primitive. Sync inside Monaco's render frame; async at the API boundary (Promise).
- **(b)** Add a separate `ComponentBridge` primitive for req/reply, keep ComponentQueue as fire-and-forget only.
- **(c)** Defer to walkthrough 20 (Monaco) — TextEditorFacade methods stub with `throw new Error("not yet implemented")` until 20 finalizes the primitive.

Recommend **(a)**. Single primitive, narrower API. Each editor's queue has both shapes available; Monaco uses the req/reply path for selection probes. Reverts to the S4 deferral promise (12 or 20) — landing here keeps Monaco's walkthrough focused on Monaco-specific concerns rather than primitive design.

Concrete API:
```typescript
class ComponentQueue<E, R = void> {
    send(event: E): void;                       // existing — fire-and-forget
    subscribe(handler: (e: E) => void): Subscription;
    use(handler: (e: E) => void): void;         // React hook

    register(handler: (req: R) => unknown): Subscription;     // NEW — view side
    execute(req: R): Promise<unknown>;                        // NEW — model side
    dispose(): void;
}
```

(Generic shape will refine in implementation; the open question is presence and call site, not the exact TS.)

### SF7 — `asGrid()` editor-id resolution under S10 — RESOLVED 2026-05-20

**Resolution:** confirmation. Mechanical translation — `this.model.state.get().editor` → `this.model.editorId` (S10); `this.model.state.get().language` → `this.model.contentHost?.state.get().language` (P4 — language is host-owned). Short-circuit check (`if currentEditor === "grid-json"`) becomes `if (id === "grid-json")`. Throw branch ("content is not JSON, CSV, or JSONL") unchanged. No new design; no mockup change required. Same translation pattern applies to any other facade method that today reads `state.get().editor` or `state.get().language` — walkthroughs 20–29 verify per editor.



Today's `resolveGridEditorId`:
```typescript
private resolveGridEditorId(): EditorView {
    const currentEditor = this.model.state.get().editor;        // ← S10 retires
    if (currentEditor === "grid-json" || currentEditor === "grid-csv" || currentEditor === "grid-jsonl") {
        return currentEditor;
    }
    const language = this.model.state.get().language;           // ← moves to host
    if (language === "json") return "grid-json";
    if (language === "csv") return "grid-csv";
    if (language === "jsonl") return "grid-jsonl";
    throw new Error("asGrid(): content is not JSON, CSV, or JSONL");
}
```

Rewrite (mechanical):
```typescript
private resolveGridEditorId(): string {
    const id = this.model.editorId;                                            // S10
    if (id === "grid-json" || id === "grid-csv" || id === "grid-jsonl") return id;
    const language = this.model.contentHost?.state.get().language;             // host-owned
    if (language === "json") return "grid-json";
    if (language === "csv") return "grid-csv";
    if (language === "jsonl") return "grid-jsonl";
    throw new Error("asGrid(): content is not JSON, CSV, or JSONL");
}
```

Recommend confirmation — mechanical translation, no new design.

### SF8 — Browser / McpInspector facade gates — RESOLVED 2026-05-20

**Resolution:** confirmation. Mechanical translation — `state.get().type !== "browserPage"` → `!(this.model instanceof BrowserEditorModel)`; `state.get().type !== "mcpInspectorPage"` → `!(this.model instanceof McpInspectorEditorModel)`. Drops the `as unknown as BrowserEditorModel` / `as unknown as McpInspectorEditorModel` cast as a side benefit (TypeScript narrows the type after the instanceof check). No `force?: boolean` parameter — SF1 stays throw-only for these two direct-model facades (no switch path to/from Browser / McpInspector pages). No new design; no mockup change required.



Today:
```typescript
async asBrowser() {
    if (this.model.state.get().type !== "browserPage") throw ...;   // S10 retires .type
    return new BrowserEditorFacade(this.model as unknown as BrowserEditorModel);
}
```

New:
```typescript
async asBrowser() {
    if (!(this.model instanceof BrowserEditorModel)) throw new Error("asBrowser() is only available for browser pages");
    return new BrowserEditorFacade(this.model);                     // no cast
}
```

Same for `asMcpInspector` and `instanceof McpInspectorEditorModel`. Drops the `as unknown as` cast as a side benefit.

Recommend confirmation — mechanical translation.

### SF9 — `PageWrapper.modified` getter under host split — RESOLVED 2026-05-20

**Resolution:** option (a) — base `EditorModel.modified: boolean` getter survives (already in place at `mockups/EditorModel.ts:373`, reads `state.get().modified` from `EditorStateBase.modified` field). Text-bearing subclasses override the getter:
```typescript
get modified(): boolean { return this._host?.state.get().modified ?? false; }
```
Non-text editors inherit the base getter (defaults to `state.get().modified` from their own state — `false` by default; non-text editors that need a notion of "modified" can write to their own state). PageWrapper unchanged — `this.model.modified` continues to work; centralizing avoids host-lookup scatter at PageTab (walkthrough 08 / T1 already reads `editor.state.use()`), save-on-close ordering (N7), and the script API. The base field's "dead-when-overridden" state (text-bearing editors never write to it) is acceptable leak — defaults to false and is unread. Rejected (b) PageWrapper inlines `this.model.contentHost?.state.get().modified ?? false` (pushes host-lookup to every consumer). No mockup change required — base getter signature already correct.



Today: `get modified() { return this.model.modified; }` — reads an `EditorModel.modified` getter.

After split:
- **Text-bearing editors** (Monaco / Grid / Markdown / Mermaid / Svg / Html / Notebook / Todo / Link / Graph / Draw): `modified` belongs to the host (`TextFileModel.state.modified`) — file-backed state.
- **Browser / McpInspector / PDF / Image / Compare / Settings / About / Storybook / Archive**: no concept of "modified" against a backing file. Returns `false`.

Two shapes:
- **(a)** Base `EditorModel.modified: boolean` getter — defaults to `false`; text-bearing override delegates to `this._host?.state.get().modified ?? false`. PageWrapper unchanged.
- **(b)** PageWrapper inlines the lookup: `return this.model.contentHost?.state.get().modified ?? false`. EditorModel doesn't expose `modified`.

Recommend **(a)**. `modified` is read in several places besides the script API (PageTab's modified-dot indicator per walkthrough 08, save-on-close dialog ordering per N7). Centralizing on a base getter that subclasses override is cleaner than scattering the host-lookup at every consumer.

### SF10 — `EditorView` literal-string union retirement — RESOLVED 2026-05-20

**Resolution:** option (b) — `EditorView` literal union retires from `src/shared/types.ts` (internal `editorId: string` per S10) but lives on as a script-API-only union in `api/types/page.d.ts`. Verified the value↔id mapping is 1:1 verbatim — no translation step at the setter; `page.editor = "grid-json"` directly invokes `switchMainEditor("grid-json")`. Maintenance cost: two-place touch when a new editor lands (registry registration + `EditorView` union); pays off at script-author IntelliSense on `page.editor = "..."`. No generic `"grid"` shortcut — scripts specify the exact registry id (`"grid-json"` / `"grid-csv"` / `"grid-jsonl"`); auto-resolve from language happens only via `asGrid(true)` per SF1. Rejected (a) plain `string` (kills IntelliSense) and (c) re-export internal `editorId` type (re-couples script API to internal types). No mockup change required.



Today's `EditorView = "monaco" | "grid-json" | "grid-csv" | "grid-jsonl" | "md-view" | ...` lives in `src/shared/types.ts` and is referenced by:
- `PageWrapper.editor` getter/setter
- `PageCollectionWrapper.addEditorPage` signature
- `IPage.editor` field type in `api/types/page.d.ts`
- 25+ callsites across editors and registry

S10 retires the field and the union. The script API still needs SOME type for `page.editor`.

**No mapping concern.** `EditorView` values match `editorRegistry` `id` values **1:1, verbatim** — `"monaco"` ↔ `id: "monaco"`, `"grid-json"` ↔ `id: "grid-json"`, every entry. The setter is a direct passthrough; the script-API type only constrains the input string at compile time.

Options:
- **(a)** `page.editor: string`. Plain. Loses literal-completion in script editors (no IntelliSense for valid editor ids).
- **(b)** Keep `EditorView` as a string literal union in the script-API-only types (`api/types/page.d.ts`), decoupled from internal types. Script editors get IntelliSense; internal code uses raw string per S10.
- **(c)** Re-export internal `editorId` type union — couples script API back to internal types.

Recommend **(b)**. Script API ergonomics matter (script authors hit literal completion when typing `page.editor = "..."`). Decoupling from internal types is exactly the right shape — `EditorView` becomes a script-API contract independent of `EditorModel.editorId: string`.

Concrete shape under (b):
```typescript
// api/types/page.d.ts — script-API only
export type EditorView = "monaco" | "grid-json" | "grid-csv" | "grid-jsonl" | "md-view" | "pdf-view" | ...;

interface IPage {
    editor: EditorView;     // typed for IntelliSense
    // ...
}

// src/renderer/scripting/api-wrapper/PageWrapper.ts
class PageWrapper {
    get editor(): EditorView {
        return this.model.editorId as EditorView;
    }
    set editor(value: EditorView) {
        this.model.page?.switchMainEditor(value)            // direct passthrough — value is the registry id
            .catch(err => ui.notify(err instanceof Error ? err.message : String(err), "error"));
    }
}

// src/shared/types.ts — internal types
// (EditorView removed; editorId is plain string per S10)
```

Script flow stays exactly as today:
```javascript
page.language = "json";       // host.changeLanguage("json")
page.editor = "grid-json";    // switchMainEditor("grid-json") — direct call, no translation
```

Maintenance cost: when a new editor lands, add its id to both (1) the `editorRegistry.register({ id: "...", ... })` call AND (2) the `EditorView` union in `api/types/page.d.ts`. Trivial recurring two-place touch — pays off at every script-author's keystroke. (a) saves the touch but kills IntelliSense entirely; (c) saves the touch but re-couples internal types.

Note: today's `EditorView` doesn't have a generic `"grid"` — only the exact variants `"grid-json"` / `"grid-csv"` / `"grid-jsonl"`. Same under (b) — scripts specify the exact registry id; `page.editor = "grid"` fails TypeScript today and continues to fail (no auto-resolve from language to variant at the setter; auto-resolve only happens via `asGrid(true)` per SF1).

## Mockup adjustments proposed

| ID | Mockup | Change |
|----|--------|--------|
| B1 | `mockups/ComponentQueue.ts` | Extend with `register(handler)` (view side) + `execute(req)` (model side) request/reply API per SF6. Single primitive; req/reply alongside existing fire-and-forget `send`/`subscribe`/`use`. |

No PageWrapper mockup file — script-API surface is too small to need a non-compiling sketch separate from the existing real-code path. The proposed shape lives in this walkthrough's "How the foundation mockups handle this" section.

## Closure

All ten concerns resolved 2026-05-20. One mockup adjustment landed: **B1** — `mockups/ComponentQueue.ts` extended with the request/reply half (`execute` / `register`) for view-context queries per SF6, symmetric with the existing fire-and-forget `send` / `subscribe` channel.

**Headline outcomes:**

| Area | Today | Under EPIC-028 |
|------|-------|----------------|
| `asX()` when page isn't X | Implicit promotion via `acquireViewModel` (shadow ViewModel) | Throw by default; opt-in switch via `asX(true)` — uses the UI switch widget's compatibility source (SF1) |
| ViewModel ref-counting | `ContentViewModelHost` + `acquireViewModel` / `releaseViewModel` | All retire — each EditorModel IS its own viewmodel (SF2) |
| `releaseList` plumbing | Threaded through PageWrapper + PageCollectionWrapper + AppWrapper | Stays in `ScriptContext` + `AppWrapper` (event subscriptions); drops from PageWrapper + PageCollectionWrapper (SF3) |
| `set editor(v)` | `model.changeEditor(v)` | `page.switchMainEditor(v).catch(ui.notify)` per S7 (SF4) |
| `page.type` field | `state.get().type` (legacy three-value union) | Removed — scripts branch on `page.editor` if needed (SF5) |
| View-context queries (`getSelectedText`, etc.) | Sync via `vm.editorRef` | Async via `ComponentQueue.execute` / `register` — S4's deferred future lands here (SF6) |
| `asGrid()` id resolution | Reads `state.editor` + `state.language` | Reads `editorId` + `contentHost.state.language` (SF7) |
| Browser / McpInspector gates | `state.type === "browserPage"` + `as unknown as` cast | `instanceof BrowserEditorModel` — cast drops as side benefit (SF8) |
| `modified` getter | `model.modified` reads base `state.modified` | Base getter unchanged; text-bearing override delegates to host (SF9) |
| `EditorView` union | In `src/shared/types.ts` (internal) | Retires internally; lives on as script-API-only union in `api/types/page.d.ts` for IntelliSense (SF10) |

**Mockup adjustments:**
- **B1** — `mockups/ComponentQueue.ts`: second generic `Req = never`; `execute(req): Promise<unknown>` + `register(handler)` request/reply pair; mailbox semantics symmetric with `send` / `subscribe`; `dispose` rejects pending requests.

**Real-code migration scope handed off:**
- `PageWrapper.ts` rewrite — host-split getters, `force?: boolean` parameter on 11 facade methods, `instanceof` gates for Browser/McpInspector, `set editor(v)` → `switchMainEditor(v).catch(ui.notify)`, drop `type` getter, drop `releaseList` parameter.
- `PageCollectionWrapper.ts` — drop `releaseList` parameter; `addEditorPage(editorId: string, ...)` already covered by walkthrough 11 / EW2.
- `TextEditorFacade.ts` — collapse to thin Promise-returning delegates over `editor.queue.execute(...)`.
- All 10 ViewModel-backed facade files (`TextEditorFacade`, `GridEditorFacade`, `NotebookEditorFacade`, `TodoEditorFacade`, `LinkEditorFacade`, `MarkdownEditorFacade`, `SvgEditorFacade`, `HtmlEditorFacade`, `MermaidEditorFacade`, `GraphEditorFacade`, `DrawEditorFacade`) — flip from wrapping `ViewModel` to wrapping the EditorModel subclass directly; finalized per editor in walkthroughs 20–29.
- `BrowserEditorFacade.ts` + `McpInspectorFacade.ts` — drop `as unknown as` cast.
- `ScriptContext.ts` — stop passing `releaseList` to `PageWrapper` and `PageCollectionWrapper`; `initializeUiFacade` Log View viewmodel cleanup rewires under walkthrough 13.
- `AppWrapper.ts` — constructor signature unchanged; stops passing `releaseList` to `PageCollectionWrapper`.
- `src/shared/types.ts` — delete `EditorView` literal union (move to `api/types/page.d.ts`); delete `IEditorState` (already covered by walkthrough 04 / P1).
- `src/renderer/api/types/page.d.ts` — add `EditorView` literal union; delete `readonly type: string` from `IPage`; update facade method signatures with `force?: boolean` parameter and `Promise<>` return for view-context queries.
- `ContentViewModelHost.ts` + `useContentViewModel.ts` files deleted.
- Per-editor confirmation: each EditorModel subclass declares its own state shape (no shared `IEditorState`); text-bearing editors override `modified` getter to delegate to host; Monaco finalizes `MonacoQueueRequest` union and ComponentQueue `register` dispatcher in walkthrough 20.
