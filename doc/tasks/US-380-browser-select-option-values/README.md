# US-380: Fix `browser_select_option` — accept `values` array (Playwright compatibility)

## Goal

Playwright MCP uses `values` (an array) for `browser_select_option`. Persephone uses `value` (a string). An AI agent trained on Playwright will pass `values: ["option1"]` and silently select nothing. Fix by accepting both.

## Background

Playwright MCP spec:
```json
{ "ref": "e42", "values": ["optionValue"] }
```

Persephone current:
```json
{ "ref": "e42", "value": "optionValue" }
```

Playwright uses an array to support multi-select dropdowns. For now Persephone only supports single-select, so we take `values[0]` when an array is passed.

**Relevant files:**
- `src/renderer/automation/commands.ts` — `browserSelectOption()` at line ~161
- `src/main/mcp-http-server.ts` — `browser_select_option` tool definition at line ~455

## Implementation Plan

### Step 1 — `commands.ts`: accept both param names

File: `src/renderer/automation/commands.ts`

Current code (~line 161):
```typescript
async function browserSelectOption(target: IBrowserTarget, params: any): Promise<McpResponse> {
    const value = params?.value;
    if (value == null) return { error: { code: -32602, message: "Missing 'value' parameter" } };
    ...
```

Change to:
```typescript
async function browserSelectOption(target: IBrowserTarget, params: any): Promise<McpResponse> {
    // Accept Playwright-style `values` array or our own `value` string
    const value = params?.value ?? (Array.isArray(params?.values) ? params.values[0] : params?.values);
    if (value == null) return { error: { code: -32602, message: "Missing 'value' or 'values' parameter" } };
    ...
```

The rest of the function stays unchanged.

### Step 2 — `mcp-http-server.ts`: add `values` to schema

File: `src/main/mcp-http-server.ts`

Find the `browser_select_option` tool definition. Add `values` alongside `value`:

```typescript
server.tool(
    "browser_select_option",
    "Select an option in a <select> element by value. Returns updated accessibility snapshot.",
    {
        selector: z.string().optional().describe("CSS selector for the <select> element."),
        ref: z.string().optional().describe("Element ref from accessibility snapshot."),
        value: z.string().optional().describe("Option value to select."),
        values: z.array(z.string()).optional().describe("Array of option values to select (Playwright-compatible). First value is used for single-select."),
        windowIndex: windowIndexParam,
    },
    async ({ selector, ref, value, values, windowIndex }) =>
        toToolResult(await sendToRenderer("browser_select_option", { selector, ref, value, values }, windowIndex))
);
```

## Acceptance Criteria

- `browser_select_option` with `{ ref: "e42", values: ["optionA"] }` selects "optionA"
- `browser_select_option` with `{ ref: "e42", value: "optionA" }` still works (no regression)
- If both are passed, `value` takes precedence

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/automation/commands.ts` | Accept `params.values` array as alias for `params.value` |
| `src/main/mcp-http-server.ts` | Add `values` param to `browser_select_option` schema |
