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
    /** Model ID. Default: "claude-sonnet-4-5". */
    modelId?: string;
    /** Maximum tokens in response. Default: 4096. */
    maxTokens?: number;
    /** Sampling temperature (0-1). */
    temperature?: number;
    /** Maximum tool-call loop iterations. Default: 20. Prevents infinite loops. */
    maxToolRounds?: number;
    /** System instructions for Claude (e.g. role, behavior, constraints). Same as calling systemMessage() after construction. */
    system?: string;
    /** Sequences that cause Claude to stop generating immediately when encountered. */
    stopSequences?: string[];
}

/**
 * Options for ClaudeSession.send().
 */
export interface IClaudeSendOptions {
    /**
     * Controls tool usage for this request:
     * - `"auto"` — Claude decides whether to use tools (default)
     * - `"any"` — Claude must use at least one tool
     * - `"tool_name"` — Claude must use this specific tool
     */
    toolChoice?: "auto" | "any" | string;
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
 * // Force Claude to use a specific tool
 * session.userMessage("Get weather data");
 * const reply = await session.send({ toolChoice: "get_weather" });
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
    /** Maximum tool-call loop iterations. */
    readonly maxToolRounds: number;
    /** Stop sequences configured for this session. */
    readonly stopSequences: string[] | undefined;

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
     * - "assistant-message" — assistant response received (full API response object)
     * - "tool-call" — Claude requested a tool call (name, input)
     * - "tool-result" — tool execution completed (name, input, result, isError)
     * - "error" — error occurred (Error object)
     */
    on(event: IClaudeSessionEvent, callback: (...args: any[]) => void): () => void;

    /**
     * Send the current conversation to Claude and run the tool loop until completion.
     * Returns the final text response.
     */
    send(options?: IClaudeSendOptions): Promise<string>;

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
