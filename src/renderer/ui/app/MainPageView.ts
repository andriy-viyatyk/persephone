import { englishMessage, t } from "../../../shared/i18n/t";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createIconElement } from "../../uikit/shared/slots";
import type { IconName } from "../../theme/icon-registry";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { themeState } from "../../theme/theme-state";
import { app } from "../../api/app";
import { autoloadService } from "../../api/autoload-service";
import { mnemeStatusModel } from "../../api/mneme-status";
import { pagesModel } from "../../api/pages";
import { windowRecording, type WindowRecordingState } from "../../api/window-recording";
import type { RecordingRegion } from "../../../ipc/api-param-types";
import { showMcpRequestLog } from "../../api/mcp-handler";
import { errMessage } from "../../../shared/utils";
import { PageTabsView } from "../tabs/PageTabsView";
import { MenuBarView } from "../sidebar/MenuBarView";
import { PagesView } from "./PagesView";
import { HeaderQuickSettingsPopoverView } from "./HeaderQuickSettingsPopover";
import "./MainPage.css";

async function runSnip(hideWindows: boolean): Promise<void> {
    try {
        const dataUrl = await app.shell.startScreenSnip(hideWindows);
        if (!dataUrl) return;
        const blob = await (await fetch(dataUrl)).blob();
        const blobUrl = URL.createObjectURL(blob);
        await pagesModel.openImageInNewTab(blobUrl, "Snip");
    } catch (error) {
        app.ui.notify(t("shell.snipFailed", { product: englishMessage("shell.snipProduct"), error: errMessage(error) } as never), "error");
    }
}

interface MainPageState {
    isMaximized: boolean;
    zoomLevel: number;
    mcpRunning: boolean;
    mcpClientCount: number;
}

export class MainPageView extends VanillaView<object> {
    private readonly header = document.createElement("div");
    private readonly pagesContainer = document.createElement("div");
    private readonly pageTabs: PageTabsView;
    private readonly pages: PagesView;
    private readonly menuBar: MenuBarView;
    private readonly autoloadButton: IconButtonView;
    private readonly autoloadWrap = document.createElement("span");
    private readonly zoomButton = document.createElement("button");
    private readonly toggleWindowButton = document.createElement("button");
    private readonly statusIndicators = document.createElement("div");
    private readonly recordingControls = document.createElement("div");
    private readonly mnemeIndicator = document.createElement("span");
    private readonly mcpIndicator = document.createElement("span");
    private hiddenChromeState: { controlsHidden: boolean; controlsDisplay: string; mcpHidden: boolean; mcpDisplay: string } | undefined;
    private readonly snipButton = document.createElement("button");
    private readonly toggleMenuBar = (): void => app.window.toggleMenuBar();
    private readonly closeMenuBar = (): void => app.window.menuBar.close();
    private quickSettingsOpen = false;
    private readonly quickSettingsPopover: HeaderQuickSettingsPopoverView;
    /** Bound once: the props pump must not hand the popover a fresh callback identity on every
     *  update (see the props-pump convention in `uikit/CLAUDE.md`). */
    private readonly runQuickSettingsSnip = (hideWindows: boolean): void => { void runSnip(hideWindows); };
    private readonly runQuickSettingsRecord = (region: RecordingRegion): void => { void this.prepareRecording(region); };
    private readonly closeQuickSettingsPopover = (): void => {
        if (!this.quickSettingsOpen) return;
        this.quickSettingsOpen = false;
        this.quickSettingsPopover.update(this.quickSettingsPopoverProps());
    };

    public constructor(props: object) {
        super(props);
        this.root.className = "app-root";
        this.pageTabs = this.child(new PageTabsView({}));
        this.pages = this.child(new PagesView({}));
        this.menuBar = this.child(new MenuBarView({ open: false, onClose: this.closeMenuBar }));
        this.autoloadButton = this.child(new IconButtonView({ name: "autoload-reload", size: "sm", icon: "refresh", title: t("shell.applicationScriptsNeedToBeReloadedClickToReload"), onClick: () => autoloadService.loadScripts() }));
        this.quickSettingsPopover = this.child(new HeaderQuickSettingsPopoverView({
            anchor: this.snipButton,
            open: false,
            placement: "bottom-end",
            onClose: this.closeQuickSettingsPopover,
            onSnip: this.runQuickSettingsSnip,
            onRecord: this.runQuickSettingsRecord,
        }));
    }

    protected onMount(): void {
        this.buildHeader();
        const content = document.createElement("div");
        content.className = "app-content";
        content.dataset.name = "app-content";
        this.pagesContainer.className = "pages-container";
        this.pagesContainer.dataset.name = "pages-container";
        this.pagesContainer.append(this.pages.root);
        content.append(this.pagesContainer, this.menuBar.root);
        this.root.append(this.header, content);
        this.pageTabs.mount();
        this.pages.mount();
        this.menuBar.mount();
        this.autoloadWrap.className = "autoload-reload";
        this.autoloadWrap.append(this.autoloadButton.root);
        this.autoloadButton.mount();
        this.bind(app.window.state, (state): MainPageState => state, (state) => this.updateIndicators(state));
        this.bind(app.window.menuBar.state, (state) => state.isOpen, (open) => {
            this.menuBar.update({ open, onClose: this.closeMenuBar });
        });
        this.bind(autoloadService.state, (state) => state.needsReload, (visible) => { this.autoloadWrap.style.display = visible ? "" : "none"; });
        this.bind(
            mnemeStatusModel.state,
            (state) => ({ enabled: state.enabled, running: state.running, modelReady: state.modelReady }),
            (state) => this.updateMneme(state),
        );
        this.bindMenuGlyphToTheme();
        this.own(windowRecording.subscribe((state) => this.updateRecordingControls(state)));
        this.quickSettingsPopover.mount();
    }

    /** Retained so the theme binding can rebuild its glyph — see `bindMenuGlyphToTheme`. */
    private menuButton: HTMLButtonElement | undefined;

    private buildHeader(): void {
        this.header.className = "app-header";
        this.header.dataset.name = "app-header";
        this.menuButton = this.createButton("persephone-menu", "app-button", t("shell.menu"), createIconElement("persephone"), () => app.window.toggleMenuBar());
        this.header.append(this.menuButton, this.pageTabs.root);
        this.header.append(createPanelElement({ name: "app-header-spacer", flex: 1, minWidth: 40 }));
        this.autoloadWrap.className = "autoload-reload";
        this.recordingControls.className = "recording-controls";
        this.recordingControls.dataset.name = "window-recording-controls";
        this.recordingControls.hidden = true;
        this.header.append(this.autoloadWrap, this.buildZoomButton(), this.recordingControls, this.createSystemButton("window-minimize", createIconElement("window-minimize"), t("shell.minimize"), () => app.window.minimize()), this.toggleWindowButton, this.createSystemButton("window-close", createIconElement("close"), t("shell.closeWindow"), () => app.window.close()));
        this.toggleWindowButton.className = "system-button darkBackground";
        this.toggleWindowButton.type = "button";
        this.toggleWindowButton.dataset.name = "window-toggle";
        this.listen(this.toggleWindowButton, "click", () => app.window.toggleWindow());
        this.statusIndicators.className = "status-indicators";
        this.statusIndicators.dataset.name = "status-indicators";
        this.snipButton.type = "button";
        this.snipButton.dataset.name = "header-snip-button";
        this.snipButton.className = "quick-settings-button";
        this.snipButton.title = t("shell.openQuickSettings");
        this.snipButton.append(createIconElement("more-horiz", { width: 28, height: 28 }));
        this.listen(this.snipButton, "click", () => this.toggleSnipMenu());
        this.statusIndicators.append(this.snipButton, this.mnemeIndicator, this.mcpIndicator);
        this.header.append(this.statusIndicators);
        this.root.append(this.quickSettingsPopover.root);
    }

    /**
     * `PersephoneIcon` is the one icon whose glyph depends on the theme: its DOM builder bakes the
     * light/dark background in at build time (`themeState.get()`), whereas the previous component read
     * `themeState.use()` and refreshed on a flip. A builder that returns a detached element cannot own a
     * subscription without leaking it, so keeping the glyph current is the owner's job —
     * this view rebuilds it. Without this, switching theme left the app-menu glyph on the previous
     * background until something else rebuilt the header (EPIC-064 E6-6 concern 1).
     * Called once from `onMount`, so the binding lives as long as the view and the caller may
     * discard the returned handle.
     */
    private bindMenuGlyphToTheme(): () => void {
        return this.bind(themeState, (state) => state.isDark, () => {
            const button = this.menuButton;
            if (!button) return;
            button.replaceChildren(createIconElement("persephone"));
        });
    }

    private createButton(name: string, className: string, title: string, icon: SVGElement, onClick: () => void): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.name = name;
        button.className = className;
        button.title = title;
        button.append(icon);
        this.listen(button, "click", onClick);
        return button;
    }

    private createSystemButton(name: string, icon: SVGElement, title: string, onClick: () => void): HTMLButtonElement {
        return this.createButton(name, `system-button darkBackground${name === "window-close" ? " close-button" : ""}`, title, icon, onClick);
    }

    private buildZoomButton(): HTMLButtonElement {
        this.zoomButton.type = "button";
        this.zoomButton.dataset.name = "zoom-indicator";
        this.zoomButton.className = "zoom-indicator";
        this.zoomButton.title = t("shell.resetZoom");
        this.listen(this.zoomButton, "click", () => app.window.resetZoom());
        return this.zoomButton;
    }

    private updateIndicators(state: MainPageState): void {
        this.zoomButton.classList.toggle("visible", state.zoomLevel !== 0);
        this.zoomButton.textContent = `${Math.round(Math.pow(1.2, state.zoomLevel) * 100)}%`;
        this.toggleWindowButton.replaceChildren(createIconElement(state.isMaximized ? "window-restore" : "window-maximize"));
        this.toggleWindowButton.title = state.isMaximized ? t("shell.restore") : t("shell.maximize");
        this.mcpIndicator.style.display = this.hiddenChromeState ? "none" : state.mcpRunning ? "" : "none";
        this.mcpIndicator.dataset.name = "mcp-indicator";
        this.mcpIndicator.className = "mcp-indicator";
        this.mcpIndicator.title = state.mcpClientCount > 0
            ? t("shell.activeMcpConnections", { product: englishMessage("shell.mCP"), count: state.mcpClientCount } as never)
            : t("shell.mcpServerRunning", { product: englishMessage("shell.mCP") } as never);
        this.mcpIndicator.onclick = () => showMcpRequestLog();
        if (state.mcpClientCount > 0) {
            const count = document.createElement("span");
            count.className = "mcp-count";
            count.textContent = String(state.mcpClientCount);
            this.mcpIndicator.replaceChildren(count, document.createTextNode(" MCP"));
        } else {
            const dot = document.createElement("span");
            dot.className = "mcp-dot";
            this.mcpIndicator.replaceChildren(dot, document.createTextNode(" MCP"));
        }
    }

    private updateMneme(state: { enabled: boolean; running: boolean; modelReady: boolean }): void {
        this.mnemeIndicator.style.display = state.enabled ? "" : "none";
        this.mnemeIndicator.dataset.name = "mneme-indicator";
        this.mnemeIndicator.className = "mneme-indicator";
        const dotClass = state.running ? (state.modelReady ? "success" : "warning") : "neutral";
        this.mnemeIndicator.title = state.running
            ? (state.modelReady
                ? t("shell.mnemeActive", { product: englishMessage("shell.mneme") } as never)
                : t("shell.mnemeNoEmbedding", { product: englishMessage("shell.mneme") } as never))
            : t("shell.mnemeEnabledStopped", { product: englishMessage("shell.mneme") } as never);
        this.mnemeIndicator.onclick = () => pagesModel.showMnemeConfigPage();
        const dot = document.createElement("span");
        dot.className = `mneme-dot ${dotClass}`;
        this.mnemeIndicator.replaceChildren(dot, document.createTextNode(" Mneme"));
    }

    private toggleSnipMenu(): void {
        this.quickSettingsOpen = !this.quickSettingsOpen;
        this.quickSettingsPopover.update(this.quickSettingsPopoverProps());
    }

    private quickSettingsPopoverProps(): {
        anchor: HTMLElement;
        open: boolean;
        placement: "bottom-end";
        onClose: () => void;
        onSnip: (hideWindows: boolean) => void;
        onRecord: (region: RecordingRegion) => void;
    } {
        return {
            anchor: this.snipButton,
            open: this.quickSettingsOpen,
            placement: "bottom-end",
            onClose: this.closeQuickSettingsPopover,
            onSnip: this.runQuickSettingsSnip,
            onRecord: this.runQuickSettingsRecord,
        };
    }

    private async prepareRecording(region: RecordingRegion): Promise<void> {
        try { await windowRecording.prepare(region, true); }
        catch (error: unknown) { app.ui.notify(t("shell.recordingPrepareFailed", { error: errMessage(error) }), "error"); }
    }

    private recordingParts: { dot: HTMLSpanElement; elapsed: HTMLSpanElement; start: HTMLButtonElement; cancel: HTMLButtonElement; pause: HTMLButtonElement; resume: HTMLButtonElement; stop: HTMLButtonElement } | undefined;

    /** Built once and updated in place: the elapsed timer ticks every 200 ms, and rebuilding the
     *  buttons on each tick would swallow a click whose target is replaced mid-press. */
    private updateRecordingControls(state: WindowRecordingState): void {
        const restoringChrome = !state.hideStatusChrome && this.hiddenChromeState !== undefined;
        if (state.hideStatusChrome && !this.hiddenChromeState) {
            this.hiddenChromeState = {
                controlsHidden: this.recordingControls.hidden, controlsDisplay: this.recordingControls.style.display,
                mcpHidden: this.mcpIndicator.hidden, mcpDisplay: this.mcpIndicator.style.display,
            };
        } else if (!state.hideStatusChrome && this.hiddenChromeState) {
            const previous = this.hiddenChromeState;
            this.hiddenChromeState = undefined;
            this.recordingControls.hidden = previous.controlsHidden;
            this.recordingControls.style.display = previous.controlsDisplay;
            this.mcpIndicator.hidden = previous.mcpHidden;
            this.mcpIndicator.style.display = previous.mcpDisplay;
        }
        const parts = this.recordingParts ??= this.buildRecordingControls();
        if (!restoringChrome) this.recordingControls.hidden = state.status === "idle";
        this.recordingControls.dataset.status = state.status;
        const seconds = Math.floor(state.elapsedMs / 1000);
        parts.elapsed.textContent = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
        parts.start.hidden = parts.cancel.hidden = state.status !== "ready";
        parts.pause.hidden = state.status !== "recording";
        parts.resume.hidden = state.status !== "paused";
        parts.stop.hidden = state.status !== "recording" && state.status !== "paused";
        if (this.hiddenChromeState) {
            this.recordingControls.hidden = true;
            this.mcpIndicator.style.display = "none";
        }
    }

    private buildRecordingControls(): NonNullable<MainPageView["recordingParts"]> {
        const dot = document.createElement("span");
        dot.dataset.name = "recording-indicator";
        const elapsed = document.createElement("span");
        elapsed.dataset.name = "recording-elapsed";
        const parts = {
            dot,
            elapsed,
            start: this.recordingButton("recording-start", "circle", t("shell.start"), () => this.startPreparedRecording()),
            cancel: this.recordingButton("recording-cancel", "close", t("common.cancel"), () => { void windowRecording.cancel(); }),
            pause: this.recordingButton("recording-pause", "pause", t("shell.pause"), () => { void windowRecording.pause(); }),
            resume: this.recordingButton("recording-resume", "play", t("shell.resume"), () => { void windowRecording.resume(); }),
            stop: this.recordingButton("recording-stop", "stop", t("shell.stop"), () => {
                void windowRecording.stop("user").catch((error: unknown) => app.ui.notify(t("shell.recordingFinishFailed", { error: errMessage(error) }), "error"));
            }),
        };
        this.recordingControls.append(dot, elapsed, parts.start, parts.pause, parts.resume, parts.stop, parts.cancel);
        return parts;
    }

    private recordingButton(name: string, icon: IconName, label: string, action: () => void): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.name = name;
        button.title = label;
        const text = document.createElement("span");
        text.textContent = label;
        button.append(createIconElement(icon), text);
        this.listen(button, "click", action);
        return button;
    }

    private startPreparedRecording(): void {
        try { windowRecording.startPrepared(); }
        catch (error: unknown) {
            void windowRecording.cancel();
            app.ui.notify(t("shell.recordingStartFailed", { error: errMessage(error) }), "error");
        }
    }
}
