import { fpRelative, fpResolve, fpSep } from "../core/utils/file-path";
import { fs } from "./fs";
import { siteExtensionStore, isValidSiteExtensionId } from "./site-extensions";
import { siteExtensionTrust } from "./site-extension-trust";
import type { SiteExtensionRemoveResult } from "./types/site-extensions";

/** Resolve an extension folder while refusing ids that could escape the configured root. */
export async function siteExtensionFolder(id: string): Promise<string> {
    if (!isValidSiteExtensionId(id)) throw new Error("Invalid site extension id.");
    const root = await siteExtensionStore.getRoot();
    const folder = fpResolve(root, id);
    const relative = fpRelative(root, folder);
    if (!relative || relative === ".." || relative.startsWith(`..${fpSep}`)) {
        throw new Error("Extension folder is outside the site extensions directory.");
    }
    return folder;
}

/** Confirm deletion, then remove the folder and revoke any existing user trust grant. */
export async function confirmAndRemoveSiteExtension(
    id: string,
    displayName?: string,
): Promise<SiteExtensionRemoveResult> {
    const folder = await siteExtensionFolder(id);
    const [stat, grant, listings] = await Promise.all([
        fs.stat(folder),
        Promise.resolve(siteExtensionTrust.get(id)),
        siteExtensionStore.list(),
    ]);
    if (!stat.exists && !grant) throw new Error(`Unknown site extension "${id}".`);

    const listing = listings.find((entry) => entry.id === id);
    const name = displayName?.trim()
        || (listing && listing.status !== "invalid" ? listing.name : undefined)
        || id;
    const { showConfirmationDialog } = await import("../ui/dialogs/ConfirmationDialog");
    const choice = await showConfirmationDialog({
        title: "Remove site extension",
        message: `Remove site extension "${name}" and its folder?`,
        buttons: ["Delete", "Cancel"],
    });
    if (choice !== "Delete") return { removed: false, revokedTrust: false };

    if (stat.exists) await fs.removeDir(folder, true);
    const revokedTrust = !!siteExtensionTrust.get(id);
    if (revokedTrust) await siteExtensionTrust.revoke(id);
    return { removed: stat.exists, revokedTrust };
}
