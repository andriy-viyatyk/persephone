import { TOneState } from "../../core/state/state";
import { errMessage } from "../../../shared/utils";
import { McpSession } from "./McpSession";

export interface McpPromptInfo { name: string; description: string; arguments: McpPromptArgInfo[]; }
export interface McpPromptArgInfo { name: string; description: string; required: boolean; }
export interface McpPromptMessage { role: "user" | "assistant"; content: McpPromptMessageContent[]; }
export type McpPromptMessageContent =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string } }
    | { type: "resource_link"; uri: string; name: string };

export interface McpPromptsPanelState {
    prompts: McpPromptInfo[];
    selectedPromptName: string;
    promptArgs: Record<string, string>;
    getPromptLoading: boolean;
    promptMessages: McpPromptMessage[] | null;
    promptError: string;
}

export const getDefaultPromptsPanelState = (): McpPromptsPanelState => ({
    prompts: [], selectedPromptName: "", promptArgs: {}, getPromptLoading: false,
    promptMessages: null, promptError: "",
});

export class McpPromptsModel {
    readonly state = new TOneState<McpPromptsPanelState>(getDefaultPromptsPanelState());
    private _selectionGeneration = 0;

    constructor(private readonly session: McpSession) {}

    loadPrompts = async (): Promise<void> => {
        const ctx = this.session.begin();
        if (!ctx) return;
        await this.session.request(ctx, "prompts/list", null, (client) => client.listPrompts(), {
            onSuccess: (result) => {
                const prompts: McpPromptInfo[] = (result.prompts || []).map((p) => ({
                    name: p.name,
                    description: p.description || "",
                    arguments: (p.arguments || []).map((a) => ({
                        name: a.name,
                        description: a.description || "",
                        required: !!a.required,
                    })),
                }));
                this.state.update((s) => {
                    s.prompts = prompts;
                    s.selectedPromptName = prompts.length > 0 ? prompts[0].name : "";
                    s.promptArgs = {};
                    s.promptMessages = null;
                    s.promptError = "";
                });
            },
        });
    };

    selectPrompt = (name: string): void => {
        this._selectionGeneration += 1;
        this.state.update((s) => {
            s.selectedPromptName = name;
            s.getPromptLoading = false;
            s.promptArgs = {};
            s.promptMessages = null;
            s.promptError = "";
        });
    };

    setPromptArg = (name: string, value: string): void => {
        this.state.update((s) => { s.promptArgs = { ...s.promptArgs, [name]: value }; });
    };

    getPrompt = async (): Promise<void> => {
        const ctx = this.session.begin();
        if (!ctx) return;
        const ps = this.state.get();
        const prompt = ps.prompts.find((p) => p.name === ps.selectedPromptName);
        if (!prompt) return;
        const promptSelectionGeneration = this._selectionGeneration;
        const selectedPromptName = prompt.name;
        const args: Record<string, string> = {};
        for (const [key, value] of Object.entries(ps.promptArgs)) {
            if (value) args[key] = value;
        }
        this.state.update((s) => { s.getPromptLoading = true; s.promptMessages = null; s.promptError = ""; });
        const getParams = { name: prompt.name, arguments: args };
        await this.session.request(ctx, "prompts/get", getParams, (client) => client.getPrompt(getParams), {
            guard: () => promptSelectionGeneration === this._selectionGeneration
                && this.state.get().selectedPromptName === selectedPromptName,
            onSuccess: (result) => {
                const messages: McpPromptMessage[] = (result.messages || []).map((m) => {
                    const contentBlock = m.content;
                    // content can be a single block or array
                    const contentArray: McpPromptMessageContent[] = Array.isArray(contentBlock)
                        ? contentBlock.map(normalizePromptContent)
                        : [normalizePromptContent(contentBlock)];
                    return { role: m.role as "user" | "assistant", content: contentArray };
                });
                this.state.update((s) => { s.getPromptLoading = false; s.promptMessages = messages; });
            },
            onError: (err) => {
                this.state.update((s) => { s.getPromptLoading = false; s.promptError = errMessage(err); });
            },
        });
    };
}

function normalizePromptContent(block: unknown): McpPromptMessageContent {
    if (!block) return { type: "text", text: "" };
    if (typeof block === "string") return { type: "text", text: block };
    if (typeof block !== "object") return { type: "text", text: String(block) };
    const b = block as Record<string, unknown>;
    if (b.type === "text") return { type: "text", text: String(b.text || "") };
    if (b.type === "image") return { type: "image", data: String(b.data), mimeType: String(b.mimeType) };
    if (b.type === "resource") {
        const r = (b.resource && typeof b.resource === "object" ? b.resource : {}) as Record<string, unknown>;
        return {
            type: "resource",
            resource: {
                uri: String(r.uri || ""),
                mimeType: r.mimeType as string | undefined,
                text: r.text as string | undefined,
                blob: r.blob as string | undefined,
            },
        };
    }
    if (b.type === "resource_link") return { type: "resource_link", uri: String(b.uri), name: String(b.name) };
    return { type: "text", text: JSON.stringify(block) };
}
