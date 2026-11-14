import { t } from "../../../shared/i18n/t";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { TagView } from "../../uikit/Tag/TagView";
import { KeyedList } from "../../uikit/shared/keyed-list";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { SavedMcpConnection } from "./McpConnectionStore";
import type { McpInspectorEditorModel, McpInspectorEditorState } from "./McpInspectorEditorModel";

export interface DisconnectedBodyProps {
    model: McpInspectorEditorModel;
    state: McpInspectorEditorState;
    connections: SavedMcpConnection[];
}

export class DisconnectedBodyView extends VanillaView<DisconnectedBodyProps> {
    private list: KeyedList<SavedMcpConnection, string, HTMLElement> | undefined;
    private content: HTMLDivElement | undefined;
    private status: HTMLSpanElement | undefined;
    private savedTitle: HTMLSpanElement | undefined;

    constructor(props: DisconnectedBodyProps) {
        super(props, createPanelElement({ flex: true, align: "center", justify: "center", overflow: "auto" }));
    }

    protected onMount(): void {
        this.content = createPanelElement({ direction: "column", width: "100%", maxWidth: 560, paddingX: "xl", gap: "sm" });
        this.root.append(this.content);
        const host = document.createElement("div");
        host.style.display = "contents";
        this.content.append(host);
        this.list = new KeyedList(host, {
            keyOf: (connection) => connection.id,
            create: (connection) => {
                const row = new SavedConnectionRowView({ connection, state: this.props.state, model: this.props.model });
                row.mount();
                return row.root;
            },
            update: (element, connection) => (element as SavedRowRoot).view?.update({
                connection,
                state: this.props.state,
                model: this.props.model,
            }),
            remove: (element) => (element as SavedRowRoot).view?.dispose(),
        });
        this.own(() => this.list?.dispose());
        this.content.append(createTextElement(t("tools.mcpConnectionClick"), { size: "xs", color: "light" }));
        this.sync(this.props);
    }

    protected onUpdate(props: DisconnectedBodyProps): void {
        this.sync(props);
    }

    private sync(props: DisconnectedBodyProps): void {
        const content = this.content;
        if (!content) return;
        const saved = props.connections.length > 0 && props.state.connectionStatus === "disconnected";
        if (saved) {
            this.status?.remove();
            this.status = undefined;
            if (!this.savedTitle) {
                this.savedTitle = createTextElement(t("tools.mcpSavedConnections"), { size: "base", color: "default", bold: true });
                this.savedTitle.dataset.part = "saved-title";
                content.insertBefore(this.savedTitle, content.firstChild);
            }
            this.list?.update(props.connections);
        } else {
            this.list?.clear();
            this.savedTitle?.remove();
            this.savedTitle = undefined;
            const message = props.state.connectionStatus === "error"
                ? t("tools.mcpConnectionFailed")
                : props.state.connectionStatus === "connecting"
                    ? t("tools.mcpConnecting")
                    : t("tools.mcpGetStarted");
            this.status ??= createTextElement("", { size: "sm", color: "light", align: "center" });
            this.status.dataset.part = "status";
            this.status.textContent = message;
            if (!this.status.parentNode) content.insertBefore(this.status, content.firstChild);
        }
    }
}

type SavedRowRoot = HTMLElement & { view?: SavedConnectionRowView };

class SavedConnectionRowView extends VanillaView<{
    connection: SavedMcpConnection;
    state: McpInspectorEditorState;
    model: McpInspectorEditorModel;
}> {
    private text: HTMLSpanElement | undefined;
    private tag: TagView | undefined;
    private close: IconButtonView | undefined;

    constructor(props: { connection: SavedMcpConnection; state: McpInspectorEditorState; model: McpInspectorEditorModel }) {
        super(props, createPanelElement({ direction: "row", align: "center", gap: "md", paddingX: "lg", paddingY: "sm", border: true, rounded: "md", revealChildrenOnHover: true }));
        (this.root as SavedRowRoot).view = this;
    }

    protected onMount(): void {
        this.listen(this.root, "click", () => this.props.model.fillFromSaved(this.props.connection));
        const textPanel = createPanelElement({ direction: "column", flex: true, overflow: "hidden", minWidth: 0 });
        this.text = createTextElement("", { size: "sm", color: "default", truncate: true });
        textPanel.append(this.text);
        this.tag = this.child(new TagView({ label: "", size: "sm" }));
        this.close = this.child(new IconButtonView({
            icon: "close",
            size: "sm",
            title: t("tools.mcpDeleteConnection"),
            hideUntilParentHover: true,
            onClick: (event) => {
                event.stopPropagation();
                void this.props.model.deleteSavedConnection(this.props.connection.id);
            },
        }));
        this.root.append(textPanel, this.tag.root, this.close.root);
        this.tag.mount();
        this.close.mount();
        this.apply(this.props);
    }

    protected onUpdate(props: { connection: SavedMcpConnection; state: McpInspectorEditorState; model: McpInspectorEditorModel }): void {
        this.apply(props);
    }
    protected onDispose(): void {
        delete (this.root as SavedRowRoot).view;
    }

    private apply(props: { connection: SavedMcpConnection; state: McpInspectorEditorState; model: McpInspectorEditorModel }): void {
        const connection = props.connection;
        this.text!.textContent = connection.transport === "http" ? connection.url : `${connection.command} ${connection.args}`;
        this.tag!.update({ label: connection.transport.toUpperCase(), size: "sm" });
        const active = connection.transport === props.state.transportType && (connection.transport === "http"
            ? connection.url === props.state.url
            : connection.command === props.state.command && connection.args === props.state.args);
        if (active) this.root.dataset.bg = "light";
        else delete this.root.dataset.bg;
    }
}
