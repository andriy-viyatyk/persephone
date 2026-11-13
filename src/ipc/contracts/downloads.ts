import type { DownloadEntry } from "../api-param-types";
import type { EventObject } from "./event-object";

export interface DownloadsApi {
    getDownloads: () => Promise<DownloadEntry[]>;
    cancelDownload: (id: string) => Promise<void>;
    openDownload: (id: string) => Promise<void>;
    showDownloadInFolder: (id: string) => Promise<void>;
    clearCompletedDownloads: () => Promise<void>;
}

export interface DownloadsEvents {
    eOpenClaimedBrowserDownload: EventObject<{
            url: string;
            boardRoot: string;
            sessionHandle?: string;
        }>;
    eDownloadStarted: EventObject<DownloadEntry>;
    eDownloadProgress: EventObject<{ id: string; receivedBytes: number; totalBytes: number }>;
    eDownloadAwaitingPath: EventObject<{ id: string; receivedBytes: number; totalBytes: number }>;
    eDownloadCompleted: EventObject<{ id: string; savePath: string }>;
    eDownloadFailed: EventObject<{ id: string; error: string }>;
    eDownloadRemoved: EventObject<{ id: string }>;
    eDownloadCleared: EventObject<DownloadEntry[]>;
}

