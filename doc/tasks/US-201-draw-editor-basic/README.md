# US-201: Drawing editor — basic Excalidraw integration

**Epic:** [EPIC-007](../../epics/EPIC-007.md)
**Status:** Planned

## Goal

Install `@excalidraw/excalidraw` and create a new `draw-view` content-view editor that opens `.excalidraw` files in Excalidraw's canvas with full round-trip (open, edit, save, session restore).

## Background

### Editor architecture choice: content-view (not page-editor)

The epic originally specified `page-editor`, but after investigation, **content-view** is the better fit:

| Aspect | page-editor | content-view |
|--------|-------------|--------------|
| File I/O (read/write) | Must implement from scratch | Free via TextFileIOModel |
| `page.content` scripting | Returns `""` (NO-OP) | Full access |
| Switch to Monaco (raw JSON) | Not possible | Built-in |
| Save / modified tracking | Must implement | Free |
| Session restore | Must implement | Free |
| Encryption support | Must implement | Free |
| Cache/recovery | Must implement | Free |

**Precedent:** The graph editor (`graph-view`) is also a visual canvas editor (D3 force graph) and uses content-view successfully. It stores JSON in `.fg.json` files, manages its own canvas/toolbar, and round-trips through `page.content`. Excalidraw stores JSON in `.excalidraw` files — identical pattern.

**Excalidraw's own toolbar:** Excalidraw renders its own full UI (shape tools, colors, etc.) inside the component. This works the same way the graph editor renders its own floating toolbar — the TextToolbar still appears above, providing standard actions (save, file explorer, etc.).

### Reference implementations

- **Graph editor** (content-view with canvas): [/src/renderer/editors/graph/](../../../src/renderer/editors/graph/)
  - `GraphViewModel.ts` — ContentViewModel subclass, parses JSON in `onInit()`/`onContentChanged()`
  - `GraphView.tsx` — uses `useContentViewModel()` hook, renders canvas + floating toolbar
  - Registration: `register-editors.ts` lines ~480-510
- **Image viewer** (page-editor for comparison): [/src/renderer/editors/image/ImageViewer.tsx](../../../src/renderer/editors/image/ImageViewer.tsx)

### Excalidraw package

- **Package:** `@excalidraw/excalidraw` (v0.18+, ESM, React component)
- **Key APIs:**
  - `<Excalidraw initialData={...} onChange={...} excalidrawAPI={...} />` — main component
  - `serializeAsJSON(elements, appState, files, "local")` — serialize to JSON string
  - `restore({ elements, appState, files }, null, null)` — parse JSON back to Excalidraw data
  - `UIOptions.canvasActions` — hide built-in file load/save/export (not functional in Electron)
- **Theme:** `theme` prop: `"dark"` | `"light"` (will be synced in US-202)
- **Bundle:** ~1-2 MB, loaded via dynamic import (code splitting)
- **Fonts:** All fonts are OFL-1.1 licensed (free for commercial use). Key families:
  - ID 5: Excalifont (default hand-drawn)
  - ID 2: Helvetica ("Normal", system font)
  - ID 3: Cascadia ("Code", monospace)
  - ID 1: Virgil (legacy hand-drawn)
- **Asset loading:** By default fonts load from CDN. For offline support, self-host woff2 files from `node_modules/@excalidraw/excalidraw/dist/prod/fonts/` and set `window.EXCALIDRAW_ASSET_PATH`

### Data format

`.excalidraw` files are standard Excalidraw JSON:

```json
{
  "type": "excalidraw",
  "version": 2,
  "elements": [...],
  "appState": { "viewBackgroundColor": "#ffffff", ... },
  "files": {}
}
```

## Implementation plan

### Step 1: Install dependency

```bash
npm install @excalidraw/excalidraw
```

Check for peer dependency issues. Excalidraw requires React 18+ (we have React 19).

### Step 2: Add types to `shared/types.ts`

**File:** `/src/shared/types.ts`

- Add `"draw-view"` to `PageEditor` union type (line 2)
- NO new PageType needed (content-views use `textFile`)

### Step 3: Register `.excalidraw` as JSON in Monaco

**File:** `/src/renderer/core/utils/monaco-languages.ts`

Add `.excalidraw` to the JSON language extensions array (line 1061-1068):

```typescript
"extensions": [
    ".json",
    ".bowerrc",
    ".jshintrc",
    ".jscsrc",
    ".eslintrc",
    ".babelrc",
    ".har",
    ".excalidraw"   // <-- add
],
```

This ensures Monaco shows JSON syntax highlighting when users switch to raw view.

### Step 4: Create editor folder structure

```
/src/renderer/editors/draw/
├── index.ts              # Exports
├── DrawView.tsx           # Main React component wrapping Excalidraw
├── DrawViewModel.ts       # ContentViewModel subclass
└── types.ts              # Excalidraw-related type definitions (if needed)
```

### Step 5: Create `DrawViewModel.ts`

**Pattern:** Follow `GraphViewModel.ts`

```typescript
import { ContentViewModel } from "../base/ContentViewModel";

export interface DrawViewState {
    loading: boolean;
    error: string | null;
}

export const defaultDrawViewState: DrawViewState = {
    loading: true,
    error: null,
};

export class DrawViewModel extends ContentViewModel<DrawViewState> {
    private _elements: any[] = [];
    private _appState: Record<string, any> = {};
    private _files: Record<string, any> = {};
    private _suppressContentSync = false;

    protected onInit(): void {
        this.parseContent(this.host.state.get().content);
    }

    protected onContentChanged(content: string): void {
        // Only update if the change came from outside (e.g., Monaco raw edit)
        if (!this._suppressContentSync) {
            this.parseContent(content);
        }
    }

    private parseContent(content: string): void {
        try {
            if (!content || content.trim() === "") {
                // New empty drawing
                this._elements = [];
                this._appState = {};
                this._files = {};
            } else {
                const data = JSON.parse(content);
                this._elements = data.elements || [];
                this._appState = data.appState || {};
                this._files = data.files || {};
            }
            this.state.set({ loading: false, error: null });
        } catch (e) {
            this.state.set({ loading: false, error: (e as Error).message });
        }
    }

    /** Called from DrawView when Excalidraw content changes */
    updateFromExcalidraw(elements: any[], appState: any, files: any): void {
        this._elements = elements;
        this._appState = appState;
        this._files = files;

        // Serialize and push to host (triggers file save, modified tracking, etc.)
        this._suppressContentSync = true;
        try {
            const json = serializeAsJSON(elements, appState, files, "local");
            this.host.changeContent(json, true);
        } finally {
            this._suppressContentSync = false;
        }
    }

    get elements() { return this._elements; }
    get appState() { return this._appState; }
    get files() { return this._files; }
}

export function createDrawViewModel(host: IContentHost) {
    return new DrawViewModel(host, defaultDrawViewState);
}
```

**Key details:**
- `_suppressContentSync` flag prevents feedback loop: Excalidraw change → serialize → `changeContent()` → `onContentChanged()` → would re-parse and re-render
- Uses Excalidraw's `serializeAsJSON()` for consistent formatting
- Debouncing of `updateFromExcalidraw` should happen in the component (via `onChange` callback), NOT in the ViewModel

### Step 6: Create `DrawView.tsx`

**Pattern:** Follow `GraphView.tsx`

```typescript
import { TextFileModel } from "../text/TextPageModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { DrawViewModel } from "./DrawViewModel";

interface DrawViewProps {
    model: TextFileModel;
}

function DrawView({ model }: DrawViewProps) {
    const viewModel = useContentViewModel(model, "draw-view") as DrawViewModel;
    const { loading, error } = viewModel.state.use();
    const excalidrawRef = useRef<any>(null);

    // Debounced onChange handler
    const handleChange = useMemo(() => {
        let timer: any;
        return (elements: any[], appState: any, files: any) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                viewModel.updateFromExcalidraw(elements, appState, files);
            }, 500);  // 500ms debounce — Excalidraw fires onChange on every mouse move
        };
    }, [viewModel]);

    if (loading) return <CircularProgress />;
    if (error) return <EditorError message={error} />;

    return (
        <DrawViewRoot>
            <Excalidraw
                excalidrawAPI={(api) => { excalidrawRef.current = api; }}
                initialData={{
                    elements: viewModel.elements,
                    appState: viewModel.appState,
                    files: viewModel.files,
                }}
                onChange={handleChange}
                UIOptions={{
                    canvasActions: {
                        loadScene: false,
                        saveToActiveFile: false,
                        export: false,
                    },
                }}
            />
        </DrawViewRoot>
    );
}
```

**Key details:**
- `Excalidraw` is **uncontrolled** — pass `initialData` on mount, read changes via `onChange`
- Debounce `onChange` at 500ms to avoid serializing on every mouse move
- `UIOptions` hides Excalidraw's built-in file actions (they use browser File System Access API, not functional in Electron)
- Styled root should be `flex: 1` to fill container
- Excalidraw renders its own toolbar/sidebar inside the component — no custom toolbar needed for US-201

### Step 7: Create `index.ts`

```typescript
export { DrawView } from "./DrawView";
export type { DrawViewProps } from "./DrawView";
```

### Step 8: Register editor in `register-editors.ts`

**File:** `/src/renderer/editors/register-editors.ts`

Add registration block (follow graph-view pattern, place near end before graph-view):

```typescript
editorRegistry.register({
    id: "draw-view",
    name: "Drawing",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        if (matchesExtension(fileName, [".excalidraw"])) return 50;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "json",
    switchOption: (_languageId, fileName) => {
        if (fileName && matchesExtension(fileName, [".excalidraw"])) return 10;
        return -1;
    },
    isEditorContent: (_languageId, content) => {
        return /^\s*\{\s*"type"\s*:\s*"excalidraw"/.test(content);
    },
    loadModule: async () => {
        const [module, { createDrawViewModel }] = await Promise.all([
            import("./draw/DrawView"),
            import("./draw/DrawViewModel"),
        ]);
        return {
            Editor: module.DrawView,
            createViewModel: createDrawViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});
```

**Key details:**
- `acceptFile`: Priority 50 for `.excalidraw` files (specialized editor)
- `validForLanguage`: Only valid for JSON (since `.excalidraw` maps to JSON)
- `switchOption`: Returns 10 for `.excalidraw` files (allows switching from Monaco)
- `isEditorContent`: Regex detects `{"type": "excalidraw"` — enables auto-detection when pasting Excalidraw JSON
- Reuses `textEditorModule` for page model creation (standard content-view pattern)

### Step 9: Add empty drawing template

When creating a new `.excalidraw` page (or opening an empty one), provide a valid empty Excalidraw document:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "js-notepad",
  "elements": [],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

Handle this in `DrawViewModel.parseContent()` when content is empty — set defaults that Excalidraw expects.

### Step 10: Self-host Excalidraw fonts

Excalidraw loads fonts from CDN by default — this won't work offline and may fail in Electron. Self-host the font assets:

1. **Copy fonts** from `node_modules/@excalidraw/excalidraw/dist/prod/fonts/` to app assets (e.g., `assets/excalidraw-fonts/`)
2. **Set asset path** before mounting the component:
   ```typescript
   window.EXCALIDRAW_ASSET_PATH = "<path-to-fonts-dir>/";
   ```
   In Electron, this should resolve to the local fonts directory. Determine the correct path at runtime (relative to the loaded HTML or via `__dirname`).
3. **Default font:** Set `initialData.appState.currentItemFontFamily: 2` (Helvetica/Normal) as the default for new drawings. Users can still pick hand-drawn (Excalifont) or code (Cascadia) from the picker — all fonts are OFL-1.1 licensed and shipped with the app.

All font families remain available:
- Excalifont (hand-drawn) — ID 5
- Helvetica (normal) — ID 2 (default for js-notepad)
- Cascadia (code/monospace) — ID 3

### Step 11: Verify Electron/Vite compatibility

- **CSS:** Import `@excalidraw/excalidraw/index.css` inside the dynamically loaded module to keep it scoped. Verify no conflicts with Emotion styles — fix with CSS overrides if needed.
- **Vite config:** May need adjustments for Excalidraw's ESM bundle. Check that code splitting works correctly (Excalidraw chunk separate from main bundle).
- **Electron caveats:** Excalidraw's built-in file save uses browser File System Access API (not available in Electron) — already hidden via `UIOptions`.

## Resolved concerns

### 1. Content-view vs page-editor — RESOLVED: content-view

Graph editor proves the pattern works for visual canvas editors. Content-view gives free file I/O, save, restore, encryption, scripting, and editor switching. If Excalidraw's UI conflicts with TextToolbar, we can refactor to page-editor later.

### 2. onChange frequency — RESOLVED: 500ms debounce

Excalidraw fires `onChange` on every mouse move. Using 500ms debounce to avoid excessive serialization. Can be tuned later if needed.

### 3. Font/asset loading — RESOLVED: self-host + Helvetica default

- All Excalidraw fonts are OFL-1.1 (free for commercial use)
- Ship woff2 files from `dist/prod/fonts/` with the app for offline support
- Set `window.EXCALIDRAW_ASSET_PATH` to local fonts directory
- Default to Helvetica (ID 2) via `initialData.appState.currentItemFontFamily`
- All font options remain available in the picker (Excalifont, Helvetica, Cascadia, etc.)

### 4. Bundle size — RESOLVED: lazy loading via dynamic import

~1-2 MB loaded only when `.excalidraw` file is opened. Verify code splitting in Vite output.

### 5. CSS conflicts — will fix if needed

Import Excalidraw CSS inside the dynamic module. Apply CSS overrides if conflicts arise with Emotion styles.

## Files changed summary

| File | Change |
|------|--------|
| `package.json` | Add `@excalidraw/excalidraw` dependency |
| `src/shared/types.ts` | Add `"draw-view"` to `PageEditor` |
| `src/renderer/core/utils/monaco-languages.ts` | Add `.excalidraw` to JSON extensions |
| `src/renderer/editors/draw/DrawViewModel.ts` | **NEW** — ContentViewModel for Excalidraw state |
| `src/renderer/editors/draw/DrawView.tsx` | **NEW** — React component wrapping Excalidraw |
| `src/renderer/editors/draw/index.ts` | **NEW** — Exports |
| `src/renderer/editors/register-editors.ts` | Register `draw-view` editor |
| `assets/excalidraw-fonts/` | **NEW** — Self-hosted woff2 font files from Excalidraw |

## Acceptance criteria

- [ ] `npm install` succeeds with `@excalidraw/excalidraw`
- [ ] Opening a `.excalidraw` file shows Excalidraw canvas with correct content
- [ ] Drawing shapes, arrows, text works in the canvas
- [ ] Changes are tracked (tab shows modified indicator)
- [ ] Ctrl+S saves the file (JSON round-trips correctly)
- [ ] Closing and reopening the tab restores the drawing (session restore)
- [ ] Switching to Monaco shows valid JSON; switching back shows canvas
- [ ] Creating a new `.excalidraw` file starts with empty canvas
- [ ] Excalidraw's built-in file load/save/export buttons are hidden
- [ ] Fonts load from local assets (no CDN requests), all 3 font options work
- [ ] Default font for new drawings is Helvetica (Normal)
- [ ] No console errors from Excalidraw in Electron
- [ ] Bundle is code-split (Excalidraw chunk not in main bundle)
