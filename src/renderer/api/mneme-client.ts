import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { WikiStatus, WikiRootConfig, WikiSearchResult, MnemeTreeEntry, StaleIndexEntry } from "./mneme-types";
import { fs } from "./fs";
import { fpJoin } from "../core/utils/file-path";
import { tryParseJson } from "../core/utils/parse-utils";

export const mnemeClient = {
    async status(client: Client): Promise<WikiStatus | null> {
        const result = await client.callTool({ name: "status", arguments: {} }, undefined, { timeout: 10_000 });
        return parseToolResult<WikiStatus>(result);
    },

    async addRoot(client: Client, folder: string, name: string): Promise<void> {
        await client.callTool({ name: "add_root", arguments: { folder, name } });
    },

    async removeRoot(client: Client, root: string): Promise<void> {
        await client.callTool({ name: "remove_root", arguments: { root } });
    },

    async reindex(
        client: Client,
        root: string | undefined,
        signal: AbortSignal,
        onProgress: (progress: { progress?: number; total?: number; rootName?: string; phase?: string }) => void,
    ): Promise<void> {
        await client.callTool(
            { name: "reindex", arguments: root ? { path: root } : {} },
            undefined,
            {
                signal,
                onprogress: (p: { progress?: number; total?: number; message?: string }) => {
                    const { rootName, phase } = parseProgressMessage(p.message);
                    onProgress({ progress: p.progress, total: p.total, rootName, phase });
                },
            },
        );
    },

    async rootConfig(
        client: Client,
        root: string,
        patch?: { include: string[]; ignore: string[] },
    ): Promise<WikiRootConfig | null> {
        const result = patch
            ? await client.callTool({ name: "root_config", arguments: { root, include: patch.include, ignore: patch.ignore } })
            : await client.callTool({ name: "root_config", arguments: { root } });
        return parseToolResult<WikiRootConfig>(result);
    },

    async modelUpdate(client: Client): Promise<void> {
        await client.callTool({ name: "model_update", arguments: {} });
    },

    async deleteIndex(client: Client, root: string, modelId: string, schemaVer: number): Promise<void> {
        await client.callTool({ name: "index_delete", arguments: { root, modelId, schemaVer } });
    },

    async listRoots(client: Client): Promise<{ roots: Array<{ name: string; folder: string }> } | null> {
        const result = await client.callTool({ name: "list_roots", arguments: {} }, undefined, { timeout: 10_000 });
        return parseToolResult(result);
    },

    async tags(client: Client, subtree: string): Promise<{ tags: Array<{ tag: string; count: number }> } | null> {
        const result = await client.callTool({ name: "tags", arguments: { subtree } }, undefined, { timeout: 10_000 });
        return parseToolResult(result);
    },

    async search(client: Client, args: Record<string, unknown>): Promise<WikiSearchResult | null> {
        const result = await client.callTool({ name: "search", arguments: args }, undefined, { timeout: 15_000 });
        return parseToolResult<WikiSearchResult>(result);
    },

    async tree(client: Client, path: string): Promise<{ entries: MnemeTreeEntry[] } | null> {
        const result = await client.callTool({ name: "tree", arguments: { path, depth: 1 } }, undefined, { timeout: 10_000 });
        return parseToolResult(result);
    },

    async write(client: Client, path: string, content: string): Promise<void> {
        await client.callTool({ name: "write", arguments: { path, content } });
    },

    async upload(client: Client, path: string, contentBase64: string): Promise<void> {
        await client.callTool({ name: "upload", arguments: { path, contentBase64 } });
    },

    async mkdir(client: Client, path: string): Promise<void> {
        await client.callTool({ name: "mkdir", arguments: { path } });
    },

    async rename(client: Client, from: string, to: string): Promise<void> {
        await client.callTool({ name: "rename", arguments: { from, to } });
    },

    async delete(client: Client, path: string): Promise<void> {
        await client.callTool({ name: "delete", arguments: { path } });
    },

    async readResource(client: Client, uri: string): Promise<Awaited<ReturnType<Client["readResource"]>>> {
        return client.readResource({ uri });
    },

    async walkRootIndexes(folder: string, activePath: string): Promise<StaleIndexEntry[]> {
        const out: StaleIndexEntry[] = [];
        const mnemeDir = fpJoin(folder, ".mneme");
        try {
            const modelDirs = await fs.listDirWithTypes(mnemeDir);
            for (const md of modelDirs) {
                if (!md.isDirectory) continue;
                const modelId = md.name;
                const modelDirPath = fpJoin(mnemeDir, modelId);
                const files = await fs.listDir(modelDirPath);
                for (const file of files) {
                    const match = /^index-v(\d+)\.db$/.exec(file);
                    if (!match) continue;
                    const schemaVer = parseInt(match[1], 10);
                    const dbPath = fpJoin(modelDirPath, file);
                    const stat = await fs.stat(dbPath);
                    out.push({
                        modelId,
                        schemaVer,
                        bytes: stat.size,
                        path: dbPath,
                        active: normalizePath(dbPath) === normalizePath(activePath),
                    });
                }
            }
        } catch {
            // .mneme may not exist yet — no inventory.
        }
        out.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.schemaVer - a.schemaVer);
        return out;
    },
};

function parseToolResult<T>(result: unknown): T | null {
    const r = result as { structuredContent?: unknown; content?: Array<{ type?: string; text?: string }> };
    const structured = r.structuredContent;
    if (structured && typeof structured === "object") {
        return structured as T;
    }
    const text = r.content?.find((c) => c.type === "text")?.text;
    if (!text) return null;
    return tryParseJson<T | null>(text, null);
}

function parseProgressMessage(message?: string): { rootName?: string; phase?: string } {
    if (!message) return {};
    const idx = message.indexOf(":");
    if (idx < 0) return { phase: message.trim() };
    return {
        rootName: message.slice(0, idx).trim(),
        phase: message.slice(idx + 1).trim(),
    };
}

function normalizePath(p: string): string {
    return p.replace(/[\\/]+/g, "/").toLowerCase();
}
