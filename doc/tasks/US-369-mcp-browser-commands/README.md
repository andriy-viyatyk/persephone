# US-369: MCP Browser Automation Commands (Playwright-compatible)

## Goal

Expose browser automation via MCP tools using **Playwright MCP-compatible tool names** so any AI agent already trained on Playwright MCP works with Persephone out of the box. The MCP tools delegate to `BrowserEditorFacade` methods established in US-365 through US-368.

## Background

### Current MCP architecture

**Tool registration:** `src/main/mcp-http-server.ts` — registers tools with `server.tool(name, description, schema, handler)` using Zod schemas. Each handler calls `sendToRenderer(method, params, windowIndex)`.

**Command dispatch:** `src/renderer/api/mcp-handler.ts` — `handleCommand(method, params)` switch statement routes to implementation functions. Returns `{ result?, error? }`.

**Pattern:** MCP tool → IPC to renderer → handleCommand → implementation → IPC response.

### Playwright MCP tool names

AI agents (Claude, Copilot, Cursor) are trained on these tool names from `@playwright/mcp`:

| Tool | Parameters | Returns |
|------|-----------|---------|
| `browser_navigate` | `url` | Accessibility snapshot |
| `browser_snapshot` | — | Accessibility snapshot (YAML) |
| `browser_click` | `ref?`, `selector?`, `element?` | Accessibility snapshot |
| `browser_type` | `ref?`, `selector?`, `text` | Accessibility snapshot |
| `browser_select_option` | `ref?`, `selector?`, `value` | Accessibility snapshot |
| `browser_press_key` | `key` | Accessibility snapshot |
| `browser_hover` | `ref?`, `selector?` | Accessibility snapshot |
| `browser_take_screenshot` | — | Screenshot image |
| `browser_evaluate` | `expression` | Evaluation result |
| `browser_tabs` | — | Tab list |
| `browser_navigate_back` | — | Accessibility snapshot |
| `browser_handle_dialog` | `action` | — |
| `browser_file_upload` | `selector`, `paths[]` | Accessibility snapshot |
| `browser_close` | — | — |
| `browser_wait_for` | `selector?`, `text?`, `timeout?` | Accessibility snapshot |
| `browser_network_requests` | — | Network log |
| `browser_console_messages` | — | Console log |

**Key pattern:** Most tools return the updated accessibility snapshot after the action. This gives the agent the new page state without a separate snapshot call.

### What we have (from US-365–US-368)

`BrowserEditorFacade` methods: `navigate`, `evaluate`, `getText`, `getValue`, `getAttribute`, `getHtml`, `exists`, `click`, `type`, `select`, `check`, `uncheck`, `clear`, `waitForSelector`, `waitForNavigation`, `wait`, `tabs`, `activeTab`, `addTab`, `closeTab`, `switchTab`, `cdp`.

### What we need for snapshot

US-371 (accessibility snapshot) adds `snapshot()`. For this task, we can either:
- Implement a basic snapshot inline (quick version)
- Wait for US-371 and add snapshot return later

**Recommendation:** Implement a basic inline snapshot for the MCP tools (return accessibility tree as text). Refine it when US-371 is done.

## Implementation Plan

### Step 1: Add browser command handlers in mcp-handler.ts

**File: `src/renderer/api/mcp-handler.ts`**

Add new cases to the `handleCommand` switch:

```typescript
case "browser_navigate":
    return await browserNavigate(params);
case "browser_snapshot":
    return await browserSnapshot(params);
case "browser_click":
    return await browserClick(params);
case "browser_type":
    return await browserType(params);
case "browser_select_option":
    return await browserSelectOption(params);
case "browser_evaluate":
    return await browserEvaluate(params);
case "browser_tabs":
    return await browserTabs(params);
case "browser_navigate_back":
    return await browserNavigateBack(params);
case "browser_wait_for":
    return await browserWaitFor(params);
case "browser_network_requests":
    return await browserNetworkRequests(params);
case "browser_close":
    return await browserClose(params);
```

**Helper to get browser facade:**

```typescript
function getBrowserFacade(): BrowserEditorFacade | null {
    // Find the first browser page
    const pages = pagesModel.state.get().pages;
    const browserPage = pages.find(p => p.mainEditor?.type === "browserPage");
    if (!browserPage?.mainEditor) return null;

    const { BrowserEditorFacade } = require("../scripting/api-wrapper/BrowserEditorFacade");
    const { BrowserEditorModel } = require("../editors/browser/BrowserEditorModel");
    if (browserPage.mainEditor instanceof BrowserEditorModel) {
        return new BrowserEditorFacade(browserPage.mainEditor);
    }
    return null;
}
```

**Basic snapshot helper (until US-371):**

```typescript
async function getBasicSnapshot(facade: BrowserEditorFacade, tabId?: string): Promise<string> {
    const cdp = facade.cdp(tabId);
    const tree = await cdp.send("Accessibility.getFullAXTree");
    const nodes = (tree.nodes || []) as any[];
    const lines: string[] = [];
    for (const n of nodes) {
        if (n.ignored) continue;
        const role = n.role?.value;
        if (!role || role === "none" || role === "generic") continue;
        const name = n.name?.value || "";
        let line = "- " + role;
        if (name) line += ' "' + name.substring(0, 80) + '"';
        if (n.backendDOMNodeId) line += " [ref=e" + n.backendDOMNodeId + "]";
        lines.push(line);
    }
    return lines.join("\n");
}
```

**Command implementations:** Each command gets the facade, performs the action, then returns the snapshot:

```typescript
async function browserNavigate(params: any): Promise<McpResponse> {
    const url = params?.url;
    if (!url) return { error: { code: -32602, message: "Missing 'url' parameter" } };
    const facade = getBrowserFacade();
    if (!facade) return { error: { code: -32602, message: "No browser page open" } };
    facade.navigate(url);
    await facade.waitForNavigation({ timeout: 10000 }).catch(() => {});
    return { result: await getBasicSnapshot(facade) };
}

async function browserClick(params: any): Promise<McpResponse> {
    const selector = params?.selector || params?.ref;
    if (!selector) return { error: { code: -32602, message: "Missing 'selector' or 'ref' parameter" } };
    const facade = getBrowserFacade();
    if (!facade) return { error: { code: -32602, message: "No browser page open" } };
    await facade.click(selector);
    return { result: await getBasicSnapshot(facade) };
}
// ... similar pattern for other commands
```

### Step 2: Register MCP tools in mcp-http-server.ts

**File: `src/main/mcp-http-server.ts`**

Register each tool with Playwright-compatible names and parameter schemas:

```typescript
// ── Browser automation tools (Playwright-compatible) ─────────────

server.tool(
    "browser_navigate",
    "Navigate the browser to a URL. Returns the page accessibility snapshot.",
    {
        url: z.string().describe("URL to navigate to."),
        windowIndex: windowIndexParam,
    },
    async ({ url, windowIndex }) =>
        toToolResult(await sendToRenderer("browser_navigate", { url }, windowIndex)),
);

server.tool(
    "browser_snapshot",
    "Get the accessibility snapshot of the current page. Returns a YAML-like tree of elements with roles, names, and ref IDs for interaction.",
    {
        windowIndex: windowIndexParam,
    },
    async ({ windowIndex }) =>
        toToolResult(await sendToRenderer("browser_snapshot", {}, windowIndex)),
);

server.tool(
    "browser_click",
    "Click an element on the page. Returns updated accessibility snapshot.",
    {
        selector: z.string().optional().describe("CSS selector for the target element."),
        ref: z.string().optional().describe("Element ref from accessibility snapshot (e.g., 'e52')."),
        windowIndex: windowIndexParam,
    },
    async ({ selector, ref, windowIndex }) =>
        toToolResult(await sendToRenderer("browser_click", { selector, ref }, windowIndex)),
);

// ... similar for browser_type, browser_select_option, browser_evaluate,
// browser_tabs, browser_navigate_back, browser_wait_for,
// browser_network_requests, browser_close
```

### Step 3: Handle `ref` parameter

Playwright MCP uses `ref=e52` to target elements from the snapshot. The `ref` maps to `backendDOMNodeId` from CDP. To click by ref:

```typescript
if (params?.ref) {
    // ref format: "e52" → backendDOMNodeId = 52
    const nodeId = parseInt(params.ref.replace(/^e/, ""), 10);
    // Resolve to a JS handle via CDP and click it
    await facade.evaluate(`(() => {
        // Use TreeWalker to find element by backendDOMNodeId
        // This is a simplification — backendDOMNodeId maps to internal Chromium node IDs
        // For now, fall back to the snapshot-provided ref as a data attribute
    })()`);
}
```

**Note:** Mapping `backendDOMNodeId` back to a clickable element requires CDP `DOM.resolveNode`. This is complex. For Phase 1, support `selector` parameter only. Add `ref` support in US-371 when the snapshot system is mature.

## Tools to Implement

All tools in one phase. US-371 (snapshot) and CDP infrastructure make everything available now.

| Tool | Implementation | Notes |
|------|---------------|-------|
| `browser_navigate` | `navigate()` + `waitForNavigation()` + `snapshot()` | Auto-wait, return snapshot |
| `browser_snapshot` | `snapshot()` | Already done (US-371) |
| `browser_click` | `click(selector)` or CDP ref resolution + `snapshot()` | Supports selector and ref |
| `browser_type` | `type(selector, text)` + `snapshot()` | |
| `browser_select_option` | `select(selector, value)` + `snapshot()` | |
| `browser_press_key` | CDP `Input.dispatchKeyEvent` + `snapshot()` | Via CdpSession.send() |
| `browser_evaluate` | `evaluate(expression)` | Returns eval result, not snapshot |
| `browser_tabs` | `tabs` getter | Returns tab list |
| `browser_navigate_back` | `back()` + `waitForNavigation()` + `snapshot()` | |
| `browser_wait_for` | `waitForSelector(selector)` + `snapshot()` | |
| `browser_take_screenshot` | CDP `Page.captureScreenshot` | Returns base64 image |
| `browser_network_requests` | IPC `getNetworkLog` (US-362) | Returns network log |
| `browser_close` | `closeTab()` | |

### `ref` parameter support

Use CDP `DOM.resolveNode` to map `backendDOMNodeId` to a remote JS object, then call functions on it:

```typescript
// ref="e52" → backendDOMNodeId=52
const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: 52 });
// object.objectId is a RemoteObjectId — use Runtime.callFunctionOn to click it
await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: "function() { this.scrollIntoView({block:'center'}); this.click(); }",
});
```

All interaction tools (`browser_click`, `browser_type`, `browser_select_option`) accept both `selector` and `ref`.

### Deferred (out of scope):

| Tool | Reason |
|------|--------|
| `browser_hover` | Needs element coordinates + `Input.dispatchMouseEvent` — fragile |
| `browser_drag` | Complex multi-step mouse events |
| `browser_handle_dialog` | Needs dialog event subscription infrastructure |
| `browser_file_upload` | Complex file input handling via CDP `DOM.setFileInputFiles` |
| `browser_resize` | Needs window/webview size management |

## Files Changed

| File | Change |
|------|--------|
| `src/main/mcp-http-server.ts` | Register ~10 browser automation tools |
| `src/renderer/api/mcp-handler.ts` | Add ~10 command handlers + `getBrowserFacade()` helper |

### Files NOT changed

- `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` — all methods already exist
- `src/renderer/editors/browser/CdpSession.ts` — already supports all needed operations
- `src/main/cdp-service.ts` — no changes needed

## Acceptance Criteria

- [ ] `browser_navigate(url)` navigates and returns snapshot
- [ ] `browser_snapshot()` returns accessibility tree as text
- [ ] `browser_click(selector/ref)` clicks and returns snapshot — supports both CSS selector and ref
- [ ] `browser_type(selector/ref, text)` types and returns snapshot
- [ ] `browser_select_option(selector/ref, value)` selects and returns snapshot
- [ ] `browser_press_key(key)` dispatches key event and returns snapshot
- [ ] `browser_evaluate(expression)` returns evaluation result
- [ ] `browser_tabs()` returns tab list
- [ ] `browser_navigate_back()` goes back and returns snapshot
- [ ] `browser_wait_for(selector, timeout?)` waits for element and returns snapshot
- [ ] `browser_take_screenshot()` returns base64 screenshot
- [ ] `browser_network_requests()` returns network log
- [ ] `browser_close()` closes the active tab
- [ ] `ref` parameter works for click, type, select_option (via DOM.resolveNode)
- [ ] AI agent can use these tools without reading Persephone documentation
- [ ] Tool names match Playwright MCP for compatibility
