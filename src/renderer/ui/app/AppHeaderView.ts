import { app } from "../../api/app";
import { autoloadService } from "../../api/autoload-service";
import { windowRecording } from "../../api/window-recording";
import { rendererProfileName } from "../../../shared/application-profile";
import { t } from "../../../shared/i18n/t";
import { errMessage } from "../../../shared/utils";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { themeState } from "../../theme/theme-state";
import type { RecordingRegion } from "../../../ipc/api-param-types";
import { createSystemButton, createWindowToggleButton, updateWindowToggle } from "./header-buttons";
import { GlobalMuteButtonView } from "./GlobalMuteButtonView";
import { HeaderQuickSettingsPopoverView } from "./HeaderQuickSettingsPopover";
import { HeaderStatusIndicatorsView } from "./HeaderStatusIndicatorsView";
import { RecordingControlsView } from "./RecordingControlsView";
import { snipToNewPage } from "../../api/shell/snip-to-new-page";

export interface AppHeaderViewProps {
    pageTabs: HTMLElement;
    rightPageTabs: HTMLElement;
}

export class AppHeaderView extends VanillaView<AppHeaderViewProps> {
    readonly popover: HeaderQuickSettingsPopoverView;
    private readonly status = this.child(new HeaderStatusIndicatorsView({}));
    private readonly recording = this.child(new RecordingControlsView({}));
    private readonly globalMute = this.child(new GlobalMuteButtonView({}));
    private readonly autoloadButton = this.child(new IconButtonView({
        name: "autoload-reload",
        size: "sm",
        icon: "refresh",
        title: t("shell.applicationScriptsNeedToBeReloadedClickToReload"),
        onClick: () => autoloadService.loadScripts(),
    }));
    private readonly autoloadWrap = document.createElement("span");
    private readonly zoomButton = document.createElement("button");
    private readonly toggleWindowButton = createWindowToggleButton((button, listener) => this.listen(button, "click", listener), () => app.window.toggleWindow());
    /** Retained so the theme binding can rebuild its glyph. */
    private readonly menuButton = document.createElement("button");
    private quickSettingsOpen = false;
    private readonly toggleSnipMenu = (): void => {
        this.quickSettingsOpen = !this.quickSettingsOpen;
        this.updateQuickSettingsPopover();
    };
    /** Bound once: the props pump must not hand the popover a fresh callback identity on every
     *  update (see the props-pump convention in `uikit/CLAUDE.md`). */
    private readonly runQuickSettingsSnip = (hideWindows: boolean): void => { void snipToNewPage(hideWindows); };
    private readonly runQuickSettingsRecord = (region: RecordingRegion): void => { void this.prepareRecording(region); };
    private readonly closeQuickSettingsPopover = (): void => {
        if (!this.quickSettingsOpen) return;
        this.quickSettingsOpen = false;
        this.updateQuickSettingsPopover();
    };

    public constructor(props: AppHeaderViewProps) {
        super(props, document.createElement("div"));
        this.root.className = "app-header";
        this.root.dataset.name = "app-header";
        this.popover = this.child(new HeaderQuickSettingsPopoverView({
            anchor: this.status.snipButton,
            open: false,
            placement: "bottom-end",
            onClose: this.closeQuickSettingsPopover,
            onSnip: this.runQuickSettingsSnip,
            onRecord: this.runQuickSettingsRecord,
        }));
    }

    protected onMount(): void {
        this.menuButton.type = "button";
        this.menuButton.dataset.name = "persephone-menu";
        this.menuButton.className = "app-button";
        this.menuButton.title = t("shell.menu");
        this.menuButton.append(createIconElement("persephone"));
        this.listen(this.menuButton, "click", () => app.window.toggleMenuBar());

        this.autoloadWrap.className = "autoload-reload";
        this.autoloadWrap.append(this.autoloadButton.root);
        this.zoomButton.type = "button";
        this.zoomButton.dataset.name = "zoom-indicator";
        this.zoomButton.className = "zoom-indicator";
        this.zoomButton.title = t("shell.resetZoom");
        this.listen(this.zoomButton, "click", () => app.window.resetZoom());
        const minimizeButton = createSystemButton("window-minimize", createIconElement("window-minimize"), t("shell.minimize"), (button, listener) => this.listen(button, "click", listener), () => app.window.minimize());
        const closeButton = createSystemButton("window-close", createIconElement("close"), t("shell.closeWindow"), (button, listener) => this.listen(button, "click", listener), () => app.window.close());
        const spacer = createPanelElement({ name: "app-header-spacer", flex: 1, minWidth: 40 });
        const profileName = rendererProfileName();
        const profileLabel = profileName ? document.createElement("span") : undefined;
        if (profileLabel && profileName) profileLabel.textContent = ` — ${profileName}`;

        this.root.append(this.menuButton, this.props.pageTabs, spacer, this.props.rightPageTabs, this.globalMute.root);
        if (profileLabel) this.root.append(profileLabel);
        this.root.append(this.autoloadWrap, this.zoomButton, this.recording.root, minimizeButton, this.toggleWindowButton, closeButton, this.status.root);

        this.listen(this.status.snipButton, "click", this.toggleSnipMenu);
        this.status.mount();
        this.globalMute.mount();
        this.recording.mount();
        this.autoloadButton.mount();
        this.bind(app.window.state, (state) => ({ isMaximized: state.isMaximized, zoomLevel: state.zoomLevel }), (state) => {
            this.zoomButton.classList.toggle("visible", state.zoomLevel !== 0);
            this.zoomButton.textContent = `${Math.round(Math.pow(1.2, state.zoomLevel) * 100)}%`;
            updateWindowToggle(this.toggleWindowButton, state.isMaximized, t("shell.restore"), t("shell.maximize"));
        });
        this.bind(autoloadService.state, (state) => state.needsReload, (visible) => { this.autoloadWrap.style.display = visible ? "" : "none"; });
        this.bind(themeState, (state) => state.isDark, () => {
            /**
             * `PersephoneIcon` is the one icon whose glyph depends on the theme: its DOM builder bakes the
             * light/dark background in at build time (`themeState.get()`), whereas the previous component read
             * `themeState.use()` and refreshed on a flip. A builder that returns a detached element cannot own a
             * subscription without leaking it, so keeping the glyph current is the owner's job —
             * this view rebuilds it. Without this, switching theme left the app-menu glyph on the previous
             * background until something else rebuilt the header.
             * Called once from `onMount`, so the binding lives as long as the view and the caller may
             * discard the returned handle.
             */
            const button = this.menuButton;
            if (!button) return;
            button.replaceChildren(createIconElement("persephone"));
        });
        this.popover.mount();
    }

    private updateQuickSettingsPopover(): void {
        this.popover.update({
            anchor: this.status.snipButton,
            open: this.quickSettingsOpen,
            placement: "bottom-end",
            onClose: this.closeQuickSettingsPopover,
            onSnip: this.runQuickSettingsSnip,
            onRecord: this.runQuickSettingsRecord,
        });
    }

    private async prepareRecording(region: RecordingRegion): Promise<void> {
        try { await windowRecording.prepare(region, true); }
        catch (error: unknown) { app.ui.notify(t("shell.recordingPrepareFailed", { error: errMessage(error) }), "error"); }
    }
}
