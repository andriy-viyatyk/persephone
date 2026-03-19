# US-217: MCP Inspector — Server Info tab with full server metadata

## Goal

Add a "Server Info" tab to the MCP Inspector that displays all available server metadata: name, title, version, description, website URL, icons, instructions, and capabilities. Also update the js-notepad MCP server to provide the additional metadata fields.

## Background

### What the MCP SDK provides after `initialize`

**From `client.getServerVersion()`** (Implementation schema):
- `name` (string) — server identifier
- `version` (string) — server version
- `title` (string?, optional) — display-friendly name
- `description` (string?, optional) — short description
- `websiteUrl` (string?, optional) — server's website link
- `icons` (array?, optional) — server icons with `src`, `mimeType`, `sizes`, `theme` (light/dark)

**From `client.getInstructions()`**:
- `instructions` (string?, optional) — markdown text describing how to use the server

**From `client.getServerCapabilities()`**:
- `tools`, `resources`, `prompts` — already used (as boolean badges)
- `logging`, `completions`, `tasks`, `experimental` — not used yet (deferred to US-218)

### Current state

- `McpConnectionManager` reads `getServerVersion()` and `getServerCapabilities()` but only extracts `name`, `version`, and capability booleans. Does not read `getInstructions()`, `title`, `description`, `websiteUrl`, or `icons`.
- `McpServerInfo` interface has `name`, `version`, `capabilities`.
- The View shows a server info bar with name, version, and capability badges that act as panel tabs.

### Panel / tab system

The Inspector uses `activePanel` state (`McpPanelId`) to switch panels:
- Current type: `"tools" | "resources" | "prompts" | "history"`
- Default panel: `"tools"`
- Badges in server info bar double as tab selectors
- Panel content rendered conditionally in `<div className="body">`

### Markdown rendering

`MarkdownBlock` component (`src/renderer/editors/markdown/MarkdownBlock.tsx`) is used in `ResourceContentView.tsx`: `<MarkdownBlock content={text} compact />`.

## Implementation Plan

### Step 1: Expand `McpServerInfo` and `McpConnectionManager`

**File:** `src/renderer/editors/mcp-inspector/McpConnectionManager.ts`

1. Expand `McpServerInfo` interface:
   ```typescript
   export interface McpServerInfo {
       name: string;
       title: string;
       version: string;
       description: string;
       websiteUrl: string;
       instructions: string;
       capabilities: {
           tools?: boolean;
           resources?: boolean;
           prompts?: boolean;
       };
   }
   ```

2. Read all fields after connect (lines 120-131):
   ```typescript
   const serverVersion = this.client.getServerVersion();
   const serverCaps = this.client.getServerCapabilities();
   const instructions = this.client.getInstructions();
   this._serverInfo = {
       name: serverVersion?.name || config.name || "Unknown",
       title: serverVersion?.title || "",
       version: serverVersion?.version || "",
       description: serverVersion?.description || "",
       websiteUrl: serverVersion?.websiteUrl || "",
       instructions: instructions || "",
       capabilities: {
           tools: !!serverCaps?.tools,
           resources: !!serverCaps?.resources,
           prompts: !!serverCaps?.prompts,
       },
   };
   ```

### Step 2: Add fields to McpInspectorModel state and add `"info"` panel

**File:** `src/renderer/editors/mcp-inspector/McpInspectorModel.ts`

1. Add `"info"` to `McpPanelId` type (line 155):
   ```typescript
   export type McpPanelId = "info" | "tools" | "resources" | "prompts" | "history";
   ```

2. Add new fields to state interface (after `serverVersion`):
   ```typescript
   serverTitle: string;
   serverDescription: string;
   serverWebsiteUrl: string;
   instructions: string;
   ```

3. Set defaults to `""` in initial state.

4. In `onStatusChange` handler where `serverName`/`serverVersion` are set (~line 227), also set:
   ```typescript
   s.serverTitle = info.title;
   s.serverDescription = info.description;
   s.serverWebsiteUrl = info.websiteUrl;
   s.instructions = info.instructions;
   ```

5. Clear all on disconnect (~line 233):
   ```typescript
   s.serverTitle = "";
   s.serverDescription = "";
   s.serverWebsiteUrl = "";
   s.instructions = "";
   ```

6. Change default `activePanel` to `"info"` (~line 201).

7. No save/restore changes — these are transient (come from server on connect).

### Step 3: Add "Server Info" panel to McpInspectorView

**File:** `src/renderer/editors/mcp-inspector/McpInspectorView.tsx`

1. Add "Info" badge as the **first** tab in server info bar, always visible when connected:
   ```tsx
   <span
       className={`capability-badge${s.activePanel === "info" ? " active" : ""}`}
       onClick={() => model.setActivePanel("info")}
   >
       Info
   </span>
   ```

2. Create `ServerInfoPanel` component (inline or separate function). Layout — simple vertical list of fields:
   - **Server Name** — `s.serverTitle || s.serverName` (use title if available, fallback to name)
   - **Version** — `s.serverVersion`
   - **Description** — `s.serverDescription` (hide if empty)
   - **Website** — `s.serverWebsiteUrl` as a clickable link (hide if empty). Use `shell.openExternal()` or open in built-in browser.
   - **Instructions** — rendered via `<MarkdownBlock content={s.instructions} compact />` (hide if empty)

   Each field: label (styled as subtle/muted) on one line, value below it. Keep padding consistent with other panels. The panel should have `overflow: auto` for scrolling long instructions.

3. Render in body:
   ```tsx
   {isConnected && s.activePanel === "info" && (
       <ServerInfoPanel state={s} />
   )}
   ```

### Step 4: Update js-notepad MCP server metadata

**File:** `src/main/mcp-http-server.ts`

Update the `McpServer` constructor (line 130-134) to include additional metadata:
```typescript
const server = new McpServer(
    {
        name: "js-notepad",
        version: electronApp.getVersion(),
        title: "JS Notepad",
        description: "Developer notepad with tabbed pages, specialized editors, JavaScript/TypeScript scripting, and full Node.js access.",
        websiteUrl: "https://github.com/andriy-viyatyk/js-notepad",
    },
    {
        instructions: [ ... ],  // existing instructions unchanged
    },
);
```

### Step 5: Expose via scripting facade

**File:** `src/renderer/scripting/api-wrapper/McpInspectorFacade.ts`

Add read-only getters (in "Connection status" section):
```typescript
get serverTitle(): string {
    return this.model.state.get().serverTitle;
}
get serverDescription(): string {
    return this.model.state.get().serverDescription;
}
get serverWebsiteUrl(): string {
    return this.model.state.get().serverWebsiteUrl;
}
get instructions(): string {
    return this.model.state.get().instructions;
}
```

**File:** `src/renderer/api/types/mcp-inspector-editor.d.ts` (and `assets/` copy)

Add to interface (in "Connection status" section):
```typescript
/** Display-friendly server title (empty if not provided). */
readonly serverTitle: string;

/** Short server description (empty if not provided). */
readonly serverDescription: string;

/** Server website URL (empty if not provided). */
readonly serverWebsiteUrl: string;

/** Server instructions received during initialization (empty when disconnected). */
readonly instructions: string;
```

## Concerns (Resolved)

1. **Markdown rendering** — Use `MarkdownBlock` with `compact` prop, same as `ResourceContentView.tsx`. No new dependency.

2. **No copy button** — User can select text and copy with Ctrl+C.

3. **Empty fields** — Hide any field that has an empty string value. If all optional fields are empty, the Info tab just shows name + version.

4. **Icons** — MCP servers can provide icons (src URL, mimeType, sizes, theme). For now, skip icon rendering — it adds complexity (light/dark theme handling, image loading) with little practical benefit since few servers provide icons today. Can be added later if needed.

5. **Website URL click behavior** — Open in the built-in browser tab via `app.pages.openUrlInBrowserTab()` or use `shell.openExternal()` for system browser. Follow the pattern used elsewhere in the app.

## Acceptance Criteria

- [ ] `McpConnectionManager` reads all Implementation fields + `getInstructions()`
- [ ] `McpServerInfo` includes `title`, `description`, `websiteUrl`, `instructions`
- [ ] `McpInspectorModel` state includes all new fields, `McpPanelId` includes `"info"`
- [ ] "Info" tab appears as first tab in connected state, is the default panel
- [ ] Info panel shows: name/title, version, description, website (clickable), instructions (markdown)
- [ ] Empty optional fields are hidden
- [ ] js-notepad MCP server provides `title`, `description`, `websiteUrl`
- [ ] Scripting facade exposes all new fields as read-only
- [ ] Type definitions updated in both `src/` and `assets/`

## Files Changed Summary

| File | Action | What changes |
|------|--------|-------------|
| `src/renderer/editors/mcp-inspector/McpConnectionManager.ts` | Edit | Expand `McpServerInfo`, read all Implementation fields + instructions |
| `src/renderer/editors/mcp-inspector/McpInspectorModel.ts` | Edit | Add fields to state, add `"info"` to `McpPanelId`, default panel `"info"` |
| `src/renderer/editors/mcp-inspector/McpInspectorView.tsx` | Edit | Add "Info" tab badge, add `ServerInfoPanel` component |
| `src/main/mcp-http-server.ts` | Edit | Add `title`, `description`, `websiteUrl` to server metadata |
| `src/renderer/scripting/api-wrapper/McpInspectorFacade.ts` | Edit | Add getters for new fields |
| `src/renderer/api/types/mcp-inspector-editor.d.ts` | Edit | Add new read-only properties |
| `assets/editor-types/mcp-inspector-editor.d.ts` | Edit | Same |
