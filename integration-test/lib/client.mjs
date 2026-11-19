import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function asText(block) {
    return typeof block?.text === "string" ? block.text : "";
}

function rawDescription(result) {
    return JSON.stringify(result?.content ?? result, null, 2);
}

function failure(path, reason, raw) {
    return new Error(`MCP call ${path ?? "<overview>"} ${reason}. Raw reply: ${raw}`);
}

function decodePrimary(result, callPath, maxLengthSupplied, textOnly, allowDialog) {
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const raw = rawDescription(result);
    if (result?.isError) throw failure(callPath, "returned isError", raw);
    if (!blocks.length) throw failure(callPath, "returned no content blocks", raw);

    const pendingIndex = blocks.findIndex((block) => asText(block).startsWith("Pending:"));
    if (pendingIndex !== -1) {
        const dialogPending = allowDialog
            && pendingIndex === 0
            && asText(blocks[0]) === "Pending: the action is waiting on a dialog. Answer it, then re-read state.";
        if (!dialogPending) throw failure(callPath, "is still pending", raw);

        let index = 1;
        if (index < blocks.length && asText(blocks[index]).startsWith("Attention:")) index += 1;
        if (index < blocks.length && asText(blocks[index]).startsWith("--- events ---")) index += 1;
        if (index !== blocks.length) throw failure(callPath, "returned unexpected content with dialog pending", raw);
        return { pending: true };
    }

    const diagnostics = [];
    let index = 0;
    if (index < blocks.length && asText(blocks[index]).startsWith("Attention:")) {
        if (!allowDialog) throw failure(callPath, "returned unexpected attention", raw);
        diagnostics.push(blocks[index++]);
    }
    if (index < blocks.length && asText(blocks[index]).startsWith("--- events ---")) {
        diagnostics.push(blocks[index++]);
    }
    if (index >= blocks.length) throw failure(callPath, "returned no primary body", raw);
    if (asText(blocks[index]).startsWith("Attention:")) throw failure(callPath, "returned unexpected attention", raw);
    if (asText(blocks[index]).startsWith("Error: ")) throw failure(callPath, "returned an error body", raw);
    const body = blocks[index++];
    if (index < blocks.length && asText(blocks[index]).startsWith("[truncated:")) {
        diagnostics.push(blocks[index++]);
        if (!maxLengthSupplied) throw failure(callPath, "was truncated without maxLength", raw);
    }
    for (const prefix of ["--- tip (", "Warning: ", "--- hint ("]) {
        if (index < blocks.length && asText(blocks[index]).startsWith(prefix)) diagnostics.push(blocks[index++]);
    }
    if (index !== blocks.length) throw failure(callPath, "returned unexpected attention or supplementary content", raw);
    const primary = body;
    if (primary.type !== "text" || typeof primary.text !== "string") {
        throw failure(callPath, "returned a non-text scalar body", raw);
    }
    if (textOnly) return primary.text;
    // Keep this literal aligned with src/shared/mcp-result-type.ts, the TypeScript owner.
    const resultType = result?._meta?.["persephone/resultType"];
    if (resultType === "string") return primary.text;
    if (resultType === "json") return JSON.parse(primary.text);
    try {
        return JSON.parse(primary.text);
    } catch {
        return primary.text;
    }
}

function raceTimeout(promise, timeout, message, onTimeout) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                onTimeout?.();
                reject(new Error(message));
            }, timeout);
        }),
    ]).finally(() => clearTimeout(timer));
}

export class McpClient {
    constructor(url, timeouts) {
        this.url = url;
        this.timeouts = timeouts;
        this.client = null;
        this.transport = null;
        this.childState = null;
        this.healthy = false;
        this.lastCallPath = null;
        this.lastResponse = "";
    }

    async connect({ deadline = Date.now() + this.timeouts.startup, childState } = {}) {
        let lastError;
        while (Date.now() < deadline) {
            if (childState?.exited) throw new Error(`Owned app exited before MCP readiness: ${childState.exited}`);
            try {
                const client = new Client({ name: "persephone-integration-runner", version: "1.0.0" });
                const transport = new StreamableHTTPClientTransport(new URL(this.url));
                this.client = client;
                this.transport = transport;
                this.childState = childState;
                transport.onclose = () => { this.healthy = false; };
                const connectAttempt = client.connect(transport);
                const exitAttempt = childState?.exitPromise?.then((exit) => { throw new Error(`Owned app exited before MCP readiness: ${exit}`); });
                await raceTimeout(exitAttempt ? Promise.race([connectAttempt, exitAttempt]) : connectAttempt,
                    Math.max(1, deadline - Date.now()), "MCP startup timed out", () => this.close());
                this.healthy = true;
                return this;
            } catch (error) {
                lastError = error;
                await this.close();
                if (childState?.exited) throw new Error(`Owned app exited before MCP readiness: ${childState.exited}`);
                await new Promise((resolve) => setTimeout(resolve, Math.min(200, Math.max(1, deadline - Date.now()))));
            }
        }
        throw new Error(`MCP did not become ready before the startup deadline: ${lastError?.message ?? "no connection"}`);
    }

    async rawCall(path, args, { maxLength, timeout = this.timeouts.request } = {}) {
        if (!this.healthy || !this.client) throw new Error("MCP connection is not healthy");
        const callPath = path;
        const request = { hints: "never" };
        if (args !== undefined) request.args = args;
        if (path !== undefined) request.path = path;
        if (maxLength !== undefined) request.maxLength = maxLength;
        this.lastCallPath = callPath ?? "<overview>";
        try {
            const requestCall = this.client.callTool({ name: "call", arguments: request }, undefined, { timeout });
            const childExit = this.childState?.exitPromise?.then((exit) => { throw new Error(`Owned app exited during MCP call: ${exit}`); });
            const result = await raceTimeout(childExit ? Promise.race([requestCall, childExit]) : requestCall, timeout,
                `MCP request timed out after ${timeout}ms`, () => this.close());
            this.lastResponse = rawDescription(result).slice(0, 4000);
            return result;
        } catch (error) {
            this.lastResponse = String(error?.message ?? error).slice(0, 4000);
            if (/timed out|closed|disconnect/i.test(this.lastResponse)) await this.close();
            throw error;
        }
    }

    async call(path, args, options) {
        const result = await this.rawCall(path, args, options);
        return decodePrimary(result, path, options?.maxLength !== undefined, false, options?.dialog === true);
    }

    async callText(path, args, options) {
        const result = await this.rawCall(path, args, options);
        return decodePrimary(result, path, options?.maxLength !== undefined, true, options?.dialog === true);
    }

    async screenshot(timeout = this.timeouts.screenshot) {
        const result = await this.rawCall("window.screen.screenshot", [], { timeout });
        if (result?.isError) throw failure("window.screen.screenshot", "returned isError", rawDescription(result));
        const image = result?.content?.find((block) => block.type === "image" && typeof block.data === "string");
        if (!image) throw failure("window.screen.screenshot", "returned no image", rawDescription(result));
        return { data: image.data, mimeType: image.mimeType };
    }

    async close() {
        this.healthy = false;
        const client = this.client;
        const transport = this.transport;
        this.client = null;
        this.transport = null;
        this.childState = null;
        await Promise.allSettled([client?.close(), transport?.close()]);
    }
}

export { raceTimeout };
