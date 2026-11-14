import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpRequestEntry } from "../log-view/logTypes";
import { errMessage } from "../../../shared/utils";
import { McpConnectionManager, type McpConnectionStatus } from "./McpConnectionManager";

export interface McpRequestContext {
    client: Client;
    generation: number;
}

export interface McpRequestOptions<T> {
    guard?: () => boolean;
    onSuccess: (result: T, durationMs: number) => void;
    onError?: (error: unknown, durationMs: number) => void;
}

export class McpSession {
    readonly connection = new McpConnectionManager();
    private _history: McpRequestEntry[] = [];
    private _disposed = false;
    generation = 0;

    onStatusChange(status: McpConnectionStatus): void {
        if (status === "connecting" || status === "disconnected" || status === "error") {
            this.generation += 1;
        }
    }

    begin(): McpRequestContext | null {
        const client = this.connection.getClient();
        return client ? { client, generation: this.generation } : null;
    }

    async request<T>(
        ctx: McpRequestContext,
        method: string,
        params: unknown,
        call: (client: Client) => Promise<T>,
        options: McpRequestOptions<T>,
    ): Promise<void> {
        const start = Date.now();
        try {
            const result = await call(ctx.client);
            const earlyDuration = method === "tools/call" ? Date.now() - start : undefined;
            if (!this.isCurrentRequest(ctx.client, ctx.generation)
                || (options.guard && !options.guard())) return;
            const durationMs = earlyDuration ?? Date.now() - start;
            this.logRequest(method, params, result, null, durationMs);
            options.onSuccess(result, durationMs);
        } catch (err) {
            const earlyDuration = method === "tools/call" ? Date.now() - start : undefined;
            if (!this.isCurrentRequest(ctx.client, ctx.generation)
                || (options.guard && !options.guard())) return;
            const durationMs = earlyDuration ?? Date.now() - start;
            this.logRequest(method, params, null, errMessage(err), durationMs);
            options.onError?.(err, durationMs);
        }
    }

    isCurrent(client: Client, generation: number): boolean {
        return !this._disposed
            && generation === this.generation
            && this.connection.getClient() === client;
    }

    private isCurrentRequest(client: Client, generation: number): boolean {
        return this.isCurrent(client, generation);
    }

    private logRequest(method: string, params: unknown, result: unknown, error: string | null, durationMs: number): void {
        this._history.push({
            type: "output.mcp-request",
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            direction: "outgoing",
            method,
            params,
            result,
            error,
            durationMs,
        });
    }

    get historyCount(): number { return this._history.length; }
    get history(): ReadonlyArray<McpRequestEntry> { return this._history; }

    clearHistory(): void { this._history = []; }

    async dispose(): Promise<void> {
        this._disposed = true;
        this.generation += 1;
        await this.connection.dispose();
    }
}
