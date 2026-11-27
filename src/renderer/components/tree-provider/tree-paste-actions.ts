import type { IFileLink, ILink, ITreeProvider } from "../../api/types/io.tree";
import { ui } from "../../api/ui";
import { fpBasename } from "../../core/utils/file-path";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { isLocalFileProvider, treeTransferCapability } from "../../content/tree-providers/tree-provider-capabilities";
import { moveTreeItemsWithResults, transferTreeFiles, transferTreeItemsWithResults } from "./tree-drop-actions";
import { pasteOsClipboardInto } from "./os-clipboard";
import { treePathBasename } from "./tree-provider-path";
import { assertBoardClipboardCurrent, consumeBoardCut, readTreeClipboard, type TreeClipboardRecord } from "./tree-clipboard";
import type { DropTarget } from "./tree-drop-actions";

async function verifyClipboardSource(record: TreeClipboardRecord, provider = record.provider): Promise<ILink[]> {
    const capability = treeTransferCapability(provider);
    if (!capability || capability.sourceKind !== "board") throw new Error(t("menus.treeClipboardSourceUnavailable"));
    await capability.assertAvailable();
    const parents = [...new Set(record.items.map((item) => item.category))];
    const listed = new Map<string, ILink>();
    for (const parent of parents) {
        for (const item of await provider.list(parent)) listed.set(item.href, item);
    }
    const items = record.items.map((item) => {
        const fresh = listed.get(item.href);
        if (!fresh || fresh.title !== item.title || fresh.category !== item.category
            || fresh.isDirectory !== item.isDirectory) {
            throw new Error(t("menus.treeClipboardItemUnavailable", { name: item.title }));
        }
        return fresh;
    });
    if (record.cut) {
        if (!record.provider.writable || !record.provider.deleteItem) {
            throw new Error(t("menus.treeClipboardCutUnavailable"));
        }
        for (const item of items) {
            const path = capability.pathForLink(item);
        const { stat, kind } = await capability.stat(path);
            const entry = { link: item, path, name: item.title, kind };
            if (!stat.exists || !capability.deletionMode(entry)) {
                throw new Error(t("menus.treeClipboardCutUnavailable"));
            }
        }
    }
    return items;
}

function osFileLinks(paths: string[]): IFileLink[] {
    return paths.map((filePath) => ({
        name: fpBasename(filePath),
        filePath,
        getBytes: async () => new Uint8Array(),
    }));
}

function pasteTarget(provider: ITreeProvider, path: string): DropTarget {
    return {
        path,
        title: path === provider.rootPath
            ? provider.displayName
            : treePathBasename(provider, path) || provider.displayName,
    };
}

/** Route one tree paste using the current OS clipboard and the live renderer-session record. */
export async function pasteTreeClipboardInto(
    targetProvider: ITreeProvider,
    targetPath: string,
): Promise<boolean> {
    const clipboard = await readTreeClipboard();
    if (clipboard.kind === "os") {
        if (isLocalFileProvider(targetProvider)) {
            return pasteOsClipboardInto(targetProvider, targetPath, {
                paths: clipboard.paths,
                dropEffect: clipboard.dropEffect === "cut" ? "cut" : clipboard.paths.length ? "copy" : "none",
            });
        }
        if (!clipboard.paths.length) {
            ui.notify(t("menus.clipboardNoFiles"), "info");
            return false;
        }
        const capability = treeTransferCapability(targetProvider);
        if (!targetProvider.writable || !capability) {
            ui.notify(t("menus.treeClipboardPasteUnavailable"), "warning");
            return false;
        }
        await capability.assertAvailable();
        return transferTreeFiles(osFileLinks(clipboard.paths), targetProvider,
            pasteTarget(targetProvider, targetPath),
            clipboard.dropEffect === "cut" ? "move" : "copy");
    }

    try {
        const source = clipboard.record;
        const sourceCapability = treeTransferCapability(source.provider);
        const targetCapability = treeTransferCapability(targetProvider);
        if (!targetProvider.writable || !targetCapability) {
            throw new Error(t("menus.treeClipboardPasteUnavailable"));
        }
        await targetCapability.assertAvailable();
        const sameTree = source.sourceIdentity === targetCapability.sourceIdentity;
        await sourceCapability!.assertAvailable();
        const items = await verifyClipboardSource(source, sameTree ? targetProvider : source.provider);
        await assertBoardClipboardCurrent(source);
        const target = pasteTarget(targetProvider, targetPath);
        let outcomes;
        if (source.cut && sameTree) {
            const paths = items.map((item) => targetCapability.pathForLink(item));
            outcomes = await moveTreeItemsWithResults(targetProvider, items, paths, target);
        } else if (sameTree) {
            outcomes = await transferTreeItemsWithResults(targetProvider, targetProvider, items, target, "copy");
        } else {
            outcomes = await transferTreeItemsWithResults(source.provider, targetProvider, items, target,
                source.cut ? "move" : "copy");
        }
        if (source.cut && !sameTree && outcomes.some((outcome) => outcome.status === "moved")) {
            const refreshSource = source.sourceRefresh?.deref()?.refreshClipboardSource(source.sourceIdentity);
            // The source view is a weak, optional observer; its refresh must not hide completed results.
            if (refreshSource) await refreshSource.catch((): void => undefined);
        }
        if (source.cut && outcomes.length === items.length
            && outcomes.every((outcome) => outcome.status === "moved")) {
            try {
                await consumeBoardCut(source);
            } catch (error: unknown) {
                reportTreePasteFailure(error);
            }
        }
        return outcomes.length > 0;
    } finally {
        clipboard.release();
    }
}

export function reportTreePasteFailure(error: unknown): void {
    ui.notify(errMessage(error, t("menus.failedToPaste")), "warning");
}
