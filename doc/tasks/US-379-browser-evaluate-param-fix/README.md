# US-379: Fix `browser_evaluate` — accept `function` param (Playwright compatibility)

## Goal

Playwright MCP uses `function` as the parameter name for `browser_evaluate`. Persephone uses `expression`. An AI agent trained on Playwright will pass `function: "() => document.title"` and get no result. Fix by accepting both names.

## Background

Playwright MCP spec:
```json
{ "function": "() => document.title" }
```

Persephone current:
```json
{ "expression": "document.title" }
```

The fix is a one-line fallback in the handler and a schema addition in the tool registration.

**Relevant files:**
- `src/renderer/automation/commands.ts` — `browserEvaluate()` at line ~190
- `src/main/mcp-http-server.ts` — `browser_evaluate` tool definition at line ~480

## Implementation Plan

### Step 1 — `commands.ts`: accept both param names

File: `src/renderer/automation/commands.ts`

Current code (~line 190):
```typescript
async function browserEvaluate(target: IBrowserTarget, params: any): Promise<McpResponse> {
    const expression = params?.expression;
    if (!expression) return { error: { code: -32602, message: "Missing 'expression' parameter" } };
    const value = await target.cdp().evaluate(expression);
    return { result: value };
}
```

Change to:
```typescript
async function browserEvaluate(target: IBrowserTarget, params: any): Promise<McpResponse> {
    const expression = params?.expression ?? params?.function;
    if (!expression) return { error: { code: -32602, message: "Missing 'expression' or 'function' parameter" } };
    const value = await target.cdp().evaluate(expression);
    return { result: value };
}
```

**Note on Playwright's `function` format:** Playwright passes a full function string like `"() => document.title"`. Our `cdp.evaluate()` wraps the expression with `(async () => ...)` internally. A bare function expression `() => ...` would just return the function — not call it. We should detect and auto-call it:

```typescript
async function browserEvaluate(target: IBrowserTarget, params: any): Promise<McpResponse> {
    let expression = params?.expression ?? params?.function;
    if (!expression) return { error: { code: -32602, message: "Missing 'expression' or 'function' parameter" } };
    // If the value looks like a function expression (Playwright style), auto-invoke it
    if (/^\s*(async\s+)?\(/.test(expression) || /^\s*(async\s+)?function/.test(expression)) {
        expression = `(${expression})()`;
    }
    const value = await target.cdp().evaluate(expression);
    return { result: value };
}
```

### Step 2 — `mcp-http-server.ts`: add `function` to schema

File: `src/main/mcp-http-server.ts`

Find the `browser_evaluate` tool definition. Add `function` as an optional param alongside `expression`:

```typescript
server.tool(
    "browser_evaluate",
    "Run JavaScript in the browser page and return the result. Supports async expressions.",
    {
        expression: z.string().optional().describe("JavaScript expression to evaluate in the page."),
        function: z.string().optional().describe("JavaScript function to call, e.g. '() => document.title'. Playwright-compatible alias for 'expression'."),
        windowIndex: windowIndexParam,
    },
    async ({ expression, function: fn, windowIndex }) =>
        toToolResult(await sendToRenderer("browser_evaluate", { expression, function: fn }, windowIndex))
);
```

Note: `function` is a reserved word in JS — use destructuring alias `function: fn`.

## Acceptance Criteria

- `browser_evaluate` with `{ function: "() => document.title" }` returns the page title
- `browser_evaluate` with `{ expression: "document.title" }` still works (no regression)
- Function-style strings are auto-invoked (not returned as function objects)

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/automation/commands.ts` | Accept `params.function` as alias; auto-invoke function expressions |
| `src/main/mcp-http-server.ts` | Add `function` param to `browser_evaluate` schema |
