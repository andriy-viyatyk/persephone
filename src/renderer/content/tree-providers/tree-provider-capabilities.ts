import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";

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
