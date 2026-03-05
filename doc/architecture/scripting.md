# Scripting System

## Overview

js-notepad includes a JavaScript execution environment that allows users to:
- Transform content programmatically
- Automate repetitive tasks
- Connect to databases and APIs
- Process data with full Node.js access

All scripting code lives in `/src/renderer/scripting/`.
Type definitions for the script API live in `/src/renderer/api/types/*.d.ts`.

## Architecture

```
ScriptRunner.run(script, page?)
    │
    ├── ScriptContext.createScriptContext(page?)
    │       ├── AppWrapper        ← wraps `app` global
    │       │     └── PageCollectionWrapper  ← wraps `app.pages`
    │       ├── PageWrapper       ← wraps `page` global
    │       │     └── EditorFacades (10)  ← page.asText(), page.asGrid(), ...
    │       ├── React             ← React library
    │       └── Proxy (globalThis interception)
    │
    ├── Execute script in sandbox (with + Function constructor)
    │
    └── cleanup()  ← releases all acquired ViewModels
```

## Execution Modes

### 1. Run Script (F5)

For files with `javascript` language:
- Runs selected text, or entire content if nothing selected
- Output appears in grouped page

### 2. Script Panel

Available on any text file:
- Open via toolbar or context menu
- Write scripts that operate on the page content
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
}
```

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

## Editor Facades

Facades provide safe, typed access to editor-specific features. Each facade wraps a `ContentViewModel` and is acquired via `page.asX()` methods.

| Method | Facade | Wraps | Key Operations |
|--------|--------|-------|----------------|
| `page.asText()` | `TextEditorFacade` | `TextViewModel` | `getSelectedText()`, `insertText()`, `replaceSelection()`, `revealLine()`, cursor position |
| `page.asGrid()` | `GridEditorFacade` | `GridViewModel` | `rows`, `columns`, `editCell()`, `addRows()`, `deleteRows()`, `addColumns()`, `deleteColumns()` |
| `page.asNotebook()` | `NotebookEditorFacade` | `NotebookViewModel` | `notes`, `categories`, `tags`, `addNote()`, `deleteNote()`, `updateNoteTitle()` |
| `page.asTodo()` | `TodoEditorFacade` | `TodoViewModel` | `items`, `lists`, `tags`, `addItem()`, `toggleItem()`, `deleteItem()`, `addList()` |
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
    constructor(model: PageModel, releaseList: Array<() => void>);

    // IPage properties delegate to model
    get content(): string { return model.state.get().content; }
    set content(v: string) { model.changeContent(v); }

    // Grouped page auto-creation
    get grouped(): PageWrapper {
        let grouped = pagesModel.getGroupedPage(this.model.id);
        if (!grouped) grouped = pagesModel.requireGroupedText(this.model.id);
        return new PageWrapper(grouped, this.releaseList);
    }

    // Facade acquisition with auto-release
    async asGrid(): Promise<GridEditorFacade> {
        const vm = await model.acquireViewModel("grid-json");
        this.releaseList.push(() => model.releaseViewModel("grid-json"));
        return new GridEditorFacade(vm);
    }
}
```

### AppWrapper

Wraps the `app` singleton, implements `IApp`. Delegates most properties directly. Wraps `pages` in `PageCollectionWrapper`.

### PageCollectionWrapper

Wraps `PagesModel`, implements `IPageCollection`. Returns `PageWrapper` instances instead of raw `PageModel` for all query methods.

## Script Execution (ScriptRunner)

Located in `/src/renderer/scripting/ScriptRunner.ts`.

### `run(script, page?)`

1. Creates `ScriptContext` with `app` and `page` wrappers
2. Wraps script code in `async function` with `with(this)` block
3. Injects lexical JS globals (Array, Date, JSON, etc.) to prevent accidental `window` access
4. Handles implicit return: last expression auto-returns (REPL-like)
5. Awaits result if Promise
6. Calls `cleanup()` in `finally` block

### `runWithResult(pageId, script, page?)`

Calls `run()`, then converts result to text and writes to grouped page.

### `convertToText(value)`

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

`createScriptContext(page?)` builds the execution environment:

1. Creates `releaseList` (shared cleanup array)
2. Creates `AppWrapper` (always) and `PageWrapper` (if page provided)
3. Builds proxy chain:
   - Custom context checked first (`app`, `page`, `React`)
   - Falls back to `globalThis` for standard APIs
   - Functions auto-bound to `globalThis` (except constructors)
   - Set operations go to custom context (scripts can create variables)
4. Returns `{ context, cleanup }` — cleanup releases all ViewModels

## Grouped Pages

When a script accesses `page.grouped`:
1. If no grouped page exists, one is automatically created
2. The new page is grouped (side-by-side) with the source page
3. Script return value is written to the grouped page

```javascript
// This automatically creates and groups a new page
page.grouped.content = 'Output here';
page.grouped.language = 'json';
page.grouped.editor = 'grid-json';
```

## Script Triggers

| Trigger | Location | What Runs |
|---------|----------|-----------|
| F5 (script panel open) | `TextFileActionsModel` | Script panel content |
| F5 (script panel closed, JS file) | `TextFileActionsModel` | Page content (or selection) |
| F5 (notebook note) | `NoteItemEditModel` | Note content as script |
| Run button (script panel) | `ScriptPanel.tsx` | Script panel content |

## Type Definitions

Script API types are defined in `/src/renderer/api/types/`:

| File | Defines |
|------|---------|
| `index.d.ts` | Global declarations: `app: IApp`, `page: IPage` |
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

These files serve dual purpose: TypeScript type checking **and** IDE IntelliSense for script authors.

## File Structure

```
/src/renderer/scripting/
├── ScriptRunner.ts              # Execution engine
├── ScriptContext.ts             # Context builder with cleanup
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

## Security Considerations

Scripts have full Node.js access. This is by design for power users, but means:
- Scripts can access filesystem
- Scripts can make network requests
- Scripts can execute any Node.js code

This is appropriate for a developer tool where the user writes/controls the scripts.
