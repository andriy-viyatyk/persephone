import { rendererProfileName } from "../../../../shared/application-profile";
import { TComponentState } from "../../../core/state/state";
import { api } from "../../../../ipc/renderer/api";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import type { ButtonProps } from "../../../uikit/Button/ButtonView";
import { SubtreeSwap } from "../../../uikit/shared/subtree-swap";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { t } from "../../../../shared/i18n/t";
import { createSectionRoot, panel, text } from "./settings-native";
import { isLinux } from "../../../../shared/platform";
import { getPlatformFeature } from "../../../../shared/platform-features";
import { errMessage } from "../../../../shared/utils";
import { ui } from "../../../api/ui";

const defaultDefaultBrowserSectionState = {
    registered: null as boolean | null,
    busy: false,
};

type DefaultBrowserSectionState = typeof defaultDefaultBrowserSectionState;
type DefaultBrowserStatus = DefaultBrowserSectionState["registered"];

class DefaultBrowserStatusView extends VanillaView<{ registered: DefaultBrowserStatus; busy: boolean; onRegister: () => void; onUnregister: () => void; onOpenSettings: () => void }> {
    private readonly statusPanel: HTMLDivElement;
    private readonly controls: ButtonView[] = [];

    public constructor(props: { registered: DefaultBrowserStatus; busy: boolean; onRegister: () => void; onUnregister: () => void; onOpenSettings: () => void }) {
        const statusPanel = panel({ direction: "row", align: "center", gap: "md", wrap: true });
        super(props, statusPanel);
        this.statusPanel = statusPanel;
    }

    protected onMount(): void {
        if (this.props.registered === null) {
            this.statusPanel.append(text(t("settings.defaultBrowserChecking"), { size: "sm", color: "light" }));
        } else if (this.props.registered) {
            this.statusPanel.append(text(t(isLinux ? "settings.defaultBrowserSelected" : "settings.defaultBrowserRegistered"), { size: "sm", color: "success" }));
            if (isLinux) this.appendButton({ variant: "link", size: "sm", background: "light", disabled: this.props.busy, onClick: this.props.onRegister }, t("settings.setDefaultBrowser"));
            this.appendButton({ variant: "link", size: "sm", background: "light", disabled: this.props.busy, onClick: this.props.onUnregister }, t("settings.unregister"));
        } else {
            if (isLinux) this.statusPanel.append(text(t("settings.defaultBrowserNotSelected"), { size: "sm", color: "light" }));
            this.appendButton({ variant: "link", size: "sm", background: "light", disabled: this.props.busy, onClick: this.props.onRegister }, t(isLinux ? "settings.setDefaultBrowser" : "settings.registerDefaultBrowser"));
        }
        if (!isLinux) this.appendButton({ variant: "link", size: "sm", background: "light", onClick: this.props.onOpenSettings }, t("settings.openWindowsDefaultApps"));
    }

    protected onUpdate(): void {}

    protected onDispose(): void {
        this.controls.length = 0;
    }

    private appendButton(props: ButtonProps, label: string): void {
        const button = this.child(new ButtonView({ ...props, children: label }));
        this.controls.push(button);
        this.statusPanel.append(button.root);
        button.mount();
    }
}

export class DefaultBrowserSectionView extends VanillaView<Record<string, never>> {
    private readonly state = new TComponentState(defaultDefaultBrowserSectionState);
    private statusSwap: SubtreeSwap<string> | undefined;
    private live = true;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        if (!getPlatformFeature("desktop.defaultBrowser").available) return;
        if (rendererProfileName()) {
            this.root.append(text(t("settings.profileBrowserRegistration"), { size: "sm", color: "light" }));
            return;
        }
        const statusHost = document.createElement("div");
        statusHost.style.display = "contents";
        this.root.append(statusHost);
        this.statusSwap = new SubtreeSwap(statusHost);
        this.own(() => this.statusSwap?.dispose());

        this.bind(this.state, (state) => state, (state) => this.syncStatus(state));
        void this.checkStatus();
    }

    protected onDispose(): void {
        this.live = false;
        this.statusSwap = undefined;
    }

    private syncStatus(state: DefaultBrowserSectionState): void {
        const statusSwap = this.statusSwap;
        if (!statusSwap) return;
        const key = state.registered === null ? "checking" : `${state.registered}-${state.busy}`;
        statusSwap.set(key, () => {
            const view = new DefaultBrowserStatusView({
                registered: state.registered,
                busy: state.busy,
                onRegister: this.handleRegister,
                onUnregister: this.handleUnregister,
                onOpenSettings: this.handleOpenSettings,
            });
            view.mount();
            return view;
        });
    }

    private checkStatus = async (): Promise<void> => {
        try {
            const registered = await api.isRegisteredAsDefaultBrowser();
            if (this.live) this.state.update((state) => { state.registered = registered; });
        } catch (error) {
            if (this.live) {
                ui.notify(t("settings.defaultBrowserStatusFailed", { error: errMessage(error) }), "error");
            }
        }
    };

    private handleRegister = async (): Promise<void> => {
        this.state.update((state) => { state.busy = true; });
        try {
            await api.registerAsDefaultBrowser();
            await this.checkStatus();
        } catch (error) {
            ui.notify(t("settings.defaultBrowserActionFailed", { error: errMessage(error) }), "error");
        } finally {
            if (this.live) this.state.update((state) => { state.busy = false; });
        }
    };

    private handleUnregister = async (): Promise<void> => {
        this.state.update((state) => { state.busy = true; });
        try {
            await api.unregisterAsDefaultBrowser();
            await this.checkStatus();
        } catch (error) {
            ui.notify(t("settings.defaultBrowserActionFailed", { error: errMessage(error) }), "error");
        } finally {
            if (this.live) this.state.update((state) => { state.busy = false; });
        }
    };

    private handleOpenSettings = (): void => {
        api.openDefaultAppsSettings();
    };
}
