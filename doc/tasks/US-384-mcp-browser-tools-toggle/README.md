# US-384: MCP browser tools toggle (optional Playwright tools)

## Goal

Add a settings checkbox "Enable browser interaction (reconnect needed)" that controls whether the 13 Playwright-compatible `browser_*` MCP tools are registered and available to AI agents. When disabled, the tools do not appear in the MCP `tools/list` response **and are fully blocked** — even if an agent makes direct HTTP calls to the MCP endpoint bypassing the tool list.

## Background

The MCP server is implemented in `src/main/mcp-http-server.ts`. On every new MCP client connection (HTTP `initialize` request), `createMcpServer()` is called (line 681) to build a fresh `McpServer` instance with all tools registered. This is where we can conditionally skip the 13 browser tools.

**Setting system:**
- All settings defined in `src/renderer/api/settings.ts` — `AppSettingKey` union type (line 32) + `settingDescriptions` (line 58) + `defaultSettings` (line 79).
- Renderer reads settings via `settings.use("key")` (reactive hook) or `settings.get("key")`.
- Renderer communicates to main via IPC. The pattern for `mcp.enabled`:
  - `app.ts:247` watches `settings.onChanged`, calls `api.setMcpEnabled(value)` on change
  - `src/ipc/renderer/api.ts:211` — renderer IPC call
  - `src/ipc/api-types.ts:51` — `Endpoint.setMcpEnabled` enum entry
  - `src/ipc/api-types.ts:107` — `Api` interface entry
  - `src/ipc/main/controller.ts:193` — main handler calls `startMcpHttpServer` / `stopMcpHttpServer`
  - `src/ipc/main/controller.ts:269` — binds the endpoint

**MCP HTTP server internal state:**
- `mcp-http-server.ts` already has module-level state (e.g., `currentPort`, `sessions`).
- We add: `let browserToolsEnabled = true` as module-level state.
- Export: `setBrowserToolsEnabled(enabled: boolean)` — updates the variable (no server restart needed).
- `createMcpServer()` reads `browserToolsEnabled` and conditionally skips the 13 browser tool registrations.

**The 13 browser tools (all in `createMcpServer()`, lines ~404–564):**
`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_select_option`, `browser_press_key`, `browser_evaluate`, `browser_tabs`, `browser_navigate_back`, `browser_wait_for`, `browser_take_screenshot`, `browser_network_requests`, `browser_close`

**Settings UI:**
- `McpSection` component: `src/renderer/editors/settings/SettingsPage.tsx:1066`
- "Enable MCP server" checkbox: line 1130, setting key `"mcp.enabled"`
- New checkbox goes immediately after, same pattern.

## Implementation Plan

### Step 1 — Add setting key to `src/renderer/api/settings.ts`

**Add to `AppSettingKey` union (after `"mcp.port"`, around line 34):**
```typescript
| "mcp.browser-tools.enabled"
```

**Add to `settingDescriptions` (after `"mcp.port"` entry):**
```typescript
"mcp.browser-tools.enabled": "Allow AI agents to control the built-in browser.\nWhen enabled, browser_* MCP tools are available (reconnect agent to apply changes).",
```

**Add to `defaultSettings` (after `"mcp.port"` entry):**
```typescript
"mcp.browser-tools.enabled": true,
```

---

### Step 2 — Add IPC endpoint to `src/ipc/api-types.ts`

**Add to `Endpoint` enum (after `setMcpEnabled` at line 51):**
```typescript
setBrowserToolsEnabled = "setBrowserToolsEnabled",
```

**Add to `Api` interface (after line 107):**
```typescript
[Endpoint.setBrowserToolsEnabled]: (enabled: boolean) => Promise<void>;
```

---

### Step 3 — Add renderer IPC call to `src/ipc/renderer/api.ts`

**Add after `setMcpEnabled` (after line 213):**
```typescript
setBrowserToolsEnabled = async (enabled: boolean) => {
    return executeOnce<void>(Endpoint.setBrowserToolsEnabled, enabled);
}
```

---

### Step 4 — Add main-process handler and binding to `src/ipc/main/controller.ts`

**Add handler in `Controller` class (after `setMcpEnabled` handler, after line 199):**
```typescript
setBrowserToolsEnabled = async (event: IpcMainEvent, enabled: boolean): Promise<void> => {
    const { setBrowserToolsEnabled } = await import("../../main/mcp-http-server");
    setBrowserToolsEnabled(enabled);
}
```

**Add binding (after line 269):**
```typescript
bindEndpoint(Endpoint.setBrowserToolsEnabled, controllerInstance.setBrowserToolsEnabled);
```

---

### Step 5 — Update `src/main/mcp-http-server.ts`

**Add module-level variable (near other module-level state, e.g., after `currentPort`):**
```typescript
let browserToolsEnabled = true;
```

**Export setter function (near `startMcpHttpServer` / `stopMcpHttpServer` exports):**
```typescript
export function setBrowserToolsEnabled(enabled: boolean): void {
    browserToolsEnabled = enabled;
}
```

**Wrap the 13 browser tool registrations in `createMcpServer()` with a conditional block:**

The 13 tools span roughly lines 404–564. Wrap them:
```typescript
if (browserToolsEnabled) {
    server.tool("browser_navigate", ...) 
    // ... all 13 browser_* tools ...
    server.tool("browser_close", ...)
}
```

All 13 tools are adjacent in the function — this is a single `if` block wrapping them all.

---

### Step 6 — Watch setting changes in `src/renderer/api/app.ts`

**Extend the `onChanged` subscription (lines 246–251) to also watch `mcp.browser-tools.enabled`:**

```typescript
// Before (lines 246–251):
this._settings.onChanged.subscribe(({ key, value }) => {
    if (key === "mcp.enabled") {
        const port = this._settings.get("mcp.port") as number | undefined;
        api.setMcpEnabled(!!value, port || undefined);
    }
});

// After:
this._settings.onChanged.subscribe(({ key, value }) => {
    if (key === "mcp.enabled") {
        const port = this._settings.get("mcp.port") as number | undefined;
        api.setMcpEnabled(!!value, port || undefined);
    }
    if (key === "mcp.browser-tools.enabled") {
        api.setBrowserToolsEnabled(!!value);
    }
});
```

**Also send the initial value on startup (after the `setMcpEnabled` call, around line 233):**
```typescript
const browserToolsEnabled = this._settings.get("mcp.browser-tools.enabled");
api.setBrowserToolsEnabled(browserToolsEnabled !== false); // default true
```

---

### Step 7 — Add checkbox to `src/renderer/editors/settings/SettingsPage.tsx`

**Add setting read at top of `McpSection` (after line 1068):**
```typescript
const browserToolsEnabled = settings.use("mcp.browser-tools.enabled");
```

**Add handler:**
```typescript
const handleBrowserToolsToggle = () => {
    settings.set("mcp.browser-tools.enabled", !browserToolsEnabled);
};
```

**Add checkbox after the "Enable MCP server" row (after line 1134):**
```tsx
<div className="mcp-toggle-row">
    <input
        type="checkbox"
        checked={browserToolsEnabled !== false}
        onChange={handleBrowserToolsToggle}
        id="mcp-browser-tools-enabled"
    />
    <label htmlFor="mcp-browser-tools-enabled" className="mcp-toggle-label">
        Enable browser interaction (reconnect needed)
    </label>
</div>
```

Note: `checked={browserToolsEnabled !== false}` handles the `undefined` case (setting not yet in stored config) as `true` (the default).

## Concerns / Open Questions

- **Should the checkbox be disabled when MCP is off?** If `mcp.enabled` is false, the browser tools checkbox has no effect. We could disable it (grey it out) when `mcpEnabled` is false, matching typical settings UX. Easy to add with `disabled={!mcpEnabled}`.

- **Default value:** Default is `true` (browser tools enabled) to preserve existing behavior for users who upgrade from 3.0.1.

### Step 8 — Add renderer guard in `src/renderer/automation/commands.ts`

Add a check at the top of `handleBrowserCommand()` (before `getTarget()`), so that even a direct HTTP call to the MCP endpoint is blocked when the setting is disabled:

**Before (lines 372–374):**
```typescript
export async function handleBrowserCommand(
    command: string,
    params: any,
): Promise<McpResponse> {
    const target = await getTarget();
    if ("error" in target) return target;
```

**After:**
```typescript
export async function handleBrowserCommand(
    command: string,
    params: any,
): Promise<McpResponse> {
    const { settings } = await import("../api/settings");
    if (settings.get("mcp.browser-tools.enabled") === false) {
        return { error: { code: -32602, message: "Browser interaction is disabled. Enable it in Settings → MCP Server → 'Enable browser interaction'." } };
    }
    const target = await getTarget();
    if ("error" in target) return target;
```

Note: `=== false` (not `!value`) so that `undefined` (setting not yet stored) is treated as enabled — matching the default of `true`.

## Acceptance Criteria

- Settings page shows "Enable browser interaction (reconnect needed)" checkbox below "Enable MCP server"
- When unchecked: `browser_*` tools do NOT appear in the MCP tools list for new connections
- When unchecked: direct HTTP calls to `browser_*` tools return a descriptive "disabled" error regardless of session
- When checked: `browser_*` tools appear and work as before
- Changing the setting and reconnecting the MCP client reflects the new state
- Default is `true` — existing behavior unchanged on upgrade

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/settings.ts` | Add `"mcp.browser-tools.enabled"` key, description, default (`true`) |
| `src/ipc/api-types.ts` | Add `setBrowserToolsEnabled` endpoint enum + `Api` interface entry |
| `src/ipc/renderer/api.ts` | Add `setBrowserToolsEnabled` IPC call |
| `src/ipc/main/controller.ts` | Add `setBrowserToolsEnabled` handler + binding |
| `src/main/mcp-http-server.ts` | Add `browserToolsEnabled` var, `setBrowserToolsEnabled()` export, conditional wrap of 13 browser tools in `createMcpServer()` |
| `src/renderer/api/app.ts` | Watch `mcp.browser-tools.enabled` changes + send initial value on startup |
| `src/renderer/editors/settings/SettingsPage.tsx` | Add checkbox + handler in `McpSection` |
| `src/renderer/automation/commands.ts` | Add guard at top of `handleBrowserCommand()` — blocks disabled calls from any source |
