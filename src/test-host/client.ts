import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { errMessage } from "../shared/utils.js";
import { formatStep } from "./step-format.js";
import { PERSEPHONE_CALL_RESULT_TYPE_META_KEY } from "../shared/mcp-result-type.js";
import { modelCallMaxLength } from "./model-call-options.js";
import { classifyAttention, EnvironmentStopError } from "./attention-policy.js";

export interface Timeouts { startup: number; request: number; wait: number; poll: number; shutdown: number; scale?: number; cleanup?: number; screenshot?: number; secondInstance?: number; }
export interface McpImage { mimeType: string; data: string; }
export class McpClient {
    private client?: Client;
    private transport?: StreamableHTTPClientTransport;
    constructor(private readonly url: string, readonly timeouts: Timeouts, private readonly child?: { exit: Promise<string | number | null>; exited?: string | number | null }) {}
    async connect(): Promise<void> {
        const deadline = Date.now() + this.timeouts.startup;
        let lastError: unknown;
        while (Date.now() < deadline) {
            if (this.child?.exited !== undefined) throw new Error(`Owned app exited before MCP readiness: ${this.child.exited}`);
            try {
                const client = new Client({ name: "persephone-test-runner", version: "1.0.0" });
                const transport = new StreamableHTTPClientTransport(new URL(this.url));
                this.client = client; this.transport = transport;
                const connection = client.connect(transport);
                const remaining = Math.max(1, deadline - Date.now());
                let timer: ReturnType<typeof setTimeout> | undefined;
                const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("MCP startup timed out.")), remaining); });
                const attempts: Promise<unknown>[] = [connection, timeout];
                if (this.child) attempts.push(this.child.exit.then((code) => { throw new Error(`Owned app exited before MCP readiness: ${code}`); }));
                try { await Promise.race(attempts); }
                finally { if (timer) clearTimeout(timer); }
                return;
            } catch (error) { lastError = error; await this.close(); await new Promise((resolve) => setTimeout(resolve, Math.min(this.timeouts.poll, 200))); }
        }
        throw new Error(`MCP did not become ready: ${errMessage(lastError)}`);
    }
    async call(path?: string, args?: unknown, timeout = this.timeouts.request, maxLength?: number, dialog = false, allowNavigation = false, testWindowIndex?: number): Promise<unknown> {
        const result = await this.rawCall(path, args, { timeout, maxLength: modelCallMaxLength(path, maxLength), allowNavigation, hints: "never" });
        return this.decode(result, path, args, maxLength !== undefined, dialog, false, testWindowIndex);
    }
    async callText(path?: string, args?: unknown, timeout = this.timeouts.request, maxLength?: number, dialog = false, allowNavigation = false, testWindowIndex?: number): Promise<string> {
        const result = await this.rawCall(path, args, { timeout, maxLength: modelCallMaxLength(path, maxLength), allowNavigation, hints: "never" });
        return this.decode(result, path, args, maxLength !== undefined, dialog, true, testWindowIndex) as string;
    }
    /** Assigns `value` to the writable property named by `path` (the `call` tool's `value` field). */
    async set(path: string, value: unknown, timeout = this.timeouts.request, testWindowIndex?: number): Promise<unknown> {
        const result = await this.rawCall(path, undefined, { timeout, hints: "never", value });
        return this.decode(result, path, { value }, false, false, false, testWindowIndex);
    }
    async rawCall(path?: string, args?: unknown, options: { timeout?: number; maxLength?: number; allowNavigation?: boolean; hints?: "always" | "never"; value?: unknown } = {}): Promise<{ isError?: boolean; content?: ContentBlock[]; _meta?: Record<string, unknown> }> {
        if (!this.client) throw new Error("MCP connection is not healthy.");
        const request: Record<string, unknown> = { hints: options.hints ?? "never" };
        if (path !== undefined) request.path = path;
        if (args !== undefined) request.args = args;
        if ("value" in options) request.value = options.value;
        if (options.maxLength !== undefined) request.maxLength = options.maxLength;
        if (options.allowNavigation !== undefined) request.allowNavigation = options.allowNavigation;
        return await this.client.callTool({ name: "call", arguments: request }, undefined, { timeout: options.timeout ?? this.timeouts.request }) as { isError?: boolean; content?: ContentBlock[]; _meta?: Record<string, unknown> };
    }
    async listTools(): Promise<unknown> {
        if (!this.client) throw new Error("MCP connection is not healthy.");
        return this.client.listTools(undefined, { timeout: this.timeouts.request });
    }
    async image(path: string, args?: unknown, timeout = this.timeouts.request): Promise<McpImage | undefined> {
        if (!this.client) throw new Error("MCP connection is not healthy.");
        const request: Record<string, unknown> = { hints: "never", path };
        if (args !== undefined) request.args = args;
        const result = await this.client.callTool({ name: "call", arguments: request }, undefined, { timeout }) as { isError?: boolean; content?: ContentBlock[] };
        if (result.isError) throw this.serverError(path, args, result.content ?? []);
        const image = result.content?.find((block): block is ContentBlock & { type: "image"; mimeType: string; data: string } =>
            block.type === "image" && typeof block.mimeType === "string" && typeof block.data === "string");
        return image ? { mimeType: image.mimeType, data: image.data } : undefined;
    }
    private decode(result: { isError?: boolean; content?: ContentBlock[]; _meta?: Record<string, unknown> }, path?: string, args?: unknown, maxLengthSupplied = false, allowDialog = false, textOnly = false, testWindowIndex?: number): unknown {
        const blocks = result.content ?? [];
        if (result.isError) throw this.serverError(path, args, blocks);
        const raw = this.readableBlocks(blocks);
        if (!blocks.length) throw new Error(`${formatStep("call", path, args)} returned no content blocks. Raw reply: ${raw}`);
        const pendingIndex = blocks.findIndex((block) => isTextBlock(block) && block.text.startsWith("Pending:"));
        if (pendingIndex !== -1) {
            if (allowDialog && pendingIndex === 0 && isTextBlock(blocks[0]) && blocks[0].text === "Pending: the action is waiting on a dialog. Answer it, then re-read state.") {
                let index = 1;
                if (startsWithText(blocks[index], "Attention:")) {
                    const classification = classifyAttention((blocks[index] as { text: string }).text, path, testWindowIndex);
                    if (classification.origin === "outside") throw new EnvironmentStopError(classification.cause);
                    index++;
                }
                if (startsWithText(blocks[index], "--- events ---")) index++;
                if (index === blocks.length) return { pending: true };
            }
            throw new Error(`${formatStep("call", path, args)} is still pending. Raw reply: ${raw}`);
        }
        let index = 0;
        if (startsWithText(blocks[index], "Attention:")) {
            const classification = classifyAttention((blocks[index] as { text: string }).text, path, testWindowIndex);
            if (classification.origin === "outside") throw new EnvironmentStopError(classification.cause);
            if (!allowDialog) throw new Error(`${classification.cause}\n${formatStep("call", path, args)} returned unexpected attention. Raw reply: ${raw}`);
            index++;
        }
        if (startsWithText(blocks[index], "--- events ---")) index++;
        const first = blocks[index++];
        const body = isTextBlock(first) ? first.text : undefined;
        // A failed call always sets isError (handled above). A successful string result that merely
        // starts with "Error: " (e.g. a page returning String(error)) is a value, not a failure.
        if (body === undefined) throw new Error(`${formatStep("call", path, args)} returned no valid text body. Raw reply: ${raw}`);
        if (startsWithText(blocks[index], "[truncated:")) {
            index++;
            if (!maxLengthSupplied) throw new Error(`${formatStep("call", path, args)} was truncated without maxLength. Raw reply: ${raw}`);
        }
        for (const prefix of ["--- tip (", "Warning: ", "--- hint ("]) if (startsWithText(blocks[index], prefix)) index++;
        if (index !== blocks.length) throw new Error(`${formatStep("call", path, args)} returned unexpected supplementary content. Raw reply: ${raw}`);
        if (textOnly) return body;
        const resultType = result._meta?.[PERSEPHONE_CALL_RESULT_TYPE_META_KEY];
        if (resultType === "string") return body;
        if (resultType === "json") return JSON.parse(body);
        try { return JSON.parse(body); } catch { return body; }
    }
    private serverError(path: string | undefined, args: unknown, blocks: ContentBlock[]): Error {
        const text = blocks.filter(isTextBlock).map((block) => block.text).join("\n");
        const metadata = blocks.filter((block) => !isTextBlock(block));
        const readableMetadata = metadata.length ? `\nNon-text content: ${this.readableBlocks(metadata)}` : "";
        let errorText = text || "MCP returned an error without text content.";
        if (/ is not a member of [^.]+\./.test(errorText) && !/Did you mean/.test(errorText)) {
            const resolved = /\(resolved up to "(.*)"\)/.exec(errorText)?.[1];
            const helpPath = resolved ? `${resolved}.$help` : "$help";
            errorText += `\nList members: ctx.call(${JSON.stringify(helpPath)})`;
        }
        const error = new Error(`${formatStep("call", path, args)}\n${errorText}${readableMetadata}`);
        // A coded error's line reads `Error [<code>]: <message>` in every namespace (ai-vision 1.4.0+).
        const code = /^Error \[([^\]\s]+)\]: /m.exec(text)?.[1];
        return code ? Object.assign(error, { code }) : error;
    }
    private readableBlocks(blocks: ContentBlock[]): string {
        try { return JSON.stringify(blocks); } catch (error) { return errMessage(error, "MCP reply could not be serialized."); }
    }
    async close(): Promise<void> {
        const client = this.client; const transport = this.transport;
        this.client = undefined; this.transport = undefined;
        await Promise.allSettled([client?.close(), transport?.close()]);
    }
}

type ContentBlock = { type: "text"; text: string; [key: string]: unknown } | { type: string; [key: string]: unknown };
function isTextBlock(block: ContentBlock | undefined): block is { type: "text"; text: string; [key: string]: unknown } {
    return block?.type === "text" && typeof block.text === "string";
}

function startsWithText(block: ContentBlock | undefined, prefix: string): boolean {
    return isTextBlock(block) && block.text.startsWith(prefix);
}
