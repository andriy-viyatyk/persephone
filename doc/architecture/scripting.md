# Scripting System

## Overview

js-notepad includes a JavaScript/TypeScript execution environment that allows users to:
- Transform content programmatically
- Automate repetitive tasks
- Connect to databases and APIs
- Process data with full Node.js access

TypeScript support is provided via [sucrase](https://github.com/alangpierce/sucrase) (~275 KB), which strips type annotations before execution. Sucrase is loaded dynamically on first TypeScript execution, so it has zero cost if only JavaScript is used.

All scripting code lives in `/src/renderer/scripting/`.
Type definitions for the script API live in `/src/renderer/api/types/*.d.ts`.

## Architecture

```
ScriptRunner.run(script, page?, language?)
    │
    ├── ScriptRunnerBase.execute(script, context, language?)
    │       ├── prepare(script, language)
    │       │     ├── transpileIfNeeded()   ← strips TS types via sucrase (lazy-loaded)
    │       │     ├── ensureSucraseLoaded() + registerLibraryExtensions()
    │       │     └── clearLibraryRequireCache() if dirty
    │       └── executeInternal(script, context)
    │             ├── Expression/statement detection
    │             ├── Wrap in async function with lexical globals
    │             └── Await result if Promise
    │
    ├── new ScriptContext(page?, consoleLogs?, libraryPath?)
    │       ├── AppWrapper        ← wraps `app` global
    │       │     ├── PageCollectionWrapper  ← wraps `app.pages`
    │       │     └── Events proxy ← wraps `app.events` (auto-tracks subscriptions)
    │       ├── PageWrapper       ← wraps `page` global
    │       │     └── EditorFacades (13)  ← page.asText(), page.asGrid(), ...
    │       ├── UiFacade (lazy)   ← wraps `ui` global (Log View logging + dialogs)
    │       ├── styledText()     ← standalone styled text builder for dialog labels
    │       ├── preventOutput()   ← suppresses default grouped-page output
    │       ├── require           ← patched require with library/ resolution
    │       ├── React             ← React library
    │       ├── ScriptOutputFlags ← tracks output suppression state
    │       └── Proxy (globalThis interception)
    │
    └── context.dispose()  ← releases all acquired ViewModels + unsubscribes events
```

## Execution Modes

### 1. Run Script (F5) / `page.runScript()`

For files with `javascript` or `typescript` language:
- Runs selected text, or entire content if nothing selected
- Output appears in grouped page (unless suppressed — see Output Suppression below)
- TypeScript files are transpiled (types stripped) before execution
- Also available programmatically via `page.runScript()` (equivalent to F5)

### 2. Script Panel

Available on any text file:
- Open via toolbar or context menu
- Monaco editor uses TypeScript language (supports both JS and TS transparently)
- Scripts are always transpiled as TypeScript (no-op for pure JS)
- Scripts have access to `page` and `app` variables

## Script Globals

Scripts execute with access to these globals:

### `page` — Current Page

```typescript
interface IPage {
    // Identity (read-only)
    readonly id: string;
    readonly type: PageType;
    readonly title: string;
    readonly modified: boolean;
    readonly pinned: boolean;
    readonly filePath: string | undefined;

    // Mutable properties
    content: string;
    language: string;
    editor: PageEditor;

    // Script-local data storage (persists across runs within same session)
    data: Record<string, any>;

    // Grouped page (auto-creates if none exists)
    readonly grouped: IPage;

    // Editor facades (async — acquire ViewModel)
    asText(): Promise<ITextEditor>;
    asGrid(): Promise<IGridEditor>;
    asNotebook(): Promise<INotebookEditor>;
    asTodo(): Promise<ITodoEditor>;
    asLink(): Promise<ILinkEditor>;
    asMarkdown(): Promise<IMarkdownEditor>;
    asSvg(): Promise<ISvgEditor>;
    asHtml(): Promise<IHtmlEditor>;
    asMermaid(): Promise<IMermaidEditor>;
    asGraph(): Promise<IGraphEditor>;
    asDraw(): Promise<IDrawEditor>;
    asBrowser(): Promise<IBrowserEditor>;
    asMcpInspector(): Promise<IMcpInspectorEditor>;

    // Run this page as a script (same as F5)
    runScript(): Promise<string>;
}
```

### `preventOutput()` — Suppress Default Output

Calling `preventOutput()` in a script prevents `runWithResult` from writing the script's return value to the grouped page. Useful when scripts handle their own output or need no output at all.

```javascript
preventOutput();
await processFiles();
app.ui.notify("Done!", "success");
```

Output is also automatically suppressed when a script writes to `page.grouped.content` directly (tracked via `GroupedPageWrapper`), or when the script accesses the `ui` global (see below).

### `ui` — Log View UI Facade

Provides logging and interactive dialogs via a Log View page. **Lazy-initialized** — the Log View page is created only when the script first accesses `ui`.

```typescript
interface IUiLog {
    // Logging — returns StyledLogBuilder for optional fluent styling
    log(message: StyledText): IStyledLogBuilder;
    info(message: StyledText): IStyledLogBuilder;
    warn(message: StyledText): IStyledLogBuilder;
    error(message: StyledText): IStyledLogBuilder;
    success(message: StyledText): IStyledLogBuilder;
    text(message: StyledText): IStyledLogBuilder;
    clear(): void;

    // Dialogs (async — returns Promise)
    // Two-overload pattern: simple positional form + full object form
    readonly dialog: {
        confirm(message: StyledText, buttons?: string[]): Promise<IDialogResult>;
        confirm(options: { message: StyledText; buttons?: string[] }): Promise<IDialogResult>;
        buttons(buttons: string[], title?: StyledText): Promise<IDialogResult>;
        buttons(options: { buttons: string[]; title?: StyledText }): Promise<IDialogResult>;
        textInput(title?: StyledText, options?: { ... }): Promise<IDialogResult>;
        textInput(options: { title?: StyledText; placeholder?: string; ... }): Promise<IDialogResult>;
        checkboxes(items: (string | CheckboxItem)[], title?, buttons?): Promise<IDialogResult>;
        checkboxes(options: { items: (string | CheckboxItem)[]; title?; layout?; buttons? }): Promise<IDialogResult>;
        radioboxes(items: string[], title?, buttons?): Promise<IDialogResult>;
        radioboxes(options: { items: string[]; title?; checked?; layout?; buttons? }): Promise<IDialogResult>;
        select(items: string[], title?, buttons?): Promise<IDialogResult>;
        select(options: { items: string[]; title?; selected?; placeholder?; buttons? }): Promise<IDialogResult>;
    };

    // Output (display-only rich content)
    readonly show: {
        progress(label?: StyledText): IProgress;
        progress(options: { label?; value?; max? }): IProgress;
        grid(data: any[]): IGrid;
        grid(options: { data: any[]; columns?; title? }): IGrid;
        text(text: string, language?: string): IText;
        text(options: { text; language?; title?; wordWrap?; lineNumbers?; minimap? }): IText;
        markdown(text: string): IMarkdown;
        markdown(options: { text: string; title?: StyledText }): IMarkdown;
        mermaid(text: string): IMermaid;
        mermaid(options: { text: string; title?: StyledText }): IMermaid;
    };
}
```

**Two-overload pattern:** All dialog methods and `ui.show.*` methods support two calling styles: a simple positional form and a full object form. Disambiguation relies on `StyledText` being `string | StyledSegment[]` — a plain non-array object is always the full form. Implementation uses `isOptionsObject()` helper in `UiFacade`.

**Styled text builder:** Logging methods return `IStyledLogBuilder` — a fluent builder that allows chaining `.append()`, `.color()`, `.bold()`, etc. and finalizing with `.print()`:

```typescript
ui.text("Status: ")
    .append("OK").color("lime").bold()
    .append(" — all checks passed")
    .print();
```

The standalone `styledText()` global creates a builder for use in dialog labels and other components:

```typescript
const label = styledText("Warning").color("red").bold().value;
await ui.dialog.confirm(label);
```

**Implementation:** `StyledTextBuilder` and `StyledLogBuilder` classes in `/src/renderer/scripting/api-wrapper/StyledTextBuilder.ts`. `StyledLogBuilder` extends `StyledTextBuilder` with a `print()` method that calls `LogViewModel.updateEntryText()` to update the already-added entry with the built styled text.

**Console forwarding:** When `ui` is first accessed, `console.log/info/warn/error` are automatically forwarded to the Log View:
- `console.log` → `log.log` (light/dimmed text)
- `console.info` → `log.info` (blue)
- `console.warn` → `log.warn` (yellow)
- `console.error` → `log.error` (red)
- Native console is always called (forwarding is additive, not a replacement)
- For MCP scripts, console output is captured in both `consoleLogs` (returned to agent) and Log View (visible to user)
- Suppress forwarding per-level with `ui.preventConsoleLog()`, `ui.preventConsoleWarn()`, `ui.preventConsoleError()`

**Callable `ui()` yield:** The `ui` global is also callable — `await ui()` yields to the event loop (via `setTimeout(0)`), preventing long-running scripts from freezing the UI. This is implemented via a `Proxy` that delegates property access to `UiFacade` but treats function calls as event-loop yields.

```javascript
for (const item of largeArray) {
    // ... heavy processing ...
    await ui(); // let UI breathe
}
```

**Key behaviors:**
- Accessing `ui` auto-creates a Log View page grouped with the source page (or standalone if no page context)
- For MCP scripts (`runWithCapture`), `ui` uses the well-known MCP Log page (`mcp-ui-log`) — same page as `ui_push`. See [pages-architecture.md § Well-Known Pages](pages-architecture.md#8-well-known-pages)
- Accessing `ui` sets `groupedContentWritten = true`, suppressing default script output
- Re-running a script reuses the existing grouped Log View (appends with separator)
- Dialog results are always objects — `button` is `undefined` if canceled (page closed while pending)
- Log View page title uses datetime format: `"2026-03-10 12:24.log.jsonl"`

**Implementation:** `UiFacade` wraps `LogViewModel`. The log-view editor module is pre-loaded in `ScriptRunner` via `editorRegistry.loadViewModelFactory("log-view")`, then the VM is created synchronously in the lazy getter via `acquireViewModelSync("log-view")`.

### `app` — Application Object

```typescript
interface IApp {
    readonly version: string;
    readonly settings: ISettings;
    readonly editors: IEditors;
    readonly recent: IRecent;
    readonly fs: IFileSystem;
    readonly window: IWindow;
    readonly shell: IShell;
    readonly ui: IUserInterface;
    readonly downloads: IDownloads;
    readonly menuFolders: IMenuFolders;
    readonly pages: IPageCollection;
}
```

### `React`

The React library is available for advanced use cases.

### Full Node.js Access

With `nodeIntegration: true`, scripts can use:

```javascript
const fs = require('fs');
const path = require('path');
const https = require('https');

// Load npm packages
const sql = require(path.join('D:\\packages\\node_modules', 'mssql'));
const axios = require(path.join('D:\\packages\\node_modules', 'axios'));
```

### Script Library Imports

When a script library folder is linked (via `script-library.path` setting), scripts can import library modules:

```javascript
const { greet } = require("library/utils/helpers");
const config = require("library/config");
```

- `require("library/...")` resolves to `{script-library.path}/...`
- Supports `.ts` and `.js` files — TypeScript files are transpiled via sucrase; `.js` files with ES module syntax (`export`/`import`) are also transpiled (imports transform only)
- Extension auto-resolution: tries exact path, `.ts`, `.js`, `/index.ts`, `/index.js`
- Relative requires within library modules work naturally (e.g., `require('./db-config')` inside a library file)
- **Context injection:** Extension handlers prepend a one-line prefix to every library module, injecting `app`, `page`, `React`, `styledText` as local variables from `globalThis.__scriptContext__`. This ensures library modules have access to the same script context globals as the top-level script. `ScriptContext` sets `globalThis.__scriptContext__` in its constructor and clears it in `dispose()`.
- Library require cache is cleared on every script execution (in `ScriptRunnerBase.prepare()`) so modules always get fresh context globals
- When the library is not linked, `require("library/...")` throws a descriptive error

Implementation: `library-require.ts` provides `createLibraryRequire()` (patched require function) and `registerLibraryExtensions()` (`.ts` and `.js` handlers via `require.extensions` — `.js` handler only transpiles files inside the library folder, both inject context prefix).

### Library IntelliSense

Monaco provides IntelliSense (autocomplete, type checking) for library modules. When a script library folder is linked, all library `.ts`/`.js` files are registered with Monaco via `addExtraLib()`, and compiler options include `paths: { "library/*": ["file:///library/*"] }` so that `import`/`require` of `library/...` paths resolve to the registered virtual files.

- Lazy-loaded: `loadLibraryIntelliSense()` is called from `initMonaco()` (in `configure-monaco.ts`)
- Live updates: subscribes to `libraryService.state` changes, disposes old extra-lib registrations and re-registers on library changes
- Path completion: a `CompletionItemProvider` triggers inside `require("library/...")` strings, suggesting folders and files from the library. Folders show with folder icon and re-trigger suggestions; files show without extension (matching runtime auto-resolution). Registered once per language (JS/TS), reads `allFiles` dynamically.
- Implementation: `/src/renderer/api/setup/library-intellisense.ts`

### Script Panel Library Integration

The script panel toolbar includes a **script selector dropdown** (ComboSelect) and a **save button** for loading/saving scripts from the `script-panel/` folder in the library.

**Script selector dropdown:**
- Lists scripts from `script-panel/{pageLanguage}/` and `script-panel/all/` (prefixed with `all/` to distinguish)
- First entry is always "(unsaved script)" representing the ad-hoc script
- Selecting a script reads the file and loads its content into the editor
- Subscribes to `libraryService.state` for live refresh when library files change

**Save button (SaveIcon):**
- Disabled when content is unmodified (for selected library scripts); always enabled for ad-hoc scripts (acts as "save as")
- Ad-hoc script: shows `InputDialog` with filename input + radio buttons for folder choice (`{language}` or `all`)
- Selected library script: directly overwrites the file (no prompt)
- Ctrl+S shortcut triggers save when script panel editor is focused
- Creates `script-panel/{folder}/` directory if it doesn't exist; shows overwrite confirmation if file exists

**State:** `ScriptPanelState` includes `selectedScript: string | null` (file path) and `dirty: boolean` (modification indicator). Both are persisted to cache and restored on app restart.

- Implementation: `/src/renderer/editors/text/ScriptPanel.tsx` (ScriptPanelModel)

### Library Setup Wizard

When no library is linked, actions that need the library (sidebar "Select Folder", settings "Browse...", script panel save) open the **Library Setup Dialog** instead of a raw folder picker.

**Dialog:** `showLibrarySetupDialog()` — async `TDialogModel` pattern, returns `Promise<string | undefined>` (linked path or cancelled).
- Folder input field + "Browse..." button (Electron folder dialog)
- "Copy example scripts" checkbox (default: checked) — copies bundled examples from `assets/script-library/` to the target folder, skipping files that already exist
- Creates target folder if it doesn't exist
- Saves path to `script-library.path` setting on success

**Bundled example scripts** (`assets/script-library/`):
- `script-panel/all/` — example, base64-encode, base64-decode
- `script-panel/plaintext/` — sort-lines, parse-jwt-token
- `script-panel/json/` — format-json
- `utils/helpers.ts` — shared module demonstrating `require("library/...")`

**Copy logic:** `copyExampleScripts(targetPath)` in `library-service.ts` — resolves asset path via `api.getAppRootPath()`, recursively copies files, never overwrites existing.

- Implementation: `/src/renderer/ui/dialogs/LibrarySetupDialog.tsx`

## Editor Facades

Facades provide safe, typed access to editor-specific features. Each facade wraps a `ContentViewModel` and is acquired via `page.asX()` methods.

| Method | Facade | Wraps | Key Operations |
|--------|--------|-------|----------------|
| `page.asText()` | `TextEditorFacade` | `TextViewModel` | `getSelectedText()`, `insertText()`, `replaceSelection()`, `revealLine()`, cursor position |
| `page.asGrid()` | `GridEditorFacade` | `GridViewModel` | `rows`, `columns`, `editCell()`, `addRows()`, `deleteRows()`, `addColumns()`, `deleteColumns()` |
| `page.asNotebook()` | `NotebookEditorFacade` | `NotebookViewModel` | `notes`, `categories`, `tags`, `addNote()`, `deleteNote()`, `updateNoteTitle()` |
| `page.asTodo()` | `TodoEditorFacade` | `TodoViewModel` | `items`, `lists`, `tags`, `addItem()`, `toggleItem()`, `deleteItem()`, `addList()`, `selectList()`, `selectTag()`, `setSearch()`, `clearSearch()` |
| `page.asLink()` | `LinkEditorFacade` | `LinkViewModel` | `links`, `categories`, `tags`, `addLink()`, `deleteLink()`, `updateLink()` |
| `page.asMarkdown()` | `MarkdownEditorFacade` | `MarkdownViewModel` | `viewMounted`, `html` (read-only) |
| `page.asSvg()` | `SvgEditorFacade` | `SvgViewModel` | `svg` (read-only) |
| `page.asHtml()` | `HtmlEditorFacade` | `HtmlViewModel` | `html` (read-only) |
| `page.asMermaid()` | `MermaidEditorFacade` | `MermaidViewModel` | `svgUrl`, `loading`, `error` (read-only) |
| `page.asGraph()` | `GraphEditorFacade` | `GraphViewModel` | `nodes`, `links`, `search()`, `bfs()`, `getComponents()`, `select()`, selection, groups, neighbors |
| `page.asDraw()` | `DrawEditorFacade` | `DrawViewModel` | `addImage()`, `exportAsSvg()`, `exportAsPng()`, `elementCount`, `editorIsMounted` |
| `page.asBrowser()` | `BrowserEditorFacade` | `BrowserPageModel` | `url`, `title`, `navigate()`, `back()`, `forward()`, `reload()` |
| `page.asMcpInspector()` | `McpInspectorFacade` | `McpInspectorModel` | `connect()`, `disconnect()`, connection params, server info (title, description, websiteUrl, instructions), `history`, `clearHistory()`, `showHistory()` |

**Exception:** `BrowserEditorFacade` and `McpInspectorFacade` wrap their PageModel directly (no ViewModel, no ref-counting) because they are page-editors, not content-views.

Facade source: `/src/renderer/scripting/api-wrapper/`
Interface definitions: `/src/renderer/api/types/*.d.ts`

## Auto-Release Lifecycle

Facades acquire ViewModels via ref-counting. Event subscriptions are tracked via proxy. A shared `releaseList` ensures cleanup after script completion:

```
1. Script starts → new ScriptContext() creates releaseList = []
2. Script calls page.asGrid()
   → acquireViewModel("grid-json")  (ref count +1)
   → releaseList.push(() => releaseViewModel("grid-json"))
   → return GridEditorFacade
3. Script calls app.events.fileExplorer.itemContextMenu.subscribe(handler)
   → events proxy intercepts subscribe(), calls real subscribe()
   → releaseList.push(() => sub.unsubscribe())
   → return SubscriptionObject
4. Script completes (or throws)
5. context.dispose() iterates releaseList
   → releaseViewModel("grid-json")  (ref count -1 → 0 → dispose)
   → sub.unsubscribe()  (removes event handler)
```

The `releaseList` is shared across all wrappers: `AppWrapper → PageCollectionWrapper → PageWrapper → Facades`. This means any ViewModel acquired through any path is automatically released. Event subscriptions made through `app.events` are also automatically unsubscribed.

### Events Proxy

`AppWrapper.events` returns a recursive proxy that wraps `app.events`. When a script calls `subscribe()` or `subscribeDefault()` on any EventChannel, the proxy intercepts the call, subscribes on the real channel, and pushes the `unsubscribe()` handle to the `releaseList`. This means scripts never need to manually unsubscribe — cleanup happens automatically when `ScriptContext.dispose()` is called.

## Wrapper Architecture

Three wrapper classes provide safe script access to the application:

### PageWrapper

Wraps `PageModel`, implements `IPage`. Created per-page:

```typescript
class PageWrapper {
    constructor(model: PageModel, releaseList: Array<() => void>, outputFlags?: ScriptOutputFlags);

    // IPage properties delegate to model
    get content(): string { return model.state.get().content; }
    set content(v: string) { model.changeContent(v); }

    // Grouped page auto-creation (returns GroupedPageWrapper)
    get grouped(): PageWrapper {
        let grouped = pagesModel.getGroupedPage(this.model.id);
        if (!grouped) grouped = pagesModel.requireGroupedText(this.model.id);
        return new GroupedPageWrapper(grouped, this.releaseList, this.outputFlags);
    }

    // Facade acquisition with auto-release
    async asGrid(): Promise<GridEditorFacade> { ... }

    // Run this page's content as a script (same as F5)
    async runScript(): Promise<string> { ... }
}

// Subclass that tracks writes to grouped page content
class GroupedPageWrapper extends PageWrapper {
    set content(value: string) {
        super.content = value;
        this.flags.groupedContentWritten = true;  // suppresses default output
    }
}
```

### AppWrapper

Wraps the `app` singleton, implements `IApp`. Delegates most properties directly. Wraps `pages` in `PageCollectionWrapper`.

### PageCollectionWrapper

Wraps `PagesModel`, implements `IPageCollection`. Returns `PageWrapper` instances instead of raw `PageModel` for all query methods.

## Script Execution

### ScriptRunnerBase (core engine)

Located in `/src/renderer/scripting/ScriptRunnerBase.ts`.

Pure execution engine with no context creation or cleanup. Handles:
- **`execute(script, context, language?)`** — prepares (transpile + library) then executes
- **`prepare()`** — transpiles TypeScript, loads sucrase, registers Script Library extensions
- **`executeInternal()`** — expression/statement detection, `with(this)` wrapping, implicit return, async await
- **`invalidateLibraryCache()`** — marks library require cache as dirty

### ScriptRunner (orchestrator)

Located in `/src/renderer/scripting/ScriptRunner.ts`. Extends `ScriptRunnerBase`.

### `run(script, page?, language?)`

1. Creates `ScriptContext`
2. Calls `execute(script, context, language)` (base handles transpilation + execution)
3. Calls `context.dispose()` in `finally` block

### `runWithResult(pageId, script, page?, language?)`

Calls `executeScript()`, then converts result to text and writes to grouped page — unless output is suppressed. Output suppression is triggered by:
- `preventOutput()` called in the script
- Script writing to `page.grouped.content` directly

When output is suppressed and the script throws an error, the error is shown in a `TextDialog` instead of the grouped page.

### `runWithCapture(script, page?, language?)`

Headless execution for MCP/programmatic use. Returns a `McpScriptResult` without writing to any grouped page:

```typescript
interface McpScriptResult {
    text: string;
    language: string;
    isError: boolean;
    consoleLogs: ConsoleLogEntry[];
}
```

Captures `console.log/error/warn/info` calls during script execution via `ScriptContext`'s console capture support. If the script accesses `ui`, console output is forwarded to both `consoleLogs` (returned to agent) and the shared MCP Log View (visible to user).

### `convertToText(value)` (utility)

Located in `/src/renderer/scripting/script-utils.ts`. Converts any JS value to displayable `{ text, language }`:

| Return Type | Output | Language |
|-------------|--------|----------|
| `string` | As-is | `"plaintext"` |
| `object`, `array` | `JSON.stringify` formatted | `"json"` |
| `Error` | Message + stack trace | `"plaintext"` |
| `undefined` | `"undefined"` | `"plaintext"` |
| `Date`, `RegExp`, `Map`, `Set` | Appropriate string representation | varies |

## Script Context (ScriptContext)

Located in `/src/renderer/scripting/ScriptContext.ts`.

`ScriptContext` is a class that builds the execution environment and manages cleanup:

```typescript
const ctx = new ScriptContext(page?, consoleLogs?, libraryPath?);
// ... execute script with ctx.context ...
ctx.dispose();  // releases ViewModels + unsubscribes events
```

The constructor:

1. Creates `releaseList` (shared cleanup array)
2. Creates `AppWrapper` (always) and `PageWrapper` (if page provided)
3. If `consoleLogs` array is provided (MCP mode), injects a basic capturing `console` object that records `log`, `error`, `warn`, `info` calls as `ConsoleLogEntry` items. This basic capture is replaced with full forwarding when `ui` is accessed (see step 6).
   ```typescript
   interface ConsoleLogEntry {
       level: "log" | "error" | "warn" | "info";
       args: any[];
       timestamp: number;
   }
   ```
4. If `libraryPath` provided, adds patched `require` that resolves `library/` paths to the library folder; otherwise adds a require wrapper that throws a clear error for `library/` paths
5. Adds `styledText` factory function for standalone styled text building
6. Adds lazy `ui` getter via `Object.defineProperty` — creates `UiFacade` on first access, then installs console forwarding (`installConsoleForwarding`) which replaces the basic capture console with one that forwards to both the Log View and (if MCP) the `consoleLogs` array
7. Builds proxy chain:
   - Custom context checked first (`app`, `page`, `ui`, `styledText`, `require`, `React`)
   - Falls back to `globalThis` for standard APIs
   - Functions auto-bound to `globalThis` (except constructors)
   - Set operations go to custom context (scripts can create variables)
5. `dispose()` releases all ViewModels and unsubscribes all event subscriptions made through `app.events`

## Grouped Pages & Output Suppression

When a script accesses `page.grouped`:
1. If no grouped page exists, one is automatically created
2. The new page is grouped (side-by-side) with the source page
3. Script return value is written to the grouped page (default behavior)

```javascript
// This automatically creates and groups a new page
page.grouped.content = 'Output here';
page.grouped.language = 'json';
page.grouped.editor = 'grid-json';
```

### Output Suppression

By default, `runWithResult` writes the script's return value to the grouped page. This can be suppressed in three ways:

1. **`preventOutput()`** — explicitly called in the script. Use when the script handles its own output (e.g., creates custom pages, shows notifications) or needs no output at all.

2. **`page.grouped.content` write detection** — if the script writes to `page.grouped.content`, the default output is suppressed automatically. This prevents the return value from overwriting script-managed output.

3. **`ui` access** — accessing the `ui` global creates a Log View page grouped with the source page, which sets `groupedContentWritten = true`. The `ui` facade handles its own output.

All three mechanisms set flags on `ScriptOutputFlags` (tracked in `ScriptContext`). The `GroupedPageWrapper` subclass intercepts `content` setter to set the `groupedContentWritten` flag.

When output is suppressed and the script throws an error, the error is displayed via `TextDialog` (a Monaco-based dialog) instead of the grouped page.

## Script Triggers

| Trigger | Location | Language | What Runs |
|---------|----------|----------|-----------|
| F5 (script panel open) | `TextFileActionsModel` | Always `"typescript"` | Script panel content |
| F5 (script panel closed, JS/TS file) | `TextFileActionsModel` | From page state | Page content (or selection) |
| F5 (notebook JS/TS note) | `NoteItemEditModel` | From note language | Note content as script |
| Run button (script panel) | `ScriptPanel.tsx` | Always `"typescript"` | Script panel content |
| MCP `execute_script` | `mcp-handler.ts` | Caller-specified (optional) | Script from MCP tool call |

## Type Definitions

Script API types are defined in `/src/renderer/api/types/`:

| File | Defines |
|------|---------|
| `index.d.ts` | Global declarations: `app: IApp`, `page: IPage`, `ui: IUiLog`, `styledText()`, `preventOutput()`, `require()` |
| `app.d.ts` | `IApp` — root application interface |
| `page.d.ts` | `IPage`, `IPageInfo` — page/tab interface |
| `pages.d.ts` | `IPageCollection` — pages management |
| `common.d.ts` | `IDisposable`, `IEvent`, `PageEditor`, `Language` |
| `text-editor.d.ts` | `ITextEditor` — Monaco editor operations |
| `grid-editor.d.ts` | `IGridEditor` — grid editor operations |
| `notebook-editor.d.ts` | `INotebookEditor` — notebook operations |
| `todo-editor.d.ts` | `ITodoEditor` — todo list operations |
| `link-editor.d.ts` | `ILinkEditor` — link manager operations |
| `markdown-editor.d.ts` | `IMarkdownEditor` |
| `svg-editor.d.ts` | `ISvgEditor` |
| `html-editor.d.ts` | `IHtmlEditor` |
| `mermaid-editor.d.ts` | `IMermaidEditor` |
| `graph-editor.d.ts` | `IGraphEditor`, `IGraphNode`, `IGraphComponent`, `IGraphSearchResult` |
| `browser-editor.d.ts` | `IBrowserEditor` — browser page operations |
| `ui.d.ts` | `IUserInterface`, `ITextDialogOptions`, `ITextDialogResult` — dialogs and notifications |
| `ui-log.d.ts` | `IUiLog`, `IUiDialog`, `IUiShow`, `IProgress`, `IGrid`, `IGridColumn`, `IDialogResult`, `IStyledTextBuilder`, `IStyledLogBuilder` — Log View UI facade |

These files serve dual purpose: TypeScript type checking **and** IDE IntelliSense for script authors.

## File Structure

```
/src/renderer/scripting/
├── ScriptRunnerBase.ts          # Core execution engine (transpile, execute)
├── ScriptRunner.ts              # Orchestrator (context lifecycle, result handling)
├── ScriptContext.ts             # Execution scope (context proxy, cleanup)
├── script-utils.ts              # Utilities (convertToText)
├── transpile.ts                 # TypeScript transpilation (sucrase, lazy-loaded)
├── library-require.ts           # Library require() resolution + .ts/.js extension handlers
└── api-wrapper/                 # Facade layer
    ├── AppWrapper.ts            # Wraps app singleton
    ├── PageWrapper.ts           # Wraps PageModel → IPage
    ├── PageCollectionWrapper.ts # Wraps PagesModel → IPageCollection
    ├── TextEditorFacade.ts      # Monaco operations
    ├── GridEditorFacade.ts      # Grid data operations
    ├── NotebookEditorFacade.ts  # Notebook operations
    ├── TodoEditorFacade.ts      # Todo list operations
    ├── LinkEditorFacade.ts      # Link manager operations
    ├── MarkdownEditorFacade.ts  # Markdown preview (read-only)
    ├── SvgEditorFacade.ts       # SVG preview (read-only)
    ├── HtmlEditorFacade.ts      # HTML preview (read-only)
    ├── MermaidEditorFacade.ts   # Mermaid diagram (read-only)
    ├── GraphEditorFacade.ts     # Graph query/analysis (read-only, designed for MCP)
    ├── BrowserEditorFacade.ts   # Browser page operations
    ├── McpInspectorFacade.ts    # MCP Inspector connection & troubleshooting
    ├── UiFacade.ts              # Log View UI (logging + dialogs + output)
    ├── Progress.ts              # Progress helper class (returned by ui.show.progress)
    ├── Grid.ts                  # Grid helper class (returned by ui.show.grid)
    ├── Text.ts                  # Text helper class (returned by ui.show.text)
    ├── Markdown.ts              # Markdown helper class (returned by ui.show.markdown)
    ├── Mermaid.ts               # Mermaid helper class (returned by ui.show.mermaid)
    └── StyledTextBuilder.ts     # Fluent styled text builder + styledText() factory

/src/renderer/api/types/
├── index.d.ts                   # Global: app, page, ui
├── app.d.ts                     # IApp
├── page.d.ts                    # IPage, IPageInfo
├── pages.d.ts                   # IPageCollection
├── ui.d.ts                      # IUserInterface, ITextDialogOptions, ITextDialogResult
├── ui-log.d.ts                  # IUiLog, IUiDialog, IDialogResult
├── common.d.ts                  # IDisposable, IEvent, PageEditor, Language
├── text-editor.d.ts             # ITextEditor
├── grid-editor.d.ts             # IGridEditor
├── notebook-editor.d.ts         # INotebookEditor
├── todo-editor.d.ts             # ITodoEditor
├── link-editor.d.ts             # ILinkEditor
├── markdown-editor.d.ts         # IMarkdownEditor
├── svg-editor.d.ts              # ISvgEditor
├── html-editor.d.ts             # IHtmlEditor
├── mermaid-editor.d.ts          # IMermaidEditor
├── graph-editor.d.ts            # IGraphEditor, IGraphNode, IGraphComponent, IGraphSearchResult
└── browser-editor.d.ts          # IBrowserEditor
```

## Sandbox Limitations

Although scripts have access to `globalThis` via proxy fallback, some Node.js globals don't work correctly through the `with(this)` proxy chain. Known limitation:

- **`Buffer`** — `Buffer.from()` fails in the sandbox. Use browser APIs instead: `btoa()`/`atob()` for base64, `TextEncoder`/`TextDecoder` for encoding.
- **`require()`** — works for Node.js modules and `library/` paths (see above), but the built-in `require` is patched to support library resolution.

Bundled example scripts use browser APIs (`atob`/`btoa`) instead of `Buffer` for this reason.

## Security Considerations

Scripts have full Node.js access. This is by design for power users, but means:
- Scripts can access filesystem
- Scripts can make network requests
- Scripts can execute any Node.js code

This is appropriate for a developer tool where the user writes/controls the scripts.
