# US-381: Fix `browser_wait_for` — add `time` and `textGone` params (Playwright compatibility)

## Goal

Playwright MCP's `browser_wait_for` supports three modes: wait for text to appear (`text`), wait for text to disappear (`textGone`), and wait a fixed amount of time (`time` in seconds). Persephone only has `text` and `selector`. Add the missing two modes.

## Background

Playwright MCP spec:
```json
{ "time": 2 }              // wait 2 seconds
{ "textGone": "Loading" }  // wait until "Loading" disappears
{ "text": "Done" }         // wait until "Done" appears (already works)
```

Persephone current (supported):
```json
{ "text": "Done" }         // ✅ works
{ "selector": ".btn" }     // ✅ works (not in Playwright but useful)
{ "timeout": 5000 }        // ✅ works (ms, not in Playwright)
```

Missing: `time` (seconds sleep) and `textGone` (wait for disappearance).

**Relevant files:**
- `src/renderer/automation/commands.ts` — `browserWaitFor()` at line ~234
- `src/main/mcp-http-server.ts` — `browser_wait_for` tool definition at line ~505

## Implementation Plan

### Step 1 — `commands.ts`: add `time` and `textGone` branches

File: `src/renderer/automation/commands.ts`

Current `browserWaitFor` (~line 234) handles `selector` and `text`. Add two new branches:

```typescript
async function browserWaitFor(target: IBrowserTarget, params: any): Promise<McpResponse> {
    const selector = params?.selector;
    const text = params?.text;
    const textGone = params?.textGone;
    const time = params?.time;           // seconds (Playwright style)
    const timeout = params?.timeout ?? 30000;

    if (time != null) {
        // Wait a fixed number of seconds
        await new Promise(resolve => setTimeout(resolve, Math.round(time * 1000)));
    } else if (selector) {
        // existing selector logic — unchanged
        const s = JSON.stringify(selector);
        await target.cdp().evaluate(`new Promise((resolve, reject) => {
            if (document.querySelector(${s})) { resolve(true); return; }
            const start = Date.now();
            const check = () => {
                if (document.querySelector(${s})) { resolve(true); return; }
                if (Date.now() - start > ${timeout}) {
                    reject(new Error('Timeout waiting for selector: ' + ${s}));
                    return;
                }
                requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        })`);
    } else if (text) {
        // existing text logic — unchanged
        await target.cdp().evaluate(`new Promise((resolve, reject) => {
            const check = () => {
                if (document.body?.innerText?.includes(${JSON.stringify(text)})) { resolve(true); return; }
                if (Date.now() - start > ${timeout}) {
                    reject(new Error('Timeout waiting for text: ${text.replace(/"/g, '\\"')}'));
                    return;
                }
                requestAnimationFrame(check);
            };
            const start = Date.now();
            check();
        })`);
    } else if (textGone != null) {
        // NEW: wait until textGone is no longer on the page
        await target.cdp().evaluate(`new Promise((resolve, reject) => {
            const check = () => {
                if (!document.body?.innerText?.includes(${JSON.stringify(textGone)})) { resolve(true); return; }
                if (Date.now() - start > ${timeout}) {
                    reject(new Error('Timeout waiting for text to disappear: ${textGone.replace(/"/g, '\\"')}'));
                    return;
                }
                requestAnimationFrame(check);
            };
            const start = Date.now();
            check();
        })`);
    } else {
        return { error: { code: -32602, message: "Missing 'selector', 'text', 'textGone', or 'time' parameter" } };
    }

    return { result: await snapshot(target) };
}
```

**Note on `time`:** Playwright's `time` is in **seconds** (e.g. `{ time: 2 }` = 2 seconds). Our existing `timeout` is in ms. The `time` sleep happens in the Node.js process (not CDP evaluate), so we use `setTimeout` directly.

### Step 2 — `mcp-http-server.ts`: add `time` and `textGone` to schema

File: `src/main/mcp-http-server.ts`

Find the `browser_wait_for` tool definition. Add the two new params:

```typescript
server.tool(
    "browser_wait_for",
    "Wait for an element or text to appear/disappear, or wait a fixed time.",
    {
        selector: z.string().optional().describe("CSS selector to wait for."),
        text: z.string().optional().describe("Text content to wait for on the page."),
        textGone: z.string().optional().describe("Wait until this text is no longer visible on the page (Playwright-compatible)."),
        time: z.number().optional().describe("Time to wait in seconds (Playwright-compatible). E.g. 2 = 2 seconds."),
        timeout: z.number().optional().describe("Max wait time in ms (default 30000). Applies to selector/text/textGone modes."),
        windowIndex: windowIndexParam,
    },
    async ({ selector, text, textGone, time, timeout, windowIndex }) =>
        toToolResult(await sendToRenderer("browser_wait_for", { selector, text, textGone, time, timeout }, windowIndex))
);
```

## Acceptance Criteria

- `{ time: 1.5 }` waits ~1500ms then returns snapshot
- `{ textGone: "Loading..." }` waits until "Loading..." disappears from the page
- `{ text: "Done" }` still works (no regression)
- `{ selector: ".btn" }` still works (no regression)
- Timeout applies to `text` and `textGone` modes; `time` mode doesn't need a timeout

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/automation/commands.ts` | Add `time` (setTimeout) and `textGone` branches to `browserWaitFor` |
| `src/main/mcp-http-server.ts` | Add `time` and `textGone` params to `browser_wait_for` schema |
