import type { PathWatchBatch } from "../../../ipc/api-types";
import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";

/** A provider that signals changes and optionally supplies a local-file watch batch. */
export interface WatchableTreeProvider extends ITreeProvider {
    watch(callback: (batch?: PathWatchBatch) => void): () => void;
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
