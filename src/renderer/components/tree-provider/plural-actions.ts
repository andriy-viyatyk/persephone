// Set-shaped tree-provider actions shared by TreeProviderViewModel (the Explorer
// tree) and CategoryViewModel (the folder-content page). Everything here operates on
// plain `ILink` items, never on a tree node, so both views can use one implementation
// of the pruning rule, the plural menu labels and the batch delete.
//
// Sibling to `os-clipboard.ts` (which owns the OS clipboard I/O these menu items call).

import type { ILink, ITreeProvider } from "../../api/types/io.tree";
import type { MenuItem } from "../../uikit/Menu";
import { ui } from "../../api/ui";
import { isUrlOrCurl } from "../../content/link-utils";
import { toClipboard } from "../../api/clipboard";
import { CopyIcon, CutIcon, DeleteIcon, DownloadIcon } from "../../theme/icons";
import { isLocalFileProvider, treeTransferCapability } from "../../content/tree-providers/tree-provider-capabilities";
import { DialogButton } from "../../api/dialogs/dialog-buttons";
import { t } from "../../../shared/i18n/t";
import { hrefCompareKey } from "../../../shared/path-containment";
import { errMessage } from "../../../shared/utils";
import { sameHref } from "./href-utils";

/**
 * Drop any selected item that lives inside another selected folder. A folder-level action
 * already affects everything under it, so keeping the descendants would double-process them —
 * a delete would fail on the second pass, a move would look for an already-moved source, and
 * Windows would copy the same file twice.
 *
 * Path-prefix test, case-insensitive, on `href`. Correct for the file provider (hrefs are
 * absolute paths) and for the archive / category providers (hrefs are `/`-joined inner
 * paths). A provider whose hrefs are not path-shaped returns its input unchanged — the
 * prefix test just never matches.
 *
 * EVERY plural action must run its input through this, at the action's entry point.
 */
export function pruneNestedItems<T extends Pick<ILink, "href" | "isDirectory">>(items: T[]): T[] {
    const dirs = items
        .filter((i) => i.isDirectory)
        .map((i) => hrefCompareKey(i.href).replace(/\/?$/, "/"));
    return items.filter((i) => {
        const href = hrefCompareKey(i.href);
        // `href !== d.slice(0, -1)` keeps a selected folder from pruning itself.
        return !dirs.some((d) => href !== d.slice(0, -1) && href.startsWith(d));
    });
}

/** Use verified provider paths for board hrefs, which are opaque and not path-shaped. */
export function pruneProviderItems<T extends ILink>(provider: ITreeProvider, items: T[]): T[] {
    const capability = treeTransferCapability(provider);
    if (capability?.sourceKind !== "board") return pruneNestedItems(items);
    const paths = items.map((item) => sameHref(item.href, provider.rootPath)
        ? provider.rootPath
        : capability.pathForLink(item));
    return items.filter((item, itemIndex) => !items.some((parent, parentIndex) => {
        if (!parent.isDirectory || parentIndex === itemIndex) return false;
        const inside = capability.isInside(paths[parentIndex], paths[itemIndex]);
        if (inside === undefined) throw new Error(t("dialogs.treeTransferContainmentUnknown"));
        return inside;
    }));
}

/** Set-shaped actions over N selected items. `items` must already be pruned, so every count
 *  shown here is the pruned count. */
export function buildMultiItemMenuItems(
    provider: ITreeProvider,
    items: ILink[],
    onDelete: () => void,
    onClipboard: (items: ILink[], cut: boolean) => void,
    onDownload: (items: ILink[]) => void,
): MenuItem[] {
    const hrefs = items.map((i) => i.href);
    const hasRoot = hrefs.includes(provider.rootPath);
    const n = items.length;
    const menuItems: MenuItem[] = [];
    const copyHrefs = !isLocalFileProvider(provider) || items.every(item => isUrlOrCurl(item.href));

    menuItems.push({
        id: copyHrefs ? "copy-hrefs" : "copy-paths",
        label: copyHrefs
            ? t("menus.copyHrefsCount", { count: n })
            : t("menus.copyPathsCount", { count: n }),
        icon: CopyIcon.createElement(),
        onClick: () => toClipboard(hrefs.join("\n")),
    });

    // OS file clipboard — Windows Explorer interop, file provider only. No Cut when the
    // tree root is in the set (mirrors the single-row gating). A folder's listed children
    // never include the provider root, so the guard is inert for the folder-content view.
    const transfer = treeTransferCapability(provider);
    if (!hasRoot && transfer?.sourceKind === "board") menuItems.push({
        startGroup: true,
        id: "download-to",
        label: t("menus.downloadTo"),
        icon: DownloadIcon.createElement(),
        onClick: () => onDownload(items),
    });

    if (isLocalFileProvider(provider) || transfer?.sourceKind === "board") {
        if (!hasRoot && (isLocalFileProvider(provider)
            || (!!provider.writable && !!provider.deleteItem && transfer?.sourceKind === "board"))) {
            menuItems.push({
                startGroup: true,
                id: "cut",
                label: t("menus.cutCount", { count: n }),
                icon: CutIcon.createElement(),
                onClick: () => onClipboard(items, true),
            });
        }
        if (!hasRoot || isLocalFileProvider(provider)) menuItems.push({
            startGroup: hasRoot,
            id: "copy",
            label: t("menus.copyCount", { count: n }),
            icon: CopyIcon.createElement(),
            onClick: () => onClipboard(items, false),
        });
    }

    if (provider.writable && provider.deleteItem && !hasRoot) {
        menuItems.push({
            startGroup: true,
            id: "delete",
            label: t("menus.deleteCount", { count: n }),
            icon: DeleteIcon.createElement(),
            onClick: onDelete,
        });
    }

    return menuItems;
}

/**
 * What `deleteItemsBatch` did, so the caller knows what still needs doing. The three cases
 * refresh differently, which is why this isn't a boolean:
 *   • `"none"`  — nothing was attempted (no capability, empty set, cancelled confirm). No refresh.
 *   • `"single"` — one item after pruning; `onSingle` ran and owns its own confirm AND refresh.
 *   • `"batch"` — N items deleted; the caller should clear its selection and refresh.
 */
export type BatchDeleteOutcome = "none" | "single" | "batch";

/**
 * Confirm once, then delete every item. Prunes nested selections first, so a folder plus files
 * inside it deletes the folder only — and the count in the confirm is the pruned count (count
 * only, no name list).
 *
 * `onSingle` handles the one-item case so each view keeps its own singular confirm wording and
 * its own refresh; nothing changes for the common case.
 */
export async function deleteItemsBatch(
    provider: ITreeProvider,
    items: ILink[],
    onSingle: (item: ILink) => Promise<void>,
): Promise<BatchDeleteOutcome> {
    if (!provider.deleteItem || !items.length) return "none";

    const targets = pruneNestedItems(items);
    if (!targets.length) return "none";
    if (targets.length === 1) {
        await onSingle(targets[0]);
        return "single";
    }

    const bt = await ui.confirm(
        t("menus.deleteItemsConfirmation", { count: targets.length }),
        { title: t("menus.deleteConfirmation"), buttons: [DialogButton.delete, DialogButton.cancel] },
    );
    if (bt !== DialogButton.delete) return "none";

    const errors: string[] = [];
    const progress = await ui.createProgress(t("menus.deletingProgressTitle"));
    try {
        await progress.show((async () => {
            let done = 0;
            for (const target of targets) {
                progress.label = t("menus.deletingProgress", {
                    done: done + 1,
                    total: targets.length,
                    name: target.title,
                });
                try {
                    await provider.deleteItem?.(target.href);
                } catch (err) {
                    errors.push(`${target.title}: ${errMessage(err, "failed")}`);
                }
                done++;
            }
        })());
    } catch (err) {
        ui.notify(errMessage(err, t("menus.failedToDelete")), "warning");
    }
    if (errors.length) {
        const shown = errors.slice(0, 5).join("\n");
        const remaining = errors.length - 5;
        ui.notify(remaining > 0
            ? t("menus.itemsCouldNotBeDeletedWithMore", { errors: shown, count: remaining } as never)
            : t("menus.itemsCouldNotBeDeleted", { errors: shown }), "warning");
    }

    return "batch";
}
