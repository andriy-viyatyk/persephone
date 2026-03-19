# US-216: Rename mcp-browser → mcp-inspector across codebase

## Goal

Rename all "mcp-browser" / "McpBrowser" / "mcpBrowser" references to "mcp-inspector" / "McpInspector" / "mcpInspector" for consistency with the UI label "MCP Inspector". The editor ID `mcp-view` stays unchanged.

## Background

The UI already shows "MCP Inspector" in titles and labels, but all code uses "mcp-browser" naming. This creates confusion when reading code, searching for references, and writing documentation. A clean rename now prevents the dual-naming problem from growing as we add the scripting API (US-214).

## Implementation Plan

### Step 1: Rename folder

- `src/renderer/editors/mcp-browser/` → `src/renderer/editors/mcp-inspector/`

### Step 2: Rename files inside the folder

| Old | New |
|-----|-----|
| `McpBrowserModel.ts` | `McpInspectorModel.ts` |
| `McpBrowserView.tsx` | `McpInspectorView.tsx` |

Files that do NOT need renaming (they don't contain "browser" in their name):
- `McpConnectionManager.ts`, `McpConnectionStore.ts`
- `ToolsPanel.tsx`, `ToolArgForm.tsx`, `ToolResultView.tsx`
- `ResourcesPanel.tsx`, `ResourceContentView.tsx`
- `PromptsPanel.tsx`
- `index.ts`

### Step 3: Rename types and classes

#### `McpInspectorModel.ts` (was McpBrowserModel.ts)

| Old | New |
|-----|-----|
| `McpBrowserPageState` | `McpInspectorPageState` |
| `getDefaultMcpBrowserPageState` | `getDefaultMcpInspectorPageState` |
| `McpBrowserModel` | `McpInspectorModel` |
| `type: "mcpBrowserPage"` | `type: "mcpInspectorPage"` |

All exported type names (`McpToolInfo`, `McpResourceInfo`, `McpPromptInfo`, etc.) do NOT need renaming — they use "Mcp" prefix without "Browser".

#### `McpInspectorView.tsx` (was McpBrowserView.tsx)

| Old | New |
|-----|-----|
| `McpBrowserViewRoot` (styled) | `McpInspectorViewRoot` |
| `McpBrowserViewProps` | `McpInspectorViewProps` |
| `McpBrowserView` (function) | `McpInspectorView` |
| `mcpBrowserEditorModule` | `mcpInspectorEditorModule` |
| `pageType !== "mcpBrowserPage"` | `pageType !== "mcpInspectorPage"` |
| All imports from `./McpBrowserModel` | → `./McpInspectorModel` |

#### `index.ts`

| Old | New |
|-----|-----|
| `export { McpBrowserModel }` | `export { McpInspectorModel }` |
| `McpBrowserPageState` | `McpInspectorPageState` |
| `from "./McpBrowserModel"` | `from "./McpInspectorModel"` |

### Step 4: Update internal imports (within mcp-inspector folder)

Files that import from `./McpBrowserModel` → `./McpInspectorModel`:
- `ToolsPanel.tsx` — import `McpBrowserModel` → `McpInspectorModel`, props type
- `ResourcesPanel.tsx` — import `McpBrowserModel` → `McpInspectorModel`, props type
- `PromptsPanel.tsx` — import `McpBrowserModel` → `McpInspectorModel`, props type
- `ResourceContentView.tsx` — import `McpResourceContent` from `./McpBrowserModel` → `./McpInspectorModel`
- `ToolResultView.tsx` — import `McpToolResult` from `./McpBrowserModel` → `./McpInspectorModel`
- `ToolArgForm.tsx` — import `McpToolInfo` from `./McpBrowserModel` → `./McpInspectorModel`

### Step 5: Update external references

#### `src/shared/types.ts` (line 1)

```
Old: export type PageType = "textFile" | ... | "mcpBrowserPage";
New: export type PageType = "textFile" | ... | "mcpInspectorPage";
```

#### `src/renderer/editors/register-editors.ts` (lines 531-536)

```
Old: pageType: "mcpBrowserPage",
     const module = await import("./mcp-browser/McpBrowserView");
New: pageType: "mcpInspectorPage",
     const module = await import("./mcp-inspector/McpInspectorView");
```

#### `src/renderer/api/pages/PagesLifecycleModel.ts` (lines 614-619)

```
Old: showMcpBrowserPage = async (...) => {
       "../../editors/mcp-browser/McpBrowserView"
       await mcpModule.default.newEmptyPageModel("mcpBrowserPage")
New: showMcpInspectorPage = async (...) => {
       "../../editors/mcp-inspector/McpInspectorView"
       await mcpModule.default.newEmptyPageModel("mcpInspectorPage")
```

#### `src/renderer/api/pages/PagesModel.ts` (lines 205-206)

```
Old: showMcpBrowserPage = (options) => this.lifecycle.showMcpBrowserPage(options);
New: showMcpInspectorPage = (options) => this.lifecycle.showMcpInspectorPage(options);
```

#### `src/renderer/api/types/pages.d.ts` (line 83)

```
Old: showMcpBrowserPage(options?: { url?: string }): Promise<void>;
New: showMcpInspectorPage(options?: { url?: string }): Promise<void>;
```

#### `assets/editor-types/pages.d.ts` (line 83)

Same change as above.

#### `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` (lines 112-113)

```
Old: showMcpBrowserPage(options) { return this.pages.showMcpBrowserPage(options); }
New: showMcpInspectorPage(options) { return this.pages.showMcpInspectorPage(options); }
```

#### `src/renderer/editors/mcp-inspector/McpConnectionManager.ts` (line 96)

```
Old: { name: "js-notepad-mcp-browser", version: "1.0.0" }
New: { name: "js-notepad-mcp-inspector", version: "1.0.0" }
```

### Step 6: Session restore backward compatibility

Two places need compat handling:

**A) `PagesLifecycleModel.ts` line 43-56** — The `newPageModelFromState` method uses `editors.find((e) => e.pageType === state.type)`. Old sessions have `type: "mcpBrowserPage"` which won't match the renamed `mcpInspectorPage`. Add a page type migration map before the lookup:

```typescript
// Legacy page type migration (renamed editors)
const PAGE_TYPE_MIGRATIONS: Record<string, string> = {
    mcpBrowserPage: "mcpInspectorPage",
};

private newPageModelFromState = async (state: Partial<IPageState>): Promise<PageModel> => {
    // Migrate legacy page types
    if (state.type && PAGE_TYPE_MIGRATIONS[state.type]) {
        state = { ...state, type: PAGE_TYPE_MIGRATIONS[state.type] as PageType };
    }
    const editors = editorRegistry.getAll();
    // ... rest unchanged
```

**B) `McpInspectorView.tsx`** — Also handle in `newPageModelFromState` as a safety net:

```typescript
newPageModelFromState: async (state: Partial<IPageState>) => {
    const s: McpInspectorPageState = {
        ...getDefaultMcpInspectorPageState(),
        ...(state as Partial<McpInspectorPageState>),
    };
    if ((s as any).type === "mcpBrowserPage") s.type = "mcpInspectorPage";
    return new McpInspectorModel(new TComponentState(s));
},
```

### Step 7: Update documentation

#### `CLAUDE.md`

```
Old: | MCP Browser model | `/src/renderer/editors/mcp-browser/McpBrowserModel.ts` |
New: | MCP Inspector model | `/src/renderer/editors/mcp-inspector/McpInspectorModel.ts` |
```

#### `doc/architecture/editors.md`

- Line 56: `mcp-view | MCP Browser | mcpBrowserPage` → `mcp-view | MCP Inspector | mcpInspectorPage`
- Line 71: `McpBrowser` → `McpInspector` in render tree
- Line 158: `McpBrowserModel` → `McpInspectorModel` in hierarchy

#### `doc/architecture/folder-structure.md`

- Lines 315-319: Rename folder and file references

#### `doc/epics/EPIC-008.md`

- Line 19: `page.asMcpBrowser()` → `page.asMcpInspector()`
- Line 43: client name string
- Lines 62-65: page type, import path references

#### `docs/whats-new.md`

- `app.pages.showMcpBrowserPage()` → `app.pages.showMcpInspectorPage()`

### Step 8: Rename mockup files (optional cleanup)

These are reference HTML mockups no longer actively needed, but for consistency:
- `mockups/mcp-browser-*.html` → `mockups/mcp-inspector-*.html`

### Step 9: Type-check and verify

- Run `npx tsc --noEmit` to verify no broken references
- Grep for any remaining `mcpBrowser` or `mcp-browser` in src/ to confirm clean rename

## Files NOT changed

- `McpConnectionManager.ts` — filename doesn't contain "browser"
- `McpConnectionStore.ts` — filename doesn't contain "browser"
- Panel components (`ToolsPanel`, `ResourcesPanel`, `PromptsPanel`, etc.) — filenames don't contain "browser"
- Editor ID `mcp-view` — stays the same (no user-visible change)
- `mcp-handler.ts` — not related to the inspector
- Completed task READMEs in `doc/tasks/US-209..US-213/` — historical records, leave as-is

## Concerns (Resolved)

1. **Session restore**: Old persisted sessions will have `type: "mcpBrowserPage"`. The restore logic in `PagesLifecycleModel.ts:47` does `editors.find((e) => e.pageType === state.type)` — strict match, no legacy support. `EditorDefinition` has no `legacyPageTypes` field. **Solution**: Handle in `newPageModelFromState` of the editor module — remap `mcpBrowserPage` → `mcpInspectorPage` before creating the model. Also add a compat mapping in `PagesLifecycleModel.newPageModelFromState` (line 43-56) to map the old page type to the new editor before `loadModule()`.

2. **Scripting API**: `showMcpBrowserPage()` is exposed in the script API (`pages.d.ts`). Since v1.0.24 is not yet released, we can rename without a deprecation alias. No backward compat needed.

## Acceptance Criteria

- [ ] No references to `McpBrowser`, `mcpBrowser`, or `mcp-browser` remain in `src/` (except backward compat check)
- [ ] Old sessions with `mcpBrowserPage` type restore correctly
- [ ] `npx tsc --noEmit` passes
- [ ] MCP Inspector opens and functions normally
- [ ] Documentation updated (CLAUDE.md, editors.md, folder-structure.md, EPIC-008, whats-new.md)

## Files Changed Summary

| File | Action | What changes |
|------|--------|-------------|
| `src/renderer/editors/mcp-browser/` | Rename folder | → `mcp-inspector/` |
| `McpBrowserModel.ts` | Rename + edit | → `McpInspectorModel.ts`, all class/type names |
| `McpBrowserView.tsx` | Rename + edit | → `McpInspectorView.tsx`, all class/type names, backward compat |
| `index.ts` | Edit | Update exports and imports |
| `ToolsPanel.tsx` | Edit | Import path + type name |
| `ResourcesPanel.tsx` | Edit | Import path + type name |
| `PromptsPanel.tsx` | Edit | Import path + type name |
| `ResourceContentView.tsx` | Edit | Import path |
| `ToolResultView.tsx` | Edit | Import path |
| `ToolArgForm.tsx` | Edit | Import path |
| `McpConnectionManager.ts` | Edit | Client name string |
| `src/shared/types.ts` | Edit | PageType union |
| `src/renderer/editors/register-editors.ts` | Edit | pageType + import path |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Edit | Method name + import path + PAGE_TYPE_MIGRATIONS map |
| `src/renderer/api/pages/PagesModel.ts` | Edit | Method name |
| `src/renderer/api/types/pages.d.ts` | Edit | Method signature |
| `assets/editor-types/pages.d.ts` | Edit | Method signature |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Edit | Method name |
| `CLAUDE.md` | Edit | Key files table |
| `doc/architecture/editors.md` | Edit | Editor table, hierarchy, render tree |
| `doc/architecture/folder-structure.md` | Edit | Folder listing |
| `doc/epics/EPIC-008.md` | Edit | References throughout |
| `docs/whats-new.md` | Edit | API reference |
| `mockups/mcp-browser-*.html` | Rename | → `mcp-inspector-*.html` |
