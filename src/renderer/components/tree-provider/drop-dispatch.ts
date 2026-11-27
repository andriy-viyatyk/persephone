import type { IFileLink, ILink, ITreeProvider } from "../../api/types/io.tree";
import { FILE_LINK, LINK, resolveTraits, type TraitDragPayload } from "../../core/traits";
import { normalizeHref } from "./href-utils";
import { boardSchemeOwner, schemeOf } from "../../content/scheme-registry";
import { treeTransferCapability } from "../../content/tree-providers/tree-provider-capabilities";
import { resolveTreeDragSource } from "./tree-drag-source";

export type TraitDropAction =
    | { kind: "move"; items: ILink[] }
    | { kind: "copy-local"; items: ILink[] }
    | { kind: "move-tree"; provider: ITreeProvider; items: ILink[]; sourcePaths: string[] }
    | { kind: "import-links"; items: ILink[] }
    | { kind: "import-files"; files: IFileLink[] }
    | { kind: "transfer-files"; files: IFileLink[] }
    | { kind: "transfer-source-unavailable" }
    | { kind: "transfer"; sourceProvider: ITreeProvider; items: ILink[] }
    | null;

/** Resolves an accepted trait payload into one provider-level action. `targetHref` is only used
 * for same-source self/descendant guards; callers retain target conversion and refresh. */
export function getTraitDropAction(
    provider: ITreeProvider,
    targetHref: string,
    payload: TraitDragPayload,
    allowLinkImport = true,
    forceCopy = false,
    targetListPath?: string,
): TraitDropAction {
    const traits = resolveTraits(payload.typeId);
    const linkTrait = traits?.get(LINK);
    const items = linkTrait?.getItems(payload.data) ?? [];
    const sameSource = !!linkTrait
        && linkTrait.getSourceId?.(payload.data) === provider.sourceUrl;
    const sourceProvider = resolveTreeDragSource(linkTrait?.getTreeDragToken?.(payload.data));
    const sourceTransfer = sourceProvider && treeTransferCapability(sourceProvider);
    const targetTransfer = treeTransferCapability(provider);

    if (sameSource && forceCopy && provider.type === "file") {
        return sourceProvider && sourceTransfer && targetTransfer ? { kind: "copy-local", items } : null;
    }

    if (items.length && targetTransfer && provider.writable && !sourceProvider
        && items.some((item) => !!boardSchemeOwner(schemeOf(item.href) ?? ""))) {
        return { kind: "transfer-source-unavailable" };
    }

    if (items.length && targetTransfer && provider.writable && sourceProvider && sourceTransfer
        && (!sameSource || forceCopy)) {
        return { kind: "transfer", sourceProvider, items };
    }

    if (sameSource && items.length) {
        if (forceCopy) return null;
        if (targetTransfer && sourceTransfer && sourceTransfer.backingStoreKey === targetTransfer.backingStoreKey
            && provider.type !== "file" && !forceCopy) {
            try {
                const targetPath = targetListPath ?? (targetHref === provider.rootPath ? provider.rootPath : provider.resolveLink(targetHref));
                const sourcePaths = items.map((item) => sourceTransfer.pathForLink(item));
                if (sourcePaths.some((path) => path === targetPath || targetTransfer.isInside(path, targetPath) !== false)) return null;
                return { kind: "move-tree", provider, items, sourcePaths };
            } catch {
                return null;
            }
        }
        if (items.some(item => {
            const scheme = schemeOf(item.href);
            return !!scheme && !!boardSchemeOwner(scheme);
        })) return null;
        const target = normalizeHref(targetHref);
        if (items.some((item) => normalizeHref(item.href) === target)) return null;
        const sourceDirectories = items
            .filter((item) => item.isDirectory)
            .map((item) => normalizeHref(item.href) + "/");
        if (sourceDirectories.some((directory) => target.startsWith(directory))) return null;
        return { kind: "move", items };
    }

    if (allowLinkImport && provider.importLinks && linkTrait && items.length) {
        return { kind: "import-links", items };
    }

    const fileLink = traits?.get(FILE_LINK);
    const files = fileLink?.getFiles(payload.data) ?? [];
    if (provider.writable && treeTransferCapability(provider) && provider.type !== "file" && files.length) {
        return { kind: "transfer-files", files };
    }
    if (provider.importFiles && files.length) {
        return { kind: "import-files", files };
    }
    return null;
}
