import { createPanelElement } from "../../uikit/Panel/panel-style";
import { t, untranslated } from "../../../shared/i18n/t";
import { createTextElement } from "../../uikit/Text/text-style";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { DividerView } from "../../uikit/Divider/DividerView";
import { DotView } from "../../uikit/Dot/DotView";
import { InputView } from "../../uikit/Input/InputView";
import { SelectView } from "../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../uikit/ListBox/types";
import { SegmentedControlView } from "../../uikit/SegmentedControl/SegmentedControlView";
import type { ISegment } from "../../uikit/SegmentedControl/SegmentedControlView";
import { SubtreeSwap } from "../../uikit/shared/subtree-swap";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { EditorToolbarView } from "../base/EditorToolbarView";
import type { SavedMcpConnection } from "./McpConnectionStore";
import { McpInspectorEditorModel, type McpInspectorEditorState, type McpPanelId } from "./McpInspectorEditorModel";
import { DisconnectedBodyView, type DisconnectedBodyProps } from "./DisconnectedBodyView";
import { HistoryPanelView } from "./HistoryPanel";
import { ServerInfoPanelView } from "./ServerInfoPanel";
import { PromptsPanelView } from "./PromptsPanel";
import { ResourcesPanelView } from "./ResourcesPanel";
import { ToolsPanelView } from "./ToolsPanel";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";
import "./mcp-inspector.css";

function transportItems(): IListBoxItem[] {
    return [
        { value: "http", label: untranslated("HTTP") },
        { value: "stdio", label: t("tools.mcpStdio") },
    ];
}

const PANEL_LABELS = {
    info: "tools.mcpInfo",
    tools: "tools.mcpTools",
    resources: "tools.mcpResources",
    prompts: "tools.mcpPrompts",
    history: "tools.mcpHistory",
} as const;

type ConnectedPanelView = ToolsPanelView | ResourcesPanelView | PromptsPanelView | HistoryPanelView | ServerInfoPanelView;
type ActiveBodyView = ConnectedPanelView | DisconnectedBodyView;

function dotColorFor(status: string): "success" | "warning" | "error" | "neutral" {
    if (status === "connected") return "success";
    if (status === "connecting") return "warning";
    if (status === "error") return "error";
    return "neutral";
}

export class McpInspectorEditorView extends VanillaView<{ model: McpInspectorEditorModel }> {
    private model: McpInspectorEditorModel;
    private storeConnections: SavedMcpConnection[] = [];
    private toolbar: EditorToolbarView | undefined;
    private connectionBar: HTMLDivElement | undefined;
    private transport: SelectView<IListBoxItem> | undefined;
    private connectButton: ButtonView | undefined;
    private savedSwap: SubtreeSwap<string> | undefined;
    private savedSelector: SavedConnectionSelectorView | undefined;
    private inputsView: TransportInputsView | undefined;
    private errorBar: ErrorBarView | undefined;
    private serverBar: ServerBarView | undefined;
    private inputsSwap: SubtreeSwap<string> | undefined;
    private errorSwap: SubtreeSwap<string> | undefined;
    private serverSwap: SubtreeSwap<string> | undefined;
    private bodySwap: SubtreeSwap<string> | undefined;
    private activeBody: ActiveBodyView | undefined;
    private bodyKey = "";

    constructor(props: { model: McpInspectorEditorModel }) {
        super(props, createPanelElement({ name: "mcp-inspector-root", direction: "column", flex: true, overflow: "hidden" }));
        this.root.dataset.type = "mcp-inspector-root";
        this.model = props.model;
    }

    protected onMount(): void {
        this.connectionBar = createPanelElement({ name: "mcp-connection-bar", direction: "row", align: "center", gap: "sm", paddingX: "lg", paddingY: "sm", flex: true });
        this.toolbar = this.child(new EditorToolbarView({ borderBottom: true, children: this.connectionBar }));
        this.root.append(this.toolbar.root);
        this.toolbar.mount();
        const savedHost = document.createElement("span");
        savedHost.dataset.part = "saved";
        this.connectionBar.append(savedHost);
        this.savedSwap = new SubtreeSwap(savedHost);
        this.own(() => this.savedSwap?.dispose());
        const transports = transportItems();
        this.transport = this.child(new SelectView<IListBoxItem>({
            name: "mcp-transport", items: transports, value: transports[0], onChange: this.selectTransport,
            disabled: true, size: "sm", minWidth: 70, maxWidth: 120,
        }));
        this.connectionBar.append(this.transport.root);
        this.transport.mount();
        const inputsHost = document.createElement("span");
        inputsHost.dataset.part = "inputs";
        inputsHost.style.display = "contents";
        this.connectionBar.append(inputsHost);
        this.inputsSwap = new SubtreeSwap(inputsHost);
        this.own(() => this.inputsSwap?.dispose());
        this.connectButton = this.child(new ButtonView({ name: "mcp-connect", variant: "default", size: "sm", onClick: this.toggleConnection }));
        this.connectionBar.append(this.connectButton.root);
        this.connectButton.mount();

        const errorHost = document.createElement("div");
        errorHost.dataset.part = "error";
        this.root.append(errorHost);
        this.errorSwap = new SubtreeSwap(errorHost);
        this.own(() => this.errorSwap?.dispose());
        const serverHost = document.createElement("div");
        serverHost.dataset.part = "server";
        this.root.append(serverHost);
        this.serverSwap = new SubtreeSwap(serverHost);
        this.own(() => this.serverSwap?.dispose());
        const body = createPanelElement({ name: "mcp-body", direction: "row", flex: true, overflow: "hidden", height: 0 });
        const bodyHost = document.createElement("div");
        bodyHost.style.display = "contents";
        body.append(bodyHost);
        this.root.append(body);
        this.bodySwap = new SubtreeSwap(bodyHost);
        this.own(() => this.bodySwap?.dispose());

        this.bind(this.model.savedConnections, (connections) => connections, this.updateConnections);
        this.bind(this.model.state, (state) => state, this.syncState);
        void this.model.loadSavedConnections();
    }

    protected onUpdate(props: { model: McpInspectorEditorModel }): void {
        if (props.model !== this.model) throw new Error("MCP inspector view model cannot be replaced.");
    }

    protected onDispose(): void {
        this.activeBody = undefined;
        void this.model.dispose();
    }

    private readonly updateConnections = (connections: SavedMcpConnection[]): void => {
        this.storeConnections = connections;
        this.syncState(this.model.state.get());
    };

    private readonly syncState = (state: McpInspectorEditorState): void => {
        const connected = state.connectionStatus === "connected";
        const connecting = state.connectionStatus === "connecting";
        this.syncSavedConnections(state);
        const transports = transportItems();
        this.transport?.update({
            name: "mcp-transport", items: transports,
            value: transports.find((item) => item.value === state.transportType) || null,
            onChange: this.selectTransport, disabled: connected || connecting,
            size: "sm", minWidth: 70, maxWidth: 120,
        });
        const inputKey = state.transportType;
        let createdInput: TransportInputsView | undefined;
        this.inputsSwap?.set(inputKey, () => {
            const view = new TransportInputsView({ model: this.model, state });
            this.inputsView = view;
            createdInput = view;
            return view;
        });
        if (this.inputsView && !createdInput) this.inputsView.update({ model: this.model, state });
        createdInput?.mount();
        this.connectButton?.update({
            name: "mcp-connect", variant: "default", size: "sm", onClick: this.toggleConnection,
            disabled: connecting,
            children: connecting ? t("tools.mcpConnecting") : connected ? t("tools.mcpDisconnect") : t("tools.mcpConnect"),
        });
        this.syncError(state);
        this.syncServer(state);
        const bodyKey = connected ? `connected:${state.activePanel}`
            : state.connectionStatus === "disconnected" && this.storeConnections.length > 0 ? "saved" : "empty";
        if (this.activeBody && this.bodyKey === bodyKey) {
            if (connected && state.activePanel === "info" && this.activeBody instanceof ServerInfoPanelView) {
                this.activeBody.update({ state });
            } else if (!connected && this.activeBody instanceof DisconnectedBodyView) {
                this.activeBody.update(this.bodyProps(state));
            }
            return;
        }
        this.activeBody = undefined;
        this.bodyKey = bodyKey;
        let created: ActiveBodyView | undefined;
        this.bodySwap?.set(bodyKey, () => {
            const view = connected ? this.connectedPanel(state.activePanel) : new DisconnectedBodyView(this.bodyProps(state));
            created = view;
            this.activeBody = view;
            return view;
        });
        created?.mount();
    };

    private bodyProps(state: McpInspectorEditorState): DisconnectedBodyProps {
        return { model: this.model, state, connections: this.storeConnections };
    }

    private connectedPanel(panel: McpPanelId): ConnectedPanelView {
        if (panel === "tools") return new ToolsPanelView({ model: this.model });
        if (panel === "resources") return new ResourcesPanelView({ model: this.model });
        if (panel === "prompts") return new PromptsPanelView({ model: this.model });
        if (panel === "history") return new HistoryPanelView({ model: this.model });
        return new ServerInfoPanelView({ state: this.model.state.get() });
    }

    private syncSavedConnections(state: McpInspectorEditorState): void {
        const key = this.storeConnections.length > 0 && state.connectionStatus !== "connected" && state.connectionStatus !== "connecting" ? "saved" : "empty";
        if (key === "saved" && this.savedSelector) {
            this.savedSelector.update({ connections: this.storeConnections, onSelect: this.selectSaved });
            return;
        }
        let created: { mount: () => HTMLElement } | undefined;
        this.savedSwap?.set(key, () => {
            if (key === "empty") {
                const view = new EmptySavedSelectorView();
                this.savedSelector = undefined;
                created = view;
                return view;
            }
            const view = new SavedConnectionSelectorView({ connections: this.storeConnections, onSelect: this.selectSaved });
            this.savedSelector = view;
            created = view;
            return view;
        });
        created?.mount();
    }

    private syncError(state: McpInspectorEditorState): void {
        const key = state.connectionStatus === "error" && state.errorMessage ? "error" : "empty";
        if (key === "error" && this.errorBar) { this.errorBar.update({ message: state.errorMessage }); return; }
        let created: { mount: () => HTMLElement } | undefined;
        this.errorSwap?.set(key, () => {
            if (key === "empty") { this.errorBar = undefined; const view = new EmptyErrorView(); created = view; return view; }
            const view = new ErrorBarView({ message: state.errorMessage });
            this.errorBar = view;
            created = view;
            return view;
        });
        created?.mount();
    }

    private syncServer(state: McpInspectorEditorState): void {
        const key = state.connectionStatus === "connected" ? "connected" : "empty";
        if (key === "connected" && this.serverBar) { this.serverBar.update({ model: this.model, state }); return; }
        let created: { mount: () => HTMLElement } | undefined;
        this.serverSwap?.set(key, () => {
            if (key === "empty") { this.serverBar = undefined; const view = new EmptyServerBarView(); created = view; return view; }
            const view = new ServerBarView({ model: this.model, state });
            this.serverBar = view;
            created = view;
            return view;
        });
        created?.mount();
    }

    private readonly toggleConnection = (): void => {
        const status = this.model.state.get().connectionStatus;
        if (status === "connected" || status === "connecting") void this.model.disconnect();
        else void this.model.connect();
    };
    private readonly selectTransport = (item: IListBoxItem): void => {
        this.model.setTransportType(item.value as string);
    };
    private readonly selectSaved = (id: string): void => {
        const connection = this.storeConnections.find((item) => item.id === id);
        if (connection) this.model.fillFromSaved(connection);
    };
}

class EmptySavedSelectorView extends VanillaView<Record<string, never>> {
    constructor() {
        super({}, document.createElement("span"));
    }
}

class SavedConnectionSelectorView extends VanillaView<{ connections: SavedMcpConnection[]; onSelect: (id: string) => void }> {
    private select: SelectView<IListBoxItem> | undefined;

    constructor(props: { connections: SavedMcpConnection[]; onSelect: (id: string) => void }) {
        super(props, document.createElement("span"));
    }

    protected onMount(): void {
        this.root.dataset.type = "mcp-saved-connections";
        this.root.style.display = "contents";
        this.select = this.child(new SelectView<IListBoxItem>({
            name: "mcp-saved-connections", items: this.items(this.props.connections), value: null,
            onChange: (item) => this.props.onSelect(String(item.value)),
            placeholder: t("tools.mcpSavedPlaceholder"), size: "sm", maxWidth: 160,
        }));
        const divider = this.child(new DividerView({ orientation: "vertical" }));
        this.root.append(this.select.root, divider.root);
        this.select.mount();
        divider.mount();
    }

    protected onUpdate(props: { connections: SavedMcpConnection[]; onSelect: (id: string) => void }): void {
        this.select?.update({
            name: "mcp-saved-connections", items: this.items(props.connections), value: null,
            onChange: (item) => props.onSelect(String(item.value)),
            placeholder: t("tools.mcpSavedPlaceholder"), size: "sm", maxWidth: 160,
        });
    }

    private items(connections: SavedMcpConnection[]): IListBoxItem[] {
        return connections.map((connection) => ({
            value: connection.id,
            label: connection.transport === "http" ? connection.url : `${connection.command} ${connection.args}`,
        }));
    }
}

class TransportInputsView extends VanillaView<{ model: McpInspectorEditorModel; state: McpInspectorEditorState }> {
    private urlInput: InputView | undefined;
    private commandInput: InputView | undefined;
    private argsInput: InputView | undefined;

    constructor(props: { model: McpInspectorEditorModel; state: McpInspectorEditorState }) {
        super(props, document.createElement("span"));
        this.root.dataset.type = "mcp-transport-inputs";
    }

    protected onMount(): void {
        this.root.style.display = "contents";
        this.createInputs();
    }

    protected onUpdate(props: { model: McpInspectorEditorModel; state: McpInspectorEditorState }): void {
        this.props = props;
        this.updateInputs();
    }

    private createInputs(): void {
        const disabled = this.isDisabled();
        if (this.props.state.transportType === "http") {
            const panel = createPanelElement({ flex: true });
            this.urlInput = this.child(new InputView(this.urlProps(disabled)));
            panel.append(this.urlInput.root);
            this.root.append(panel);
            this.urlInput.mount();
            return;
        }
        this.commandInput = this.child(new InputView(this.commandProps(disabled)));
        const panel = createPanelElement({ flex: true });
        this.argsInput = this.child(new InputView(this.argsProps(disabled)));
        panel.append(this.argsInput.root);
        this.root.append(this.commandInput.root, panel);
        this.commandInput.mount();
        this.argsInput.mount();
    }

    private updateInputs(): void {
        const disabled = this.isDisabled();
        this.urlInput?.update(this.urlProps(disabled));
        this.commandInput?.update(this.commandProps(disabled));
        this.argsInput?.update(this.argsProps(disabled));
    }
    private isDisabled(): boolean {
        return this.props.state.connectionStatus === "connected" || this.props.state.connectionStatus === "connecting";
    }
    private urlProps(disabled: boolean) {
        return { name: "mcp-url", placeholder: untranslated("http://127.0.0.1:7865/mcp"), value: this.props.state.url,
            onChange: (value: string) => this.props.model.state.update((state) => { state.url = value; }),
            onKeyDown: this.onKeyDown, disabled, size: "sm" as const };
    }
    private commandProps(disabled: boolean) {
        return { name: "mcp-command", placeholder: t("tools.mcpCommandPlaceholder"), value: this.props.state.command,
            onChange: (value: string) => this.props.model.state.update((state) => { state.command = value; }),
            onKeyDown: this.onKeyDown, disabled, size: "sm" as const, width: 160 };
    }
    private argsProps(disabled: boolean) {
        return { name: "mcp-args", placeholder: t("tools.mcpArgsPlaceholder"), value: this.props.state.args,
            onChange: (value: string) => this.props.model.state.update((state) => { state.args = value; }),
            onKeyDown: this.onKeyDown, disabled, size: "sm" as const };
    }
    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const state = this.props.model.state.get();
        if (event.key === "Enter" && state.connectionStatus !== "connected" && state.connectionStatus !== "connecting") {
            void this.props.model.connect();
        }
    };
}

class EmptyErrorView extends VanillaView<Record<string, never>> {
    constructor() {
        super({}, document.createElement("div"));
        this.root.dataset.type = "mcp-empty-error";
    }
}

class ErrorBarView extends VanillaView<{ message: string }> {
    private text: HTMLSpanElement | undefined;

    constructor(props: { message: string }) {
        super(props, createPanelElement({ paddingX: "lg", paddingY: "xs", background: "light", borderBottom: true }));
    }

    protected onMount(): void {
        this.text = createTextElement(this.props.message, { size: "sm", color: "error" });
        this.root.append(this.text);
    }

    protected onUpdate(props: { message: string }): void {
        if (this.text) this.text.textContent = props.message;
    }
}

class EmptyServerBarView extends VanillaView<Record<string, never>> {
    constructor() {
        super({}, document.createElement("div"));
        this.root.dataset.type = "mcp-empty-server";
    }
}

class ServerBarView extends VanillaView<{ model: McpInspectorEditorModel; state: McpInspectorEditorState }> {
    private dot: DotView | undefined;
    private title: HTMLSpanElement | undefined;
    private version: HTMLSpanElement | undefined;
    private segments: SegmentedControlView | undefined;

    constructor(props: { model: McpInspectorEditorModel; state: McpInspectorEditorState }) {
        super(props, createPanelElement({ direction: "row", align: "center", gap: "md", paddingX: "lg", paddingY: "xs", borderBottom: true }));
    }

    protected onMount(): void {
        this.dot = this.child(new DotView({ size: "xs", color: dotColorFor(this.props.state.connectionStatus) }));
        this.title = createTextElement("", { size: "sm", color: "default", bold: true });
        this.segments = this.child(new SegmentedControlView({
            name: "mcp-panel-switch", items: this.panelSegments(this.props.model), value: this.props.state.activePanel,
            onChange: (value) => this.props.model.setActivePanel(value as McpPanelId), size: "sm",
        }));
        this.root.append(this.dot.root, this.title, this.segments.root);
        this.dot.mount();
        this.segments.mount();
        this.apply(this.props);
    }

    protected onUpdate(props: { model: McpInspectorEditorModel; state: McpInspectorEditorState }): void {
        this.apply(props);
    }

    private apply(props: { model: McpInspectorEditorModel; state: McpInspectorEditorState }): void {
        const state = props.state;
        this.dot?.update({ size: "xs", color: dotColorFor(state.connectionStatus) });
        if (this.title) this.title.textContent = state.serverTitle || state.serverName;
        if (state.serverVersion) {
            this.version ??= createTextElement("", { size: "sm", color: "light" });
            this.version.textContent = untranslated(`v${state.serverVersion}`);
            if (!this.version.parentNode && this.segments) this.root.insertBefore(this.version, this.segments.root);
        } else this.version?.remove();
        this.segments?.update({
            name: "mcp-panel-switch", items: this.panelSegments(props.model), value: state.activePanel,
            onChange: (value) => props.model.setActivePanel(value as McpPanelId), size: "sm",
        });
    }

    private panelSegments(model: McpInspectorEditorModel): ISegment[] {
        return model.availablePanels.map((id) => ({ value: id, label: t(PANEL_LABELS[id]) }));
    }
}
