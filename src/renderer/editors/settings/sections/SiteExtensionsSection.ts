import { api } from "../../../../ipc/renderer/api";
import { errMessage } from "../../../../shared/utils";
import { siteExtensionStore } from "../../../api/site-extensions";
import { siteExtensionTrust } from "../../../api/site-extension-trust";
import { settings } from "../../../api/settings";
import { pagesModel } from "../../../api/pages";
import { fs } from "../../../api/fs";
import { ui } from "../../../api/ui";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createSectionRoot, panel, settingsPath, text } from "./settings-native";
import "../../../uikit/Button/Button.css";

/**
 * Settings summary for site extensions (US-1613): the extensions folder, installed and trusted
 * counts, and a button to the full list in the Tools & Editors hub's Site extensions tab.
 */
export class SiteExtensionsSectionView extends VanillaView<Record<string, never>> {
    private readonly folderValue = panel({ flex: true, minWidth: 0, paddingY: "sm", paddingX: "md", background: "dark", border: true, rounded: "sm", overflow: "hidden" });
    private readonly folderRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
    private readonly summary = text("", { size: "xs" });
    private readonly problems = text("", { color: "warning", size: "xs" });
    private readonly browseButton: ButtonView;
    private readonly resetButton: ButtonView;
    private readonly openButton: ButtonView;
    private refreshGeneration = 0;

    constructor(props: Record<string, never>) {
        const root = createSectionRoot("settings-section");
        super(props, root);
        this.browseButton = this.child(new ButtonView({
            name: "site-extensions-folder-browse", variant: "link", size: "sm", background: "light",
            children: "Browse...", onClick: () => void this.browse(),
        }));
        this.resetButton = this.child(new ButtonView({
            name: "site-extensions-folder-reset", variant: "link", size: "sm", background: "light",
            children: "Use default", onClick: () => settings.set("site-extensions.path", ""),
        }));
        this.openButton = this.child(new ButtonView({
            name: "site-extensions-open", variant: "ghost", size: "sm", background: "light",
            children: "Open site extensions",
            onClick: () => void pagesModel.showToolsHubPage({ tab: "site-extensions" }),
        }));
        this.folderValue.dataset.name = "site-extensions-folder";
        this.summary.dataset.name = "site-extensions-summary";
        this.problems.hidden = true;
        this.folderRow.append(this.folderValue, this.browseButton.root, this.resetButton.root);
        root.append(
            panel({ paddingBottom: "lg" }, text("Site Extensions", { bold: true, size: "sm" })),
            panel({ flex: true, paddingBottom: "md" }, text(
                "Scripts that give agents a model of a website. Each runs only on its own hosts, and only after you trust it.",
                { color: "light", size: "xs" },
            )),
            this.folderRow,
            panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" },
                panel({ direction: "column", flex: true }, this.summary, this.problems),
                this.openButton.root,
            ),
        );
    }

    protected onMount(): void {
        this.browseButton.mount();
        this.resetButton.mount();
        this.openButton.mount();
        this.own(siteExtensionTrust.subscribe(() => { void this.refresh(); }));
        this.own(settings.onChanged.subscribe(({ key }) => { if (key === "site-extensions.path") void this.refresh(); }));
        void this.refresh();
    }

    protected onDispose(): void { this.refreshGeneration++; }

    private async browse(): Promise<void> {
        try {
            const result = await api.showOpenFolderDialog({ title: "Select Site Extensions Folder", defaultPath: await siteExtensionStore.getRoot() });
            if (result?.[0]) settings.set("site-extensions.path", result[0]);
        } catch (error) {
            ui.notify(errMessage(error, "Failed to choose the site extensions folder."), "warning");
        }
    }

    private async refresh(): Promise<void> {
        const generation = ++this.refreshGeneration;
        try {
            const configured = settings.get("site-extensions.path").trim() !== "";
            const root = await siteExtensionStore.getRoot();
            const [listings, folderStat] = await Promise.all([siteExtensionStore.list(), fs.stat(root), siteExtensionTrust.load()]);
            if (generation !== this.refreshGeneration) return;
            this.folderValue.replaceChildren(settingsPath(root));
            if (!configured) this.folderValue.append(text(" (default)", { size: "xs", color: "light" }));
            this.resetButton.root.hidden = !configured;

            const grants = siteExtensionTrust.snapshot;
            const listed = new Set(listings.map((listing) => listing.id));
            const trusted = listings.filter((listing) => grants[listing.id]).length;
            const broken = listings.filter((listing) => listing.status !== "valid").length
                + Object.keys(grants).filter((id) => !listed.has(id)).length;
            this.summary.textContent = listings.length === 0
                ? "No site extensions installed."
                : `${listings.length} installed, ${trusted} trusted.`;
            const problems = [
                // The default folder is created on first use; a configured one should already exist.
                ...(configured && !folderStat.exists ? ["The folder does not exist."] : []),
                ...(broken > 0 ? [`${broken} need attention.`] : []),
            ];
            this.problems.textContent = problems.join(" ");
            this.problems.hidden = problems.length === 0;
        } catch (error) {
            if (generation === this.refreshGeneration) this.summary.textContent = errMessage(error, "Site extensions could not be loaded.");
        }
    }
}
