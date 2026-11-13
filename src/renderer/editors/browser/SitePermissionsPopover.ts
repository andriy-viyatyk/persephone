import { t } from "../../../shared/i18n/t";
import type { BrowserSitePermissionEntry, BrowserSitePermissionKey, BrowserSitePermissions } from "../../../ipc/browser-ipc";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { SwitchView } from "../../uikit/Switch/SwitchView";
import { TagView } from "../../uikit/Tag/TagView";
import { attachTooltip, type TooltipAttachment } from "../../uikit/Tooltip/attach-tooltip";
import { BROWSER_PERMISSION_LABELS } from "./browser-permission-labels";

export type AiVisionIndicator =
    | { source: "none" | "page" }
    | { source: "extension"; extensionName: string };

export interface SitePermissionsContentProps {
    permissions: BrowserSitePermissions;
    changed: boolean;
    aiVisionIndicator: AiVisionIndicator;
    certificateVisible: boolean;
    certificateHandlerAvailable: boolean;
    onSet: (key: BrowserSitePermissionKey, decision: "allow" | "block") => void;
    onReset: () => void;
    onReload: () => void;
    onViewCertificate: () => void;
}

export class SitePermissionsContentView extends VanillaView<SitePermissionsContentProps> {
    // The popover shell owns its own `data-type`; this editor-owned content root is the styling hook.
    private readonly contentRoot = document.createElement("div");
    private readonly aiVisionBadge: TagView;
    private aiVisionBadgeTooltip: TooltipAttachment | undefined;
    private certificateButtonTooltip: TooltipAttachment | undefined;
    private readonly headerRow = document.createElement("div");
    private readonly certificateButton: ButtonView;
    private readonly heading = createTextElement("", { size: "md", bold: true });
    private readonly rows = document.createElement("div");
    private readonly reset: ButtonView;
    private readonly reloadHint = createTextElement(t("browser.profileNetworkReloadHint"), { size: "sm", color: "light" });
    private readonly reload: ButtonView;
    private readonly rowViews = new Map<BrowserSitePermissionKey, { row: HTMLDivElement; label: HTMLSpanElement; hint: HTMLSpanElement; toggle: SwitchView }>();

    public constructor(props: SitePermissionsContentProps, host: HTMLElement) {
        super(props, host);
        this.rows.dataset.part = "permission-list";
        this.reset = this.child(new ButtonView({ name: "site-permissions-reset", variant: "ghost", size: "sm", children: t("browser.sitePermissionsReset"), onClick: () => this.props.onReset() }));
        this.reload = this.child(new ButtonView({ name: "site-permissions-reload", variant: "link", size: "sm", children: t("browser.reload"), onClick: () => this.props.onReload() }));
        this.aiVisionBadge = this.child(new TagView({ name: "site-permissions-ai-vision-badge", label: "", variant: "outlined", size: "sm" }));
        this.certificateButton = this.child(new ButtonView({ name: "site-certificate-view", size: "sm", children: t("browser.certificateView"), onClick: () => this.props.onViewCertificate() }));
    }

    protected onMount(): void {
        this.contentRoot.dataset.type = "browser-site-permissions";
        this.headerRow.dataset.part = "header";
        this.headerRow.append(this.aiVisionBadge.root, this.certificateButton.root);
        this.certificateButtonTooltip = attachTooltip(this.certificateButton.root, { content: "" });
        this.own(() => this.certificateButtonTooltip?.dispose());
        this.contentRoot.append(this.headerRow, this.heading, this.rows, this.reset.root);
        const reloadRow = document.createElement("div");
        reloadRow.dataset.part = "reload-hint";
        reloadRow.append(this.reloadHint, this.reload.root);
        this.contentRoot.append(reloadRow);
        this.root.append(this.contentRoot);
        this.reset.mount();
        this.reload.mount();
        this.aiVisionBadge.mount();
        this.certificateButton.mount();
        this.aiVisionBadgeTooltip = attachTooltip(this.aiVisionBadge.root, { content: null });
        this.own(() => this.aiVisionBadgeTooltip?.dispose());
        this.sync(this.props);
    }

    protected onUpdate(props: SitePermissionsContentProps): void {
        this.sync(props);
    }

    private sync(props: SitePermissionsContentProps): void {
        this.heading.textContent = props.permissions.origin;
        this.contentRoot.dataset.changed = props.changed ? "" : "false";
        const indicator = props.aiVisionIndicator;
        if (indicator.source === "none") {
            this.aiVisionBadge.root.hidden = true;
        } else {
            const isPage = indicator.source === "page";
            const extensionName = indicator.source === "extension" ? indicator.extensionName : "";
            // Rest props (data-*) apply only at construction, so the source attribute is set directly.
            this.aiVisionBadge.root.dataset.aiVisionSource = indicator.source;
            this.aiVisionBadge.update({
                name: "site-permissions-ai-vision-badge",
                variant: "outlined",
                size: "sm",
            label: isPage ? t("browser.aiVisionBuiltinBadge") : t("browser.aiVisionExtensionBadge", { name: extensionName }),
            });
            this.aiVisionBadgeTooltip?.update({
                content: isPage
                    ? t("browser.aiVisionBuiltinTooltip")
                    : t("browser.aiVisionExtensionTooltip", { name: extensionName }),
            });
            this.aiVisionBadge.root.hidden = false;
        }
        this.headerRow.hidden = indicator.source === "none" && !props.certificateVisible;
        this.certificateButton.root.hidden = !props.certificateVisible;
        this.certificateButton.update({
            name: "site-certificate-view",
            size: "sm",
            children: t("browser.certificateView"),
            onClick: () => this.props.onViewCertificate(),
        });
        this.certificateButtonTooltip?.update({ content: props.certificateHandlerAvailable
            ? t("browser.certificateTooltipAvailable")
            : t("browser.certificateTooltipUnavailable") });
        const entries = props.permissions.entries;
        const entryKeys = new Set(entries.map((entry) => entry.key));
        for (const [key, row] of this.rowViews) {
            if (entryKeys.has(key)) continue;
            this.releaseChild(row.toggle);
            row.row.remove();
            this.rowViews.delete(key);
        }
        const orderedRows: HTMLDivElement[] = [];
        for (const entry of entries) {
            const row = this.getOrCreateRow(entry);
            row.label.textContent = this.permissionLabel(entry.key);
            row.hint.textContent = entry.decision === undefined ? t("browser.permissionAsk") : "";
            row.hint.hidden = entry.decision !== undefined;
            row.toggle.update({ name: `site-permission-${entry.key.replace(/[^a-z0-9-]/gi, "-")}`, label: this.permissionLabel(entry.key), checked: entry.decision === "allow", size: "sm", onChange: (checked) => this.props.onSet(entry.key, checked ? "allow" : "block") });
            orderedRows.push(row.row);
        }
        this.rows.replaceChildren(...orderedRows);
        this.reloadHint.hidden = !props.changed;
        this.reload.root.hidden = !props.changed;
    }

    private getOrCreateRow(entry: BrowserSitePermissionEntry): { row: HTMLDivElement; label: HTMLSpanElement; hint: HTMLSpanElement; toggle: SwitchView } {
        const existing = this.rowViews.get(entry.key);
        if (existing) return existing;
        const row = document.createElement("div");
        row.dataset.part = "permission-row";
        const copy = document.createElement("div");
        copy.dataset.part = "permission-copy";
        const label = createTextElement("");
        const hint = createTextElement("", { size: "sm", color: "light" });
        hint.dataset.part = "permission-ask";
        copy.append(label, hint);
        const toggle = this.child(new SwitchView({ name: `site-permission-${entry.key}`, label: this.permissionLabel(entry.key), checked: entry.decision === "allow", size: "sm", onChange: (checked) => this.props.onSet(entry.key, checked ? "allow" : "block") }));
        row.append(copy, toggle.root);
        if (this.root.isConnected) toggle.mount();
        const view = { row, label, hint, toggle };
        this.rowViews.set(entry.key, view);
        return view;
    }

    private permissionLabel(key: string): string {
        if (key.startsWith("openExternal:")) return t(BROWSER_PERMISSION_LABELS.openExternal.setting, { scheme: key.slice("openExternal:".length) });
        const label = BROWSER_PERMISSION_LABELS[key as keyof typeof BROWSER_PERMISSION_LABELS];
        return label ? t(label.setting) : key;
    }
}

