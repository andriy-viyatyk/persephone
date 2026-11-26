import { createHash, randomUUID } from "node:crypto";
import type {
    ClipboardFlavor,
    ClipboardHistoryChanged,
    ClipboardHistoryItem,
} from "../ipc/clipboard-ipc";
import { errMessage } from "../shared/utils";

export interface ClipboardCapturedPayload {
    flavor: ClipboardFlavor;
    bytes: Buffer;
}

export interface ClipboardHistoryStoredItem extends ClipboardHistoryItem {
    hash: string;
}

export interface ClipboardHistoryFileList {
    paths: string[];
    dropEffect: "copy" | "cut" | "none";
}

export interface ClipboardHistoryPersistence {
    isEnabled(): boolean;
    maxItems(): number;
    items(): ClipboardHistoryStoredItem[];
    setItems(items: ClipboardHistoryStoredItem[]): void;
    stage(id: string, payloads: ClipboardCapturedPayload[]): Promise<Record<ClipboardFlavor, string>>;
    writeIndex(items: ClipboardHistoryStoredItem[]): Promise<void>;
    deleteItem(item: ClipboardHistoryStoredItem): Promise<void>;
    primary(payloads: ClipboardCapturedPayload[]): ClipboardFlavor;
    preview(payloads: ClipboardCapturedPayload[], files: ClipboardHistoryFileList | null): string;
    broadcast(reason: ClipboardHistoryChanged["reason"]): void;
    log(message: string): void;
    removeFile(filePath: string): Promise<void>;
}

/** Persist one platform-neutral clipboard sample through the shared history store. */
export async function persistClipboardSample(
    payloads: ClipboardCapturedPayload[],
    files: ClipboardHistoryFileList | null,
    capturedAt: number,
    store: ClipboardHistoryPersistence,
): Promise<void> {
    if (!store.isEnabled()) return;
    if (files) payloads.push({ flavor: "files", bytes: Buffer.from(files.paths.join("\r\n"), "utf8") });
    if (!payloads.length) return;

    const primary = store.primary(payloads);
    const primaryPayload = payloads.find((payload) => payload.flavor === primary);
    if (!primaryPayload) return;

    const hash = createHash("sha256").update(primary).update("\0").update(primaryPayload.bytes).digest("hex");
    const currentItems = store.items();
    const duplicates = currentItems.filter((item) => item.hash === hash);
    const id = randomUUID();
    let payloadPaths: Record<ClipboardFlavor, string> | undefined;
    try {
        payloadPaths = await store.stage(id, payloads);
        const nextItem: ClipboardHistoryStoredItem = {
            id,
            capturedAt,
            primary,
            preview: store.preview(payloads, files),
            payloads: payloadPaths,
            hash,
            ...(files ? { dropEffect: files.dropEffect } : {}),
        };
        const duplicateIds = new Set(duplicates.map((item) => item.id));
        const nextItems = [nextItem, ...currentItems.filter((item) => !duplicateIds.has(item.id))];
        const kept = nextItems.slice(0, store.maxItems());
        await store.writeIndex(kept);
        store.setItems(kept);
        await Promise.all([...duplicates, ...nextItems.slice(store.maxItems())].map(store.deleteItem));
        store.broadcast("captured");
    } catch (err) {
        if (payloadPaths) await Promise.all(Object.values(payloadPaths).map(store.removeFile));
        store.log(`Clipboard capture failed: ${errMessage(err)}`);
    }
}
