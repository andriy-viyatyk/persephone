import { t } from "../../../shared/i18n/t";
import { pages } from "../../api/pages";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { SegmentedControlView, type SegmentedControlProps } from "../../uikit/SegmentedControl/SegmentedControlView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { HubTab } from "../../editors/tools-hub";
import { EditorsTreeView } from "./EditorsTreeView";
import { TrustedToolsListView } from "./TrustedToolsListView";
import "./ToolsEditorsPanel.css";

type PanelTab = "editors" | "tools";
export interface ToolsEditorsPanelProps { onClose?: () => void }

function panelTabToHubTab(tab: PanelTab): HubTab { return tab === "editors" ? "editors" : "tools"; }

export class ToolsEditorsPanelView extends VanillaView<ToolsEditorsPanelProps> {
    private tab: PanelTab = "editors";
    private readonly header = document.createElement("div");
    private readonly tabsHost = document.createElement("div");
    private readonly body = document.createElement("div");
    private readonly openButton: IconButtonView;
    private readonly tabs: SegmentedControlView;
    private bodyView: VanillaView<{ onClose?: () => void }> | undefined;
    private previousOnClose: (() => void) | undefined;
    private readonly tabsProps: SegmentedControlProps = {
        name: "tools-editors-tabs", size: "sm", value: this.tab,
        onChange: (value) => this.onTabChange(value),
        items: [
            { value: "editors", label: t("shell.editorCategoryEditorsTab") },
            { value: "tools", label: t("shell.tools") },
        ],
    };

    public constructor(props: ToolsEditorsPanelProps) {
        super(props);
        this.openButton = new IconButtonView({ name: "tools-editors-open-in-tab", size: "sm", icon: "new-window", title: t("shell.openInNewTab2"), onClick: () => this.openInNewTab() });
        this.tabs = new SegmentedControlView(this.tabsProps);
        this.previousOnClose = props.onClose;
    }

    protected onMount(): void {
        this.root.dataset.type = "tools-editors-panel";
        this.header.dataset.part = "header";
        this.tabsHost.dataset.part = "tabs";
        this.body.dataset.part = "body";
        this.root.append(this.header, this.tabsHost, this.body);
        this.child(this.openButton).mount();
        this.header.append(this.openButton.root);
        this.child(this.tabs).mount();
        this.tabsHost.append(this.tabs.root);
        this.mountBody();
    }

    protected onUpdate(props: ToolsEditorsPanelProps): void {
        if (props.onClose === this.previousOnClose) return;
        this.previousOnClose = props.onClose;
        this.bodyView?.update({ onClose: props.onClose });
    }

    private onTabChange(value: string): void {
        const next = value as PanelTab;
        if (next === this.tab) return;
        this.tab = next;
        this.tabsProps.value = next;
        this.tabs.update(this.tabsProps);
        this.mountBody();
    }

    private mountBody(): void {
        if (this.bodyView) this.releaseChild(this.bodyView);
        this.bodyView?.root.remove();
        const view = this.tab === "editors"
            ? new EditorsTreeView({ onClose: this.props.onClose })
            : new TrustedToolsListView({ onClose: this.props.onClose });
        this.bodyView = view;
        this.body.append(view.root);
        this.child(view).mount();
    }

    private openInNewTab(): void {
        void pages.standalonePages.show("tools-hub-page", { tab: panelTabToHubTab(this.tab) }).then((): undefined => undefined);
        this.props.onClose?.();
    }
}
