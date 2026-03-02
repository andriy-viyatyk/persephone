import type { DownloadEntry } from "../../ipc/api-param-types";

/**
 * IDownloads — Global download tracking service.
 * Manages download state synchronized from main process.
 * Used by Browser editor and other components that handle downloads.
 */
export interface IDownloads {
    // Query state
    readonly downloads: DownloadEntry[];
    readonly hasActiveDownloads: boolean;
    readonly aggregateProgress: number;

    // Actions
    cancelDownload(id: string): void;
    openDownload(id: string): void;
    showInFolder(id: string): void;
    clearCompleted(): void;

    // Initialize (internal)
    init(): Promise<void>;
}
