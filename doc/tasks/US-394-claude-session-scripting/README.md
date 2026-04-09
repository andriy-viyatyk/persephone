# US-394: ClaudeSession Helper Class for Scripting

## Goal

Add a `ClaudeSession` class to Persephone's scripting environment that wraps the `@anthropic-ai/sdk` and simplifies multi-turn conversations with Claude. Scripts can create a session, define tools with lifecycle hooks, subscribe to events, and send messages — all without manually managing the message array or tool-call loop.

## Background

### Why raw SDK, not Agent SDK?

EPIC-014 (Claude AI Chat Panel) uses `@anthropic-ai/claude-agent-sdk` for a full-featured agent with MCP tools. This task is different: it exposes the **raw `@anthropic-ai/sdk`** to scripts for custom Claude API interactions. The raw SDK gives scripts fine-grained control over messages, tools, and responses — ideal for data transformation, automation, and experimentation.

### Existing patterns to follow

| Pattern | File | What to reuse |
|---------|------|---------------|
| Namespace factory | [IoNamespace.ts](../../../src/renderer/scripting/api-wrapper/IoNamespace.ts) | `createIoNamespace()` → return object with constructors |
| Script context injection | [ScriptContext.ts:59-62](../../../src/renderer/scripting/ScriptContext.ts) | Add `readonly ai = createAiNamespace();` |
| Script prefix | [ScriptRunnerBase.ts:11-15](../../../src/renderer/scripting/ScriptRunnerBase.ts) | Add `ai=this.ai` to SCRIPT_PREFIX |
| Library module context | [library-require.ts:15-20](../../../src/renderer/scripting/library-require.ts) | Add `ai=__ctx?.ai` to MODULE_CONTEXT_PREFIX |
| Type definitions | [io.d.ts](../../../src/renderer/api/types/io.d.ts) | Interface pattern for constructors and namespace |
| Global declaration | [index.d.ts](../../../src/renderer/api/types/index.d.ts) | `declare global { const ai: IAiNamespace; }` |
| Lazy SDK loading | [McpConnectionManager.ts:34-48](../../../src/renderer/editors/mcp-inspector/McpConnectionManager.ts) | `let Anthropic; function loadSdk() { Anthropic = require("@anthropic-ai/sdk"); }` |

### SDK basics

The `@anthropic-ai/sdk` `messages.create()` returns a response with `stop_reason`:
- `"end_turn"` — Claude finished responding
- `"tool_use"` — Claude wants to call a tool (response contains `tool_use` content blocks)
- `"max_tokens"` — hit token limit

The tool loop: call API → check for `tool_use` blocks → execute tools → append results → call API again → repeat until `end_turn`.

### Namespace naming: `ai` not `claude`

Using `ai` as the namespace name (not `claude`) because:
- More generic — could support other providers in the future
- Shorter to type in scripts: `new ai.ClaudeSession()` vs `new claude.Session()`
- Consistent with industry naming (Vercel AI SDK uses `ai`)

## Implementation Plan

### Step 1: Install `@anthropic-ai/sdk`

```bash
npm install @anthropic-ai/sdk
```

The package will be available via `require()` at runtime (same as `@modelcontextprotocol/sdk`). No Vite config changes needed — Electron's `nodeIntegration: true` provides real `require()`.

### Step 2: Create `ClaudeSession` class

**File (new):** `src/renderer/scripting/api-wrapper/ClaudeSession.ts`

This is the core implementation. Key design:

```typescript
// Lazy-load SDK
let Anthropic: any;
function loadSdk(): void {
    if (Anthropic) return;
    Anthropic = require("@anthropic-ai/sdk").default;
}
```

#### ClaudeSession class structure

```typescript
export interface ClaudeToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, any>;  // JSON Schema for tool parameters
    tool: (input: any) => any | Promise<any>;  // The function to execute
}

export type ClaudeSessionEvent =
    | "message"          // Any new message added to history
    | "user-message"     // User message added
    | "assistant-message" // Assistant response received
    | "tool-call"        // Claude requested a tool call
    | "tool-result"      // Tool execution completed
    | "error";           // Error occurred

type EventCallback = (...args: any[]) => void;

export class ClaudeSession {
    private client: any;  // Anthropic client instance
    private _messages: Array<{ role: string; content: any }> = [];
    private _systemMessage: string | undefined;
    private _tools: ClaudeToolDef[] = [];
    private _listeners = new Map<ClaudeSessionEvent, Set<EventCallback>>();

    readonly modelId: string;
    readonly maxTokens: number;
    readonly temperature: number | undefined;

    constructor(config: {
        apiKey: string;
        modelId?: string;
        maxTokens?: number;
        temperature?: number;
    }) {
        loadSdk();
        if (!config.apiKey) {
            throw new Error("Anthropic API key is required. Pass apiKey in the constructor config.");
        }
        this.client = new Anthropic({ apiKey: config.apiKey });
        this.modelId = config?.modelId || "claude-sonnet-4-5-20250514";
        this.maxTokens = config?.maxTokens || 4096;
        this.temperature = config?.temperature;
    }

    // --- Messages ---

    get messages() { return [...this._messages]; }

    systemMessage(text: string): void {
        this._systemMessage = text;
    }

    userMessage(text: string): void {
        this._messages.push({ role: "user", content: text });
        this.emit("user-message", text);
        this.emit("message", { role: "user", content: text });
    }

    // --- Tools ---

    set tools(defs: ClaudeToolDef[]) { this._tools = defs; }
    get tools() { return this._tools; }

    // --- Events ---

    on(event: ClaudeSessionEvent, callback: EventCallback): () => void {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event)!.add(callback);
        return () => this._listeners.get(event)?.delete(callback);  // unsubscribe fn
    }

    private emit(event: ClaudeSessionEvent, ...args: any[]) {
        this._listeners.get(event)?.forEach(cb => {
            try { cb(...args); } catch (e) { console.error(`ClaudeSession event error:`, e); }
        });
    }

    // --- Send to Claude ---

    async send(options?: {
        toolChoice?: "auto" | "any" | string;  // "auto", "any", or tool name
    }): Promise<string> {
        // Build API tools array from tool defs
        const apiTools = this._tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
        }));

        // Resolve toolChoice shorthand to API format
        const resolveToolChoice = (choice?: string) => {
            if (!choice || choice === "auto") return { type: "auto" };
            if (choice === "any") return { type: "any" };
            return { type: "tool", name: choice };  // specific tool name
        };

        // Build request options
        const reqOptions: any = {
            model: this.modelId,
            max_tokens: this.maxTokens,
            messages: this._messages,
        };
        if (this._systemMessage) reqOptions.system = this._systemMessage;
        if (this.temperature !== undefined) reqOptions.temperature = this.temperature;
        if (apiTools.length > 0) {
            reqOptions.tools = apiTools;
            if (options?.toolChoice) reqOptions.tool_choice = resolveToolChoice(options.toolChoice);
        }

        // Tool loop
        while (true) {
            const response = await this.client.messages.create(reqOptions);

            // Add assistant response to message history
            this._messages.push({ role: "assistant", content: response.content });
            this.emit("assistant-message", response);
            this.emit("message", { role: "assistant", content: response.content });

            if (response.stop_reason === "tool_use") {
                // Execute tool calls
                const toolResults: any[] = [];
                for (const block of response.content) {
                    if (block.type !== "tool_use") continue;

                    const toolDef = this._tools.find(t => t.name === block.name);
                    this.emit("tool-call", block.name, block.input);

                    let result: any;
                    let isError = false;
                    try {
                        if (toolDef) {
                            result = await toolDef.tool(block.input);
                        } else {
                            result = `Unknown tool: ${block.name}`;
                            isError = true;
                        }
                    } catch (err: any) {
                        result = err.message || String(err);
                        isError = true;
                    }

                    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
                    this.emit("tool-result", block.name, block.input, resultStr, isError);

                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: block.id,
                        content: resultStr,
                        ...(isError ? { is_error: true } : {}),
                    });
                }

                // Add tool results as a user message
                this._messages.push({ role: "user", content: toolResults });
                reqOptions.messages = this._messages;

            } else {
                // end_turn or max_tokens — extract text and return
                const textBlocks = response.content.filter((b: any) => b.type === "text");
                return textBlocks.map((b: any) => b.text).join("");
            }
        }
    }

    // --- Convenience ---

    /** Clear all messages. Keeps system message and tools. */
    clear(): void {
        this._messages = [];
    }

    /** Get the last assistant text response. */
    get lastResponse(): string | undefined {
        for (let i = this._messages.length - 1; i >= 0; i--) {
            const msg = this._messages[i];
            if (msg.role === "assistant" && Array.isArray(msg.content)) {
                const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
                if (text) return text;
            }
        }
        return undefined;
    }
}
```

#### Key design decisions

1. **`send()` does the tool loop internally** — keeps calling the API until `end_turn`. The script author doesn't need to manage the loop.
2. **Events fire during the loop** — `on("tool-call")` and `on("tool-result")` let scripts observe what's happening in real-time.
3. **`toolChoice` on `send()`** — controls whether Claude must use tools (`"any"`), a specific tool (`"tool_name"`), or decides itself (`"auto"`). Maps to the API's `tool_choice` parameter.
4. **`messages` getter returns a copy** — prevents external mutation of internal state.

### Step 3: Create the `ai` namespace factory

**File (new):** `src/renderer/scripting/api-wrapper/AiNamespace.ts`

```typescript
import { ClaudeSession } from "./ClaudeSession";

export function createAiNamespace() {
    return {
        ClaudeSession,
    };
}
```

### Step 4: Inject `ai` into script context

**File:** `src/renderer/scripting/ScriptContext.ts`

Add import (after line 12):
```typescript
import { createAiNamespace } from "./api-wrapper/AiNamespace";
```

Add property (after line 62, after `io`):
```typescript
readonly ai = createAiNamespace();
```

**File:** `src/renderer/scripting/ScriptRunnerBase.ts`

Update SCRIPT_PREFIX (lines 11-15):
```typescript
const SCRIPT_PREFIX =
    "var app=this.app,page=this.page,io=this.io,ai=this.ai,React=this.React" +
    ",styledText=this.styledText,preventOutput=this.preventOutput" +
    ",require=this.customRequire" +
    ",console=this.console;\n";
```

**File:** `src/renderer/scripting/library-require.ts`

Update MODULE_CONTEXT_PREFIX (lines 15-20):
```typescript
const MODULE_CONTEXT_PREFIX =
    "var __ctx=globalThis.__activeScriptContext__" +
    ",app=__ctx?.app,page=__ctx?.page,io=__ctx?.io,ai=__ctx?.ai,React=__ctx?.React" +
    ",styledText=__ctx?.styledText,preventOutput=__ctx?.preventOutput" +
    ",require=__ctx?.customRequire||require" +
    ",console=__ctx?.console||console;\n";
```

### Step 5: Type definitions for IntelliSense

**File (new):** `src/renderer/api/types/ai.d.ts`

```typescript
/**
 * Tool definition for ClaudeSession.
 */
export interface IClaudeToolDef {
    /** Unique tool name (e.g., "get_weather"). */
    name: string;
    /** Description of what the tool does — shown to Claude. */
    description: string;
    /** JSON Schema for the tool's input parameters. */
    inputSchema: Record<string, any>;
    /** The function Claude will call. Return value is sent back as the tool result. */
    tool: (input: any) => any | Promise<any>;
}

/**
 * Events emitted by ClaudeSession during send().
 */
export type IClaudeSessionEvent =
    | "message"
    | "user-message"
    | "assistant-message"
    | "tool-call"
    | "tool-result"
    | "error";

/**
 * Configuration for creating a ClaudeSession.
 */
export interface IClaudeSessionConfig {
    /** Anthropic API key. Required. */
    apiKey: string;
    /** Model ID. Default: "claude-sonnet-4-5-20250514". */
    modelId?: string;
    /** Maximum tokens in response. Default: 4096. */
    maxTokens?: number;
    /** Sampling temperature (0-1). */
    temperature?: number;
}

/**
 * A conversation session with Claude.
 *
 * Manages the message list, tool-call loop, and events automatically.
 *
 * @example
 * const session = new ai.ClaudeSession({ apiKey: "sk-ant-..." });
 * session.systemMessage("You are a helpful assistant.");
 * session.userMessage("What is 2 + 2?");
 * const reply = await session.send();
 * console.log(reply);  // "4"
 *
 * @example
 * // With tools
 * const session = new ai.ClaudeSession({ apiKey: "sk-ant-..." });
 * session.tools = [{
 *     name: "get_weather",
 *     description: "Get current weather for a city",
 *     inputSchema: {
 *         type: "object",
 *         properties: { city: { type: "string" } },
 *         required: ["city"],
 *     },
 *     tool: ({ city }) => ({ temp: 22, condition: "sunny", city }),
 * }];
 * session.on("tool-call", (name, input) => console.log(`Calling ${name}`, input));
 * session.userMessage("What's the weather in Paris?");
 * const reply = await session.send();
 *
 * @example
 * // Multi-turn conversation
 * const session = new ai.ClaudeSession({ apiKey: "sk-ant-...", modelId: "claude-haiku-4-5-20251001" });
 * session.systemMessage("You are a math tutor.");
 * session.userMessage("What is a derivative?");
 * await session.send();
 * session.userMessage("Give me an example");
 * const reply = await session.send();
 */
export interface IClaudeSession {
    /** Current model ID. */
    readonly modelId: string;
    /** Maximum tokens per response. */
    readonly maxTokens: number;
    /** Sampling temperature. */
    readonly temperature: number | undefined;

    /** Copy of the current message history. */
    readonly messages: Array<{ role: string; content: any }>;
    /** The last assistant text response, or undefined if none. */
    readonly lastResponse: string | undefined;

    /** Set the system message (instructions for Claude). */
    systemMessage(text: string): void;
    /** Add a user message to the conversation. */
    userMessage(text: string): void;

    /** Tool definitions. Set before calling send(). */
    tools: IClaudeToolDef[];

    /**
     * Subscribe to session events.
     * @returns Unsubscribe function.
     *
     * Events:
     * - "message" — any message added (user or assistant)
     * - "user-message" — user message added
     * - "assistant-message" — assistant response received
     * - "tool-call" — Claude requested a tool call (name, input)
     * - "tool-result" — tool execution completed (name, input, result, isError)
     * - "error" — error occurred
     */
    on(event: IClaudeSessionEvent, callback: (...args: any[]) => void): () => void;

    /**
     * Send the current conversation to Claude and run the tool loop until completion.
     * Returns the final text response.
     *
     * @param options.toolChoice Controls tool usage:
     *   - `"auto"` — Claude decides whether to use tools (default)
     *   - `"any"` — Claude must use at least one tool
     *   - `"tool_name"` — Claude must use this specific tool
     */
    send(options?: { toolChoice?: "auto" | "any" | string }): Promise<string>;

    /** Clear all messages. Keeps system message and tools. */
    clear(): void;
}

/**
 * ClaudeSession constructor.
 */
export interface IClaudeSessionConstructor {
    new(config: IClaudeSessionConfig): IClaudeSession;
}

/**
 * The `ai` namespace — AI model integrations for scripts.
 *
 * @example
 * const session = new ai.ClaudeSession({ apiKey: "sk-ant-..." });
 * session.userMessage("Hello!");
 * const reply = await session.send();
 */
export interface IAiNamespace {
    /** Create a new Claude conversation session. */
    readonly ClaudeSession: IClaudeSessionConstructor;
}
```

**File:** `src/renderer/api/types/index.d.ts`

Add import and global declaration:
```typescript
import type { IAiNamespace } from "./ai";

// Inside declare global:
const ai: IAiNamespace;
```

### Step 6: Verify auto-sync

The Vite plugin in `vite.renderer.config.ts` (lines 12-64) automatically copies all `*.d.ts` files from `src/renderer/api/types/` to `assets/editor-types/`. The new `ai.d.ts` will be picked up automatically. Monaco's `loadEditorTypes()` in `configure-monaco.ts` loads all files listed in `_imports.txt` — also automatic.

**No changes needed** in Vite config or Monaco setup.

## Concerns / Open Questions

1. **Streaming support:** v1 uses non-streaming `messages.create()`. Streaming could be added later with a `sendStream()` method. Not critical for scripting use cases where the full response is typically needed.

2. **Error handling for missing SDK:** If `@anthropic-ai/sdk` is not installed (e.g., development env issue), `require()` will throw. We should catch this and provide a clear error message.

3. **Relationship to EPIC-014 and naming strategy:** EPIC-014 uses `@anthropic-ai/claude-agent-sdk` (full agent). This task uses `@anthropic-ai/sdk` (raw API). Both live under the `ai` namespace with distinct names: `ai.ClaudeSession` (raw API — manual control over messages, tools, loop) and a future `ai.ClaudeAgent` (autonomous agent with built-in MCP/tools). The Session vs Agent naming makes the distinction clear.

4. **Max tool-loop iterations:** Should we add a safety limit (e.g., max 20 iterations) to prevent infinite loops if a tool keeps returning results that trigger more tool calls? Probably yes — add a `maxToolRounds` config option (default 20).

## Acceptance Criteria

- [ ] `@anthropic-ai/sdk` installed as a dependency
- [ ] `ClaudeSession` class works in scripts: create with `apiKey`, set system message, add user message, send, get response
- [ ] Tool definitions work: Claude calls tools, tools execute, results are sent back
- [ ] Event callbacks fire: `on("tool-call")`, `on("tool-result")`, `on("assistant-message")`
- [ ] `ai` namespace available in scripts with IntelliSense in Monaco editor
- [ ] Multi-turn conversations work (send multiple times, history preserved)
- [ ] `clear()` resets conversation
- [ ] Error handling: missing `apiKey` throws clear error, tool errors are caught and sent back to Claude
- [ ] SDK is lazy-loaded (not imported at startup)

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | Add `@anthropic-ai/sdk` dependency |
| `src/renderer/scripting/api-wrapper/ClaudeSession.ts` | **New** | Core ClaudeSession class implementation |
| `src/renderer/scripting/api-wrapper/AiNamespace.ts` | **New** | `createAiNamespace()` factory |
| `src/renderer/scripting/ScriptContext.ts` | Modify | Add `ai` property |
| `src/renderer/scripting/ScriptRunnerBase.ts` | Modify | Add `ai=this.ai` to SCRIPT_PREFIX |
| `src/renderer/scripting/library-require.ts` | Modify | Add `ai=__ctx?.ai` to MODULE_CONTEXT_PREFIX |
| `src/renderer/api/types/ai.d.ts` | **New** | Type definitions for IntelliSense |
| `src/renderer/api/types/index.d.ts` | Modify | Add `ai` global declaration |

### Files NOT changed

- `src/renderer/api/settings.ts` — no API key setting; scripts provide their own key
- `vite.renderer.config.ts` — auto-syncs all `*.d.ts` files, no changes needed
- `src/renderer/api/setup/configure-monaco.ts` — auto-loads all types from `_imports.txt`, no changes needed
- `electron-builder.yml` — `node_modules` already included in asar, no changes needed
- `forge.config.ts` — no changes needed
- Any main process files — SDK runs in renderer via `require()`
