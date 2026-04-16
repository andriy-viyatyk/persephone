[← API Index](./index.md) · [Scripting Guide](../scripting.md)

# `ai` — AI Model Integrations

The global `ai` namespace provides AI model helpers for scripts. Currently it exposes `ClaudeSession` for building multi-turn conversations with Claude via the Anthropic API.

---

## `ai.ClaudeSession`

A conversation session with Claude. Manages the message history, tool-call loop, and event callbacks automatically — you add messages and call `send()`, and the session handles the rest.

### Constructor

```typescript
new ai.ClaudeSession(config: IClaudeSessionConfig): IClaudeSession
```

**Config properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `apiKey` | `string` | required | Your Anthropic API key (`sk-ant-...`) |
| `modelId` | `string` | `"claude-sonnet-4-5"` | Model to use |
| `maxTokens` | `number` | `4096` | Max tokens per response |
| `temperature` | `number` | — | Sampling temperature (0–1) |
| `maxToolRounds` | `number` | `20` | Max tool-call loop iterations before stopping |
| `system` | `string` | — | System instructions for Claude (role, behavior, constraints). Equivalent to calling `systemMessage()` after construction. |
| `stopSequences` | `string[]` | — | Sequences that cause Claude to stop generating immediately when encountered. |

---

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `modelId` | `string` | Model ID in use |
| `maxTokens` | `number` | Max tokens per response |
| `temperature` | `number \| undefined` | Sampling temperature |
| `maxToolRounds` | `number` | Max tool-call loop iterations |
| `stopSequences` | `string[] \| undefined` | Stop sequences configured for this session |
| `messages` | `Array<{role, content}>` | Copy of the current message history |
| `lastResponse` | `string \| undefined` | The last assistant text response |
| `tools` | `IClaudeToolDef[]` | Tool definitions (get/set) |

---

### Methods

#### `systemMessage(text)`

Set the system message (instructions for Claude). Call before `send()`.

```javascript
session.systemMessage("You are a helpful code reviewer.");
```

#### `userMessage(text)`

Add a user message to the conversation history.

```javascript
session.userMessage("What is a closure in JavaScript?");
```

#### `send(options?): Promise<string>`

Send the current conversation to Claude. Runs the full tool-call loop internally — keeps calling the API until Claude finishes (no more tool calls needed). Returns the final text response.

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `toolChoice` | `"auto" \| "any" \| string` | Control tool usage: `"auto"` (Claude decides), `"any"` (must use a tool), or a specific tool name (must use that tool) |

```javascript
const reply = await session.send();
const reply = await session.send({ toolChoice: "any" });
const reply = await session.send({ toolChoice: "get_weather" });
```

#### `on(event, callback): () => void`

Subscribe to session events. Returns an unsubscribe function.

**Events:**

| Event | Callback args | Description |
|-------|--------------|-------------|
| `"message"` | `(message)` | Any message added (user or assistant) |
| `"user-message"` | `(text)` | User message added |
| `"assistant-message"` | `(response)` | Raw API response received |
| `"tool-call"` | `(name, input)` | Claude requested a tool call |
| `"tool-result"` | `(name, input, result, isError)` | Tool execution completed |
| `"error"` | `(error)` | Error occurred |

```javascript
const unsubscribe = session.on("tool-call", (name, input) => {
    console.log(`Claude calling ${name}:`, input);
});
// Later: unsubscribe();
```

#### `clear()`

Clear all messages. Keeps the system message and tool definitions.

```javascript
session.clear();  // Start a new conversation with the same session
```

---

### Tool Definitions

Tools let Claude call JavaScript functions. Set `session.tools` before calling `send()`.

```typescript
interface IClaudeToolDef {
    name: string;                          // Unique tool identifier
    description: string;                   // What it does — Claude reads this
    inputSchema: Record<string, any>;      // JSON Schema for parameters
    tool: (input: any) => any | Promise<any>;  // Function to call
}
```

Return any value from `tool()` — it is JSON-serialized and sent back to Claude. Throw an error to indicate failure (Claude will receive the error message and can try again or adjust).

---

### Examples

#### Simple Q&A

```javascript
const session = new ai.ClaudeSession({ apiKey: "sk-ant-..." });
session.systemMessage("You are a concise assistant. Keep answers short.");
session.userMessage("What is a closure in JavaScript?");
const reply = await session.send();
return reply;
```

#### Multi-turn conversation

```javascript
const session = new ai.ClaudeSession({ apiKey: "sk-ant-..." });
session.systemMessage("You are a math tutor.");

session.userMessage("What is a derivative?");
await session.send();

session.userMessage("Give me a simple example.");
const reply = await session.send();

return reply;
```

#### With tools

```javascript
const session = new ai.ClaudeSession({ apiKey: "sk-ant-..." });

session.tools = [
    {
        name: "get_weather",
        description: "Get the current weather for a city",
        inputSchema: {
            type: "object",
            properties: {
                city: { type: "string", description: "City name" },
            },
            required: ["city"],
        },
        tool: ({ city }) => {
            // In a real script, call a weather API here
            return { city, temp: 22, condition: "sunny" };
        },
    },
];

session.on("tool-call", (name, input) => ui.log(`Calling ${name}...`));

session.userMessage("What's the weather in Paris and Tokyo?");
const reply = await session.send();
return reply;
```

#### Force a specific tool

```javascript
session.userMessage("Get the weather data.");
const reply = await session.send({ toolChoice: "get_weather" });
```

#### Observe events for logging

```javascript
const session = new ai.ClaudeSession({ apiKey: "sk-ant-..." });

session.on("tool-call", (name, input) => {
    ui.log(`Tool call: ${name}`);
});

session.on("tool-result", (name, input, result, isError) => {
    if (isError) {
        ui.warn(`Tool ${name} failed: ${result}`);
    } else {
        ui.log(`Tool ${name} returned: ${result}`);
    }
});

session.on("assistant-message", (response) => {
    // response is the raw Anthropic API response object
    ui.log(`Stop reason: ${response.stop_reason}`);
});

session.userMessage("Analyze this data and summarize it.");
const reply = await session.send();
ui.success(reply);
preventOutput();
```

#### Process page content with Claude

```javascript
const session = new ai.ClaudeSession({
    apiKey: "sk-ant-...",
    modelId: "claude-haiku-4-5-20251001",  // Fast model for simple tasks
});

session.systemMessage("You are a JSON formatter. Fix and format the JSON I give you.");
session.userMessage(page.content);

const formatted = await session.send();

page.grouped.content = formatted;
page.grouped.language = "json";
```

#### Using `system` and `stopSequences` in the constructor

```javascript
// Both can be set in the constructor instead of calling systemMessage() separately
const session = new ai.ClaudeSession({
    apiKey: "sk-ant-...",
    system: "You are a concise assistant. Keep answers under 3 sentences.",
    stopSequences: ["---", "END"],
});

session.userMessage("Explain closures in JavaScript.");
const reply = await session.send();
return reply;
```

---

### Notes

- **API key security** — do not hard-code API keys in scripts saved to shared locations. Consider storing the key in a local library module (e.g., `require("library/config")`) that is not checked into source control.
- **Streaming** — `send()` uses non-streaming API calls. The full response is returned at once. Streaming support may be added in a future release.
- **Tool loop limit** — `maxToolRounds` (default 20) prevents infinite loops. If the limit is reached, the last partial response is returned and an `"error"` event fires.
- **Message history** — messages accumulate across multiple `send()` calls. Call `clear()` to start a fresh conversation while reusing the same session.
