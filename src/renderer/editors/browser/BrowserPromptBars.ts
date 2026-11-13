import type { BrowserEditor } from "./BrowserEditor";
import { t } from "../../../shared/i18n/t";
import type { BrowserEditorState } from "./browser-state";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { BROWSER_PERMISSION_LABELS } from "./browser-permission-labels";

export class PopupBlockedView extends VanillaView<{ model: BrowserEditor; count: number }> {
    private readonly text = createTextElement("");
    private readonly allow: ButtonView;
    private readonly dismiss: IconButtonView;
    public constructor(props: { model: BrowserEditor; count: number }) {
        const root = createPanelElement({ name: "popup-blocked-bar", direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs", background: "light", borderBottom: true, shrink: false });
        super(props, root); this.allow = this.child(new ButtonView({ name: "popup-allow", size: "sm", variant: "ghost", children: t("browser.allow"), onClick: props.model.allowPopups })); this.dismiss = this.child(new IconButtonView({ name: "popup-dismiss", size: "sm", icon: "close", title: t("browser.dismiss"), onClick: props.model.dismissBlockedPopups }));
        root.append(createPanelElement({ flex: true }, [this.text]), this.allow.root, this.dismiss.root);
    }
    protected onMount(): void { this.allow.mount(); this.dismiss.mount(); this.sync(); }
    protected onUpdate(props: { model: BrowserEditor; count: number }): void { this.props = props; this.sync(); }
    private sync(): void { this.text.textContent = t("browser.blockedPopup", { count: this.props.count }); }
}

export class PermissionPromptBarView extends VanillaView<{ model: BrowserEditor; prompt: BrowserEditorState["permissionPrompts"][number] }> {
    private readonly origin = createTextElement("");
    private readonly requestText = createTextElement("");
    private readonly allow: ButtonView;
    private readonly block: ButtonView;

    public constructor(props: { model: BrowserEditor; prompt: BrowserEditorState["permissionPrompts"][number] }) {
        const root = createPanelElement({ name: "browser-permission-prompt", direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs", background: "light", borderBottom: true, shrink: false });
        super(props, root);
        const details = createPanelElement({ name: "permission-prompt-copy", flex: true, direction: "column", gap: "xs" });
        details.append(this.origin, this.requestText);
        this.allow = this.child(new ButtonView({ name: "permission-allow", size: "sm", variant: "ghost", children: t("browser.allow"), onClick: () => this.resolve("allow") }));
        this.block = this.child(new ButtonView({ name: "permission-block", size: "sm", variant: "ghost", children: t("browser.block"), onClick: () => this.resolve("block") }));
        root.append(details, this.allow.root, this.block.root);
    }

    protected onMount(): void { this.allow.mount(); this.block.mount(); this.sync(); }
    protected onUpdate(props: { model: BrowserEditor; prompt: BrowserEditorState["permissionPrompts"][number] }): void { this.props = props; this.sync(); }

    private sync(): void {
        const prompt = this.props.prompt;
        this.origin.textContent = prompt.topLevelOrigin;
        this.origin.dataset.name = "permission-origin";
        const names = prompt.permissions.map((permission) => permission === "openExternal"
            ? t(BROWSER_PERMISSION_LABELS.openExternal.prompt, { scheme: prompt.externalScheme || "external" })
            : BROWSER_PERMISSION_LABELS[permission as keyof typeof BROWSER_PERMISSION_LABELS]
                ? t(BROWSER_PERMISSION_LABELS[permission as keyof typeof BROWSER_PERMISSION_LABELS].prompt)
                : permission);
        this.requestText.textContent = t("browser.permissionRequest", { permissions: names.join(", ") });
        this.requestText.dataset.name = "permission-description";
    }

    private resolve(decision: "allow" | "block"): void {
        this.props.model.resolvePermissionPrompt(this.props.prompt.requestId, decision);
    }
}

export class SiteExtensionTrustPromptBarView extends VanillaView<{ model: BrowserEditor; prompt: BrowserEditorState["siteExtensionTrustPrompts"][number] }> {
    private readonly copy = createTextElement("");
    private readonly trust: ButtonView;
    private readonly notNow: ButtonView;
    public constructor(props: { model: BrowserEditor; prompt: BrowserEditorState["siteExtensionTrustPrompts"][number] }) {
        const root = createPanelElement({ name: "site-extension-trust-prompt", direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs", background: "light", borderBottom: true, shrink: false });
        super(props, root);
        const details = createPanelElement({ name: "site-extension-trust-copy", flex: true, direction: "column", gap: "xs" });
        details.append(this.copy);
        this.trust = this.child(new ButtonView({ name: "site-extension-trust", size: "sm", variant: "ghost", children: t("browser.trust"), onClick: () => void props.model.siteExtensions.trustPrompt(props.prompt.internalTabId, props.prompt.documentId) }));
        this.notNow = this.child(new ButtonView({ name: "site-extension-not-now", size: "sm", variant: "ghost", children: t("browser.notNow"), onClick: () => props.model.siteExtensions.dismissPrompt(props.prompt.internalTabId, props.prompt.documentId) }));
        root.append(details, this.trust.root, this.notNow.root);
    }
    protected onMount(): void { this.trust.mount(); this.notNow.mount(); this.sync(); }
    protected onUpdate(props: { model: BrowserEditor; prompt: BrowserEditorState["siteExtensionTrustPrompts"][number] }): void { this.props = props; this.sync(); }
    private sync(): void {
        const { name, host, hosts, fetchHosts, available } = this.props.prompt;
        const otherHosts = hosts.filter((item) => item !== host);
        this.copy.textContent = !available
            ? t("browser.siteExtensionTrustPromptInvalid", { name, host })
            : otherHosts.length
                ? t("browser.siteExtensionTrustPrompt", { name, host, otherHosts: otherHosts.join(", ") })
                : t("browser.siteExtensionTrustPromptSingleHost", { name, host });
        if (available) this.copy.textContent += " " + (fetchHosts.length
            ? t("browser.siteExtensionFetchDisclosure", { hosts: fetchHosts.join(", ") })
            : t("browser.siteExtensionNoFetchDisclosure"));
        this.copy.dataset.name = "site-extension-trust-prompt-copy";
        this.trust.root.hidden = !available;
    }
}

