# US-213: MCP Browser — Connections Store & Management UI

**Epic:** EPIC-008 (MCP Browser Editor)
**Status:** Planned

## Goal

Create a centralized connections store that persists MCP server connections to a JSON file in the app data folder. Add a management UI to the MCP Browser editor — a connections list when disconnected, auto-save on successful connect, and a quick-connect dropdown in the connection bar.

## Background

### App data file I/O pattern

The project uses `app.fs` (`src/renderer/api/fs.ts`) for all file operations:
```typescript
import { fs as appFs } from "../../api/fs";

// Resolve a path in the app data directory
const filePath = await appFs.resolveDataPath("mcp-connections.json");

// Read/write data files (auto-resolves to data dir, supports window index template)
await appFs.saveDataFile("mcp-connections.json", JSON.stringify(data, null, 4));
const content = await appFs.getDataFile("mcp-connections.json");

// Prepare file (creates with default content if missing)
await appFs.prepareDataFile("mcp-connections.json", "[]");
```

File location: `%APPDATA%/js-notepad/data/mcp-connections.json`

Note: `saveDataFile`/`getDataFile` use `dataFileName()` which substitutes `{windowIndex}`. Since connections should be **shared across all windows**, use `resolveDataPath()` + direct `readFile`/`writeFile` instead.

### UUID generation

Use `crypto.randomUUID()` — the project's standard pattern (used in PageModel, LinkViewModel, etc.).

### Current MCP Browser state

`McpBrowserPageState` already has connection config fields: `url`, `transportType`, `command`, `args`, `connectionName`. The connect method builds a `McpConnectionConfig` from these. The store needs to persist the same data.

### Existing persistence patterns

- **Settings**: `settings.ts` — reads JSON, debounced save on changes, FileWatcher for external edits
- **Page state**: `PagesPersistenceModel.ts` — `saveDataFile()` with debounce, restore on startup
- **Bookmarks**: `BrowserBookmarks.ts` — saved via TextFileModel with debounced writes

For the connections store, a simple service with load/save/debounced-write is sufficient. No FileWatcher needed (only modified from within the app).

## Implementation Plan

### Step 1: Create McpConnectionStore service

**File:** `src/renderer/editors/mcp-browser/McpConnectionStore.ts`

A singleton service that manages the connections file.

```typescript
export interface SavedMcpConnection {
    id: string;
    name: string;
    transport: McpTransportType;
    url: string;          // for HTTP
    command: string;      // for stdio
    args: string;         // for stdio (space-separated)
    createdAt: number;    // timestamp
    lastUsedAt: number;   // timestamp
}

class McpConnectionStore {
    private _connections: SavedMcpConnection[] = [];
    private _loaded = false;
    private _filePath = "";

    /** Reactive state for UI to subscribe. */
    readonly state = new TOneState<{ connections: SavedMcpConnection[] }>({ connections: [] });

    /** Load connections from disk. Called once on first access. */
    async load(): Promise<void> { ... }

    /** Save or update a connection. Returns the saved connection. */
    async save(conn: Omit<SavedMcpConnection, "id" | "createdAt" | "lastUsedAt"> & { id?: string }): Promise<SavedMcpConnection> { ... }

    /** Delete a connection by ID. */
    async delete(id: string): Promise<void> { ... }

    /** Find existing connection matching URL or command. */
    findByConfig(transport: McpTransportType, url: string, command: string): SavedMcpConnection | undefined { ... }

    /** Write to disk (debounced). */
    private writeToDisk = debounce(async () => { ... }, 500);
}

export const mcpConnectionStore = new McpConnectionStore();
```

**Load logic:**
1. `resolveDataPath("mcp-connections.json")` → get file path
2. Read file, parse JSON array
3. If file doesn't exist or is empty, start with `[]`
4. Update `state`

**Save logic (for auto-save on connect):**
1. Check if connection with same URL/command already exists (`findByConfig`)
2. If exists: update `lastUsedAt`, optionally update name
3. If new: create with `crypto.randomUUID()` ID, set `createdAt` and `lastUsedAt`
4. Update state, debounced write to disk

### Step 2: Auto-save connection on successful connect

**File:** `src/renderer/editors/mcp-browser/McpBrowserModel.ts`

In `onStatusChange`, when status becomes `"connected"`:
```typescript
if (status === "connected") {
    this.loadTools();
    this.loadResources();
    this.loadPrompts();
    // Auto-save connection
    this.autoSaveConnection();
}
```

```typescript
private autoSaveConnection = async (): Promise<void> => {
    const s = this.state.get();
    const name = s.connectionName || s.serverName || s.url || s.command;
    await mcpConnectionStore.save({
        name,
        transport: s.transportType,
        url: s.url,
        command: s.command,
        args: s.args,
    });
    // Update tab title if name was generated
    if (!s.connectionName && name) {
        this.state.update((st) => { st.connectionName = name; st.title = name; });
    }
};
```

### Step 3: Add connections dropdown to the connection bar

**File:** `src/renderer/editors/mcp-browser/McpBrowserView.tsx`

Add a `<select>` dropdown before the transport selector:
```tsx
<select className="saved-select" value="" onChange={handleSelectConnection} disabled={isConnected}>
    <option value="">Saved…</option>
    {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
</select>
<span className="separator" />
{/* existing transport-select + url-input + button */}
```

When a saved connection is selected:
1. Fill the connection bar fields (transport, url/command/args, connectionName)
2. Don't auto-connect — user clicks Connect

The dropdown reads from `mcpConnectionStore.state.use()`.

Style the dropdown and separator in `McpBrowserViewRoot`.

### Step 4: Add connections list panel when disconnected

**File:** `src/renderer/editors/mcp-browser/McpBrowserView.tsx`

When disconnected, instead of (or in addition to) the "Enter a server URL..." empty state, show a connections list:

```tsx
{!isConnected && (
    <div className="main-panel">
        {connections.length > 0 ? (
            <ConnectionsList
                connections={connections}
                onSelect={handleFillConnection}
                onDelete={handleDeleteConnection}
            />
        ) : (
            <div className="empty-state">
                Enter a server URL or command above and click
                <strong> Connect</strong> to get started.
            </div>
        )}
    </div>
)}
```

**ConnectionsList** (inline in McpBrowserView or small extracted component):
- List of saved connections showing: name, URL/command, transport badge, last-used date
- Click to fill connection bar
- Delete button (with confirmation or just hover-reveal)
- Edit name inline (optional — can defer to future)

### Step 5: Add model methods for connection management

**File:** `src/renderer/editors/mcp-browser/McpBrowserModel.ts`

```typescript
/** Fill connection bar from a saved connection. */
fillFromSaved = (conn: SavedMcpConnection): void => {
    this.state.update((s) => {
        s.transportType = conn.transport;
        s.url = conn.url;
        s.command = conn.command;
        s.args = conn.args;
        s.connectionName = conn.name;
    });
};

/** Delete a saved connection. */
deleteSavedConnection = async (id: string): Promise<void> => {
    await mcpConnectionStore.delete(id);
};
```

## Resolved Concerns

1. **Shared across windows:** Connections file uses `resolveDataPath()` (not `saveDataFile` with window index template), so all windows see the same connections.

2. **Deduplication on auto-save:** `findByConfig()` checks for existing connection with same transport + URL (HTTP) or transport + command (stdio). Updates `lastUsedAt` instead of creating a duplicate.

3. **Default name generation:** On auto-save, name defaults to: `serverName` (from handshake) → `url` (for HTTP) → `command + first arg` (for stdio). User can rename later.

4. **Per-connection UI state persistence:** Deferred — this task focuses on connection config persistence. Selected tool/args per connection is a future enhancement.

## Acceptance Criteria

- [ ] Connections file created at `%APPDATA%/js-notepad/data/mcp-connections.json`
- [ ] Connections auto-saved on successful connect
- [ ] Duplicate connections detected and updated (not created twice)
- [ ] Saved connections dropdown in the connection bar
- [ ] Selecting a saved connection fills the connection bar fields
- [ ] Connections list shown when disconnected (if saved connections exist)
- [ ] Delete saved connection works
- [ ] Connections shared across all windows
- [ ] Connection tab title updates to saved name
- [ ] Store loads lazily on first access
- [ ] Debounced writes to disk (no excessive I/O)

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/editors/mcp-browser/McpConnectionStore.ts` | Create | Singleton store: load, save, delete, findByConfig, debounced disk write |
| `src/renderer/editors/mcp-browser/McpBrowserModel.ts` | Modify | Add autoSaveConnection, fillFromSaved, deleteSavedConnection methods |
| `src/renderer/editors/mcp-browser/McpBrowserView.tsx` | Modify | Add saved connections dropdown + connections list when disconnected |

## Files NOT Changed

- `McpConnectionManager.ts` — connection logic unchanged
- `ToolsPanel.tsx`, `ResourcesPanel.tsx`, `PromptsPanel.tsx` — panel components unchanged
- `register-editors.ts`, `shared/types.ts` — no new types/registrations
- `src/renderer/api/fs.ts` — existing API sufficient
