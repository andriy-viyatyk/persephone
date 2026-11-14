import { t } from "../../../shared/i18n/t";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { McpInspectorEditorModel } from "./McpInspectorEditorModel";

export class HistoryPanelView extends VanillaView<{ model: McpInspectorEditorModel }> {
    private readonly actionButtons = new Set<ButtonView>();

    constructor(props: { model: McpInspectorEditorModel }) {
        super(props, document.createElement("div"));
    }

    protected onMount(): void {
        this.render();
    }

    protected onUpdate(): void {
        this.render();
    }

    private render(): void {
        this.actionButtons.forEach((button) => this.releaseChild(button));
        this.actionButtons.clear();
        this.root.replaceChildren();
        const count = this.props.model.historyCount;
        if (count === 0) {
            this.root.append(createTextElement(t("tools.mcpNoRequests"), { size: "sm", color: "light" }));
            return;
        }
        const panel = createPanelElement({ flex: true, direction: "column", align: "center", justify: "center", gap: "md" });
        panel.append(createTextElement(t("tools.mcpHistoryRequests", { count }), { size: "sm", color: "light" }));
        const buttons = createPanelElement({ direction: "row", gap: "md" });
        const show = this.child(new ButtonView({
            name: "mcp-open-history", variant: "default", size: "sm", onClick: this.showHistory,
            children: t("tools.mcpOpenLog"),
        }));
        const clear = this.child(new ButtonView({
            name: "mcp-clear-history", variant: "default", size: "sm", onClick: this.clearHistory,
            children: t("tools.mcpClearHistory"),
        }));
        this.actionButtons.add(show);
        this.actionButtons.add(clear);
        buttons.append(show.root, clear.root);
        panel.append(buttons);
        this.root.append(panel);
        show.mount();
        clear.mount();
    }

    private readonly showHistory = (): void => {
        void this.props.model.showHistory();
    };

    private readonly clearHistory = (): void => {
        this.props.model.clearHistory();
        this.render();
    };
}
