import { settings } from "../../api/settings";
import { PopoverView, type PopoverViewProps } from "../../uikit/Popover/PopoverView";
import { SwitchView } from "../../uikit/Switch/SwitchView";
import { restoreFocus } from "../../uikit/shared/focus-restore";
import { createIconElement } from "../../uikit/shared/slots";
import type { IconName } from "../../theme/icon-registry";
import { MEMORY_ICON_COLOR } from "../../theme/palette-colors";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import "../../uikit/Switch/Switch.css";
import "./HeaderQuickSettingsPopover.css";

export type QuickServiceKey = "mcp.enabled" | "mneme.enabled" | "clipboard.enabled";

export interface QuickServiceEntry {
    key: QuickServiceKey;
    label: string;
    /** Registry name, not a node: an icon element is single-use, so each row builds its own. */
    icon: IconName;
    iconColor?: string;
}

const QUICK_SERVICE_ENTRIES: readonly QuickServiceEntry[] = [
    // The same icons these services carry in Tools & Editors, so one service reads the same
    // wherever it appears.
    { key: "mcp.enabled", label: "MCP", icon: "mcp" },
    { key: "mneme.enabled", label: "Mneme", icon: "memory", iconColor: MEMORY_ICON_COLOR },
    { key: "clipboard.enabled", label: "Clipboard listener", icon: "paste" },
];

interface HeaderQuickSettingsContentProps {
    onClose: () => void;
    onSnip: (hideWindows: boolean) => void;
}

interface ServiceSwitchRecord {
    entry: QuickServiceEntry;
    view: SwitchView;
    onChange: (checked: boolean) => void;
}

class HeaderQuickSettingsContentView extends VanillaView<HeaderQuickSettingsContentProps> {
    private readonly serviceSwitches: ServiceSwitchRecord[] = [];
    private firstAction: HTMLButtonElement | undefined;

    public constructor(props: HeaderQuickSettingsContentProps) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "header-quick-settings-list";
    }

    protected onMount(): void {
        this.root.append(
            this.createSnipRow("Snip Screen", true),
            this.createSnipRow("Snip Persephone", false),
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
        row.append(icon, labelElement);
        this.listen(row, "click", () => {
            this.props.onSnip(hideWindows);
            this.props.onClose();
        });
        if (!this.firstAction) this.firstAction = row;
        return row;
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
        label.textContent = entry.label;

        const onChange = (checked: boolean): void => {
            settings.set(entry.key, checked);
        };
        const switchView = this.child(new SwitchView({
            name: `header-quick-settings-${entry.key.replace(".", "-")}`,
            label: entry.label,
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
                label: entry.label,
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
