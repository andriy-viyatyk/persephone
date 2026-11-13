import type { TimeoutExemptions } from "../timeout-exemptions";
import type {
    ClipboardFileList,
    ClipboardHistoryChanged,
    ClipboardHistorySnapshot,
    ClipboardStatus,
} from "../clipboard-ipc";
import type { EventObject } from "./event-object";

export interface ClipboardApi {
    setClipboardEnabled: (enabled: boolean, maxItems: number) => Promise<ClipboardStatus>;
    getClipboardHistory: () => Promise<ClipboardHistorySnapshot>;
    removeClipboardItem: (id: string) => Promise<void>;
    clearClipboardHistory: () => Promise<void>;
    copyClipboardItem: (id: string) => Promise<boolean>;
    getClipboardStatus: () => Promise<ClipboardStatus>;
    setClipboardHealthMonitoring: (active: boolean) => Promise<ClipboardStatus>;
    restartClipboard: (maxItems: number) => Promise<ClipboardStatus>;
    startScreenSnip: (hideWindows: boolean) => Promise<string | null>;
    clipboardWriteText: (text: string) => Promise<void>;
    clipboardWritePng: (bytes: Uint8Array) => Promise<void>;
    clipboardReadFilePaths: () => Promise<ClipboardFileList>;
    clipboardWriteFilePaths: (paths: string[], cut: boolean) => Promise<boolean>;
    startOsFileDrag: (paths: string[]) => Promise<void>;
}

export interface ClipboardEvents {
    eClipboardHistoryChanged: EventObject<ClipboardHistoryChanged>;
    eClipboardStatusChanged: EventObject<ClipboardStatus>;
}


export const clipboardTimeoutExemptions = {
    copyClipboardItem: "File reads and OS clipboard writes depend on unbounded payload I/O.",
    restartClipboard: "Sidecar readiness, queueing, and teardown are not request-bounded.",
    startScreenSnip: "Waits for the user-driven snipping overlay to exit.",
    clipboardWriteFilePaths: "Waits for the snipping process after streaming supplied paths.",
    setClipboardEnabled: "Sidecar readiness, queueing, and teardown are not request-bounded.",
} satisfies TimeoutExemptions<ClipboardApi>;
