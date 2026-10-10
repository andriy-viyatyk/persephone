import { englishMessage, t } from "../../../shared/i18n/t";
import { settings } from "../../api/settings";
import { PopoverView, type PopoverViewProps } from "../../uikit/Popover/PopoverView";
import { SwitchView } from "../../uikit/Switch/SwitchView";
import { restoreFocus } from "../../uikit/shared/focus-restore";
import { createIconElement } from "../../uikit/shared/slots";
import color from "../../theme/color";
import type { IconName } from "../../theme/icon-registry";
import { MEMORY_ICON_COLOR } from "../../theme/palette-colors";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { RecordingRegion } from "../../../ipc/api-param-types";
import "../../uikit/Switch/Switch.css";
import "./HeaderQuickSettingsPopover.css";
import type { MessageKey } from "../../../shared/i18n/en";

export type QuickServiceKey = "mcp.enabled" | "mneme.enabled" | "clipboard.enabled";

export interface QuickServiceEntry {
    key: QuickServiceKey;
    labelKey: MessageKey;
    /** Registry name, not a node: an icon element is single-use, so each row builds its own. */
    icon: IconName;
    iconColor?: string;
}

const QUICK_SERVICE_ENTRIES: readonly QuickServiceEntry[] = [
    // The same icons these services carry in Tools & Editors, so one service reads the same
    // wherever it appears.
    { key: "mcp.enabled", labelKey: "shell.mCP", icon: "mcp" },
    { key: "mneme.enabled", labelKey: "shell.mneme", icon: "memory", iconColor: MEMORY_ICON_COLOR },
    { key: "clipboard.enabled", labelKey: "shell.clipboardListener", icon: "paste" },
];

function quickServiceLabel(entry: QuickServiceEntry): string {
    return entry.key === "mcp.enabled" || entry.key === "mneme.enabled"
        ? englishMessage(entry.labelKey)
        : t(entry.labelKey);
}

interface HeaderQuickSettingsContentProps {
    onClose: () => void;
    onSnip: (hideWindows: boolean) => void;
    onRecord: (region: RecordingRegion) => void;
}

interface ServiceSwitchRecord {
    entry: QuickServiceEntry;
    view: SwitchView;
    onChange: (checked: boolean) => void;
}

class HeaderQuickSettingsContentView extends VanillaView<HeaderQuickSettingsContentProps> {
    private readonly serviceSwitches: ServiceSwitchRecord[] = [];
    private firstAction: HTMLButtonElement | undefined;
    private readonly recordChoices: HTMLButtonElement[] = [];

    public constructor(props: HeaderQuickSettingsContentProps) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "header-quick-settings-list";
    }

    protected onMount(): void {
        this.root.append(
            this.createSnipRow(t("shell.snipScreen"), true),
            this.createSnipRow(t("shell.snipPersephone"), false),
            this.createRecordRow(),
            ...this.createRecordChoices(),
            this.createSeparator(),
        );
        QUICK_SERVICE_ENTRIES.forEach((entry) => this.root.append(this.createServiceRow(entry)));
        this.own(settings.onChanged.subscribe(this.onSettingChanged));
        this.syncServiceSwitches();
        this.firstAction?.focus();
    }

    protected onDispose(): void {
        this.serviceSwitches.length = 0;
        this.firstAction = undefined;
    }

    private createSnipRow(label: string, hideWindows: boolean): HTMLButtonElement {
        const row = document.createElement("button");
        row.type = "button";
        row.dataset.type = "header-quick-settings-snip-row";
        const icon = document.createElement("span");
        icon.dataset.part = "icon";
        icon.append(createIconElement("snip"));
        const labelElement = document.createElement("span");
        labelElement.dataset.part = "label";
        labelElement.textContent = label;
        labelElement.title = label;
        row.append(icon, labelElement);
        this.listen(row, "click", () => {
            this.props.onSnip(hideWindows);
            this.props.onClose();
        });
        if (!this.firstAction) this.firstAction = row;
        return row;
    }

    private createRecordRow(): HTMLButtonElement {
        const row = document.createElement("button");
        row.type = "button";
        row.dataset.type = "header-quick-settings-snip-row";
        row.dataset.name = "record-region-toggle";
        const icon = document.createElement("span");
        icon.dataset.part = "icon";
        icon.append(createIconElement("circle", { color: color.misc.red }));
        const labelElement = document.createElement("span");
        labelElement.dataset.part = "label";
        const label = t("shell.record");
        labelElement.textContent = label;
        labelElement.title = label;
        const chevron = document.createElement("span");
        chevron.dataset.part = "chevron";
        chevron.append(createIconElement("chevron-right"));
        row.append(icon, labelElement, chevron);
        this.listen(row, "click", () => {
            const open = this.recordChoices[0]?.hidden ?? false;
            this.recordChoices.forEach((choice) => { choice.hidden = !open; });
            row.toggleAttribute("data-expanded", open);
        });
        return row;
    }

    private createRecordChoices(): HTMLButtonElement[] {
        return ([
            [t("shell.fullWindow"), "window"],
            [t("shell.activePage"), "page"],
            [t("shell.mainEditorArea"), "editor"],
        ] as const).map(([label, region]) => {
            const row = document.createElement("button");
            row.type = "button";
            row.dataset.type = "header-quick-settings-snip-row";
            row.dataset.name = `record-${region}`;
            row.dataset.part = "record-choice";
            row.hidden = true;
            row.textContent = label;
            this.listen(row, "click", () => { this.props.onRecord(region); this.props.onClose(); });
            this.recordChoices.push(row);
            return row;
        });
    }

    private createSeparator(): HTMLDivElement {
        const separator = document.createElement("div");
        separator.dataset.type = "header-quick-settings-separator";
        separator.setAttribute("role", "separator");
        return separator;
    }

    private createServiceRow(entry: QuickServiceEntry): HTMLDivElement {
        const row = document.createElement("div");
        row.dataset.type = "header-quick-settings-service-row";

        const iconHost = document.createElement("span");
        iconHost.dataset.part = "icon";
        iconHost.append(createIconElement(entry.icon, {
            width: 16,
            height: 16,
            ...(entry.iconColor === undefined ? {} : { color: entry.iconColor }),
        }));
        const label = document.createElement("span");
        label.dataset.part = "label";
        const labelText = quickServiceLabel(entry);
        label.textContent = labelText;
        label.title = labelText;

        const onChange = (checked: boolean): void => {
            settings.set(entry.key, checked);
        };
        const switchView = this.child(new SwitchView({
            name: `header-quick-settings-${entry.key.replace(".", "-")}`,
            label: quickServiceLabel(entry),
            checked: Boolean(settings.get(entry.key)),
            size: "sm",
            onChange,
        }));
        const control = document.createElement("span");
        control.dataset.part = "control";
        control.append(switchView.root);
        row.append(iconHost, label, control);

        this.listen(row, "click", (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('[data-type="switch"]')) return;
            settings.set(entry.key, settings.get(entry.key) !== true);
        });
        switchView.mount();
        this.serviceSwitches.push({ entry, view: switchView, onChange });
        return row;
    }

    private readonly onSettingChanged = ({ key }: { key: string; value: unknown }): void => {
        if (QUICK_SERVICE_ENTRIES.some((entry) => entry.key === key)) this.syncServiceSwitches();
    };

    private syncServiceSwitches(): void {
        this.serviceSwitches.forEach(({ entry, view, onChange }) => {
            view.update({
                name: `header-quick-settings-${entry.key.replace(".", "-")}`,
                label: quickServiceLabel(entry),
                checked: Boolean(settings.get(entry.key)),
                size: "sm",
                onChange,
            });
        });
    }
}

export interface HeaderQuickSettingsPopoverProps {
    anchor: HTMLElement;
    open: boolean;
    placement: "bottom-end";
    onClose: () => void;
    onSnip: (hideWindows: boolean) => void;
    onRecord: (region: RecordingRegion) => void;
}

export class HeaderQuickSettingsPopoverView extends VanillaView<HeaderQuickSettingsPopoverProps> {
    private readonly popover: PopoverView;
    private previousOpen: boolean;

    public constructor(props: HeaderQuickSettingsPopoverProps) {
        super(props, createContentsRoot());
        this.previousOpen = props.open;
        this.popover = this.child(new PopoverView(this.popoverProps(props)));
        this.root.append(this.popover.root);
    }

    protected onMount(): void {
        this.popover.mount();
    }

    protected onUpdate(props: HeaderQuickSettingsPopoverProps): void {
        const closing = this.previousOpen && !props.open;
        this.previousOpen = props.open;
        this.popover.update(this.popoverProps(props));
        if (closing) restoreFocus(props.anchor);
    }

    private popoverProps(props: HeaderQuickSettingsPopoverProps): PopoverViewProps {
        return {
            name: "header-quick-settings",
            "data-type": "header-quick-settings",
            open: props.open,
            elementRef: props.anchor,
            placement: props.placement,
            scroll: false,
            outsideClickIgnoreSelector: '[data-name="header-snip-button"]',
            onClose: props.onClose,
            contentView: (host) => {
                const content = new HeaderQuickSettingsContentView({
                    onClose: props.onClose,
                    onSnip: props.onSnip,
                    onRecord: props.onRecord,
                });
                host.append(content.root);
                return content;
            },
        };
    }
}

function createContentsRoot(): HTMLSpanElement {
    const root = document.createElement("span");
    root.style.display = "contents";
    return root;
}
