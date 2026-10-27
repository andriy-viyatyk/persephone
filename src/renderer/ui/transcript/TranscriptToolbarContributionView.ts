import { MenuView } from "../../uikit/Menu/MenuView";
import type { MenuItem } from "../../core/events/context-menu";
import { ButtonView, type ButtonViewProps } from "../../uikit/Button/ButtonView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { api } from "../../../ipc/renderer/api";
import { EventEndpoint } from "../../../ipc/api-types";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import { t } from "../../../shared/i18n/t";
import { TranscriptController, type TranscriptSource, type TranscriptState } from "./TranscriptController";
import "./TranscriptToolbarContributionView.css";

interface TranscriptToolbarProps { controller: TranscriptController }

export class TranscriptToolbarContributionView extends VanillaView<TranscriptToolbarProps> {
    private readonly button: ButtonView;
    private readonly menu: MenuView;
    private readonly meter = document.createElement("span");
    private readonly items: MenuItem[];
    private available = false;
    private menuOpen = false;
    private state: TranscriptState = { status: "idle", level: 0 };
    private loadingProviders = false;

    public constructor(props: TranscriptToolbarProps) {
        super(props, document.createElement("span"));
        this.root.dataset.type = "transcript-toolbar-contribution";
        this.root.dataset.name = "transcript-toolbar";
        this.root.hidden = true;
        this.meter.dataset.part = "level";
        this.meter.dataset.name = "transcript-level";
        this.meter.setAttribute("role", "meter");
        this.meter.setAttribute("aria-label", t("transcript.audioLevel"));
        this.meter.setAttribute("aria-valuemin", "0");
        this.meter.setAttribute("aria-valuemax", "100");
        this.items = [
            { id: "transcript-mode-both", label: t("transcript.both"), onClick: () => this.start("both"), disabled: process.platform !== "win32" },
            { id: "transcript-mode-computer-audio", label: t("transcript.computerAudio"), onClick: () => this.start("computer"), disabled: process.platform !== "win32" },
            { id: "transcript-mode-microphone-me", label: t("transcript.microphoneMe"), onClick: () => this.start("microphone") },
        ];
        this.button = this.child(new ButtonView(this.buttonProps()));
        this.menu = this.child(new MenuView({
            name: "transcript-source-menu",
            elementRef: this.button.root,
            placement: "bottom-end",
            open: false,
            items: this.items,
            onClose: this.onMenuClose,
        }));
    }

    protected onMount(): void {
        this.root.append(this.button.root, this.meter, this.menu.root);
        this.meter.hidden = true;
        this.button.mount();
        this.menu.mount();
        void this.refreshProviders();
        this.own(rendererEvents[EventEndpoint.eBoardTrustChanged].subscribe(() => { void this.refreshProviders(); }));
    }

    protected onUpdate(props: TranscriptToolbarProps): void {
        if (props.controller !== this.props.controller) this.updateState({ status: "idle", level: 0 });
    }

    protected onDispose(): void {
        this.props.controller.dispose();
    }

    public updateState(state: TranscriptState): void {
        this.state = state;
        this.meter.hidden = state.status === "idle";
        const level = Math.round(Math.min(1, Math.max(0, state.level * 2.6)) * 100);
        this.meter.setAttribute("aria-valuenow", String(level));
        this.meter.style.setProperty("--transcript-level", `${level}%`);
        this.sync();
    }

    private readonly onMenuClose = (itemClicked: boolean): void => {
        this.menuOpen = false;
        if (!itemClicked) this.menu.update(this.menuProps());
    };

    private readonly toggle = (): void => {
        if (this.state.status !== "idle") { void this.props.controller.stop(); return; }
        this.menuOpen = !this.menuOpen;
        this.menu.update(this.menuProps());
    };

    private readonly start = (source: TranscriptSource): void => {
        this.menuOpen = false;
        this.menu.update(this.menuProps());
        void this.props.controller.start(source).then(() => this.sync());
    };

    private async refreshProviders(): Promise<void> {
        if (this.loadingProviders || this.isDisposed) return;
        this.loadingProviders = true;
        try { this.available = (await api.getBoardServiceProviders("speech.transcribe")).some((item) => item.version === 1); }
        catch { this.available = false; }
        finally { this.loadingProviders = false; }
        this.sync();
    }

    private sync(): void {
        this.button.update(this.buttonProps());
        this.menu.update(this.menuProps());
        this.root.hidden = !this.available && this.state.status === "idle";
    }

    private buttonProps(): ButtonViewProps {
        const active = this.state.status !== "idle";
        return {
            name: active ? "transcript-stop" : "transcript-button",
            variant: "ghost",
            size: "sm",
            icon: active ? "stop" : "volume",
            children: active ? t("transcript.stopLabel") : t("transcript.button"),
            title: active ? t("transcript.stop") : t("transcript.button"),
            disabled: !active && !this.available,
            onClick: this.toggle,
            "aria-label": active ? t("transcript.stop") : t("transcript.button"),
        };
    }

    private menuProps() {
        return {
            name: "transcript-source-menu",
            elementRef: this.button.root,
            placement: "bottom-end" as const,
            open: this.menuOpen && this.state.status === "idle",
            items: this.items,
            onClose: this.onMenuClose,
        };
    }
}
