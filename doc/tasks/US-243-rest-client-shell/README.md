# US-243: Rest Client Editor — Basic Shell

## Goal

Create the Rest Client editor — a content-view editor registered for `.rest.json` files with a two-panel layout (collection tree on the left, request/response on the right), file load/save, and basic collection management (add/delete/rename requests).

This is the structural foundation for the editor. US-244 adds the request builder, US-245 adds the response viewer.

## Background

### Editor pattern to follow

The Rest Client is a **content-view** editor — same category as Grid, Todo, Notebook. It uses:
- `pageType: "textFile"` — content is JSON text stored in the page's text model
- `category: "content-view"` — alternative view of text content
- `ContentViewModel<TState>` base class — manages lifecycle, parse/serialize
- `useContentViewModel` hook — React component acquires/releases the view model

### Key reference implementations

- **Todo editor** — simplest content-view, good structural reference
  - Model: `src/renderer/editors/todo/TodoViewModel.ts`
  - View: `src/renderer/editors/todo/TodoEditor.tsx`
  - Registration: `src/renderer/editors/register-editors.ts` lines 386-420
- **Notebook editor** — uses TreeView for hierarchical display
  - Model: `src/renderer/editors/notebook/NotebookEditorModel.ts`

### ContentViewModel lifecycle

```
onInit() → parse JSON content, set up state
onContentChanged(content) → external edit, re-parse (skip if we just wrote)
state changes → debounce → serialize JSON → host.changeContent(json, true)
onDispose() → flush pending saves, cleanup
```

### Key pattern: skip flag

When the view model serializes data back to the host, it sets `skipNextContentUpdate = true` to prevent `onContentChanged()` from re-parsing the content it just wrote. This avoids an infinite loop.

## .rest.json File Format

```json
{
    "type": "rest-client",
    "requests": [
        {
            "id": "uuid-1",
            "name": "Get Users",
            "method": "GET",
            "url": "https://api.example.com/users",
            "headers": [
                { "key": "Accept", "value": "application/json", "enabled": true }
            ],
            "body": ""
        },
        {
            "id": "uuid-2",
            "name": "Create User",
            "method": "POST",
            "url": "https://api.example.com/users",
            "headers": [
                { "key": "Content-Type", "value": "application/json", "enabled": true }
            ],
            "body": "{\n    \"name\": \"John\",\n    \"email\": \"john@example.com\"\n}"
        }
    ]
}
```

**Design notes:**
- `"type": "rest-client"` — marker for `isEditorContent` detection
- Headers as array of `{ key, value, enabled }` — supports disabling individual headers without deleting
- `body` is a string (JSON, text, XML, etc.) — the body editor will provide language modes
- No response data stored — responses are ephemeral (shown in UI only)
- `id` uses `crypto.randomUUID()` for unique request identification

## Implementation Plan

### Step 1: Add PageEditor type
**File:** `src/shared/types.ts`

Add `"rest-client"` to the `PageEditor` union type.

### Step 2: Create types file
**File:** `src/renderer/editors/rest-client/restClientTypes.ts`

```typescript
export interface RestRequest {
    id: string;
    name: string;
    method: string;
    url: string;
    headers: RestHeader[];
    body: string;
}

export interface RestHeader {
    key: string;
    value: string;
    enabled: boolean;
}

export interface RestClientData {
    type: "rest-client";
    requests: RestRequest[];
}
```

### Step 3: Create RestClientViewModel
**File:** `src/renderer/editors/rest-client/RestClientViewModel.ts`

Extends `ContentViewModel<RestClientEditorState>`.

**State:**
```typescript
const defaultRestClientEditorState = {
    data: { type: "rest-client", requests: [] } as RestClientData,
    error: undefined as string | undefined,
    selectedRequestId: "" as string,
    leftPanelWidth: 250,
};
```

**Lifecycle:**
- `onInit()` — parse JSON content via `loadData()`, restore selected request from `stateStorage`
- `onContentChanged(content)` — re-parse (with skip flag)
- State subscription → debounced serialize → `host.changeContent(json, true)`
- `onDispose()` — flush pending saves

**Methods:**
- `addRequest(name?: string)` — create new request with default values, add to data, select it
- `deleteRequest(id: string)` — remove request, select adjacent
- `renameRequest(id: string, name: string)` — update name
- `moveRequest(fromId: string, toId: string)` — reorder via drag-drop
- `selectRequest(id: string)` — set selected
- `updateRequest(id: string, changes: Partial<RestRequest>)` — update any request field

**Export factory:**
```typescript
export function createRestClientViewModel(host: IContentHost): ContentViewModel<any> {
    return new RestClientViewModel(host);
}
```

### Step 4: Create RestClientEditor view
**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

**Layout:**
```
┌──────────────┬──────────────────────────────────────┐
│  Collection  │                                      │
│  TreeView    │   Request details                    │
│              │   (placeholder for US-244/US-245)    │
│  [+ Add]     │                                      │
│              │   Shows selected request name,        │
│  - Get Users │   method, URL as read-only preview   │
│  > Create    │                                      │
│              │                                      │
└──────────────┴──────────────────────────────────────┘
```

**Left panel:**
- TreeView component from `src/renderer/components/TreeView/`
- Root node is the collection, children are requests
- Each request shows method badge + name as label
- Context menu: Rename, Delete
- Drag-and-drop reorder via TreeView's `dragType`/`onDrop`
- "Add Request" button at top or bottom

**Right panel (placeholder for this task):**
- Shows selected request's name, method, URL as a simple read-only display
- This panel will be replaced by the full request builder (US-244) and response viewer (US-245)

**Styling:**
- Single root styled component with nested class-based styles
- All colors from `color.ts` theme tokens
- Resizable left panel (follow the pattern from Todo/Notebook editors)

**Component structure:**
```typescript
function RestClientEditor({ model }: { model: IContentHost }) {
    const vm = useContentViewModel<RestClientViewModel>(model, "rest-client");
    if (!vm) return null;
    const state = vm.state.use();
    // ... render two-panel layout
}
```

### Step 5: Register the editor
**File:** `src/renderer/editors/register-editors.ts`

```typescript
editorRegistry.register({
    id: "rest-client",
    name: "Rest Client",
    pageType: "textFile",
    category: "content-view",
    acceptFile: (fileName) => {
        if (matchesPattern(fileName, /\.rest\.json$/i)) return 20;
        return -1;
    },
    validForLanguage: (languageId) => languageId === "json",
    switchOption: (languageId, fileName) => {
        if (languageId !== "json") return -1;
        if (!fileName || !matchesPattern(fileName, /\.rest\.json$/i)) return -1;
        return 10;
    },
    isEditorContent: (languageId, content) => {
        if (languageId !== "json") return false;
        if (!content.includes('"type"')) return false;
        return /"type"\s*:\s*"rest-client"/.test(content) && content.includes('"requests"');
    },
    loadModule: async () => {
        const [module, { createRestClientViewModel }] = await Promise.all([
            import("./rest-client/RestClientEditor"),
            import("./rest-client/RestClientViewModel"),
        ]);
        return {
            Editor: module.RestClientEditor,
            createViewModel: createRestClientViewModel,
            newPageModel: textEditorModule.newPageModel,
            newEmptyPageModel: textEditorModule.newEmptyPageModel,
            newPageModelFromState: textEditorModule.newPageModelFromState,
        };
    },
});
```

### Step 6: Add creatable page entry (optional)
**File:** `src/renderer/editors/register-editors.ts` (in the creatablePages section)

Add a "Rest Client" entry so users can create new `.rest.json` files from the "+" menu:
```typescript
{
    id: "rest-client",
    label: "Rest Client",
    create: () => {
        const content = JSON.stringify({
            type: "rest-client",
            requests: [],
        }, null, 4);
        return newTextFileModel({ content, language: "json", editor: "rest-client" });
    },
}
```

## Files Changed Summary

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `"rest-client"` to `PageEditor` union |
| `src/renderer/editors/rest-client/restClientTypes.ts` | **New.** Type definitions for requests, headers, data |
| `src/renderer/editors/rest-client/RestClientViewModel.ts` | **New.** ContentViewModel subclass — parse/serialize, CRUD operations |
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | **New.** React component — two-panel layout, TreeView, placeholder right panel |
| `src/renderer/editors/register-editors.ts` | Register `rest-client` editor + creatable page entry |

## Acceptance Criteria

- [ ] `.rest.json` files open in the Rest Client editor
- [ ] Two-panel layout with resizable left panel
- [ ] TreeView displays requests from the collection
- [ ] Add new request (creates default GET request)
- [ ] Delete request (with confirmation or undo)
- [ ] Rename request (inline edit or dialog)
- [ ] Drag-and-drop reorder requests
- [ ] Select request shows basic info in right panel
- [ ] File saves as valid `.rest.json` JSON
- [ ] New "Rest Client" option in the "+" create menu
- [ ] `isEditorContent` detects existing `.rest.json` files
- [ ] Empty file creates a valid empty collection
