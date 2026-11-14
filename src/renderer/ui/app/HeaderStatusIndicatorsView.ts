import { AudioCaptureState } from "../../api/audio-capture-state";
import { mnemeStatusModel } from "../../api/mneme-status";
import { pages } from "../../api/pages";
import { app } from "../../api/app";
import { showMcpRequestLog } from "../../api/mcp/request-log";
import { windowRecording } from "../../api/window-recording";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { englishMessage, t } from "../../../shared/i18n/t";

interface HeaderWindowState {
    mcpRunning: boolean;
    mcpClientCount: number;
    inAppAgentCount: number;
}

export class HeaderStatusIndicatorsView extends VanillaView<object> {
    readonly snipButton = document.createElement("button");
    private readonly mnemeIndicator = document.createElement("span");
    private readonly mcpIndicator = document.createElement("span");
    private readonly audioCaptureIndicator = document.createElement("span");
    private readonly audioCaptureState = new AudioCaptureState();
    private hiddenChromeState: { hidden: boolean; display: string } | undefined;

    public constructor(props: object) {
        super(props, document.createElement("div"));
        this.root.className = "status-indicators";
        this.root.dataset.name = "status-indicators";
        this.snipButton.type = "button";
        this.snipButton.dataset.name = "header-snip-button";
        this.snipButton.className = "quick-settings-button";
        this.snipButton.title = t("shell.openQuickSettings");
        this.snipButton.append(createIconElement("more-horiz", { width: 28, height: 28 }));
        this.mnemeIndicator.dataset.name = "mneme-indicator";
        this.mnemeIndicator.className = "mneme-indicator";
        this.mcpIndicator.dataset.name = "mcp-indicator";
        this.mcpIndicator.className = "mcp-indicator";
        this.audioCaptureIndicator.className = "audio-capture-indicator";
        this.audioCaptureIndicator.dataset.name = "audio-capture-indicator";
        this.audioCaptureIndicator.textContent = "●";
        this.audioCaptureIndicator.setAttribute("aria-label", t("shell.audioCaptureActive"));
        this.audioCaptureIndicator.title = t("shell.audioCaptureActive");
        this.audioCaptureIndicator.hidden = true;
        this.root.append(this.snipButton, this.mnemeIndicator, this.mcpIndicator, this.audioCaptureIndicator);
    }

    protected onMount(): void {
        this.own(() => this.audioCaptureState.dispose());
        this.audioCaptureState.start();
        this.bind(
            this.audioCaptureState.state,
            (state) => state.count,
            (count) => { this.audioCaptureIndicator.hidden = count <= 0; },
        );
        this.bind(
            app.window.state,
            (state): HeaderWindowState => ({
                mcpRunning: state.mcpRunning,
                mcpClientCount: state.mcpClientCount,
                inAppAgentCount: state.inAppAgentCount,
            }),
            (state) => this.updateMcp(state),
        );
        this.bind(
            mnemeStatusModel.state,
            (state) => ({ enabled: state.enabled, running: state.running, modelReady: state.modelReady }),
            (state) => this.updateMneme(state),
        );
        this.own(windowRecording.subscribe((state) => this.updateChromeVisibility(state.hideStatusChrome)));
        this.listen(this.mcpIndicator, "click", () => { void showMcpRequestLog(); });
        this.listen(this.mnemeIndicator, "click", () => { void pages.standalonePages.show("mneme-config-page"); });
    }

    private updateMcp(state: HeaderWindowState): void {
        const mcpVisible = state.mcpRunning || state.inAppAgentCount > 0;
        const totalClients = state.mcpClientCount + state.inAppAgentCount;
        this.mcpIndicator.style.display = this.hiddenChromeState ? "none" : mcpVisible ? "" : "none";
        const externalTitle = state.mcpClientCount > 0
            ? t("shell.activeMcpConnections", { product: englishMessage("shell.mCP"), count: state.mcpClientCount } as never)
            : state.mcpRunning ? t("shell.mcpServerRunning", { product: englishMessage("shell.mCP") } as never) : "";
        const agentTitle = state.inAppAgentCount > 0
            ? t("shell.activeInAppMcpConnections", { count: state.inAppAgentCount } as never)
            : "";
        this.mcpIndicator.title = [externalTitle, agentTitle].filter(Boolean).join("; ");
        if (totalClients > 0) {
            const count = document.createElement("span");
            count.className = "mcp-count";
            count.textContent = `${state.mcpClientCount}/${state.inAppAgentCount}`;
            this.mcpIndicator.replaceChildren(count, document.createTextNode(" MCP"));
        } else {
            const dot = document.createElement("span");
            dot.className = "mcp-dot";
            this.mcpIndicator.replaceChildren(dot, document.createTextNode(" MCP"));
        }
    }

    private updateMneme(state: { enabled: boolean; running: boolean; modelReady: boolean }): void {
        this.mnemeIndicator.style.display = state.enabled ? "" : "none";
        const dotClass = state.running ? (state.modelReady ? "success" : "warning") : "neutral";
        this.mnemeIndicator.title = state.running
            ? (state.modelReady
                ? t("shell.mnemeActive", { product: englishMessage("shell.mneme") } as never)
                : t("shell.mnemeNoEmbedding", { product: englishMessage("shell.mneme") } as never))
            : t("shell.mnemeEnabledStopped", { product: englishMessage("shell.mneme") } as never);
        const dot = document.createElement("span");
        dot.className = `mneme-dot ${dotClass}`;
        this.mnemeIndicator.replaceChildren(dot, document.createTextNode(" Mneme"));
    }

    private updateChromeVisibility(hideStatusChrome: boolean | undefined): void {
        if (hideStatusChrome && !this.hiddenChromeState) {
            this.hiddenChromeState = { hidden: this.mcpIndicator.hidden, display: this.mcpIndicator.style.display };
        } else if (!hideStatusChrome && this.hiddenChromeState) {
            const previous = this.hiddenChromeState;
            this.hiddenChromeState = undefined;
            this.mcpIndicator.hidden = previous.hidden;
            this.mcpIndicator.style.display = previous.display;
        }
        if (this.hiddenChromeState) this.mcpIndicator.style.display = "none";
    }
}
