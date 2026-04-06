# US-382: Fix `browser_tabs` — add action-based interface (Playwright compatibility)

## Goal

Playwright MCP's `browser_tabs` is an action-based tool that can list, create, close, and switch tabs. Persephone's `browser_tabs` only returns a list. An AI agent trained on Playwright will pass `{ action: "new", url: "https://..." }` and get a tab list instead of a new tab. Fix by adding full action-based support.

## Background

Playwright MCP spec:
```json
{ "action": "list" }                        // list all tabs
{ "action": "new", "url": "https://..." }   // open new tab
{ "action": "close", "index": 1 }           // close tab at index
{ "action": "select", "index": 0 }          // switch to tab at index
```

Persephone current: always returns the tab array (no `action` param).

**IBrowserTarget interface** (already has all needed methods — `src/renderer/automation/types.ts`):
```typescript
readonly tabs: ReadonlyArray<ITargetTab>;   // list
addTab(url?: string): string;               // new — returns new tab ID
closeTab(tabId?: string): void;             // close — by ID or active
switchTab(tabId: string): void;             // select
```

`ITargetTab` shape:
```typescript
{ id: string; url: string; title: string; loading: boolean; active: boolean; }
```

**Relevant files:**
- `src/renderer/automation/commands.ts` — `browserGetTabs()` at line ~197
- `src/main/mcp-http-server.ts` — `browser_tabs` tool definition at line ~490

## Implementation Plan

### Step 1 — `commands.ts`: extend `browserGetTabs` to handle actions

File: `src/renderer/automation/commands.ts`

Current (~line 197):
```typescript
async function browserGetTabs(target: IBrowserTarget): Promise<McpResponse> {
    return { result: target.tabs };
}
```

Replace with:
```typescript
async function browserGetTabs(target: IBrowserTarget, params: any): Promise<McpResponse> {
    const action = params?.action ?? "list";

    switch (action) {
        case "list":
            return { result: target.tabs };

        case "new": {
            const newTabId = target.addTab(params?.url);
            // Wait briefly for the new tab to become active and load
            await new Promise(resolve => setTimeout(resolve, 200));
            return { result: target.tabs };
        }

        case "close": {
            const tabs = target.tabs;
            if (params?.index != null) {
                const tab = tabs[params.index];
                if (!tab) return { error: { code: -32602, message: `No tab at index ${params.index}` } };
                target.closeTab(tab.id);
            } else {
                target.closeTab(); // closes active tab
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            return { result: target.tabs };
        }

        case "select": {
            const tabs = target.tabs;
            if (params?.index == null) return { error: { code: -32602, message: "Missing 'index' for action 'select'" } };
            const tab = tabs[params.index];
            if (!tab) return { error: { code: -32602, message: `No tab at index ${params.index}` } };
            target.switchTab(tab.id);
            return { result: target.tabs };
        }

        default:
            return { error: { code: -32602, message: `Unknown action '${action}'. Use: list, new, close, select` } };
    }
}
```

Also update the dispatch call to pass params:
```typescript
case "browser_tabs": return browserGetTabs(target, params);
```

### Step 2 — `mcp-http-server.ts`: update schema

File: `src/main/mcp-http-server.ts`

Find the `browser_tabs` tool definition and replace:

```typescript
server.tool(
    "browser_tabs",
    "Manage browser tabs: list all tabs, open a new tab, close a tab, or switch to a tab.",
    {
        action: z.enum(["list", "new", "close", "select"]).optional()
            .describe("Operation to perform: 'list' (default), 'new', 'close', 'select'."),
        index: z.number().optional()
            .describe("Tab index (0-based) for 'close' or 'select'. If omitted for 'close', closes the active tab."),
        url: z.string().optional()
            .describe("URL to open in the new tab (for 'new' action)."),
        windowIndex: windowIndexParam,
    },
    async ({ action, index, url, windowIndex }) =>
        toToolResult(await sendToRenderer("browser_tabs", { action, index, url }, windowIndex))
);
```

## Concerns

- **New tab timing:** After `addTab()`, a small delay (200ms) is used before returning the tab list so the new tab appears. If the tab isn't visible yet, the list may be stale. May need to poll `target.tabs` until length increases.
- **Tab index stability:** Playwright uses numeric index. Tabs can be reordered. The index maps to `target.tabs[index]` which reflects current order — this should be stable within a single action call.

## Acceptance Criteria

- `{ action: "list" }` returns array of tabs (same as current behavior)
- No `action` param defaults to `"list"` (backward compatible)
- `{ action: "new", url: "https://example.com" }` opens a new tab and returns updated tab list
- `{ action: "close", index: 1 }` closes the tab at index 1
- `{ action: "select", index: 0 }` switches to tab at index 0
- All actions return the updated tab array

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/automation/commands.ts` | Extend `browserGetTabs` with `action` param (list/new/close/select); update dispatch call to pass `params` |
| `src/main/mcp-http-server.ts` | Replace `browser_tabs` schema with action-based interface |
