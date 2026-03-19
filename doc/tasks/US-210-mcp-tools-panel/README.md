# US-210: MCP Browser — Tools Panel (List, Inspect, Call)

**Epic:** EPIC-008 (MCP Browser Editor)
**Status:** Planned

## Goal

Implement the tools panel for the MCP Browser editor — list tools from a connected server in the sidebar, display tool details with a dynamic argument form generated from JSON Schema, execute tools via `client.callTool()`, and display results. This is the most useful panel of the MCP Browser.

## Background

### Current MCP Browser state (US-209)

The editor scaffold is in place:
- `McpBrowserModel` manages connection state and exposes `connection.getClient()` to access the MCP SDK Client
- `McpBrowserView` renders connection bar, server info, sidebar (placeholder labels), and main panel (empty state)
- Sidebar currently shows static labels (Tools, Resources, Prompts, History) — needs to become a real tool list when `activePanel === "tools"`
- Main panel shows empty state message — needs to render tool detail view

### MCP SDK Client API for tools

```typescript
// List all tools
const result = await client.listTools();
// result.tools: Tool[] — each tool has:
//   name: string
//   description?: string
//   inputSchema: { type: "object", properties?: Record<string, object>, required?: string[] }
//   annotations?: { title?: string, readOnlyHint?: boolean, destructiveHint?: boolean, ... }

// Call a tool
const result = await client.callTool({ name: "tool-name", arguments: { key: "value" } });
// result.content: ContentItem[] — each item is one of:
//   { type: "text", text: string }
//   { type: "image", data: string, mimeType: string }  (base64)
//   { type: "audio", data: string, mimeType: string }  (base64)
//   { type: "resource", resource: { uri, mimeType, text?, blob? } }
//   { type: "resource_link", uri: string, name: string, ... }
// result.isError?: boolean
// result.structuredContent?: Record<string, unknown>
```

### Monaco editor embedding pattern

For tool argument inputs and result display, use `@monaco-editor/react` (Pattern A from codebase):

```typescript
import { Editor, OnMount } from "@monaco-editor/react";

<Editor
    value={text}
    language="json"
    theme="custom-dark"
    options={{
        automaticLayout: true,
        minimap: { enabled: false },
        lineNumbers: "off",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        folding: false,
        renderLineHighlight: "none",
        padding: { top: 4, bottom: 4 },
    }}
/>
```

Used in: `TextDialog.tsx`, `TextOutputView.tsx`, `ScriptPanel.tsx`.

### JSON Schema → form generation

Tool `inputSchema` is a JSON Schema object. Each property needs an appropriate input:
- `string` → `TextAreaField` component (simple multiline text input)
- `number` / `integer` → `TextField` component
- `boolean` → checkbox
- `enum` → `<select>` dropdown
- `object` / `array` / complex → Monaco editor with JSON language

Decision rule for string fields: use `TextAreaField` for all simple strings. Use Monaco editor only for `object`, `array`, or fields where the property name contains "script", "code", "json", "yaml", "xml" (code-like content that benefits from syntax highlighting).

### Existing components to use

**`TextAreaField`** (`src/renderer/components/basic/TextAreaField.tsx`):
```typescript
<TextAreaField value={value} onChange={handleChange} placeholder="..." />
// Props: value, onChange(value: string), singleLine?, readonly?, placeholder?
```

**`TextField`** (`src/renderer/components/basic/TextField.tsx`):
```typescript
<TextField value={value} onChange={handleChange} placeholder="..." />
// Props: value, onChange(value: string), placeholder?, disabled?, label?, password?
```

**`Splitter`** (`src/renderer/components/layout/Splitter.tsx`):
```typescript
<Splitter type="vertical" initialWidth={200} onChangeWidth={setWidth} borderSized="right" />
// Props: type ("vertical"|"horizontal"), initialWidth?, onChangeWidth?, borderSized?
```

## Implementation Plan

### Step 1: Add tools state to McpBrowserModel

**File:** `src/renderer/editors/mcp-browser/McpBrowserModel.ts`

Add to `McpBrowserPageState`:
```typescript
// Tools panel state (not persisted — loaded on connect)
// These are NOT in the state because they are large objects managed outside reactive state
```

Add to `McpBrowserModel`:
```typescript
// Tool data (managed outside reactive state to avoid large objects in state)
private _tools: McpToolInfo[] = [];
private _selectedToolName: string = "";
private _toolResult: McpToolResult | null = null;
private _toolCallLoading = false;
private _toolArgs: Record<string, string> = {};

// Reactive signal for tool panel to subscribe
readonly toolsState = new TOneState<McpToolsPanelState>(getDefaultToolsPanelState());
```

Define types:
```typescript
export interface McpToolInfo {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties?: Record<string, any>;
        required?: string[];
    };
    annotations?: {
        title?: string;
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
    };
}

export interface McpToolResult {
    content: McpToolResultContent[];
    isError?: boolean;
    durationMs: number;
}

export type McpToolResultContent =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string } }
    | { type: "resource_link"; uri: string; name: string };

export interface McpToolsPanelState {
    tools: McpToolInfo[];
    selectedToolName: string;
    toolCallLoading: boolean;
    toolResult: McpToolResult | null;
    toolArgs: Record<string, string>;
}
```

Add methods:
```typescript
/** Load tools list from connected server. Called after successful connect. */
loadTools = async (): Promise<void> => { ... }

/** Select a tool by name. */
selectTool = (name: string): void => { ... }

/** Update a tool argument value. */
setToolArg = (name: string, value: string): void => { ... }

/** Call the selected tool with current arguments. */
callTool = async (): Promise<void> => { ... }
```

Wire `loadTools()` into the `onStatusChange` callback — when status becomes `"connected"`, auto-load tools list. When disconnected, clear tools.

### Step 2: Create ToolsPanel component

**File:** `src/renderer/editors/mcp-browser/ToolsPanel.tsx`

This component replaces the sidebar + main panel content when `activePanel === "tools"`.

**Layout (matches mockup):**
```
+------+---------------------------------------------+
| Side | Tool Detail                                  |
| bar  |                                              |
| ──── | tool-name                                    |
| tool1| Description text...                          |
| tool2| ─────────────────────────────────             |
| tool3| Arguments:                                   |
| tool4|   param1: [input.............] string *req    |
| tool5|   param2: [Monaco editor....] object          |
| ...  | ─────────────────────────────────             |
|      | [▶ Call Tool]                                 |
|      | ─────────────────────────────────             |
|      | Result:                                       |
|      | [Monaco editor with result JSON]              |
+------+---------------------------------------------+
```

**Structure:**

```tsx
<ToolsPanelRoot>
    {/* Left: tools sidebar (resizable via Splitter) */}
    <div className="tools-sidebar" style={{ width: sidebarWidth }}>
        <div className="sidebar-header">Tools <span className="count">{tools.length}</span></div>
        {tools.map(t => <div className="sidebar-item" ... />)}
    </div>
    <Splitter type="vertical" initialWidth={200} onChangeWidth={setWidth} borderSized="right" />
    {/* Right: tool detail */}
    <div className="tool-detail">
        <ToolDetailHeader ... />
        <ToolArgForm ... />
        <CallButton ... />
        <ToolResultView ... />
    </div>
</ToolsPanelRoot>
```

**Sub-components (all within the same file or small extracted files):**

1. **Tools sidebar** — scrollable list of tool names with count badge in header. Active tool highlighted with left border. Click to select. Initial width 200px, resizable via `Splitter` component. Tool names truncated with ellipsis, full name on hover via title attribute.

2. **Tool detail header** — tool name, description, annotations badges (read-only, destructive).

3. **Argument form** (`ToolArgForm.tsx`) — generated from `inputSchema.properties`:
   - Each field: label + type badge + required indicator + input control
   - Simple string → `TextAreaField` component
   - Number / integer → `TextField` component
   - Boolean → checkbox
   - Enum (schema has `enum` array) → `<select>` dropdown
   - Code-like string (name contains "script", "code", "json", etc.) → Monaco editor (~80px)
   - Object/Array/complex → Monaco editor with JSON language (~120px height)
   - Required fields marked with red asterisk

4. **Call button** — primary button, disabled during loading, shows spinner text when loading.

5. **Result display** (`ToolResultView.tsx`) — Monaco editor (read-only, scrollable, no max-height truncation) for text content. For image content, render inline `<img>` with base64 data URL. Error results shown with error styling.

**Styling:** Single `ToolsPanelRoot` styled component with nested class-based styles. The tools sidebar replaces the generic sidebar from McpBrowserView.

### Step 3: Refactor McpBrowserView for panel routing

**File:** `src/renderer/editors/mcp-browser/McpBrowserView.tsx`

Currently the sidebar and main panel are inline in McpBrowserView. Refactor:

1. Replace the static sidebar + empty main panel with panel-specific components:
   ```tsx
   <div className="body">
       {isConnected && activePanel === "tools" && (
           <ToolsPanel model={model} />
       )}
       {isConnected && activePanel === "resources" && (
           <div className="main-panel"><div className="empty-state">Resources panel — coming soon</div></div>
       )}
       {/* ... other panels ... */}
       {!isConnected && (
           <div className="main-panel"><div className="empty-state">...</div></div>
       )}
   </div>
   ```

2. Remove the generic sidebar from McpBrowserView — each panel component owns its own sidebar.

3. Keep the connection bar, error bar, and server info bar in McpBrowserView (shared across all panels).

### Step 4: Build the argument form generator

**File:** `src/renderer/editors/mcp-browser/ToolArgForm.tsx`

A pure component that receives `inputSchema` and `args` Record, and renders the appropriate inputs.

```typescript
interface ToolArgFormProps {
    schema: McpToolInfo["inputSchema"];
    args: Record<string, string>;
    onArgChange: (name: string, value: string) => void;
    disabled?: boolean;
}
```

For each property in `schema.properties`:
1. Read the property schema: `{ type, description, enum, default, ... }`
2. Determine input type:
   - `type === "boolean"` → checkbox
   - `enum` array present → `<select>` dropdown
   - `type === "number"` or `type === "integer"` → `TextField`
   - `type === "string"` and name matches code pattern (`script`, `code`, `json`, `yaml`, `xml`) → Monaco editor
   - `type === "string"` → `TextAreaField`
   - `type === "object"` or `type === "array"` or anything else → Monaco editor (JSON language)
3. Render label with: property name, type badge, required asterisk, description

Monaco editors for arguments should be ~80-120px tall, with JSON or plaintext language depending on type.

### Step 5: Build the result display

**File:** `src/renderer/editors/mcp-browser/ToolResultView.tsx`

Renders `McpToolResult`:
```typescript
interface ToolResultViewProps {
    result: McpToolResult;
}
```

For each content item in `result.content`:
- `type === "text"` → Monaco editor (read-only). Auto-detect language: if text is valid JSON, use `json`; otherwise `plaintext`.
- `type === "image"` → `<img src="data:{mimeType};base64,{data}" />` with max-width constraint
- `type === "resource"` → show URI + text content in Monaco
- `type === "resource_link"` → show as clickable link

Show error styling if `result.isError === true` (red border on result area).

Show duration badge: `"{durationMs}ms"`.

### Step 6: Wire model methods

**File:** `src/renderer/editors/mcp-browser/McpBrowserModel.ts`

Implement the model methods:

```typescript
loadTools = async (): Promise<void> => {
    const client = this.connection.getClient();
    if (!client) return;
    try {
        const result = await client.listTools();
        const tools: McpToolInfo[] = (result.tools || []).map(t => ({
            name: t.name,
            description: t.description || "",
            inputSchema: t.inputSchema as McpToolInfo["inputSchema"],
            annotations: t.annotations,
        }));
        this.toolsState.update(s => {
            s.tools = tools;
            s.selectedToolName = tools.length > 0 ? tools[0].name : "";
            s.toolResult = null;
            s.toolArgs = {};
        });
    } catch (err: any) {
        // Silently fail — tools list just stays empty
    }
};

selectTool = (name: string): void => {
    this.toolsState.update(s => {
        s.selectedToolName = name;
        s.toolResult = null;
        s.toolArgs = {};
    });
};

setToolArg = (name: string, value: string): void => {
    this.toolsState.update(s => {
        s.toolArgs = { ...s.toolArgs, [name]: value };
    });
};

callTool = async (): Promise<void> => {
    const client = this.connection.getClient();
    if (!client) return;
    const ts = this.toolsState.get();
    const tool = ts.tools.find(t => t.name === ts.selectedToolName);
    if (!tool) return;

    // Parse arguments from string values to proper types
    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ts.toolArgs)) {
        if (!value && value !== "false") continue; // skip empty
        const propSchema = tool.inputSchema.properties?.[key] as any;
        if (propSchema?.type === "number" || propSchema?.type === "integer") {
            args[key] = Number(value);
        } else if (propSchema?.type === "boolean") {
            args[key] = value === "true";
        } else if (propSchema?.type === "object" || propSchema?.type === "array") {
            try { args[key] = JSON.parse(value); } catch { args[key] = value; }
        } else {
            args[key] = value;
        }
    }

    this.toolsState.update(s => { s.toolCallLoading = true; s.toolResult = null; });
    const startTime = Date.now();
    try {
        const result = await client.callTool({ name: tool.name, arguments: args });
        const duration = Date.now() - startTime;
        this.toolsState.update(s => {
            s.toolCallLoading = false;
            s.toolResult = {
                content: (result as any).content || [],
                isError: (result as any).isError,
                durationMs: duration,
            };
        });
    } catch (err: any) {
        const duration = Date.now() - startTime;
        this.toolsState.update(s => {
            s.toolCallLoading = false;
            s.toolResult = {
                content: [{ type: "text", text: err?.message || String(err) }],
                isError: true,
                durationMs: duration,
            };
        });
    }
};
```

Wire `loadTools()` in the `onStatusChange` callback:
```typescript
this.connection.onStatusChange = (status, error) => {
    // ... existing state update ...
    if (status === "connected") {
        this.loadTools();
    } else if (status === "disconnected" || status === "error") {
        this.toolsState.set(getDefaultToolsPanelState());
    }
};
```

## Resolved Concerns

1. **Monaco vs simple inputs for arguments:** Use `TextAreaField` for simple string arguments, `TextField` for numbers. Monaco editor only for `object`/`array` types and code-like string fields (name contains "script", "code", "json", "yaml", "xml"). This keeps the UI lightweight for tools with many parameters.

2. **Argument state persistence across tool switches:** Persist args and selected tool per connection in the `mcp-connections.json` file (to be implemented in US-213 connections store). For now in US-210, keep args in the `toolsState` and clear on tool switch — US-213 will add persistence later.

3. **Large result display:** Show full result in a scrollable Monaco editor. No truncation — users can scroll through large results.

4. **Sidebar width:** Initial width 200px. Use `Splitter` component (`type="vertical"`, `borderSized="right"`) to make the sidebar resizable. Tool names truncated with ellipsis, full name shown via `title` attribute on hover.

## Acceptance Criteria

- [ ] Tools list loads automatically on successful connection
- [ ] Tools sidebar shows all tool names with count in header
- [ ] Clicking a tool shows its detail view (name, description, input schema)
- [ ] Argument form renders appropriate inputs based on JSON Schema type
- [ ] Required fields are visually marked
- [ ] "Call Tool" button executes the tool with entered arguments
- [ ] Loading state shown during tool call
- [ ] Result displayed in Monaco editor (read-only, auto-detected language)
- [ ] Image results rendered as inline images
- [ ] Error results shown with error styling
- [ ] Call duration displayed
- [ ] Empty arguments are omitted from the call
- [ ] Tools list clears on disconnect
- [ ] Sidebar is resizable via Splitter (initial 200px)
- [ ] Works with js-notepad's own MCP server (9 tools)

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/editors/mcp-browser/McpBrowserModel.ts` | Modify | Add tools state, loadTools, selectTool, setToolArg, callTool methods |
| `src/renderer/editors/mcp-browser/McpBrowserView.tsx` | Modify | Refactor body to route panels, remove generic sidebar |
| `src/renderer/editors/mcp-browser/ToolsPanel.tsx` | Create | Tools sidebar + tool detail + result display |
| `src/renderer/editors/mcp-browser/ToolArgForm.tsx` | Create | JSON Schema → argument form generator |
| `src/renderer/editors/mcp-browser/ToolResultView.tsx` | Create | Tool call result renderer (text, image, resource) |

## Files NOT Changed

- `McpConnectionManager.ts` — no changes, `getClient()` already exposes SDK Client
- `register-editors.ts` — no registration changes
- `shared/types.ts` — no new types needed
- `PagesModel.ts` / `PagesLifecycleModel.ts` — no API changes
- Scripting wrappers — scripting API is US-214
