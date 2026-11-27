import type { ILink, ITreeProvider, ITreeProviderItem, ITreeStat } from "../../api/types/io.tree";

export type TransferNodeKind = "file" | "directory" | "file-symlink" | "directory-symlink";
export type TreeDeletionMode = "recursive" | "empty-only";

export interface TransferEntry {
    link: ILink;
    path: string;
    name: string;
    kind: TransferNodeKind;
    size?: number;
}

/** Explicit, strict operations required by safe cross-tree transfers. */
export interface TreeTransferCapability {
    backingStoreKey: string;
    pathForLink(link: ILink): string;
    joinChild(folderPath: string, name: string): string;
    validateName(name: string): void;
    listChildren(folderPath: string): Promise<TransferEntry[]>;
    stat(path: string): Promise<{ stat: ITreeStat; kind: TransferNodeKind }>;
    resolveContentHref(path: string): Promise<string>;
    isInside(parentPath: string, childPath: string): boolean | undefined;
    deletionMode(entry: TransferEntry): TreeDeletionMode | undefined;
    deleteEntry(entry: TransferEntry): Promise<void>;
}

export function treeTransferCapability(provider: ITreeProvider): TreeTransferCapability | undefined {
    const candidate = provider as ITreeProvider & { transfer?: TreeTransferCapability };
    return candidate.transfer;
}

export type ClassifiedTreeWatchBatch =
    | { relist: Array<{ href: string; changedPaths?: string[] }> }
    | { rebuild: true };

/** A provider that signals changes and optionally supplies a classified watch batch. */
export interface WatchableTreeProvider extends ITreeProvider {
    watch(callback: (batch?: ClassifiedTreeWatchBatch) => void): () => void;
}

/** A provider that can list one directory strictly for incremental watch updates. */
export interface IncrementalTreeProvider extends ITreeProvider {
    listIncremental(dirPath: string): Promise<ITreeProviderItem[]>;
}

export function isWatchable(provider: ITreeProvider): provider is WatchableTreeProvider {
    return "watch" in provider && typeof provider.watch === "function";
}

export function isIncremental(provider: ITreeProvider): provider is IncrementalTreeProvider {
    return "listIncremental" in provider && typeof provider.listIncremental === "function";
}

export function isLocalFileProvider(provider: ITreeProvider): boolean {
    return provider.type === "file";
}
