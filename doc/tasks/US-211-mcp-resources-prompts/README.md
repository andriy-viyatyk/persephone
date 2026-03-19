# US-211: MCP Browser — Resources & Prompts Panels

**Epic:** EPIC-008 (MCP Browser Editor)
**Status:** Planned

## Goal

Implement the resources and prompts panels for the MCP Browser editor. Resources panel lists resources/templates from the server, reads resource content on click, and renders it adaptively by mimeType. Prompts panel lists prompts, provides an argument form, calls `getPrompt()`, and displays the returned messages.

## Background

### Current state (after US-210)

- `McpBrowserModel` has `toolsState` (TOneState) and tools methods. Same pattern to follow for resources and prompts.
- `McpBrowserView` routes panels: `activePanel === "tools"` → `<ToolsPanel />`, others show placeholder text.
- `ToolsPanel` established the UI pattern: resizable sidebar (Splitter) + detail panel with top (scrollable form) and bottom (flex result).
- Epic note: resource content rendering should be adaptive based on `mimeType`. Epic note: use Monaco for text input/output fields.

### MCP SDK Client API — Resources

```typescript
// List resources
const result = await client.listResources();
// result.resources: Resource[] — each has:
//   uri: string, name: string, description?: string, mimeType?: string

// List resource templates
const result = await client.listResourceTemplates();
// result.resourceTemplates: ResourceTemplate[] — each has:
//   uriTemplate: string, name: string, description?: string, mimeType?: string

// Read a resource
const result = await client.readResource({ uri: "notepad://guides/pages" });
// result.contents: (TextResourceContents | BlobResourceContents)[]
//   TextResourceContents: { uri, text: string, mimeType? }
//   BlobResourceContents: { uri, blob: string (base64), mimeType? }
```

### MCP SDK Client API — Prompts

```typescript
// List prompts
const result = await client.listPrompts();
// result.prompts: Prompt[] — each has:
//   name: string, description?: string
//   arguments?: PromptArgument[] — each: { name, description?, required? }

// Get a prompt
const result = await client.getPrompt({ name: "prompt-name", arguments: { key: "value" } });
// result.messages: PromptMessage[]
//   { role: "user" | "assistant", content: ContentBlock }
//   ContentBlock is one of:
//     { type: "text", text: string }
//     { type: "image", data: string, mimeType: string }
//     { type: "resource", resource: { uri, text?, blob?, mimeType? } }
//     { type: "resource_link", uri, name, ... }
// result.description?: string
```

### Existing components to reuse

**`MarkdownBlock`** (`src/renderer/editors/markdown/MarkdownBlock.tsx`):
```typescript
<MarkdownBlock content={markdownText} compact />
// Props: content: string, compact?: boolean, highlightText?, filePath?, className?, style?
```

**`Splitter`**, **`Button`**, **`TextField`**, **`TextAreaField`** — same as US-210.

**`Editor` from `@monaco-editor/react`** — for non-markdown text content and code display.

## Implementation Plan

### Step 1: Add resources & prompts types to McpBrowserModel

**File:** `src/renderer/editors/mcp-browser/McpBrowserModel.ts`

Add types:
```typescript
// ── Resources ──
export interface McpResourceInfo {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
}

export interface McpResourceTemplateInfo {
    uriTemplate: string;
    name: string;
    description: string;
    mimeType: string;
}

export interface McpResourceContent {
    uri: string;
    mimeType: string;
    text?: string;       // text content
    blob?: string;       // base64 binary content
}

export interface McpResourcesPanelState {
    resources: McpResourceInfo[];
    templates: McpResourceTemplateInfo[];
    selectedUri: string;
    readLoading: boolean;
    readContent: McpResourceContent | null;
    readError: string;
}

// ── Prompts ──
export interface McpPromptInfo {
    name: string;
    description: string;
    arguments: McpPromptArgInfo[];
}

export interface McpPromptArgInfo {
    name: string;
    description: string;
    required: boolean;
}

export interface McpPromptMessage {
    role: "user" | "assistant";
    content: McpPromptMessageContent[];
}

export type McpPromptMessageContent =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string } }
    | { type: "resource_link"; uri: string; name: string };

export interface McpPromptsPanelState {
    prompts: McpPromptInfo[];
    selectedPromptName: string;
    promptArgs: Record<string, string>;
    getPromptLoading: boolean;
    promptMessages: McpPromptMessage[] | null;
    promptError: string;
}
```

Add state instances and methods to `McpBrowserModel`:
```typescript
readonly resourcesState = new TOneState<McpResourcesPanelState>(getDefaultResourcesPanelState());
readonly promptsState = new TOneState<McpPromptsPanelState>(getDefaultPromptsPanelState());

// Resources
loadResources = async (): Promise<void> => { ... }
selectResource = (uri: string): void => { ... }
readResource = async (): Promise<void> => { ... }

// Prompts
loadPrompts = async (): Promise<void> => { ... }
selectPrompt = (name: string): void => { ... }
setPromptArg = (name: string, value: string): void => { ... }
getPrompt = async (): Promise<void> => { ... }
```

Wire `loadResources()` and `loadPrompts()` into `onStatusChange` callback alongside `loadTools()`.

### Step 2: Create ResourcesPanel component

**File:** `src/renderer/editors/mcp-browser/ResourcesPanel.tsx`

Same layout pattern as ToolsPanel: sidebar (Splitter, 260px initial — wider for URIs) + detail panel.

**Sidebar:**
- Header "Resources" with count badge
- List items showing resource name + URI below (two-line items). Templates shown in a separate section below with "Templates" sub-header.
- Active item highlighted. Click to select.

**Detail panel — top section (scrollable):**
- Resource name, URI (monospace, blue), description, mimeType badge
- "Read Resource" button (or auto-read on select — start with explicit button click)

**Detail panel — bottom section (flex, fills remaining space):**

Adaptive content rendering based on `mimeType`:
- `text/markdown` → `MarkdownBlock` component (compact mode, wrapped in a scrollable div)
- `application/json` → Monaco editor (read-only, `json` language)
- `text/*` or unknown text → Monaco editor (read-only, auto-detect language from mimeType: `text/html` → `html`, `text/css` → `css`, etc.)
- `image/*` → `<img>` with base64 data URL
- Binary with no text → show mimeType + size info + base64 preview (truncated)

Error display: red error message if `readError` is set.

### Step 3: Create PromptsPanel component

**File:** `src/renderer/editors/mcp-browser/PromptsPanel.tsx`

Same sidebar + detail layout.

**Sidebar:**
- Header "Prompts" with count badge
- List items showing prompt name + description (two-line)

**Detail panel — top section:**
- Prompt name, description
- Argument form: for each `argument` in the prompt, render a `TextAreaField` with label (name, required badge, description). Prompts have simpler args than tools — all are strings, no JSON Schema types.
- "Get Prompt" button

**Detail panel — bottom section (flex):**

Display `promptMessages` as a message list:
- Each message: role badge ("user" / "assistant") + content
- Text content → displayed as text (or Monaco if long/code-like)
- Image content → inline `<img>`
- Resource content → URI + text in Monaco
- Messages separated by subtle divider

### Step 4: Update McpBrowserView panel routing

**File:** `src/renderer/editors/mcp-browser/McpBrowserView.tsx`

Replace placeholders:
```tsx
{isConnected && s.activePanel === "resources" && (
    <ResourcesPanel model={model} />
)}
{isConnected && s.activePanel === "prompts" && (
    <PromptsPanel model={model} />
)}
```

### Step 5: Create ResourceContentView shared component

**File:** `src/renderer/editors/mcp-browser/ResourceContentView.tsx`

Shared component for rendering resource content adaptively. Used by ResourcesPanel and potentially by ToolResultView (for `type: "resource"` results).

```typescript
interface ResourceContentViewProps {
    content: McpResourceContent;
}
```

Rendering logic:
1. If `content.text` exists:
   - Detect display mode from `content.mimeType`:
     - `text/markdown` → `<MarkdownBlock content={text} compact />`
     - `application/json` → Monaco (json)
     - `text/html` → Monaco (html)
     - `text/css` → Monaco (css)
     - `text/javascript`, `application/javascript` → Monaco (javascript)
     - `text/yaml`, `application/yaml` → Monaco (yaml)
     - `text/xml`, `application/xml` → Monaco (xml)
     - Other `text/*` or unknown → Monaco (plaintext)
   - Monaco editors: read-only, flex fill, same options as ToolResultView
2. If `content.blob` exists (binary):
   - If `content.mimeType` starts with `image/` → `<img src="data:{mimeType};base64,{blob}" />`
   - Otherwise → show mimeType + blob length info

## Resolved Concerns

1. **Resource content rendering:** Adaptive based on mimeType. `text/markdown` uses existing `MarkdownBlock` component. Other text types use Monaco with appropriate language. Images rendered inline. Binary shows metadata.

2. **Prompt arguments vs tool arguments:** Prompts have simpler arguments — just `{ name, description, required }` without JSON Schema types. All prompt args are strings. Use `TextAreaField` for all of them (no need for the full `ToolArgForm` complexity).

3. **Auto-read vs explicit read:** Start with explicit "Read Resource" button click. Auto-read on select could be added later if the UX feels clunky.

4. **Sidebar width for resources:** 260px initial (wider than tools' 200px) because resource URIs can be long. Still resizable via Splitter.

## Acceptance Criteria

- [ ] Resources list loads automatically on connect (if server has resources capability)
- [ ] Resource templates listed in a separate section below resources
- [ ] Clicking a resource shows its detail (name, URI, description, mimeType)
- [ ] "Read Resource" button reads and displays content
- [ ] Markdown resources rendered via MarkdownBlock
- [ ] JSON resources rendered in Monaco with json language
- [ ] Other text resources rendered in Monaco with appropriate language
- [ ] Image resources (binary) rendered as inline images
- [ ] Prompts list loads automatically on connect (if server has prompts capability)
- [ ] Clicking a prompt shows its detail with argument form
- [ ] "Get Prompt" button calls getPrompt and displays messages
- [ ] Prompt messages show role badge and formatted content
- [ ] Both panels use resizable sidebar (Splitter)
- [ ] Loading states shown during read/getPrompt
- [ ] Errors displayed with error styling
- [ ] Resources/prompts state clears on disconnect
- [ ] Works with js-notepad's own MCP server (4 resources, 0 prompts currently)

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/editors/mcp-browser/McpBrowserModel.ts` | Modify | Add resources/prompts types, state, and methods |
| `src/renderer/editors/mcp-browser/McpBrowserView.tsx` | Modify | Route resources/prompts panels |
| `src/renderer/editors/mcp-browser/ResourcesPanel.tsx` | Create | Resources sidebar + detail + content display |
| `src/renderer/editors/mcp-browser/PromptsPanel.tsx` | Create | Prompts sidebar + argument form + messages display |
| `src/renderer/editors/mcp-browser/ResourceContentView.tsx` | Create | Adaptive content renderer (markdown/monaco/image) |

## Files NOT Changed

- `McpConnectionManager.ts` — no changes needed
- `ToolsPanel.tsx`, `ToolArgForm.tsx`, `ToolResultView.tsx` — tools panel untouched
- `register-editors.ts`, `shared/types.ts` — no new types/registrations
- Scripting wrappers — scripting API is US-214
