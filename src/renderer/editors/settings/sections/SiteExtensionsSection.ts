import { api } from "../../../../ipc/renderer/api";
import { errMessage } from "../../../../shared/utils";
import { fpJoin, fpRelative, fpResolve, fpSep } from "../../../core/utils/file-path";
import { siteExtensionStore, type SiteExtensionListing } from "../../../api/site-extensions";
import { siteExtensionTrust } from "../../../api/site-extension-trust";
import { fs } from "../../../api/fs";
import { ui } from "../../../api/ui";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { IconButtonView } from "../../../uikit/IconButton/IconButtonView";
import { SwitchView } from "../../../uikit/Switch/SwitchView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createSectionRoot, panel, settingsLabel, text } from "./settings-native";
import "../../../uikit/Button/Button.css";
import "../../../uikit/IconButton/IconButton.css";
import "../../../uikit/Switch/Switch.css";
import "./SiteExtensionsSection.css";

type Entry = { listing?: SiteExtensionListing; id: string; grant?: { hosts: string[]; enabled: boolean } };

export class SiteExtensionsSectionView extends VanillaView<Record<string, never>> {
    private readonly list = document.createElement("div");
    private readonly refreshButton: ButtonView;
    private readonly renderedSwitches: SwitchView[] = [];
    private readonly renderedButtons: Array<ButtonView | IconButtonView> = [];
    private readonly reloadNotice = text("", { color: "warning", size: "xs" });
    private readonly status = text("", { color: "error", size: "xs" });
    private reloadRequired = false;

    constructor(props: Record<string, never>) {
        const root = createSectionRoot("settings-section");
        super(props, root);
        this.refreshButton = this.child(new ButtonView({
            name: "site-extensions-refresh", variant: "ghost", size: "sm", background: "light",
            children: "refresh", onClick: () => void this.refresh(),
        }));
        const description = panel({ flex: true }, text(
            "Scripts that give agents a model of a website. Each runs only on its own hosts, and only after you trust it.",
            { color: "light", size: "xs" },
        ));
        this.list.className = "site-extensions-list";
        this.reloadNotice.dataset.name = "site-extension-reload-notice";
        root.append(
            panel({ paddingBottom: "lg" }, text("Site Extensions", { bold: true, size: "sm" })),
            panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" }, description, this.refreshButton.root),
            this.status, this.reloadNotice, this.list,
        );
    }

    protected onMount(): void {
        this.refreshButton.mount();
        // The mirror follows main's broadcasts, so this also covers changes made in other windows.
        this.own(siteExtensionTrust.subscribe(() => { void this.refresh(); }));
        void this.refresh();
    }

    protected onDispose(): void { this.disposeRows(); }

    private async refresh(): Promise<void> {
        try {
            await siteExtensionTrust.load();
            const [listings] = await Promise.all([siteExtensionStore.list(), siteExtensionTrust.load()]);
            this.renderEntries(listings, siteExtensionTrust.snapshot);
            this.status.textContent = "";
        } catch (error) {
            this.status.textContent = errMessage(error, "Site extensions could not be loaded.");
        }
    }

    private renderEntries(listings: SiteExtensionListing[], grants: Record<string, { hosts: string[]; enabled: boolean }>): void {
        this.disposeRows();
        const byId = new Map(listings.map((listing) => [listing.id, listing]));
        const entries: Entry[] = listings.map((listing) => ({ listing, id: listing.id, grant: grants[listing.id] }));
        for (const [id, grant] of Object.entries(grants)) if (!byId.has(id)) entries.push({ id, grant });
        this.list.replaceChildren();
        this.reloadNotice.textContent = this.reloadRequired
            ? "Trust or enabled state changed. Pages that already ran an extension keep their current code and model until you reload or navigate."
            : "";
        this.reloadNotice.hidden = !this.reloadRequired;
        if (entries.length === 0) {
            this.list.append(text("No site extensions installed.", { color: "light", size: "xs" }));
            return;
        }
        for (const entry of entries) this.list.append(this.createEntry(entry));
    }

    private createEntry(entry: Entry): HTMLElement {
        const listing = entry.listing;
        const usable = listing && listing.status !== "invalid" ? listing : undefined;
        const row = panel({ direction: "column", rounded: "sm", background: "dark" });
        row.dataset.extensionId = entry.id;

        const header = panel({ direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs" });
        header.append(panel({ flex: true }, text(usable ? usable.name : entry.id, { size: "sm" })));
        header.append(badge(!listing ? "folder missing" : listing.status));
        if (entry.grant) {
            header.append(text(entry.grant.enabled ? "trusted" : "trusted, disabled", { color: entry.grant.enabled ? "success" : "warning", size: "xs" }));
            const enabled = new SwitchView({
                name: `site-extension-enabled-${entry.id}`, label: `Enable ${entry.id}`, size: "sm", checked: entry.grant.enabled,
                onChange: (value) => void this.perform(async () => { await siteExtensionTrust.setEnabled(entry.id, value); this.reloadRequired = true; }),
            });
            this.child(enabled); this.renderedSwitches.push(enabled); header.append(enabled.root); enabled.mount();
            this.addButton(header, `site-extension-revoke-${entry.id}`, "revoke trust", async () => { await siteExtensionTrust.revoke(entry.id); this.reloadRequired = true; });
        } else {
            header.append(text("not trusted", { color: "light", size: "xs" }));
        }
        if (listing) {
            this.addButton(header, `site-extension-open-folder-${entry.id}`, "open folder", async () => {
                const root = await fs.dataFileName("site-extensions");
                const extensionDir = fpResolve(root, entry.id);
                const relative = fpRelative(root, extensionDir);
                if (relative === ".." || relative.startsWith(`..${fpSep}`)) throw new Error("Extension folder is outside the site extensions directory.");
                await api.openPath(extensionDir);
            });
            const remove = new IconButtonView({
                name: `site-extension-remove-${entry.id}`, size: "sm", icon: "close", title: "Remove extension",
                onClick: () => void this.perform(async () => this.removeExtension(entry.id, listing)),
            });
            this.child(remove); this.renderedButtons.push(remove); header.append(remove.root); remove.mount();
        }
        row.append(header);

        if (usable) row.append(detail("Hosts:", usable.hosts.join(", ")));
        if (listing?.status === "invalid") row.append(detail("Problem:", listing.reason, "error"));
        if (listing?.status === "conflict") row.append(detail("Conflict:", `another extension also claims ${listing.conflictingHosts.join(", ")}; neither runs there`, "warning"));
        if (!listing) row.append(detail("Folder:", "deleted outside Settings; revoke the leftover trust"));
        if (entry.grant && usable && !sameHosts(entry.grant.hosts, usable.hosts)) {
            row.append(detail("Trust:", "the host list changed since you trusted it; the browser will ask again", "warning"));
        }
        return row;
    }

    private addButton(host: HTMLElement, name: string, label: string, action: () => Promise<void>): void {
        const button = new ButtonView({ name, variant: "ghost", size: "sm", background: "light", children: label, onClick: () => void this.perform(action) });
        this.child(button); this.renderedButtons.push(button); host.append(button.root); button.mount();
    }

    private async removeExtension(id: string, listing?: SiteExtensionListing): Promise<void> {
        const { showConfirmationDialog } = await import("../../../ui/dialogs/ConfirmationDialog");
        const choice = await showConfirmationDialog({ title: "Remove site extension", message: `Remove site extension "${listing && listing.status !== "invalid" ? listing.name : id}" and its folder?`, buttons: ["Delete", "Cancel"] });
        if (choice !== "Delete") return;
        try {
            const root = await fs.dataFileName("site-extensions");
            const extensionDir = fpJoin(root, id);
            const relative = fpRelative(root, extensionDir);
            if (relative === ".." || relative.startsWith(`..${fpSep}`)) throw new Error("Extension folder is outside the site extensions directory.");
            await fs.removeDir(extensionDir, true);
            // Only a trusted extension can have run in a page, so only then is a reload needed.
            if (siteExtensionTrust.get(id)) {
                await siteExtensionTrust.revoke(id);
                this.reloadRequired = true;
            }
            await this.refresh();
        } catch (error) {
            ui.notify(errMessage(error, "Failed to remove the site extension."), "error");
            await this.refresh();
        }
    }

    private async perform(action: () => Promise<void>): Promise<void> {
        try { await action(); await this.refresh(); }
        catch (error) { ui.notify(errMessage(error, "Site extension action failed."), "error"); }
    }

    private disposeRows(): void {
        for (const view of [...this.renderedSwitches, ...this.renderedButtons]) view.dispose();
        this.renderedSwitches.length = 0; this.renderedButtons.length = 0;
    }
}

function sameHosts(left: string[], right: string[]): boolean {
    return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function badge(value: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.dataset.type = "settings-badge";
    element.textContent = value;
    return element;
}

function detail(label: string, value: string, color?: "error" | "warning"): HTMLDivElement {
    return panel(
        { direction: "row", align: "center", gap: "sm", paddingX: "md", paddingBottom: "xs" },
        settingsLabel(label),
        text(value, { color, size: "xs" }),
    );
}
