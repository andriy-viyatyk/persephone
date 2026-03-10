# Editor System Architecture

## Overview

The editor system handles different file types with specialized viewers/editors. Each editor:
- Has its own state management (PageModel or ContentViewModel)
- Renders a specific UI for the file type
- Is loaded asynchronously for code splitting
- Can expose a scripting facade via `page.asX()` methods

All editor code lives in `/src/renderer/editors/`.

## Editor Categories

### Content Views (`category: "content-view"`)

Views of text-based content that share `TextFileModel` for state management. They render inside `TextPageView` and can switch between each other.

| Editor ID | Name | File types | ViewModel |
|-----------|------|------------|-----------|
| `monaco` | Text Editor | `*` (all, default) | `TextViewModel` |
| `grid-json` | Grid | `.json`, `.grid.json` | `GridViewModel` |
| `grid-csv` | Grid | `.csv`, `.grid.csv` | `GridViewModel` |
| `grid-jsonl` | Grid | `.jsonl`, `.ndjson`, `.grid.jsonl` | `GridViewModel` |
| `md-view` | Preview | `.md`, `.markdown` | `MarkdownViewModel` |
| `svg-view` | Preview | `.svg` | `SvgViewModel` |
| `html-view` | Preview | `.html` | `HtmlViewModel` |
| `mermaid-view` | Mermaid | `.mmd`, `.mermaid` | `MermaidViewModel` |
| `notebook-view` | Notebook | `.note.json` | `NotebookViewModel` |
| `todo-view` | ToDo | `.todo.json` | `TodoViewModel` |
| `link-view` | Links | `.link.json` | `LinkViewModel` |
| `log-view` | Log View | `.log.jsonl` | `LogViewModel` |

**Characteristics:**
- Rendered inside `TextPageView` via `ActiveEditor` component
- Share toolbar, script panel, footer, and encryption panel
- Can switch between each other (e.g., JSON text <-> Grid view)
- Use `TextFileModel` (no separate PageModel)
- Each has a `ContentViewModel` subclass for view-specific state
- `switchOption()` function controls when editor appears in switch dropdown

### Page Editors (`category: "page-editor"`)

Standalone editors with their own PageModel.

| Editor ID | Name | Page type | File types |
|-----------|------|-----------|------------|
| `pdf-view` | PDF Viewer | `pdfFile` | `.pdf` |
| `image-view` | Image Viewer | `imageFile` | `.png`, `.jpg`, `.gif`, `.webp`, `.bmp`, `.ico` |

> **Image Viewer URL support:** ImageViewer can display images from external URLs (e.g. opened from a browser webview context menu) via the `url` field in its state. URL-based images show a "Save Image to File" toolbar button that fetches the image, saves it locally via a save dialog, and switches the page from URL mode to file mode.

| `browser-view` | Browser | `browserPage` | (none — opened via UI) |
| `about-view` | About | `aboutPage` | (none — opened via UI) |
| `settings-view` | Settings | `settingsPage` | (none — opened via UI) |
| `compare` | Compare | (triggered) | (none — opened via diff command) |

**Characteristics:**
- Rendered instead of `TextPageView` by `RenderEditor`
- Have their own PageModel subclass
- Handle their own UI entirely (no shared toolbar/script panel)
- Each has a unique `pageType`

### Architecture Diagram

```
RenderEditor
├── [page-editor] → AsyncEditor → EditorErrorBoundary → PdfViewer / ImageViewer / Browser / About / Settings
└── [content-view] → TextPageView
                         ├── TextToolbar
                         ├── ActiveEditor → AsyncEditor → EditorErrorBoundary → Monaco / Grid / Markdown / Notebook / Todo / Link / Log View / SVG / HTML / Mermaid
                         ├── ScriptPanel
                         ├── TextFooter
                         └── EditorOverlay (portal target for expanded note)
```

**Error protection:** `EditorErrorBoundary` (`/src/renderer/components/basic/EditorErrorBoundary.tsx`) wraps every editor inside `AsyncEditor`. If the editor component throws during render, the boundary catches the error and displays the error message + stack trace in the tab instead of crashing the application. This is a React class component (required for `getDerivedStateFromError`).

## Content Host + ViewModel Architecture

Content-view editors use a layered architecture with ref-counted ViewModels:

```
TextFileModel (IContentHost)
    │
    ├── owns text content, language, file I/O
    │
    └── ContentViewModelHost (ref-counting)
            │
            ├── GridViewModel (refs: 1)      ← acquired by GridEditor component
            ├── MarkdownViewModel (refs: 0)  ← disposed (no active consumers)
            └── NotebookViewModel (refs: 2)  ← acquired by NotebookEditor + NotebookEditorFacade
```

### IContentHost Interface

The contract for anything that hosts editable text content. Implemented by:
- `TextFileModel` — standalone page tab
- `NoteItemEditModel` — notebook note (embedded editor)

```typescript
interface IContentHost {
    readonly id: string;
    readonly state: IState<IContentHostState>;  // { content, language, editor }
    changeContent(content: string, byUser?: boolean): void;
    changeEditor(editor: PageEditor): void;
    changeLanguage(language: string | undefined): void;
    readonly stateStorage: EditorStateStorage;
    acquireViewModel(editorId: PageEditor): Promise<ContentViewModel<any>>;
    acquireViewModelSync(editorId: PageEditor): ContentViewModel<any> | undefined;
    prepareViewModel(editorId: PageEditor): Promise<void>;
    releaseViewModel(editorId: PageEditor): void;
}
```

**Sync acquisition:** `prepareViewModel()` pre-loads the editor module, then `acquireViewModelSync()` creates the VM synchronously from the cached factory. Returns `undefined` if the module hasn't been loaded. Used by `UiFacade` to create `LogViewModel` synchronously in the lazy `ui` getter.

### ContentViewModel Lifecycle

1. React component mounts → `useContentViewModel(host, editorId)` calls `host.acquireViewModel()`
2. `ContentViewModelHost.acquire()` → checks cache → first call: loads factory, creates VM, calls `init()`
3. VM subscribes to host content changes via `onContentChanged()`
4. React component unmounts → hook calls `host.releaseViewModel()`
5. `ContentViewModelHost.release()` → decrements refs → if 0: calls `dispose()`

### ViewModelFactory Registration

Each content-view editor provides a `createViewModel` factory in its `EditorModule`:

```typescript
// In register-editors.ts
editorRegistry.register({
    id: "grid-json",
    category: "content-view",
    loadModule: async () => {
        const { GridEditor } = await import("./grid/GridEditor");
        const { createGridViewModel } = await import("./grid/GridViewModel");
        return {
            Editor: GridEditor,
            createViewModel: createGridViewModel,  // ← factory for ContentViewModel
            newPageModel: textEditorModule.newPageModel,
            // ...
        };
    },
});
```

## PageModel Hierarchy

```
TDialogModel<T, R>   (from core/state/model.ts)
└── PageModel<T, R>   (from editors/base/PageModel.ts)
    ├── TextFileModel         # Content-view host (Monaco, Grid, Markdown, etc.)
    ├── BrowserPageModel      # Browser (multi-tab, webview, IPC)
    ├── NotebookEditorModel   # Notebook (.note.json — page-level model)
    └── (PdfViewer, ImageViewer, About, Settings, Compare — inline models)

ContentViewModel<TState>   (from editors/base/ContentViewModel.ts)
├── TextViewModel           # Monaco text editor state
├── GridViewModel           # Grid columns, rows, filters
├── MarkdownViewModel       # Search state, compact, scroll (delegates rendering to MarkdownBlock)
├── NotebookViewModel       # Notes, categories, tags, filters
├── TodoViewModel           # Todo items, lists, tags
├── LinkViewModel           # Links, pins, favicons
├── LogViewModel            # Log entries, dialog promises, dirty-index serialization
├── SvgViewModel            # SVG rendering
├── HtmlViewModel           # HTML rendering
└── MermaidViewModel        # SVG URL, loading, error, light mode
```

**Note:** PageModel extends `TDialogModel` (not `TModel`) because pages need `close()` with confirmation and `canClose` guards.

### PageModel Base

```typescript
class PageModel<T extends IPageState, R = any> extends TDialogModel<T, R> {
    get id(): string;
    get type(): PageType;
    get title(): string;
    get modified(): boolean;
    get pinned(): boolean;
    get filePath(): string | undefined;

    scriptData: Record<string, any>;   // In-memory data for scripts
    navPanel: NavPanelModel | null;    // Navigation panel state

    confirmRelease(): Promise<boolean>;
    restore(): Promise<void>;
    saveState(): Promise<void>;
    getRestoreData(): Partial<T>;
    changeLanguage(language: string): void;
}
```

## Scripting Facades

Editor facades provide safe, typed script access to editors via `page.asX()` methods. Each facade wraps a ContentViewModel or PageModel.

| Method | Facade | Source |
|--------|--------|--------|
| `page.asText()` | `TextEditorFacade` | Wraps `TextViewModel` |
| `page.asGrid()` | `GridEditorFacade` | Wraps `GridViewModel` |
| `page.asNotebook()` | `NotebookEditorFacade` | Wraps `NotebookViewModel` |
| `page.asTodo()` | `TodoEditorFacade` | Wraps `TodoViewModel` |
| `page.asLink()` | `LinkEditorFacade` | Wraps `LinkViewModel` |
| `page.asBrowser()` | `BrowserEditorFacade` | Wraps `BrowserPageModel` directly |
| `page.asMarkdown()` | `MarkdownEditorFacade` | Wraps `MarkdownViewModel` |
| `page.asSvg()` | `SvgEditorFacade` | Wraps `SvgViewModel` |
| `page.asHtml()` | `HtmlEditorFacade` | Wraps `HtmlViewModel` |
| `page.asMermaid()` | `MermaidEditorFacade` | Wraps `MermaidViewModel` |

Facades live in `/src/renderer/scripting/api-wrapper/`. Interfaces in `/src/renderer/api/types/*.d.ts`.

Content-view facades acquire a ViewModel via `host.acquireViewModel()` and auto-release it when the script completes (via `releaseList` in `PageWrapper`). `BrowserEditorFacade` wraps the PageModel directly (no ViewModel, no ref-counting).

## Editor Resolution

When a file is opened:

```
File Path → editorRegistry.resolve() → EditorDefinition → loadModule() → Render
```

Resolution priority (higher priority wins):
1. Filename patterns (e.g., `*.note.json`) — priority 20
2. File extensions (e.g., `.pdf`) — priority 100
3. Default to monaco text editor — priority 0

All editor registration is in `/src/renderer/editors/register-editors.ts`.

## Editor Structure

Every editor follows this pattern:

```
/editors/[name]/
├── index.ts              # Public exports + EditorModule
├── [Name]Editor.tsx      # Main component (or [Name]View.tsx)
├── [Name]ViewModel.ts    # ContentViewModel subclass (content-views)
├── [Name]PageModel.ts    # PageModel subclass (page-editors)
├── components/           # Editor-specific components (optional)
└── utils/                # Editor-specific utilities (optional)
```

### EditorModule Interface

```typescript
interface EditorModule {
    Editor: React.ComponentType<{ model: PageModel | IContentHost }>;
    newPageModel(filePath?: string): Promise<PageModel>;
    newEmptyPageModel(pageType: PageType): Promise<PageModel | null>;
    newPageModelFromState(state: Partial<IPageState>): Promise<PageModel>;
    createViewModel?: ViewModelFactory;  // Content-views provide this
}
```

## Adding a New Editor

### Adding a Content-View Editor

1. Create folder `/editors/myview/`
2. Implement `ContentViewModel` subclass:
   ```typescript
   export class MyViewModel extends ContentViewModel<MyState> {
       protected onInit(): void { /* parse initial content */ }
       protected onContentChanged(content: string): void { /* react to updates */ }
   }
   export const createMyViewModel: ViewModelFactory = (host) => new MyViewModel(host, defaultState);
   ```
3. Implement editor component receiving `IContentHost` as model
4. Register with `category: "content-view"` and `createViewModel` factory
5. Add `PageEditor` type to `/shared/types.ts`
6. (Optional) Add scripting facade in `/scripting/api-wrapper/` + `.d.ts` in `/api/types/`

### Adding a Page-Editor

1. Create folder `/editors/myeditor/`
2. Extend `PageModel` with custom state
3. Implement editor component receiving your PageModel
4. Register with `category: "page-editor"` and unique `pageType`
5. Add `PageType` and `PageEditor` types to `/shared/types.ts`
6. (Optional) Add scripting facade

## Editor Switching

Content-view editors support switching views (e.g., JSON text <-> Grid view):

```typescript
// Get available switch options for current language
const switchOptions = editorRegistry.getSwitchOptions(language, filePath);
if (switchOptions.options.length > 1) {
    // Render switch buttons in toolbar
}
```

The `page.editor` property on `TextFileModel` state controls which editor renders the content.

### Content-Based Editor Detection

Structured JSON editors (notebook, todo, link) embed a `"type"` property in their JSON content:
- `"type": "note-editor"` → notebook-view
- `"type": "todo-editor"` → todo-view
- `"type": "link-editor"` → link-view

This allows the correct switch button to appear even when the file name doesn't match the expected pattern (e.g., `.note.json`). Detection uses fast regex checks (no JSON parsing) via the `isEditorContent()` hook on `EditorDefinition`.

`TextFileModel` runs detection:
- **Immediately** on `restore()` and `changeEditor()`
- **Debounced (2.5s)** on `changeContent()`
- Timer is cancelled on `dispose()`

The detected editor is stored in `TextFilePageModelState.detectedContentEditor` and merged into switch options by `TextToolbar`.

## EditorRegistry API

```typescript
editorRegistry.register(definition)              // Register an editor
editorRegistry.getById(id)                       // Get editor by ID
editorRegistry.getAll()                          // Get all registered editors
editorRegistry.resolve(filePath)                 // Resolve editor for file
editorRegistry.resolveId(filePath)               // Resolve just the editor ID
editorRegistry.validateForLanguage(editor, lang) // Validate editor/language combo
editorRegistry.getSwitchOptions(lang, filePath)  // Get UI switch options
editorRegistry.getPreviewEditor(lang, filePath)  // Get auto-preview editor
editorRegistry.detectContentEditor(lang, content) // Detect editor from content type field
editorRegistry.getViewModelFactory(editorId)     // Get cached VM factory (sync)
editorRegistry.loadViewModelFactory(editorId)    // Load VM factory (async)
editorRegistry.validateForHost(editorId, host)   // Validate editor for content host
```

For complete guide, see [Editor Creation Guide](/doc/standards/editor-guide.md).
