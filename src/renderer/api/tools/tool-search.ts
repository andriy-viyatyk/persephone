import { registeredTools } from "./registered-tools";
import type { RegisteredTool } from "./registered-tools";

// Agent-facing validation lives in ai-vision/namespaces/tools.ts; this function throws plain errors.
export interface ToolSearchDefinition {
    id: string;
    toolset: string;
    description: string;
    inputSchema?: object;
    requirements?: string;
    env?: string[];
    timeoutMs?: number;
    toolsetRoot: string;
}

export type ToolSearchResult =
    | { total: number; tools: { id: string; description: string }[] }
    | { total: number; tools: ToolSearchDefinition[]; note?: string }
    | { total: number; returned: number; tools: (ToolSearchDefinition & { score: number })[] };

function toDefinition(tool: RegisteredTool): ToolSearchDefinition {
    return {
        id: tool.id,
        toolset: tool.toolsetName,
        description: tool.tool.description,
        inputSchema: tool.tool.inputSchema,
        requirements: tool.tool.requirements,
        env: tool.tool.env,
        timeoutMs: tool.tool.timeoutMs,
        toolsetRoot: tool.toolsetRoot,
    };
}

/** Search registered tools by listing, exact selection, or ranked keyword matches. */
export async function searchTools(query: string | undefined, maxResults?: unknown): Promise<ToolSearchResult> {
    await registeredTools.ensureInitialized();
    const all = registeredTools.tools;
    const normalizedQuery = (query ?? "").trim();
    const limit = typeof maxResults === "number" && maxResults > 0
        ? Math.floor(maxResults)
        : 5;

    if (!normalizedQuery) {
        return { total: all.length, tools: all.map((tool) => ({ id: tool.id, description: tool.tool.description })) };
    }

    const selectPrefix = "select:";
    if (normalizedQuery.toLowerCase().startsWith(selectPrefix)) {
        const wantedRaw = normalizedQuery.slice(selectPrefix.length).trim();
        const wanted = wantedRaw.toLowerCase();
        const matches = all.filter((tool) => tool.id.toLowerCase() === wanted);
        return {
            total: matches.length,
            tools: matches.map(toDefinition),
            ...(matches.length === 0 ? { note: `No tool with id "${wantedRaw}". Call tools.search with an empty query to list all.` } : {}),
        };
    }

    const terms = [...new Set(normalizedQuery.toLowerCase().split(/\s+/).filter((word) => word.length >= 2))];
    const scored = all
        .map((tool) => {
            const haystack = [
                tool.id,
                tool.tool.description,
                ...(tool.tool.keywords ?? []),
                tool.toolsetName,
                tool.toolsetDescription ?? "",
                ...(tool.toolsetKeywords ?? []),
            ].join(" ").toLowerCase();
            return { tool, score: terms.filter((term) => haystack.includes(term)).length };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);
    return {
        total: scored.length,
        returned: Math.min(scored.length, limit),
        tools: scored.slice(0, limit).map((item) => ({ ...toDefinition(item.tool), score: item.score })),
    };
}
