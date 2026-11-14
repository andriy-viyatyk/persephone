import { settings } from "../../../api/settings";
import { settingDefault, settingRange } from "../../../api/settings-schema";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { CheckboxView } from "../../../uikit/Checkbox/CheckboxView";
import type { CheckboxProps } from "../../../uikit/Checkbox/CheckboxView";
import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { SelectView, type SelectViewProps } from "../../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createSectionRoot, helpLabel, panel, settingsFieldLabel, text } from "./settings-native";
import { t } from "../../../../shared/i18n/t";
import type { AudioProcessingStatus } from "../../../../ipc/audio-channels";
import { MICROPHONE_TUNING, type MicrophoneNotch } from "../../../../shared/microphone-cleaning-types";
import { microphoneSettings } from "../../../api/speech/microphone-settings";
import { NumberField } from "../fields/NumberField";
import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";
import "../../../uikit/Button/Button.css";
import "../../../uikit/Checkbox/Checkbox.css";
import "../../../uikit/Input/Input.css";
import "../../../uikit/Select/Select.css";

type MicrophoneProfileView = CheckboxView | InputView;

export class MicrophoneAudioSectionView extends VanillaView<Record<string, never>> {
    private device = "";
    private devices: IListBoxItem[] = [];
    private defaultDeviceId = "";
    private deviceSelect: SelectView<IListBoxItem> | undefined;
    private cleanCheckbox: CheckboxView | undefined;
    private profileHost: HTMLElement | undefined;
    private profileViews: MicrophoneProfileView[] = [];
    private status: HTMLElement | undefined;
    private readonly statuses = new Map<string, string>();

    public constructor(props: Record<string, never>) { super(props, createSectionRoot("settings-section")); }

    protected onMount(): void {
        const cleanRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        cleanRow.dataset.name = "microphone.clean";
        this.cleanCheckbox = this.child(new CheckboxView(this.cleanProps()));
        cleanRow.append(this.cleanCheckbox.root);
        this.cleanCheckbox.mount();
        this.root.append(cleanRow);

        const attenuationRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        attenuationRow.dataset.name = "microphone.attenuation-db";
        const attenuationField = this.child(new NumberField({
            store: appSettingsStore as SettingsStore<number>,
            id: "microphone.attenuation-db",
            ...settingRange("microphone.attenuation-db"),
            width: 56,
            fallback: settingDefault("microphone.attenuation-db"),
        }));
        attenuationRow.append(settingsFieldLabel(t("settings.microphoneAttenuation")), attenuationField.root);
        attenuationField.mount();
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

        this.own(microphoneSettings.onStatus(this.handleStatus));
        const retry = this.child(new ButtonView({ size: "sm", variant: "default", children: t("settings.microphoneRetry"), onClick: () => microphoneSettings.retry() }));
        this.root.append(retry.root);
        retry.mount();

        this.own(settings.watch("microphone.clean", () => this.cleanCheckbox?.update(this.cleanProps())));
        void this.loadDevices();
    }

    protected onDispose(): void {
        this.deviceSelect = undefined;
        this.cleanCheckbox = undefined;
        this.profileHost = undefined;
        this.profileViews = [];
        this.status = undefined;
    }

    private cleanProps(): CheckboxProps {
        return { checked: settings.get("microphone.clean"), onChange: this.onCleanChange, children: t("settings.microphoneClean") };
    }

    private readonly onCleanChange = (checked: boolean): void => settings.set("microphone.clean", checked);

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
        const devices = await microphoneSettings.listDevices();
        if (!this.deviceSelect) return;
        this.defaultDeviceId = devices.find((item) => item.isDefault)?.deviceId ?? "";
        this.devices = devices.map((item) => {
            const label = item.label || t("settings.microphoneNoDevice");
            return { value: item.deviceId, label: item.isDefault ? t("settings.microphoneDeviceDefault", { label }) : label };
        });
        if (!this.devices.some((item) => item.value === this.device)) this.device = this.defaultDeviceId || String(this.devices[0]?.value ?? "");
        this.deviceSelect.update(this.deviceProps());
        this.renderProfile();
    }

    private readonly handleStatus = (value: AudioProcessingStatus): void => {
        if (!this.status) return;
        const message = value.mode === "reference-ready" ? t("settings.microphoneReferenceReady") : value.mode === "reference-unavailable" ? t("settings.microphoneReferenceUnavailable", { reason: value.reason })
            : value.mode === "restart" ? t("settings.microphoneRestart") : value.mode === "failed" ? t("settings.microphoneFailed", { reason: value.reason })
            : value.mode === "load" ? t("settings.microphoneLoad", { ratio: value.reason }) : value.mode === "neural" ? t("settings.microphoneNeural")
            : t("settings.microphoneUnfiltered", { reason: value.reason });
        this.statuses.set(value.mode.startsWith("reference-") ? "reference" : "cleaning", message);
        this.status.textContent = [...this.statuses.values()].join(" · ");
    };

    /** Rebuilds the per-device notch controls; the device list or a saved change re-runs it. */
    private renderProfile(): void {
        const host = this.profileHost;
        if (!host) return;
        for (const view of this.profileViews) this.releaseChild(view);
        this.profileViews = [];
        host.replaceChildren();
        if (!this.device) return;
        const id = this.device;
        const notchStore = appSettingsStore as SettingsStore<Record<string, MicrophoneNotch>>;
        const notches = notchStore.get("microphone.notches") as Record<string, MicrophoneNotch>;
        const current = notches[id] ?? { enabled: false, frequency: MICROPHONE_TUNING.notchFrequency, q: MICROPHONE_TUNING.notchQ, gainDb: MICROPHONE_TUNING.notchGainDb };
        const update = (change: Partial<typeof current>): void => {
            void notchStore.set("microphone.notches", { ...notchStore.get("microphone.notches") as Record<string, MicrophoneNotch>, [id]: { ...current, ...change } });
        };

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
