import { app } from "../../../api/app";
import { settings } from "../../../api/settings";
import { settingDefault, settingOptions, settingRange } from "../../../api/settings-schema";
import { ui } from "../../../api/ui";
import { api } from "../../../../ipc/renderer/api";
import { createComponentModelDriver, TComponentModel, type ComponentModelDriver } from "../../../core/state/model";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { DotView } from "../../../uikit/Dot/DotView";
import { HelpIconView } from "../../../uikit/HelpIcon/HelpIconView";
import { SubtreeSwap } from "../../../uikit/shared/subtree-swap";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createDepsGate, type DepsGate } from "../../../uikit/shared/deps-gate";
import { createSectionRoot, helpIcon, helpLabel, panel, settingsFieldLabel, text } from "./settings-native";
import { t } from "../../../../shared/i18n/t";
import { createLibraryPathField, PathField } from "../fields/PathField";
import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";
import { CheckboxField } from "../fields/CheckboxField";
import { ChoiceField } from "../fields/ChoiceField";
import { PortField } from "../fields/PortField";
import { createShortcutCaptureState, ShortcutField } from "../fields/ShortcutField";
import "../../../uikit/Button/Button.css";
import "../../../uikit/Dot/Dot.css";
import "../../../uikit/IconButton/IconButton.css";

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

