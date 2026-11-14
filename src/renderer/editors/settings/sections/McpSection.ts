import { settings } from "../../../api/settings";
import type { AppSettingsKey } from "../../../api/settings-schema";
import { settingRange } from "../../../api/settings-schema";
import { createComponentModelDriver, type ComponentModelDriver } from "../../../core/state/model";
import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";
import { CheckboxField } from "../fields/CheckboxField";
import { PortField } from "../fields/PortField";
import { ColorizedCodeView } from "../../shared/ColorizedCodeView";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import type { ButtonProps } from "../../../uikit/Button/ButtonView";
import { DotView } from "../../../uikit/Dot/DotView";
import { SubtreeSwap } from "../../../uikit/shared/subtree-swap";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { t } from "../../../../shared/i18n/t";
import { mcpEndpointUrl } from "../../../../shared/mcp-endpoint";
import { McpSectionModel, defaultMcpSectionState, type McpSectionProps, type McpSectionState } from "./McpSectionModel";
import { createSectionRoot, helpHeader, panel, text } from "./settings-native";
import "../../../uikit/Button/Button.css";
import "../../../uikit/Dot/Dot.css";
interface StatusProps {
    status: { running: boolean; url: string; clientCount: number } | { running: boolean; url: string };
    mneme: boolean;
    copied: string | null;
    onCopy: (value: string, label: string) => void;
}

class McpStatusView extends VanillaView<StatusProps> {
    private readonly statusPanel: HTMLDivElement;
    private readonly urlPanel: HTMLDivElement;
    private readonly dot: DotView;
    private readonly statusText: HTMLSpanElement;
    private readonly urlText: HTMLSpanElement;
    private readonly copyButton: ButtonView;

    public constructor(props: StatusProps) {
        const statusPanel = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        const urlPanel = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        const root = document.createElement("div");
        root.dataset.type = "settings-mcp-status";
        super(props, root);
        this.statusPanel = statusPanel;
        this.urlPanel = urlPanel;
        this.dot = this.child(new DotView({ size: "sm", color: props.status.running ? "success" : "neutral" }));
        this.statusText = text("", { size: "sm", color: "light" });
        this.urlText = document.createElement("span");
        this.urlText.dataset.type = "settings-url";
        this.copyButton = this.child(new ButtonView(this.copyButtonProps(props)));
    }

    protected onMount(): void {
        this.statusPanel.append(this.dot.root, this.statusText);
        this.urlPanel.append(this.urlText, this.copyButton.root);
        this.root.append(this.statusPanel, this.urlPanel);
        this.dot.mount();
        this.copyButton.mount();
        this.applyProps(this.props);
    }

    protected onUpdate(props: StatusProps): void {
        this.applyProps(props);
    }

    protected onDispose(): void {
        this.root.replaceChildren();
    }

    private applyProps(props: StatusProps): void {
        const running = props.status.running;
        const status = props.status as { running: boolean; url: string; clientCount?: number };
        this.dot.update({ size: "sm", color: running ? "success" : "neutral" });
        this.statusText.textContent = props.mneme
            ? running ? t("settings.running") : t("settings.stopped")
            : running && status.clientCount && status.clientCount > 0
                ? t("settings.mcpRunningWithClients", { count: status.clientCount })
                : running ? t("settings.running") : t("settings.stopped");
        this.urlText.textContent = props.status.url;
        this.copyButton.update(this.copyButtonProps(props));
    }

    private copyButtonProps(props: StatusProps): ButtonProps {
        const label = props.mneme ? "mneme-url" : "url";
        return {
            variant: "default",
            size: "sm",
            background: "light",
            onClick: () => props.onCopy(props.status.url, label),
            children: props.copied === label ? t("settings.copied") : t("settings.copyUrl"),
        };
    }
}

export class McpSectionView extends VanillaView<Record<string, never>> {
    private driver: ComponentModelDriver<McpSectionState, McpSectionProps, McpSectionModel> | undefined;
    private model: McpSectionModel | undefined;
    private mcpPortField: PortField | undefined;
    private mnemePortField: PortField | undefined;
    private configCode: ColorizedCodeView | undefined;
    private configCopyButton: ButtonView | undefined;
    private mcpStatusSwap: SubtreeSwap<string> | undefined;
    private mnemeStatusSwap: SubtreeSwap<string> | undefined;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        const driver = createComponentModelDriver(
            this.currentProps(),
            McpSectionModel,
            defaultMcpSectionState,
        );
        this.driver = driver;
        const model = driver.model;
        this.model = model;
        this.own(() => driver.dispose());

        this.root.append(
        );
        const mcpRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        const mcpEnabled = this.child(new CheckboxField({ store: appSettingsStore as SettingsStore<boolean>, id: "mcp.enabled", label: t("settings.mcpEnable") }));
        mcpRow.append(mcpEnabled.root);
        mcpEnabled.mount();
        this.root.append(mcpRow);

        const tipsRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        const agentTips = this.child(new CheckboxField({ store: appSettingsStore as SettingsStore<boolean>, id: "agent-tips.enabled", label: t("settings.agentTipsEnable") }));
        tipsRow.append(agentTips.root);
        agentTips.mount();
        this.root.append(tipsRow);

        const mainScriptsRow = panel({ direction: "column", gap: "sm", paddingBottom: "lg" });
        const mainScripts = this.child(new CheckboxField({ store: appSettingsStore as SettingsStore<boolean>, id: "main.scripting.enabled", label: t("settings.mainScriptsEnable") }));
        mainScriptsRow.append(mainScripts.root);
        mainScriptsRow.append(text(t("settings.mainScriptsWarning"), { color: "light", size: "xs" }));
        mainScripts.mount();
        this.root.append(mainScriptsRow);

        const portRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        portRow.append(text(t("settings.portLabel"), { size: "sm" }));
        this.mcpPortField = this.child(new PortField({ store: appSettingsStore as SettingsStore<number>, id: "mcp.port", range: settingRange("mcp.port"), fallback: model.props.mcpPort, width: 72, disabled: model.props.mcpEnabled }));
        portRow.append(this.mcpPortField.root);
        this.mcpPortField.mount();
        this.root.append(portRow);

        const mcpStatusHost = document.createElement("div");
        mcpStatusHost.style.display = "contents";
        const mnemeStatusHost = document.createElement("div");
        mnemeStatusHost.style.display = "contents";
        this.root.append(mcpStatusHost);
        this.mcpStatusSwap = new SubtreeSwap(mcpStatusHost);
        this.root.append(
            helpHeader(t("settings.mnemeTitle"), t("settings.mnemeDescription"), (cleanup) => this.own(cleanup)),
        );
        const mnemeRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        const mnemeEnabled = this.child(new CheckboxField({ store: appSettingsStore as SettingsStore<boolean>, id: "mneme.enabled", label: t("settings.mnemeEnable") }));
        mnemeRow.append(mnemeEnabled.root);
        mnemeEnabled.mount();
        this.root.append(mnemeRow);
        const mnemePortRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        mnemePortRow.append(text(t("settings.portLabel"), { size: "sm" }));
        this.mnemePortField = this.child(new PortField({ store: appSettingsStore as SettingsStore<number>, id: "mneme.port", range: settingRange("mneme.port"), fallback: model.props.mnemePort, width: 72, disabled: model.props.mnemeEnabled }));
        mnemePortRow.append(this.mnemePortField.root);
        this.mnemePortField.mount();
        this.root.append(mnemePortRow);
        this.root.append(mnemeStatusHost);
        this.mnemeStatusSwap = new SubtreeSwap(mnemeStatusHost);

        this.root.append(
            panel({ paddingTop: "sm", paddingBottom: "md" }, text(t("settings.aiClientConfiguration"), { color: "light", size: "xs" })),
        );
        const code = document.createElement("pre");
        code.dataset.type = "settings-code";
        this.configCode = this.child(new ColorizedCodeView({ code: this.configJson(), language: "json" }));
        code.append(this.configCode.root);
        this.root.append(code, panel({ paddingTop: "md" }));
        const copyButton = this.child(new ButtonView({
            variant: "default", size: "sm", background: "light",
            onClick: () => this.model?.handleCopy(this.configJson(), "config"),
            children: t("settings.copy"),
        }));
        this.configCopyButton = copyButton;
        (this.root.lastElementChild as HTMLDivElement).append(copyButton.root);
        this.own(() => this.mcpStatusSwap?.dispose());
        this.own(() => this.mnemeStatusSwap?.dispose());
        this.configCode.mount();
        copyButton.mount();
        driver.mount();
        this.bind(model.state, (state) => state, (state) => this.syncState(state));
        const refresh = (): void => {
            driver.update(this.currentProps());
            this.syncState(model.state.get());
        };
        const settingsKeys = [
            "agent-tips.enabled", "mcp.enabled", "mcp.port", "main.scripting.enabled", "mneme.enabled", "mneme.port",
        ] as const satisfies readonly AppSettingsKey[];
        for (const key of settingsKeys) this.own(settings.watch(key, refresh));
    }

    protected onDispose(): void {
        this.driver = undefined;
        this.model = undefined;
        this.mcpPortField = undefined;
        this.mnemePortField = undefined;
        this.configCode = undefined;
        this.configCopyButton = undefined;
        this.mcpStatusSwap = undefined;
        this.mnemeStatusSwap = undefined;
    }

    private currentProps(): McpSectionProps {
        return {
            agentTipsEnabled: settings.get("agent-tips.enabled"),
            mcpEnabled: settings.get("mcp.enabled"),
            mcpPort: settings.get("mcp.port"),
            mainScriptsEnabled: settings.get("main.scripting.enabled"),
            mnemeEnabled: settings.get("mneme.enabled"),
            mnemePort: settings.get("mneme.port"),
        };
    }

    private configJson(): string {
        const model = this.model;
        const mcpPort = model?.props.mcpPort ?? settings.get("mcp.port");
        const mnemePort = model?.props.mnemePort ?? settings.get("mneme.port");
        const mcpServers: Record<string, { type: string; url: string }> = {
            persephone: { type: "http", url: mcpEndpointUrl(mcpPort) },
        };
        if (model?.props.mnemeEnabled ?? settings.get("mneme.enabled")) {
            mcpServers.mneme = { type: "http", url: mcpEndpointUrl(mnemePort) };
        }
        return JSON.stringify({ mcpServers }, null, 2);
    }

    private syncState(state: McpSectionState): void {
        const model = this.model;
        if (!model) return;
        this.mcpPortField?.setDisabled(model.props.mcpEnabled);
        this.mnemePortField?.setDisabled(model.props.mnemeEnabled);
        this.configCode?.update({ code: this.configJson(), language: "json" });
        const copyLabel = state.copied === "config" ? t("settings.copied") : t("settings.copy");
        this.configCopyButton?.update({
            variant: "default", size: "sm", background: "light",
            onClick: () => model.handleCopy(this.configJson(), "config"),
            children: copyLabel,
        });
        const mcpStatus = model.props.mcpEnabled ? state.status : null;
        if (mcpStatus) {
            this.mcpStatusSwap?.set(this.statusKey(mcpStatus, state.copied), () => {
                const view = new McpStatusView({ status: mcpStatus, mneme: false, copied: state.copied, onCopy: model.handleCopy });
                view.mount();
                return view;
            });
        } else this.mcpStatusSwap?.clear();
        const mnemeStatus = model.props.mnemeEnabled ? state.mnemeStatus : null;
        if (mnemeStatus) {
            this.mnemeStatusSwap?.set(this.statusKey(mnemeStatus, state.copied), () => {
                const view = new McpStatusView({ status: mnemeStatus, mneme: true, copied: state.copied, onCopy: model.handleCopy });
                view.mount();
                return view;
            });
        } else this.mnemeStatusSwap?.clear();
    }

    private statusKey(status: { running: boolean; url: string; clientCount?: number }, copied: string | null): string { return `${status.running}-${status.url}-${status.clientCount ?? 0}-${copied ?? ""}`; }
}
