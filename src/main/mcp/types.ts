/** Shared types for the MCP server definition (main process). */

/** The zod namespace, obtained from the lazily-loaded SDK bundle. */
export type Zod = typeof import("zod").z;
/** A tool parameter schema accepted by the MCP SDK. */
export type ZodRawShape = import("zod").ZodRawShape;

/** Main-process adapter shape consumed by MCP tool result conversion. */
export interface McpResponse { result?: unknown; error?: { code?: number; message: string } }

/** Arguments a tool callback receives. The generic registrar cannot infer the concrete
 * shape from the schema the way the SDK's own overload does, so custom handlers cast. */
export type ToolArgs = Record<string, unknown>;

export type McpContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string };

export interface IMcpToolResult {
    content: McpContentBlock[];
    isError?: boolean;
}

/** A tool definition always provides its implementation explicitly. */
export interface IMcpToolDef {
    name: string;
    description: string;
    /** Omit for a no-parameter tool. */
    schema?: ZodRawShape;
    handler: (args: ToolArgs) => Promise<IMcpToolResult>;
}
