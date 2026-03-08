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
    ├── transpileIfNeeded(script, language)   ← strips TS types via sucrase (lazy-loaded)
    ├── ensureSucraseLoaded() + registerLibraryExtensions()  ← for require(".ts"/".js") in library
    ├── clearLibraryRequireCache() if dirty   ← invalidate cached library modules
    │
    ├── ScriptContext.createScriptContext(page?, consoleLogs?, libraryPath?)
    │       ├── AppWrapper        ← wraps `app` global
    │       │     └── PageCollectionWrapper  ← wraps `app.pages`
    │       ├── PageWrapper       ← wraps `page` global
    │       │     └── EditorFacades (10)  ← page.asText(), page.asGrid(), ...
    │       ├── preventOutput()   ← suppresses default grouped-page output
    │       ├── require           ← patched require with library/ resolution
    │       ├── React             ← React library
    │       ├── ScriptOutputFlags ← tracks output suppression state
    │       └── Proxy (globalThis interception)
    │
    ├── Execute script in sandbox (with + Function constructor)
    │
    └── cleanup()  ← releases all acquired ViewModels
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
    asBrowser(): Promise<IBrowserEditor>;

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

Output is also automatically suppressed when a script writes to `page.grouped.content` directly (tracked via `GroupedPageWrapper`).

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
- Library require cache is invalidated via `LibraryService` file watcher → calls `scriptRunner.invalidateLibraryCache()` which marks the cache as stale → next script execution clears it
- When the library is not linked, `require("library/...")` throws a descriptive error

Implementation: `library-require.ts` provides `createLibraryRequire()` (patched require function) and `registerLibraryExtensions()` (`.ts` and `.js` handlers via `require.extensions` — `.js` handler only transpiles files inside the library folder).

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
| `page.asBrowser()` | `BrowserEditorFacade` | `BrowserPageModel` | `url`, `title`, `navigate()`, `back()`, `forward()`, `reload()` |

**Exception:** `BrowserEditorFacade` wraps `BrowserPageModel` directly (no ViewModel, no ref-counting) because browser is a page-editor, not a content-view.

Facade source: `/src/renderer/scripting/api-wrapper/`
Interface definitions: `/src/renderer/api/types/*.d.ts`

## Auto-Release Lifecycle

Facades acquire ViewModels via ref-counting. A `releaseList` ensures cleanup after script completion:

```
1. Script starts → ScriptContext creates releaseList = []
2. Script calls page.asGrid()
   → acquireViewModel("grid-json")  (ref count +1)
   → releaseList.push(() => releaseViewModel("grid-json"))
   → return GridEditorFacade
3. Script calls page.asText()
   → acquireViewModel("monaco")  (ref count +1)
   → releaseList.push(() => releaseViewModel("monaco"))
   → return TextEditorFacade
4. Script completes (or throws)
5. cleanup() iterates releaseList
   → releaseViewModel("grid-json")  (ref count -1 → 0 → dispose)
   → releaseViewModel("monaco")  (ref count -1 → 0 → dispose)
```

The `releaseList` is shared across all wrappers: `AppWrapper → PageCollectionWrapper → PageWrapper → Facades`. This means any ViewModel acquired through any path is automatically released.

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

## Script Execution (ScriptRunner)

Located in `/src/renderer/scripting/ScriptRunner.ts`.

### `run(script, page?, language?)`

1. Calls `transpileIfNeeded(script, language)` — strips TypeScript types if `language === "typescript"`
2. Creates `ScriptContext` with `app` and `page` wrappers
3. Wraps script code in `async function` with `with(this)` block
4. Injects lexical JS globals (Array, Date, JSON, etc.) to prevent accidental `window` access
5. Handles implicit return: last expression auto-returns (REPL-like)
6. Awaits result if Promise
7. Calls `cleanup()` in `finally` block

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

Captures `console.log/error/warn/info` calls during script execution via `ScriptContext`'s console capture support (see below).

### `convertToText(value)` (public)

Converts any JS value to displayable `{ text, language }`:

| Return Type | Output | Language |
|-------------|--------|----------|
| `string` | As-is | `"plaintext"` |
| `object`, `array` | `JSON.stringify` formatted | `"json"` |
| `Error` | Message + stack trace | `"plaintext"` |
| `undefined` | `"undefined"` | `"plaintext"` |
| `Date`, `RegExp`, `Map`, `Set` | Appropriate string representation | varies |

## Script Context (ScriptContext)

Located in `/src/renderer/scripting/ScriptContext.ts`.

`createScriptContext(page?, consoleLogs?, libraryPath?)` builds the execution environment:

1. Creates `releaseList` (shared cleanup array)
2. Creates `AppWrapper` (always) and `PageWrapper` (if page provided)
3. If `consoleLogs` array is provided, injects a capturing `console` object that records `log`, `error`, `warn`, `info` calls as `ConsoleLogEntry` items:
   ```typescript
   interface ConsoleLogEntry {
       level: "log" | "error" | "warn" | "info";
       args: any[];
       timestamp: number;
   }
   ```
4. If `libraryPath` provided, adds patched `require` that resolves `library/` paths to the library folder; otherwise adds a require wrapper that throws a clear error for `library/` paths
5. Builds proxy chain:
   - Custom context checked first (`app`, `page`, `require`, `React`)
   - Falls back to `globalThis` for standard APIs
   - Functions auto-bound to `globalThis` (except constructors)
   - Set operations go to custom context (scripts can create variables)
5. Returns `{ context, cleanup, outputFlags }` — cleanup releases all ViewModels, outputFlags tracks suppression state

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

By default, `runWithResult` writes the script's return value to the grouped page. This can be suppressed in two ways:

1. **`preventOutput()`** — explicitly called in the script. Use when the script handles its own output (e.g., creates custom pages, shows notifications) or needs no output at all.

2. **`page.grouped.content` write detection** — if the script writes to `page.grouped.content`, the default output is suppressed automatically. This prevents the return value from overwriting script-managed output.

Both mechanisms set flags on `ScriptOutputFlags` (tracked in `ScriptContext`). The `GroupedPageWrapper` subclass intercepts `content` setter to set the `groupedContentWritten` flag.

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
| `index.d.ts` | Global declarations: `app: IApp`, `page: IPage`, `preventOutput()`, `require()` |
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
| `browser-editor.d.ts` | `IBrowserEditor` — browser page operations |
| `ui.d.ts` | `IUserInterface`, `ITextDialogOptions`, `ITextDialogResult` — dialogs and notifications |

These files serve dual purpose: TypeScript type checking **and** IDE IntelliSense for script authors.

## File Structure

```
/src/renderer/scripting/
├── ScriptRunner.ts              # Execution engine
├── ScriptContext.ts             # Context builder with cleanup
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
    └── BrowserEditorFacade.ts   # Browser page operations

/src/renderer/api/types/
├── index.d.ts                   # Global: app, page
├── app.d.ts                     # IApp
├── page.d.ts                    # IPage, IPageInfo
├── pages.d.ts                   # IPageCollection
├── ui.d.ts                      # IUserInterface, ITextDialogOptions, ITextDialogResult
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
