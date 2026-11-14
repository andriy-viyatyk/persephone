import { pages } from "../../api/pages";
import { t } from "../../../shared/i18n/t";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { MarkdownBlockView } from "../markdown/MarkdownBlockView";
import type { McpInspectorEditorState } from "./McpInspectorEditorModel";

export class ServerInfoPanelView extends VanillaView<{ state: McpInspectorEditorState }> {
    private markdown: MarkdownBlockView | undefined;

    constructor(props: { state: McpInspectorEditorState }) {
        super(props, createPanelElement({ direction: "column", flex: true, overflow: "auto", paddingX: "xl", paddingY: "lg", gap: "lg" }));
        this.root.dataset.type = "mcp-server-info";
    }

    protected onMount(): void {
        this.listen(this.root, "click", this.onClick);
        this.render(this.props.state);
    }

    protected onUpdate(props: { state: McpInspectorEditorState }): void {
        this.render(props.state);
    }

    protected onDispose(): void {
        this.markdown?.dispose();
        this.markdown = undefined;
    }

    private render(state: McpInspectorEditorState): void {
        this.markdown?.dispose();
        this.markdown = undefined;
        this.root.replaceChildren();
        const add = (label: string, value: string): void => this.root.append(createPanelElement(
            { direction: "column", gap: "xs" },
            [
                createTextElement(label, { size: "xs", variant: "uppercased", color: "light", bold: true }),
                createTextElement(value, { size: "sm", color: "default" }),
            ],
        ));
        add(t("tools.mcpServerName"), state.serverTitle || state.serverName);
        if (state.serverVersion) add(t("tools.mcpVersion"), state.serverVersion);
        if (state.serverDescription) add(t("tools.mcpDescription"), state.serverDescription);
        if (state.serverWebsiteUrl) {
            const panel = createPanelElement({ direction: "column", gap: "xs" });
            panel.append(createTextElement(t("tools.mcpWebsite"), { size: "xs", variant: "uppercased", color: "light", bold: true }));
            const link = document.createElement("a");
            link.href = state.serverWebsiteUrl;
            link.textContent = state.serverWebsiteUrl;
            panel.append(link);
            this.root.append(panel);
        }
        if (state.instructions) {
            const panel = createPanelElement({ direction: "column", gap: "xs", flex: true });
            panel.append(createTextElement(t("tools.mcpInstructions"), { size: "xs", variant: "uppercased", color: "light", bold: true }));
            const markdownPanel = createPanelElement({ flex: true, border: true, rounded: "md", overflow: "auto", paddingX: "lg", paddingY: "md" });
            this.markdown = new MarkdownBlockView({ content: state.instructions, compact: true });
            markdownPanel.append(this.markdown.root);
            this.root.append(panel);
            panel.append(markdownPanel);
            this.markdown.mount();
        }
    }

    private readonly onClick = (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof HTMLAnchorElement)) return;
        event.preventDefault();
        void pages.openUrlInBrowserTab(target.href);
    };
}
