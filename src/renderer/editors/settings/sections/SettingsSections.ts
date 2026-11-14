import { app } from "../../../api/app";
import { settings } from "../../../api/settings";
import { settingDefault, settingOptions, settingRange } from "../../../api/settings-schema";
import { ui } from "../../../api/ui";
import { api } from "../../../../ipc/renderer/api";
import { createComponentModelDriver, TComponentModel, type ComponentModelDriver } from "../../../core/state/model";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { CheckboxView } from "../../../uikit/Checkbox/CheckboxView";
import type { CheckboxProps } from "../../../uikit/Checkbox/CheckboxView";
import { DotView } from "../../../uikit/Dot/DotView";
import { HelpIconView } from "../../../uikit/HelpIcon/HelpIconView";
import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { SelectView, type SelectViewProps } from "../../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { SubtreeSwap } from "../../../uikit/shared/subtree-swap";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createDepsGate, type DepsGate } from "../../../uikit/shared/deps-gate";
import { createSectionRoot, helpIcon, helpLabel, panel, settingsFieldLabel, text } from "./settings-native";
import { t } from "../../../../shared/i18n/t";
import { AUDIO_SETTINGS_DEVICES, AUDIO_STATUS, AUDIO_STATUS_GET, AUDIO_RETRY, type AudioDevice } from "../../../../ipc/audio-channels";
import { MICROPHONE_TUNING } from "../../../../shared/microphone-cleaning-types";
import { createLibraryPathField, PathField } from "../fields/PathField";
import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";
import { CheckboxField } from "../fields/CheckboxField";
import { ChoiceField } from "../fields/ChoiceField";
import { PortField } from "../fields/PortField";
import { createShortcutCaptureState, ShortcutField } from "../fields/ShortcutField";
import "../../../uikit/Button/Button.css";
import "../../../uikit/Checkbox/Checkbox.css";
import "../../../uikit/Dot/Dot.css";
import "../../../uikit/IconButton/IconButton.css";
import "../../../uikit/Input/Input.css";
import "../../../uikit/Select/Select.css";

const LINK_ITEM_LABELS = ["settings.openDefaultOsBrowser", "settings.openInternalBrowser"] as const;
const LINK_ITEMS = settingOptions("link-open-behavior").map((value, index) => ({ value, key: LINK_ITEM_LABELS[index] }));

const TERMINAL_ITEMS: readonly { value: string; key: "settings.autoDetectTerminal" | "settings.powershell7" | "settings.windowsPowershell" | "settings.commandPrompt" | "settings.windowsTerminal" }[] = [
    { value: "", key: "settings.autoDetectTerminal" },
    { value: "pwsh", key: "settings.powershell7" },
    { value: "powershell", key: "settings.windowsPowershell" },
    { value: "cmd", key: "settings.commandPrompt" },
    { value: "wt", key: "settings.windowsTerminal" },
];

const voiceTypingChoiceStore: SettingsStore<string> = {
    get: (id) => {
        const value = appSettingsStore.get(id);
        return value instanceof Promise ? value.then((result) => String(result)) : String(value);
    },
    set: (id, value) => appSettingsStore.set(id, Number(value)),
    subscribe: (id, callback) => appSettingsStore.subscribe(id, (value) => callback(String(value))),
};

export class LinkBehaviorSectionView extends VanillaView<Record<string, never>> {
    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        const host = panel({ maxWidth: 300 });
        const field = this.child(new ChoiceField({
            store: appSettingsStore as SettingsStore<string>,
            id: "link-open-behavior",
            items: LINK_ITEMS.map((item) => ({ value: item.value, label: t(item.key) })),
            ariaLabel: t("settings.groupTitleLinks"),
        }));
        host.append(field.root);
        field.mount();
        this.root.append(host);
    }
}

export class WindowBehaviorSectionView extends VanillaView<Record<string, never>> {
    private description: HelpIconView | undefined;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        const row = panel({ direction: "row", align: "center", paddingBottom: "md" });
        const checkbox = this.child(new CheckboxField({
            store: appSettingsStore as SettingsStore<boolean>,
            id: "window.close-to-tray",
            label: t("settings.keepRunningTray"),
        }));
        row.append(checkbox.root);
        checkbox.mount();
        this.description = helpIcon(t("settings.keepRunningTray"), t("settings.lastWindowTray"), (cleanup) => this.own(cleanup));
        row.append(this.description.root);
        this.root.append(row);
        this.sync();
        this.own(settings.watch("window.close-to-tray", () => this.sync()));
    }

    protected onDispose(): void {
        this.description = undefined;
    }

    private sync(): void {
        const closeToTray = settings.get("window.close-to-tray");
        if (this.description) {
            this.description.update({ label: t("settings.moreInformation", { label: t("settings.keepRunningTray") }), text: closeToTray ? t("settings.lastWindowTray") : t("settings.lastWindowQuit") });
        }
    }
}

export class EditorBehaviorSectionView extends VanillaView<Record<string, never>> {
    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        const row = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        const checkbox = this.child(new CheckboxField({
            store: appSettingsStore as SettingsStore<boolean>,
            id: "editor.word-wrap",
            label: t("settings.enableWordWrapDefault"),
        }));
        row.append(checkbox.root);
        checkbox.mount();
        this.root.append(row);
    }
}

interface GitIntegrationState { probe: { installed: boolean; version?: string } | null; }

class GitIntegrationModel extends TComponentModel<GitIntegrationState, { gitEnabled: boolean }> {
    private initialized = false;
    private readonly gitEnabledGate: DepsGate = createDepsGate();
    private cancelProbe: (() => void) | undefined;

    setProbe = (probe: GitIntegrationState["probe"]): void => this.state.update((state) => { state.probe = probe; });

    init(): void {
        this.updateProbe(this.props.gitEnabled);
        this.gitEnabledGate.prime([this.props.gitEnabled]);
        this.initialized = true;
    }

    setProps = (props: { gitEnabled: boolean }): void => {
        if (!this.initialized) return;
        if (this.gitEnabledGate.changed([props.gitEnabled])) this.updateProbe(props.gitEnabled);
    };

    private updateProbe(gitEnabled: boolean): void {
        this.cancelProbe?.();
        this.cancelProbe = undefined;
        if (!gitEnabled) {
            this.setProbe(null);
            return;
        }

        let alive = true;
        this.cancelProbe = () => { alive = false; };
        void import("../../../api/git")
            .then(({ git }) => git.probe())
            .then((result) => { if (alive) this.setProbe(result); })
            .catch(() => { if (alive) this.setProbe({ installed: false }); });
    }

    dispose(): void {
        this.cancelProbe?.();
        this.cancelProbe = undefined;
    }
}

class GitStatusView extends VanillaView<{ probe: NonNullable<GitIntegrationState["probe"]> }> {
    private dot: DotView | undefined;

    public constructor(props: { probe: NonNullable<GitIntegrationState["probe"]> }) {
        const root = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        super(props, root);
    }

    protected onMount(): void {
        this.dot = this.child(new DotView({ size: "sm", color: this.props.probe.installed ? "success" : "neutral" }));
        this.root.append(this.dot.root, text(this.props.probe.installed ? t("settings.gitDetected", { version: this.props.probe.version ?? "" }).trim() : t("settings.gitNotFound"), { size: "sm", color: "light" }));
        this.dot.mount();
    }
}

export class GitIntegrationSectionView extends VanillaView<Record<string, never>> {
    private driver: ComponentModelDriver<GitIntegrationState, { gitEnabled: boolean }, GitIntegrationModel> | undefined;
    private model: GitIntegrationModel | undefined;
    private statusSwap: SubtreeSwap<string> | undefined;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        const driver = createComponentModelDriver(
            { gitEnabled: settings.get("git.enabled") },
            GitIntegrationModel,
            { probe: null },
        );
        this.driver = driver;
        const model = driver.model;
        this.model = model;
        this.own(() => driver.dispose());

        const row = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        const checkbox = this.child(new CheckboxField({
            store: appSettingsStore as SettingsStore<boolean>,
            id: "git.enabled",
            label: t("settings.enableGitIntegration"),
        }));
        row.append(checkbox.root);
        checkbox.mount();
        this.root.append(row);
        const host = document.createElement("div");
        host.style.display = "contents";
        this.root.append(host);
        this.statusSwap = new SubtreeSwap(host);
        this.own(() => this.statusSwap?.dispose());
        driver.mount();
        this.bind(model.state, (state) => state, (state) => this.sync(state));
        this.own(settings.watch("git.enabled", () => {
            driver.update({ gitEnabled: settings.get("git.enabled") });
            this.sync(model.state.get());
        }));
    }

    protected onDispose(): void {
        this.driver = undefined;
        this.model = undefined;
        this.statusSwap = undefined;
    }

    private sync(state: GitIntegrationState): void {
        const model = this.model;
        if (!model) return;
        const probe = model.props.gitEnabled ? state.probe : null;
        if (probe) {
            this.statusSwap?.set(`${probe.installed}-${probe.version ?? ""}`, () => {
                const view = new GitStatusView({ probe });
                view.mount();
                return view;
            });
        } else this.statusSwap?.clear();
    }
}

export class BoardVarsSectionView extends VanillaView<Record<string, never>> {
    private openButton: ButtonView | undefined;
    private createButton: ButtonView | undefined;

    public constructor(props: Record<string, never>) { super(props, createSectionRoot("settings-section")); }

    protected onMount(): void {
        this.createButton = this.child(new ButtonView({ variant: "link", size: "sm", background: "light", onClick: () => void this.handleCreate(), children: t("settings.create") }));
        const field = this.child(new PathField({
            store: appSettingsStore as SettingsStore<string>,
            id: "board-vars.file",
            title: t("settings.groupTitleBoardVars"),
            emptyText: t("settings.notConfigured"),
            browse: this.handleBrowse,
            clear: () => settings.set("board-vars.file", ""),
            clearLabel: t("settings.unlink"),
            fallback: "",
            extraActions: this.createButton.root,
            paddingBottom: "lg",
        }));
        this.openButton = this.child(new ButtonView({ disabled: true, onClick: () => void app.openRawLink(settings.get("board-vars.file"), { editor: "env-vars-view" }), children: t("settings.openEnvironmentVariables") }));
        const openRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        openRow.append(this.openButton.root);
        this.root.append(field.root);
        field.mount();
        this.createButton.mount();
        this.openButton.mount();
        this.root.append(openRow);
        this.sync();
        this.own(settings.watch("board-vars.file", () => this.sync()));
    }

    protected onDispose(): void { this.openButton = undefined; this.createButton = undefined; }

    private sync(): void {
        const filePath = settings.get("board-vars.file");
        this.openButton?.update({ disabled: !filePath, onClick: () => void app.openRawLink(filePath, { editor: "env-vars-view" }), children: t("settings.openEnvironmentVariables") });
    }

    private readonly handleBrowse = async (): Promise<void> => {
        const { fs } = await import("../../../api/fs");
        const picked = await fs.showOpenDialog({ title: t("settings.chooseEnvironmentFile"), defaultPath: settings.get("board-vars.file") || undefined, filters: [{ name: t("settings.envJsonFilter"), extensions: ["env.json"] }, { name: t("settings.jsonFilter"), extensions: ["json"] }] });
        if (picked?.[0]) settings.set("board-vars.file", picked[0]);
    };

    private readonly handleCreate = async (): Promise<void> => {
        const { showCreateBoardVarsStorageDialog } = await import("../../../ui/dialogs/CreateBoardVarsStorageDialog");
        await showCreateBoardVarsStorageDialog();
    };

}

export interface LibraryPathConfig {
    read: () => string | undefined | Promise<string | undefined>;
    subscribe: (listener: () => void) => () => void;
    emptyText: string;
    browse: () => Promise<void>;
    reset: () => void | Promise<void>;
    clearLabel: string;
}
export class LibraryPathSectionView extends VanillaView<Record<string, never>> {
    private readonly config: LibraryPathConfig;

    public constructor(_props: Record<string, never>, config: LibraryPathConfig) {
        super(_props, createSectionRoot("settings-section"));
        this.config = config;
    }

    protected onMount(): void {
        const field = this.child(createLibraryPathField({ ...this.config, title: t("settings.groupTitleScriptLibrary") }));
        this.root.append(field.root);
        field.mount();
    }
}

export function createScriptLibrarySection(): LibraryPathSectionView {
    return new LibraryPathSectionView({}, {
        read: () => settings.get("script-library.path"),
        subscribe: (listener) => settings.watch("script-library.path", listener),
        emptyText: t("settings.notLinked"),
        browse: async () => { const { showLibrarySetupDialog } = await import("../../../ui/dialogs/LibrarySetupDialog"); showLibrarySetupDialog(); },
        reset: () => settings.set("script-library.path", ""),
        clearLabel: t("settings.unlink"),
    });
}

export class VideoPlayerSectionView extends VanillaView<Record<string, never>> {
    public constructor(props: Record<string, never>) { super(props, createSectionRoot("settings-section")); }

    protected onMount(): void {
        const outer = panel({ direction: "column", rounded: "sm", background: "dark" });
        const pathRow = panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" });
        pathRow.append(settingsFieldLabel(t("settings.vlcPathLabel")));
        const pathField = this.child(new PathField({
            store: appSettingsStore as SettingsStore<string>,
            variant: "link-or-placeholder",
            id: "vlc-path",
            title: t("settings.vlcPathLabel"),
            emptyText: t("settings.autoDetect"),
            browse: this.handleBrowseVlc,
            clear: () => settings.set("vlc-path", ""),
            clearLabel: t("settings.removeVlcPath"),
            fallback: "",
        }));
        pathRow.append(pathField.root);
        pathField.mount();
        const portRow = panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" });
        portRow.append(settingsFieldLabel(t("settings.streamPortLabel")));
        const portField = this.child(new PortField({
            store: appSettingsStore as SettingsStore<number>,
            id: "video-stream.port",
            range: settingRange("video-stream.port"),
            width: 56,
            fallback: settings.get("video-stream.port"),
        }));
        portRow.append(portField.root);
        portField.mount();
        outer.append(pathRow, portRow);
        this.root.append(outer);
    }

    private readonly handleBrowseVlc = async (): Promise<void> => {
        const result = await api.showOpenFileDialog({ title: t("settings.selectVlcExe"), filters: [{ name: t("settings.executableFiles"), extensions: ["exe"] }] });
        if (result?.[0]) settings.set("vlc-path", result[0]);
    };
}

export class TerminalSectionView extends VanillaView<Record<string, never>> {
    public constructor(props: Record<string, never>) { super(props, createSectionRoot("settings-section")); }

    protected onMount(): void {
        const host = panel({ maxWidth: 360 });
        const field = this.child(new ChoiceField({
            store: appSettingsStore as SettingsStore<string>,
            id: "terminal.command",
            items: TERMINAL_ITEMS.map((item) => ({ value: item.value, label: t(item.key) })),
            ariaLabel: t("settings.groupTitleTerminal"),
            keepUnknownValue: true,
        }));
        host.append(field.root);
        field.mount();
        this.root.append(host);
    }
}

export class VoiceTypingSettingsSectionView extends VanillaView<Record<string, never>> {
    private readonly shortcutCaptureState = createShortcutCaptureState();
    private shortcutField: ShortcutField | undefined;
    private translateShortcutField: ShortcutField | undefined;

    public constructor(props: Record<string, never>) { super(props, createSectionRoot("settings-section")); }

    protected onMount(): void {
        const row = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        row.append(helpLabel(t("settings.voiceTypingShortcutLabel"), t("settings.voiceTypingShortcutHelp"), (cleanup) => this.own(cleanup)));
        this.shortcutField = this.child(new ShortcutField({
            store: appSettingsStore as SettingsStore<string>,
            id: "voice-typing.shortcut",
            width: 180,
            ariaLabel: t("settings.voiceTypingShortcutLabel"),
            resetValue: settingDefault("voice-typing.shortcut"),
            captureState: this.shortcutCaptureState,
            getOtherShortcut: () => settings.get("voice-typing.translate-shortcut"),
            onInvalid: () => ui.notify(t("settings.voiceTypingInvalidShortcut"), "warning"),
        }));
        row.append(this.shortcutField.root);
        this.shortcutField.mount();
        const reset = this.child(new ButtonView({
            size: "sm",
            variant: "default",
            onClick: () => { void this.shortcutField?.reset(); },
            children: t("settings.voiceTypingResetShortcut"),
        }));
        row.append(reset.root);
        reset.mount();
        const translateRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        translateRow.append(helpLabel(t("settings.voiceTypingTranslateShortcutLabel"), t("settings.voiceTypingTranslateHint"), (cleanup) => this.own(cleanup)));
        this.translateShortcutField = this.child(new ShortcutField({
            store: appSettingsStore as SettingsStore<string>,
            id: "voice-typing.translate-shortcut",
            width: 180,
            ariaLabel: t("settings.voiceTypingTranslateShortcutLabel"),
            resetValue: settingDefault("voice-typing.translate-shortcut"),
            captureState: this.shortcutCaptureState,
            getOtherShortcut: () => settings.get("voice-typing.shortcut"),
            onInvalid: () => ui.notify(t("settings.voiceTypingInvalidShortcut"), "warning"),
        }));
        translateRow.append(this.translateShortcutField.root);
        this.translateShortcutField.mount();
        const translateReset = this.child(new ButtonView({
            size: "sm",
            variant: "default",
            onClick: () => { void this.translateShortcutField?.reset(); },
            children: t("settings.voiceTypingResetShortcut"),
        }));
        translateRow.append(translateReset.root);
        translateReset.mount();
        const silenceRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        silenceRow.append(helpLabel(t("settings.voiceTypingAutoStopLabel"), t("settings.voiceTypingAutoStopHelp"), (cleanup) => this.own(cleanup)));
        const silenceValues = settingOptions("voice-typing.auto-stop-silence-ms");
        const silenceSelect = this.child(new ChoiceField({
            store: voiceTypingChoiceStore,
            id: "voice-typing.auto-stop-silence-ms",
            width: 180,
            items: silenceValues.map((value) => ({ value: String(value), label: value === 0 ? t("settings.voiceTypingAutoStopOff") : t("settings.voiceTypingAutoStopSeconds", { seconds: value / 1000 }) })),
        }));
        silenceRow.append(silenceSelect.root);
        silenceSelect.mount();
        const inactivityRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        inactivityRow.append(helpLabel(t("settings.voiceTypingInactivityLabel"), t("settings.voiceTypingInactivityHelp"), (cleanup) => this.own(cleanup)));
        const inactivityValues = settingOptions("voice-typing.auto-stop-inactivity-ms");
        const inactivitySelect = this.child(new ChoiceField({
            store: voiceTypingChoiceStore,
            id: "voice-typing.auto-stop-inactivity-ms",
            width: 180,
            items: inactivityValues.map((value) => ({ value: String(value), label: value === 0 ? t("settings.voiceTypingAutoStopOff") : t("settings.voiceTypingAutoStopSeconds", { seconds: value / 1000 }) })),
        }));
        inactivityRow.append(inactivitySelect.root);
        inactivitySelect.mount();
        this.root.append(row, translateRow, silenceRow, inactivityRow);
    }

    protected onDispose(): void { this.shortcutField = undefined; this.translateShortcutField = undefined; }
}

/** Settings for managed microphone capture. */
type MicrophoneProfileView = CheckboxView | InputView;

export class MicrophoneAudioSectionView extends VanillaView<Record<string, never>> {
    private device = "";
    private devices: IListBoxItem[] = [];
    private deviceSelect: SelectView<IListBoxItem> | undefined;
    private cleanCheckbox: CheckboxView | undefined;
    private attenuationInput: InputView | undefined;
    private attenuationDraft = "";
    private profileHost: HTMLElement | undefined;
    private profileViews: MicrophoneProfileView[] = [];
    private status: HTMLElement | undefined;

    public constructor(props: Record<string, never>) { super(props, createSectionRoot("settings-section")); }

    protected onMount(): void {

        const cleanRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        cleanRow.dataset.name = "microphone.clean";
        this.cleanCheckbox = this.child(new CheckboxView(this.cleanProps()));
        cleanRow.append(this.cleanCheckbox.root);
        this.cleanCheckbox.mount();
        this.root.append(cleanRow);

        this.attenuationDraft = String(settings.get("microphone.attenuation-db"));
        const attenuationRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        attenuationRow.dataset.name = "microphone.attenuation-db";
        this.attenuationInput = this.child(new InputView(this.attenuationProps()));
        attenuationRow.append(settingsFieldLabel(t("settings.microphoneAttenuation")), this.attenuationInput.root);
        this.attenuationInput.mount();
        this.root.append(attenuationRow);

        const deviceRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        const deviceHost = panel({ maxWidth: 640, flex: 1 });
        this.deviceSelect = this.child(new SelectView(this.deviceProps()));
        deviceHost.append(this.deviceSelect.root);
        this.deviceSelect.mount();
        deviceRow.append(helpLabel(t("settings.microphoneDevice"), t("settings.microphoneDeviceHelp"), (cleanup) => this.own(cleanup)), deviceHost);
        this.root.append(deviceRow);
        // Connecting or removing a headset changes the list and the Windows default.
        const onDeviceChange = (): void => { void this.loadDevices(); };
        navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
        this.own(() => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange));

        this.profileHost = panel({ direction: "column" });
        this.profileHost.dataset.name = "microphone.notches";
        this.root.append(this.profileHost);

        this.status = text("", { color: "light", size: "xs" });
        this.root.append(panel({ paddingTop: "md" }, this.status));
        this.root.append(panel({ paddingTop: "sm", paddingBottom: "md" }, text(t("settings.microphoneEnrollment"), { color: "light", size: "xs" })));

        const { ipcRenderer } = require("electron") as typeof import("electron");
        const statuses = new Map<string, string>();
        const status = (_event: Electron.IpcRendererEvent, value: { mode: string; reason: string }): void => {
            if (!this.status) return;
            const message = value.mode === "reference-ready" ? t("settings.microphoneReferenceReady") : value.mode === "reference-unavailable" ? t("settings.microphoneReferenceUnavailable", { reason: value.reason })
                : value.mode === "restart" ? t("settings.microphoneRestart") : value.mode === "failed" ? t("settings.microphoneFailed", { reason: value.reason })
                : value.mode === "load" ? t("settings.microphoneLoad", { ratio: value.reason }) : value.mode === "neural" ? t("settings.microphoneNeural")
                : t("settings.microphoneUnfiltered", { reason: value.reason });
            statuses.set(value.mode.startsWith("reference-") ? "reference" : "cleaning", message);
            this.status.textContent = [...statuses.values()].join(" · ");
        };
        ipcRenderer.on(AUDIO_STATUS, status);
        this.own(() => ipcRenderer.removeListener(AUDIO_STATUS, status));
        void ipcRenderer.invoke(AUDIO_STATUS_GET).then((values: Array<{ mode: string; reason: string }>) => { for (const value of values ?? []) status({} as Electron.IpcRendererEvent, value); });
        const retry = this.child(new ButtonView({ size: "sm", variant: "default", children: t("settings.microphoneRetry"), onClick: () => ipcRenderer.send(AUDIO_RETRY) }));
        this.root.append(retry.root);
        retry.mount();

        this.own(settings.watch("microphone.clean", () => this.cleanCheckbox?.update(this.cleanProps())));
        this.own(settings.watch("microphone.attenuation-db", () => {
            this.attenuationDraft = String(settings.get("microphone.attenuation-db"));
            this.attenuationInput?.update(this.attenuationProps());
        }));
        void this.loadDevices();
    }

    protected onDispose(): void {
        this.deviceSelect = undefined;
        this.cleanCheckbox = undefined;
        this.attenuationInput = undefined;
        this.profileHost = undefined;
        this.profileViews = [];
        this.status = undefined;
    }

    private cleanProps(): CheckboxProps {
        return { checked: settings.get("microphone.clean"), onChange: this.onCleanChange, children: t("settings.microphoneClean") };
    }

    private readonly onCleanChange = (checked: boolean): void => settings.set("microphone.clean", checked);

    private attenuationProps(): InputProps {
        return { size: "sm", width: 56, type: "text", value: this.attenuationDraft, onChange: this.onAttenuationChange, onBlur: this.onAttenuationBlur, onKeyDown: blurOnEnter };
    }

    private readonly onAttenuationChange = (value: string): void => {
        this.attenuationDraft = value;
        this.attenuationInput?.update(this.attenuationProps());
    };

    private readonly onAttenuationBlur = (): void => {
        const value = Number(this.attenuationDraft);
        const range = settingRange("microphone.attenuation-db");
        if (this.attenuationDraft.trim() && Number.isFinite(value) && value >= range.min && value <= range.max) {
            settings.set("microphone.attenuation-db", value);
            return;
        }
        this.attenuationDraft = String(settings.get("microphone.attenuation-db"));
        this.attenuationInput?.update(this.attenuationProps());
    };

    private deviceProps(): SelectViewProps<IListBoxItem> {
        const items = this.devices.length ? this.devices : [{ value: "", label: t("settings.microphoneNoDevice") }];
        return { items, value: items.find((item) => item.value === this.device) ?? items[0], onChange: this.onDeviceChange };
    }

    private readonly onDeviceChange = (item: IListBoxItem | null): void => {
        this.device = (item?.value as string) ?? "";
        this.deviceSelect?.update(this.deviceProps());
        this.renderProfile();
    };

    private async loadDevices(): Promise<void> {
        const { ipcRenderer } = require("electron") as typeof import("electron");
        const devices = await ipcRenderer.invoke(AUDIO_SETTINGS_DEVICES).catch((): AudioDevice[] => []) as AudioDevice[];
        if (!this.deviceSelect) return;
        const inputs = devices.filter((item) => item.deviceId && item.deviceId !== "default" && item.deviceId !== "communications");
        // Chromium labels the pseudo-device "Default - <real label>"; that names the current Windows default.
        const defaultLabel = devices.find((item) => item.deviceId === "default")?.label.replace(/^Default - /, "");
        const defaultId = inputs.find((item) => item.label === defaultLabel)?.deviceId;
        this.devices = inputs.map((item) => {
            const label = item.label || t("settings.microphoneNoDevice");
            return { value: item.deviceId, label: item.deviceId === defaultId ? t("settings.microphoneDeviceDefault", { label }) : label };
        });
        if (!inputs.some((item) => item.deviceId === this.device)) this.device = defaultId ?? inputs[0]?.deviceId ?? "";
        this.deviceSelect.update(this.deviceProps());
        this.renderProfile();
    }

    /** Rebuilds the per-device notch controls; the device list or a saved change re-runs it. */
    private renderProfile(): void {
        const host = this.profileHost;
        if (!host) return;
        for (const view of this.profileViews) this.releaseChild(view);
        this.profileViews = [];
        host.replaceChildren();
        if (!this.device) return;
        const id = this.device;
        const current = settings.get("microphone.notches")[id] ?? { enabled: false, frequency: MICROPHONE_TUNING.notchFrequency, q: MICROPHONE_TUNING.notchQ, gainDb: MICROPHONE_TUNING.notchGainDb };
        const update = (change: Partial<typeof current>): void => settings.set("microphone.notches", { ...settings.get("microphone.notches"), [id]: { ...current, ...change } });

        const enabledRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "sm" });
        const enabled = this.child(new CheckboxView({ checked: current.enabled, onChange: (checked) => { update({ enabled: checked }); this.renderProfile(); }, children: t("settings.microphoneNotch") }));
        enabledRow.append(enabled.root);
        enabled.mount();
        host.append(enabledRow);
        this.profileViews.push(enabled);

        const fields = panel({ direction: "row", align: "center", gap: "lg", paddingLeft: "xxl" });
        const notchRange = settingRange("microphone.notches");
        const frequencyRange = notchRange.frequency;
        const qRange = notchRange.q;
        const gainRange = notchRange.gainDb;
        for (const [key, title, min, max] of [
            ["frequency", t("settings.microphoneFrequency"), frequencyRange.min, frequencyRange.max],
            ["q", t("settings.microphoneQ"), qRange.min, qRange.max],
            ["gainDb", t("settings.microphoneGain"), gainRange.min, gainRange.max],
        ] as const) {
            let draft = String(current[key]);
            const props = (): InputProps => ({
                size: "sm", width: 64, type: "text", value: draft, disabled: !current.enabled,
                onChange: (value) => { draft = value; input.update(props()); },
                onBlur: () => {
                    const value = Number(draft);
                    if (draft.trim() && Number.isFinite(value) && value >= min && value <= max) {
                        if (value !== current[key]) { update({ [key]: value }); this.renderProfile(); }
                        return;
                    }
                    draft = String(current[key]);
                    input.update(props());
                },
                onKeyDown: blurOnEnter,
            });
            const input: InputView = this.child(new InputView(props()));
            const field = panel({ direction: "row", align: "center", gap: "sm" });
            field.append(settingsFieldLabel(title), input.root);
            input.mount();
            fields.append(field);
            this.profileViews.push(input);
        }
        host.append(fields);
    }
}

function blurOnEnter(event: KeyboardEvent): void {
    if (event.key === "Enter") (event.target as HTMLInputElement).blur();
}
