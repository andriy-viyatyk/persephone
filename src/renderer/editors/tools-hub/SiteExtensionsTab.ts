import { pagesModel } from "../../api/pages";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { siteExtensionStore, type SiteExtensionListing } from "../../api/site-extensions";
import { sameSiteExtensionHostSet, siteExtensionTrust } from "../../api/site-extension-trust";
import { confirmAndRemoveSiteExtension, siteExtensionFolder } from "../../api/site-extension-management";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { InputView } from "../../uikit/Input/InputView";
import { SwitchView } from "../../uikit/Switch/SwitchView";
import { createPanelElement, type PanelStyleProps } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import "../../uikit/Button/Button.css";
import "../../uikit/IconButton/IconButton.css";
import "../../uikit/Input/Input.css";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Switch/Switch.css";
import "../../uikit/Text/Text.css";
import "./SiteExtensionsTab.css";

type Grant = { hosts: string[]; enabled: boolean };
type Entry = { listing?: SiteExtensionListing; id: string; grant?: Grant };
type RowView = ButtonView | IconButtonView | SwitchView;

/**
 * Tools & Editors hub tab listing every installed site extension (US-1613): trust state,
 * enable/disable, revoke, open folder, remove. Settings shows only a summary that links here.
 */
export class SiteExtensionsTabView extends VanillaView<Record<string, never>> {
    private readonly list = createPanelElement({ direction: "column" });
    private readonly reloadNotice = createTextElement("", { color: "warning", size: "xs" });
    private readonly status = createTextElement("", { color: "error", size: "xs" });
    private readonly folder = createTextElement("", { color: "light", size: "xs" });
    private readonly rowViews: RowView[] = [];
    private input: InputView | undefined;
    private entries: Entry[] = [];
    private query = "";
    private reloadRequired = false;
    private alive = false;

    public constructor(props: Record<string, never>) {
        const root = createPanelElement({ name: "site-extensions-tab", direction: "column", flex: 1, minHeight: 0 });
        root.dataset.type = "site-extensions-tab";
        super(props, root);
    }

    protected onMount(): void {
        this.alive = true;
        const toolbar = createPanelElement({ direction: "row", align: "center", gap: "sm", paddingX: "lg", paddingBottom: "md", shrink: false });
        this.input = this.child(new InputView(this.inputProps()));
        const refresh = this.child(new IconButtonView({
            name: "site-extensions-refresh", size: "sm", icon: "refresh", title: t("tools.refresh"), onClick: () => void this.refresh(),
        }));
        const openRoot = this.child(new IconButtonView({
            name: "site-extensions-open-root", size: "sm", icon: "folder-open", title: t("tools.openSiteExtensionsFolder"),
            onClick: () => void this.perform(async () => { await pagesModel.addEmptyPageWithNavPanel(await siteExtensionStore.getRoot()); }),
        }));
        const description = createPanelElement({ flex: 1, paddingLeft: "md" }, [createTextElement(
            t("tools.siteExtensionsDescription"),
            { color: "light", size: "xs" },
        )]);
        toolbar.append(this.input.root, refresh.root, openRoot.root, description);

        this.list.dataset.part = "list";
        this.reloadNotice.dataset.name = "site-extension-reload-notice";
        this.reloadNotice.hidden = true;
        const content = createPanelElement({ direction: "column", flex: 1, minHeight: 0, overflowY: "auto", gap: "sm", paddingX: "lg", paddingBottom: "lg" });
        this.folder.dataset.name = "site-extensions-tab-folder";
        content.append(this.folder, this.status, this.reloadNotice, this.list);
        this.root.append(toolbar, content);
        this.input.mount();
        refresh.mount();
        openRoot.mount();

        // The mirror follows main's broadcasts, so this also covers changes made in other windows.
        this.own(siteExtensionTrust.subscribe(() => { void this.refresh(); }));
        this.own(settings.onChanged.subscribe(({ key }) => { if (key === "site-extensions.path") void this.refresh(); }));
        void this.refresh();
    }

    protected onDispose(): void {
        this.alive = false;
        this.disposeRows();
    }

    private inputProps() {
        return {
            name: "site-extensions-filter",
            size: "sm" as const,
            value: this.query,
            onChange: (value: string) => this.setQuery(value),
            placeholder: t("tools.filterExtensions"),
            tone: this.query ? "accent" as const : "default" as const,
            maxWidth: 360,
        };
    }

    private setQuery(query: string): void {
        this.query = query;
        this.input?.update(this.inputProps());
        this.renderEntries();
    }

    private async refresh(): Promise<void> {
        try {
            const [listings] = await Promise.all([siteExtensionStore.list(), siteExtensionTrust.load()]);
            const root = await siteExtensionStore.getRoot();
            if (!this.alive) return;
            this.folder.textContent = t("tools.folderPath", { path: root });
            const grants = siteExtensionTrust.snapshot;
            const listed = new Set(listings.map((listing) => listing.id));
            this.entries = listings.map((listing) => ({ listing, id: listing.id, grant: grants[listing.id] }));
            for (const [id, grant] of Object.entries(grants)) if (!listed.has(id)) this.entries.push({ id, grant });
            this.status.textContent = "";
            this.renderEntries();
        } catch (error) {
            if (this.alive) this.status.textContent = errMessage(error, t("tools.siteExtensionsLoadFailed"));
        }
    }

    private renderEntries(): void {
        this.disposeRows();
        this.list.replaceChildren();
        this.reloadNotice.textContent = this.reloadRequired
            ? t("tools.extensionReloadRequired")
            : "";
        this.reloadNotice.hidden = !this.reloadRequired;
        if (this.entries.length === 0) {
            this.list.append(createTextElement(t("tools.noSiteExtensions"), { color: "light", size: "sm" }));
            return;
        }
        const query = this.query.trim().toLowerCase();
        const visible = query ? this.entries.filter((entry) => matches(entry, query)) : this.entries;
        if (visible.length === 0) {
            this.list.append(createTextElement(t("tools.noExtensionsMatch"), { color: "light", size: "sm" }));
            return;
        }
        for (const entry of visible) this.list.append(this.createEntry(entry));
    }

    private createEntry(entry: Entry): HTMLElement {
        const listing = entry.listing;
        const usable = listing && listing.status !== "invalid" ? listing : undefined;
        const row = panel({ direction: "column", rounded: "sm", background: "dark" });
        row.dataset.extensionId = entry.id;

        const header = panel({ direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs" });
        header.append(panel({ flex: true }, createTextElement(usable ? usable.name : entry.id, { size: "sm" })));
        header.append(badge(!listing ? t("tools.folderMissing") : listing.status === "valid" ? t("tools.extensionValid") : listing.status === "invalid" ? t("tools.extensionInvalid") : t("tools.extensionConflictStatus")));
        if (entry.grant) {
            header.append(createTextElement(entry.grant.enabled ? t("tools.trusted") : t("tools.trustedDisabled"), { color: entry.grant.enabled ? "success" : "warning", size: "xs" }));
            this.addRowView(header, new SwitchView({
                name: `site-extension-enabled-${entry.id}`, label: t("tools.enableExtension", { id: entry.id }), size: "sm", checked: entry.grant.enabled,
                onChange: (value) => void this.perform(async () => { await siteExtensionTrust.setEnabled(entry.id, value); this.reloadRequired = true; }),
            }));
            this.addButton(header, `site-extension-revoke-${entry.id}`, t("tools.revokeTrust"), async () => { await siteExtensionTrust.revoke(entry.id); this.reloadRequired = true; });
        } else {
            header.append(createTextElement(t("tools.notTrusted"), { color: "light", size: "xs" }));
        }
        if (listing) {
            this.addButton(header, `site-extension-open-folder-${entry.id}`, t("tools.openFolder"), async () => { await pagesModel.addEmptyPageWithNavPanel(await siteExtensionFolder(entry.id)); });
        }
        if (listing || entry.grant) {
            this.addRowView(header, new IconButtonView({
                name: `site-extension-remove-${entry.id}`, size: "sm", icon: "close", title: t("tools.removeExtension"),
                onClick: () => void this.perform(async () => {
                    const displayName = listing && listing.status !== "invalid" ? listing.name : entry.id;
                    const result = await confirmAndRemoveSiteExtension(entry.id, displayName);
                    if (result.revokedTrust) this.reloadRequired = true;
                }),
            }));
        }
        row.append(header);

        if (usable) row.append(detail(t("tools.hosts"), usable.hosts.join(", ")));
        if (listing?.status === "invalid") row.append(detail(t("tools.problem"), listing.reason, "error"));
        if (listing?.status === "conflict") row.append(detail(t("tools.conflict"), t("tools.extensionConflict", { hosts: listing.conflictingHosts.join(", ") }), "warning"));
        if (!listing) row.append(detail(t("tools.folder"), t("tools.deletedFolderTrust")));
        if (entry.grant && usable && !sameSiteExtensionHostSet(entry.grant.hosts, usable.hosts)) {
            row.append(detail(t("tools.trust"), t("tools.trustChanged"), "warning"));
        }
        return row;
    }

    private addButton(host: HTMLElement, name: string, label: string, action: () => Promise<void>): void {
        this.addRowView(host, new ButtonView({ name, variant: "ghost", size: "sm", background: "light", children: label, onClick: () => void this.perform(action) }));
    }

    private addRowView(host: HTMLElement, view: RowView): void {
        this.child(view);
        this.rowViews.push(view);
        host.append(view.root);
        view.mount();
    }

    private async perform(action: () => Promise<void>): Promise<void> {
        try { await action(); }
        catch (error) { ui.notify(errMessage(error, "Site extension action failed."), "error"); }
        await this.refresh();
    }

    private disposeRows(): void {
        for (const view of this.rowViews) this.releaseChild(view);
        this.rowViews.length = 0;
    }
}

function matches(entry: Entry, query: string): boolean {
    const listing = entry.listing;
    const texts = [entry.id];
    if (listing && listing.status !== "invalid") texts.push(listing.name, ...listing.hosts);
    if (entry.grant) texts.push(...entry.grant.hosts);
    return texts.some((value) => value.toLowerCase().includes(query));
}

function panel(props: PanelStyleProps, ...children: Node[]): HTMLDivElement {
    return createPanelElement(props, children);
}

function badge(value: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.dataset.type = "site-extension-badge";
    element.textContent = value;
    return element;
}

function detail(label: string, value: string, color?: "error" | "warning"): HTMLDivElement {
    const labelElement = document.createElement("span");
    labelElement.dataset.type = "site-extension-label";
    labelElement.textContent = label;
    return panel(
        { direction: "row", align: "center", gap: "sm", paddingX: "md", paddingBottom: "xs" },
        labelElement,
        createTextElement(value, { color, size: "xs" }),
    );
}
