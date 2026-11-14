import { EditorId } from "../../../shared/editor-ids";
import { EditorModel, type EditorStateBase, type RestoreData } from "../base/EditorModel";
import type { EditorDescriptor } from "../../../shared/persistence";
import { TComponentState, TOneState } from "../../core/state/state";
import { untranslated } from "../../../shared/i18n/t";
import { McpIcon } from "../../theme/icons";
import { type McpConnectionStatus, type McpTransportType } from "./McpConnectionManager";
import { mcpConnectionStore, type SavedMcpConnection } from "./McpConnectionStore";
import { app } from "../../api/app";
import type { McpRequestEntry } from "../log-view/logTypes";
import { McpSession } from "./McpSession";
import { McpToolsModel, getDefaultToolsPanelState } from "./McpToolsModel";
import { McpResourcesModel, getDefaultResourcesPanelState } from "./McpResourcesModel";
import { McpPromptsModel, getDefaultPromptsPanelState } from "./McpPromptsModel";

export type McpPanelId = "info" | "tools" | "resources" | "prompts" | "history";

export interface McpInspectorEditorState extends EditorStateBase {
    url: string;
    transportType: McpTransportType;
    command: string;
    args: string;
    connectionName: string;
    connectionStatus: McpConnectionStatus;
    errorMessage: string;
    serverName: string;
    serverTitle: string;
    serverVersion: string;
    serverDescription: string;
    serverWebsiteUrl: string;
    instructions: string;
    hasTools: boolean;
    hasResources: boolean;
    hasPrompts: boolean;
    activePanel: McpPanelId;
}

export const EMPTY_SERVER_INFO = {
    serverName: "",
    serverTitle: "",
    serverVersion: "",
    serverDescription: "",
    serverWebsiteUrl: "",
    instructions: "",
    hasTools: false,
    hasResources: false,
    hasPrompts: false,
};

export const getDefaultMcpInspectorEditorState = (): McpInspectorEditorState => ({
    id: crypto.randomUUID(),
    title: untranslated("MCP Inspector"),
    modified: false,
    editor: EditorId.mcpView,
    url: "",
    transportType: "http",
    command: "",
    args: "",
    connectionName: "",
    connectionStatus: "disconnected",
    errorMessage: "",
    ...EMPTY_SERVER_INFO,
    activePanel: "info",
});

function assertCredentialFreeUrl(value: string): void {
    if (/^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/i.test(value)) {
        throw new Error("MCP URL must not contain embedded userinfo or credentials.");
    }
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return;
    }
    // Userinfo only. A fragment is not a credential, and rejecting one would refuse a legitimate
    // URL for no gain — the guard is here to stop a secret being written into the call transcript,
    // not to narrow what an MCP endpoint may look like.
    if (parsed.username || parsed.password) {
        throw new Error("MCP URL must not contain embedded credentials (user:password@).");
    }
    for (const key of parsed.searchParams.keys()) {
        if (/(?:token|secret|password|passwd|credential|api[_-]?key|auth)/i.test(key)) {
            throw new Error(`MCP URL query parameter "${key}" may contain a secret and is not allowed.`);
        }
    }
}

export class McpInspectorEditorModel extends EditorModel<McpInspectorEditorState> {
    readonly editorId = EditorId.mcpView;
    noLanguage = true;
    skipSave = true;

    readonly session = new McpSession();
    readonly tools = new McpToolsModel(this.session);
    readonly resources = new McpResourcesModel(this.session);
    readonly prompts = new McpPromptsModel(this.session);
    readonly savedConnections = new TOneState<SavedMcpConnection[]>([]);
    private _disposed = false;

    constructor(state: TComponentState<McpInspectorEditorState>) {
        super(state);
        this.session.connection.onStatusChange = (status, error) => {
            if (this._disposed) return;
            this.session.onStatusChange(status);
            const info = this.session.connection.serverInfo;
            this.state.update((s) => {
                s.connectionStatus = status;
                s.errorMessage = error || "";
                if (info) {
                    s.serverName = info.name;
                    s.serverTitle = info.title;
                    s.serverVersion = info.version;
                    s.serverDescription = info.description;
                    s.serverWebsiteUrl = info.websiteUrl;
                    s.instructions = info.instructions;
                    s.hasTools = !!info.capabilities.tools;
                    s.hasResources = !!info.capabilities.resources;
                    s.hasPrompts = !!info.capabilities.prompts;
                } else if (status === "disconnected" || status === "error") {
                    Object.assign(s, EMPTY_SERVER_INFO);
                }
            });
            if (status === "connected") {
                this.tools.loadTools();
                this.resources.loadResources();
                this.prompts.loadPrompts();
                this.autoSaveConnection();
            } else if (status === "disconnected" || status === "error") {
                this.tools.state.set(getDefaultToolsPanelState());
                this.resources.state.set(getDefaultResourcesPanelState());
                this.prompts.state.set(getDefaultPromptsPanelState());
                this.session.clearHistory();
            }
        };
    }

    connect = async (): Promise<void> => {
        if (this._disposed) return;
        const s = this.state.get();
        await this.session.connection.connect({
            name: s.connectionName || "MCP Server",
            transport: s.transportType,
            url: s.transportType === "http" ? s.url : undefined,
            command: s.transportType === "stdio" ? s.command : undefined,
            args: s.transportType === "stdio" && s.args ? s.args.split(/\s+/).filter(Boolean) : undefined,
        });
    };

    disconnect = async (): Promise<void> => {
        if (this._disposed) return;
        await this.session.connection.disconnect();
    };

    setActivePanel = (panel: McpPanelId): void => { this.state.update((s) => { s.activePanel = panel; }); };

    get availablePanels(): readonly McpPanelId[] {
        const state = this.state.get();
        const panels: McpPanelId[] = ["info"];
        if (state.hasTools) panels.push("tools");
        if (state.hasResources) panels.push("resources");
        if (state.hasPrompts) panels.push("prompts");
        panels.push("history");
        return panels;
    }

    setTransportType(value: string): void { this.state.update((state) => { state.transportType = value as McpTransportType; }); }
    setUrl(value: string): void { assertCredentialFreeUrl(value); this.state.update((state) => { state.url = value; }); }
    setConnectionName(value: string): void { this.state.update((state) => { state.connectionName = value; }); }

    loadSavedConnections = async (): Promise<void> => {
        await mcpConnectionStore.load();
        this.savedConnections.set(mcpConnectionStore.state.get().connections);
    };

    private autoSaveConnection = async (): Promise<void> => {
        const ctx = this.session.begin();
        if (!ctx) return;
        const s = this.state.get();
        const name = s.connectionName || s.serverName || s.url || s.command || "MCP Server";
        const generation = ctx.generation;
        await mcpConnectionStore.save({ name, transport: s.transportType, url: s.url, command: s.command, args: s.args });
        this.savedConnections.set(mcpConnectionStore.state.get().connections);
        if (!this.session.isCurrent(ctx.client, generation)) return;
        if (!s.connectionName && name) this.state.update((st) => { st.connectionName = name; });
    };

    fillFromSaved = (conn: SavedMcpConnection): void => {
        this.state.update((s) => {
            s.transportType = conn.transport;
            s.url = conn.url;
            s.command = conn.command;
            s.args = conn.args;
            s.connectionName = conn.name;
        });
    };

    deleteSavedConnection = async (id: string): Promise<void> => {
        await mcpConnectionStore.delete(id);
        this.savedConnections.set(mcpConnectionStore.state.get().connections);
    };

    get historyCount(): number { return this.session.historyCount; }
    get history(): ReadonlyArray<McpRequestEntry> { return this.session.history; }
    clearHistory = (): void => { this.session.clearHistory(); };

    showHistory = async (): Promise<void> => {
        if (this.session.history.length === 0) return;
        const content = this.session.history.map((e) => JSON.stringify(e)).join("\n");
        await app.capabilities.invoke("content.view", {
            representation: "log",
            content,
            language: "jsonl",
            title: untranslated("MCP Inspector History"),
        });
    };

    getRestoreData(): EditorDescriptor {
        const s = this.state.get();
        return {
            editorId: this.editorId,
            id: s.id,
            state: {
                ...s,
                connectionStatus: "disconnected",
                errorMessage: "",
                ...EMPTY_SERVER_INFO,
            } as unknown as Record<string, unknown>,
        };
    }

    applyRestoreData(data: RestoreData<McpInspectorEditorState>): void {
        super.applyRestoreData(data);
        this.state.update((s) => {
            if (data.url !== undefined) s.url = data.url;
            if (data.transportType) s.transportType = data.transportType;
            if (data.command !== undefined) s.command = data.command;
            if (data.args !== undefined) s.args = data.args;
            if (data.connectionName !== undefined) s.connectionName = data.connectionName;
            if (data.activePanel) s.activePanel = data.activePanel;
        });
    }

    async dispose(): Promise<void> {
        if (this._disposed) return;
        this._disposed = true;
        await this.session.dispose();
        await super.dispose();
    }

    getIconElement = (): SVGElement | undefined => McpIcon.createElement();
}
