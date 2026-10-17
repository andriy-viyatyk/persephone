import type { IProvider, IProviderDescriptor, IProviderStat } from "../../api/types/io.provider";
import type { PathWatchBatch } from "../../../ipc/api-types";
import { subscribe } from "../../api/path-watch";
import { fpBasename, isArchivePath, isAsarPath } from "../../core/utils/file-path";

const nodefs = require("fs");

/**
 * FileProvider — reads/writes binary content from local files.
 *
 * Does NOT handle archive paths (no `!` detection). Archive support
 * comes from FileProvider + ArchiveTransformer in the pipe chain.
 */
export class FileProvider implements IProvider {
    readonly type = "file";
    readonly restorable = true;
    readonly writable = true;
    readonly sourceUrl: string;
    readonly displayName: string;

    constructor(private readonly filePath: string) {
        this.sourceUrl = filePath;
        this.displayName = fpBasename(filePath);
    }

    async readBinary(options?: { signal?: AbortSignal }): Promise<Buffer> {
        return nodefs.promises.readFile(this.filePath, options?.signal ? { signal: options.signal } : undefined);
    }

    createReadStream(range?: { start: number; end: number }, options?: { signal?: AbortSignal }): NodeJS.ReadableStream {
        const streamOptions = {
            ...(range ? { start: range.start, end: range.end } : {}),
            ...(options?.signal ? { signal: options.signal } : {}),
        };
        return nodefs.createReadStream(this.filePath, streamOptions);
    }

    async writeBinary(data: Buffer): Promise<void> {
        await nodefs.promises.writeFile(this.filePath, data);
    }

    async stat(): Promise<IProviderStat> {
        try {
            const stats = await nodefs.promises.stat(this.filePath);
            return {
                size: stats.size,
                mtime: new Date(stats.mtime).toISOString(),
                exists: true,
            };
        } catch {
            return { exists: false };
        }
    }

    watch(callback: (event: string, details?: { newPath: string }) => void, label = "content pipe"): () => void {
        if (isArchivePath(this.filePath) || isAsarPath(this.filePath)) return () => {};

        let hasReceivedBatch = false;
        let hasDeliveredMove = false;
        let isEnded = false;
        return subscribe(this.filePath, (batch: PathWatchBatch) => {
            if (isEnded || hasDeliveredMove) return;
            if (batch.ended) {
                isEnded = true;
                if (hasReceivedBatch) callback("change");
                return;
            }
            hasReceivedBatch = true;
            // One callback per batch, as the old debounced fs.watch delivered one per window.
            if (!batch.rescan && batch.changes.length === 0) return;
            // A file subscription only receives changes for its own path, and main reports the
            // canonical form of it (long name, backslashes), so do not compare against filePath.
            const movedChange = batch.changes.find(change => change.type === "moved");
            if (movedChange?.type === "moved") {
                hasDeliveredMove = true;
                callback("moved", { newPath: movedChange.to });
                return;
            }
            callback(batch.changes.some(change => change.type !== "changed") ? "rename" : "change");
        }, { debounceMs: 300, label });
    }

    toDescriptor(): IProviderDescriptor {
        return {
            type: "file",
            config: { path: this.filePath },
        };
    }

    dispose(): void {
        // No resources to release. Watch subscriptions are managed
        // by the caller via the returned disposer.
    }
}
