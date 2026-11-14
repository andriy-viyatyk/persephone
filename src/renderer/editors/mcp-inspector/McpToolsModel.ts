import { TOneState } from "../../core/state/state";
import { tryParseJson } from "../../core/utils/parse-utils";
import { errMessage } from "../../../shared/utils";
import { McpSession } from "./McpSession";

export interface McpToolInfo {
    name: string;
    description: string;
    inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
    annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean };
}

export interface McpToolResult {
    content: McpToolResultContent[];
    isError?: boolean;
    durationMs: number;
}

export type McpToolResultContent =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string } }
    | { type: "resource_link"; uri: string; name: string };

export interface McpToolsPanelState {
    tools: McpToolInfo[];
    selectedToolName: string;
    toolCallLoading: boolean;
    toolResult: McpToolResult | null;
    toolArgs: Record<string, string>;
}

export const getDefaultToolsPanelState = (): McpToolsPanelState => ({
    tools: [], selectedToolName: "", toolCallLoading: false, toolResult: null, toolArgs: {},
});

export class McpToolsModel {
    readonly state = new TOneState<McpToolsPanelState>(getDefaultToolsPanelState());
    private _selectionGeneration = 0;

    constructor(private readonly session: McpSession) {}

    loadTools = async (): Promise<void> => {
        const ctx = this.session.begin();
        if (!ctx) return;
        await this.session.request(ctx, "tools/list", null, (client) => client.listTools(), {
            onSuccess: (result) => {
                const tools: McpToolInfo[] = (result.tools || []).map((t) => ({
                    name: t.name,
                    description: t.description || "",
                    inputSchema: t.inputSchema as McpToolInfo["inputSchema"],
                    annotations: t.annotations,
                }));
                this.state.update((s) => {
                    s.tools = tools;
                    s.selectedToolName = tools.length > 0 ? tools[0].name : "";
                    s.toolResult = null;
                    s.toolArgs = {};
                });
            },
        });
    };

    selectTool = (name: string): void => {
        this._selectionGeneration += 1;
        this.state.update((s) => {
            s.selectedToolName = name;
            s.toolCallLoading = false;
            s.toolResult = null;
            s.toolArgs = {};
        });
    };

    setToolArg = (name: string, value: string): void => {
        this.state.update((s) => { s.toolArgs = { ...s.toolArgs, [name]: value }; });
    };

    callTool = async (): Promise<void> => {
        const ctx = this.session.begin();
        if (!ctx) return;
        const ts = this.state.get();
        const tool = ts.tools.find((t) => t.name === ts.selectedToolName);
        if (!tool) return;
        const toolSelectionGeneration = this._selectionGeneration;
        const args: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(ts.toolArgs)) {
            if (!value && value !== "false") continue;
            const propSchema = tool.inputSchema.properties?.[key];
            const propType = (propSchema && typeof propSchema === "object" && "type" in propSchema)
                ? (propSchema as { type?: unknown }).type
                : undefined;
            if (propType === "number" || propType === "integer") {
                args[key] = Number(value);
            } else if (propType === "boolean") {
                args[key] = value === "true";
            } else if (propType === "object" || propType === "array") {
                args[key] = tryParseJson<unknown>(value, value);
            } else {
                args[key] = value;
            }
        }
        this.state.update((s) => { s.toolCallLoading = true; s.toolResult = null; });
        const callParams = { name: tool.name, arguments: args };
        await this.session.request(ctx, "tools/call", callParams, (client) => client.callTool(callParams), {
            guard: () => toolSelectionGeneration === this._selectionGeneration
                && this.state.get().selectedToolName === tool.name,
            onSuccess: (result, durationMs) => {
                this.state.update((s) => {
                    s.toolCallLoading = false;
                    s.toolResult = {
                        content: (result.content as McpToolResultContent[]) || [],
                        isError: result.isError as boolean | undefined,
                        durationMs,
                    };
                });
            },
            onError: (err, durationMs) => {
                this.state.update((s) => {
                    s.toolCallLoading = false;
                    s.toolResult = {
                        content: [{ type: "text", text: errMessage(err) }],
                        isError: true,
                        durationMs,
                    };
                });
            },
        });
    };
}
