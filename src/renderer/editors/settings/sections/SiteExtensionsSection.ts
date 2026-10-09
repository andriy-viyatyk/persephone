import { api } from "../../../../ipc/renderer/api";
import { errMessage } from "../../../../shared/utils";
import { t } from "../../../../shared/i18n/t";
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
            children: t("settings.siteExtensionsFolderBrowse"), onClick: () => void this.browse(),
        }));
        this.resetButton = this.child(new ButtonView({
            name: "site-extensions-folder-reset", variant: "link", size: "sm", background: "light",
            children: t("settings.siteExtensionsUseDefault"), onClick: () => settings.set("site-extensions.path", ""),
        }));
        this.openButton = this.child(new ButtonView({
            name: "site-extensions-open", variant: "ghost", size: "sm", background: "light",
            children: t("settings.siteExtensionsOpenList"),
            onClick: () => void pagesModel.showToolsHubPage({ tab: "site-extensions" }),
        }));
        this.folderValue.dataset.name = "site-extensions-folder";
        this.summary.dataset.name = "site-extensions-summary";
        this.problems.hidden = true;
        this.folderRow.append(this.folderValue, this.browseButton.root, this.resetButton.root);
        root.append(
            panel({ paddingBottom: "lg" }, text(t("settings.siteExtensionsTitle"), { bold: true, size: "sm" })),
            panel({ flex: true, paddingBottom: "md" }, text(
                t("settings.siteExtensionsAgentDescription"),
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
            const result = await api.showOpenFolderDialog({ title: t("settings.siteExtensionsFolderTitle"), defaultPath: await siteExtensionStore.getRoot() });
            if (result?.[0]) settings.set("site-extensions.path", result[0]);
        } catch (error) {
            ui.notify(errMessage(error, t("settings.siteExtensionsFolderFailed")), "warning");
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
            if (!configured) this.folderValue.append(text(t("settings.siteExtensionsDefaultSuffix"), { size: "xs", color: "light" }));
            this.resetButton.root.hidden = !configured;

            const grants = siteExtensionTrust.snapshot;
            const listed = new Set(listings.map((listing) => listing.id));
            const trusted = listings.filter((listing) => grants[listing.id]).length;
            const broken = listings.filter((listing) => listing.status !== "valid").length
                + Object.keys(grants).filter((id) => !listed.has(id)).length;
            const summaryParams = { count: listings.length, trusted };
            this.summary.textContent = listings.length === 0
                ? t("settings.noSiteExtensions")
                : t("settings.siteExtensionInstalledTrusted", summaryParams);
            const problems = [
                // The default folder is created on first use; a configured one should already exist.
                ...(configured && !folderStat.exists ? [t("settings.siteExtensionFolderMissing")] : []),
                ...(broken > 0 ? [t("settings.siteExtensionNeedsAttention", { count: broken })] : []),
            ];
            this.problems.textContent = problems.join(" ");
            this.problems.hidden = problems.length === 0;
        } catch (error) {
            if (generation === this.refreshGeneration) this.summary.textContent = errMessage(error, t("settings.siteExtensionsLoadFailed"));
        }
    }
}
