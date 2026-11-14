import { ButtonView } from "../../../uikit/Button/ButtonView";
import { IconButtonView } from "../../../uikit/IconButton/IconButtonView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { fpBasename } from "../../../core/utils/file-path";
import { ui } from "../../../api/ui";
import { panel, settingsLink, settingsPath, settingsPlaceholder, text } from "../sections/settings-native";
import { errMessage } from "../../../../shared/utils";
import { t } from "../../../../shared/i18n/t";
import type { SettingsStore } from "./settings-store";
import "../../../uikit/Button/Button.css";
import "../../../uikit/IconButton/IconButton.css";

export interface PathFieldProps {
    variant?: "value-box" | "link-or-placeholder";
    store: Pick<SettingsStore<string | undefined>, "get" | "subscribe">;
    id: string;
    title: string;
    emptyText: string;
    browse: () => void | Promise<void>;
    clear: () => void | Promise<void>;
    clearLabel: string;
    clearTitle?: string;
    fallback?: string;
    host?: HTMLDivElement;
    leadingContent?: (hasValue: boolean) => readonly Node[];
    showPathTitle?: boolean;
    extraActions?: Node | readonly Node[];
    groupLabel?: string;
    paddingBottom?: "none" | "sm" | "md" | "lg" | "xl";
    name?: string;
    reportErrors?: boolean;
    onError?: (operation: "read" | "choose" | "reset", error: unknown) => void;
}

export function createPathFieldStore(
    read: () => string | undefined | Promise<string | undefined>,
    subscribe: (listener: () => void) => () => void,
): Pick<SettingsStore<string | undefined>, "get" | "subscribe"> {
    return {
        get: () => read(),
        subscribe: (_id, callback) => subscribe(() => callback(undefined)),
    };
}

export function createLibraryPathField(config: {
    read: () => string | undefined | Promise<string | undefined>;
    subscribe: (listener: () => void) => () => void;
    title: string;
    emptyText: string;
    browse: () => Promise<void>;
    reset: () => void | Promise<void>;
    clearLabel: string;
}): PathField {
    return new PathField({
        store: createPathFieldStore(config.read, config.subscribe),
        id: "library-path",
        title: config.title,
        emptyText: config.emptyText,
        browse: config.browse,
        clear: config.reset,
        clearLabel: config.clearLabel,
        groupLabel: config.title,
        reportErrors: true,
    });
}

export class PathField extends VanillaView<PathFieldProps> {
    private valuePanel: HTMLDivElement | undefined;
    private clearButton: ButtonView | undefined;
    private linkClearButton: IconButtonView | undefined;
    private syncGeneration = 0;

    public constructor(props: PathFieldProps) {
        const root = props.host ?? (props.variant === "link-or-placeholder"
            ? document.createElement("div") as HTMLDivElement
            : panel({ direction: "row", align: "center", gap: "md", paddingBottom: props.paddingBottom }));
        if (props.variant === "link-or-placeholder" && !props.host) root.style.display = "contents";
        super(props, root);
    }

    protected onMount(): void {
        if (this.props.variant === "link-or-placeholder") {
            this.valuePanel = this.root as HTMLDivElement;
            this.listen(this.root, "click", this.onLinkClick);
            this.sync();
            this.own(this.props.store.subscribe(this.props.id, () => this.sync()));
            return;
        }
        if (this.props.groupLabel !== undefined) {
            this.root.setAttribute("role", "group");
            this.root.setAttribute("aria-label", this.props.groupLabel);
        }
        this.valuePanel = panel({ flex: true, minWidth: 0, paddingY: "sm", paddingX: "md", background: "dark", border: true, rounded: "sm", overflow: "hidden" });
        if (this.props.name !== undefined) this.valuePanel.dataset.name = this.props.name;
        this.root.append(this.valuePanel);
        const browse = this.child(new ButtonView({ variant: "link", size: "sm", background: "light", onClick: () => void this.handleBrowse(), children: t("settings.browse") }));
        this.root.append(browse.root);
        browse.mount();
        const extraActions = this.props.extraActions;
        if (Array.isArray(extraActions)) this.root.append(...extraActions);
        else if (extraActions) this.root.append(extraActions as Node);
        this.sync();
        this.own(this.props.store.subscribe(this.props.id, () => this.sync()));
    }

    protected onDispose(): void {
        this.syncGeneration++;
        this.valuePanel = undefined;
        this.clearButton = undefined;
        this.linkClearButton = undefined;
    }

    private sync(): void {
        const generation = ++this.syncGeneration;
        try {
            const result = this.props.store.get(this.props.id);
            if (result instanceof Promise) {
                void result.then((value) => {
                    if (!this.isDisposed && generation === this.syncGeneration) this.renderValue(value);
                }).catch((error: unknown) => {
                    if (!this.isDisposed && generation === this.syncGeneration) {
                        this.renderValue(this.props.fallback);
                        this.reportError("read", error);
                    }
                });
            } else {
                this.renderValue(result);
            }
        } catch (error: unknown) {
            this.renderValue(this.props.fallback);
            this.reportError("read", error);
        }
    }

    private renderValue(value: string | undefined): void {
        if (this.props.variant === "link-or-placeholder") {
            if (this.linkClearButton) {
                this.releaseChild(this.linkClearButton);
                this.linkClearButton = undefined;
            }
            const filename = value ? fpBasename(value) : "";
            const contents = filename
                ? [...(this.props.leadingContent?.(true) ?? []), this.createLink(filename, value), this.createLinkClearButton()]
                : [...(this.props.leadingContent?.(false) ?? []), settingsPlaceholder(this.props.emptyText)];
            this.valuePanel?.replaceChildren(...contents);
            return;
        }
        this.valuePanel?.replaceChildren(value ? settingsPath(value) : text(this.props.emptyText, { size: "sm", italic: true, color: "light" }));
        if (value && !this.clearButton) {
            const clearButton = this.child(new ButtonView({ variant: "link", size: "sm", background: "light", onClick: () => void this.handleClear(), children: this.props.clearLabel }));
            this.clearButton = clearButton;
            this.root.append(clearButton.root);
            clearButton.mount();
        } else if (!value && this.clearButton) {
            this.releaseChild(this.clearButton);
            this.clearButton = undefined;
        }
    }

    private createLinkClearButton(): Node {
        const button = this.child(new IconButtonView({
            size: "sm",
            icon: "close",
            title: this.props.clearTitle ?? t("settings.removeVlcPath"),
            onClick: () => void this.handleClear(),
        }));
        this.linkClearButton = button;
        button.mount();
        return button.root;
    }

    private createLink(filename: string, filePath: string | undefined): HTMLSpanElement {
        const link = settingsLink(filename);
        if (this.props.showPathTitle && filePath) link.title = filePath;
        return link;
    }

    private readonly onLinkClick = (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest('[data-type="settings-link"], [data-type="settings-placeholder"]')) return;
        void this.handleBrowse();
    };

    private async handleBrowse(): Promise<void> {
        try {
            await this.props.browse();
        } catch (error: unknown) {
            this.reportError("choose", error);
        }
    }

    private async handleClear(): Promise<void> {
        try {
            await this.props.clear();
        } catch (error: unknown) {
            this.reportError("reset", error);
        }
    }

    private reportError(operation: "read" | "choose" | "reset", error: unknown): void {
        if (this.props.onError) {
            this.props.onError(operation, error);
            return;
        }
        if (!this.props.reportErrors) return;
        const setting = this.props.title.toLowerCase();
        const fallback = operation === "read"
            ? t("settings.failedRead", { setting })
            : operation === "choose"
              ? t("settings.failedChoose", { setting })
              : t("settings.failedReset", { setting });
        ui.notify(errMessage(error, fallback), "warning");
    }
}
