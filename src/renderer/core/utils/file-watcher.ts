const nodefs = require("fs");

import { FileStats } from "../../../shared/types";
import type { PathWatchBatch } from "../../../ipc/api-types";
import { subscribe } from "../../api/path-watch";
import { fs } from "../../api/fs";
import { fpRelative, isArchivePath, isAsarPath } from "./file-path";

function getFileStats(filePath: string): FileStats {
    try {
        const stats = nodefs.statSync(filePath);
        return {
            size: stats.size,
            mtime: stats.mtime.getTime(),
            exists: true,
        };
    } catch (err) {
        return {
            size: 0,
            mtime: 0,
            exists: false,
        };
    }
}

export class FileWatcher {
    private path: string;
    private unWatch: () => void;
    private onChange: () => void;

    stat: FileStats = {
        size: 0,
        mtime: 0,
        exists: false,
    }
    encoding = "utf-8";

    constructor(filePath: string, onChange: () => void, label = "file watcher") {
        this.path = filePath;
        this.onChange = onChange;
        if (isArchivePath(filePath) || isAsarPath(filePath)) {
            // Archive/asar inner files can't be watched — no-op
            this.unWatch = () => {};
            this.stat = { size: 0, mtime: 0, exists: true };
        } else {
            this.unWatch = subscribe(this.path, this.onFileChange, { debounceMs: 300, label });
            this.stat = getFileStats(this.path);
        }
    }

    dispose = () => {
        this.unWatch();
    }

    getTextContent = async (encoding?: string): Promise<string | undefined> => {
        if (isArchivePath(this.path) || isAsarPath(this.path)) {
            // Archive/asar paths use async exists check via fs.readFile
            try {
                const fileData = await fs.readFile(this.path, encoding);
                this.encoding = fileData.encoding || "utf-8";
                return fileData.content;
            } catch {
                return undefined;
            }
        }
        if (!fs.fileExistsSync(this.path)) {
            return undefined;
        }
        const fileData = await fs.readFile(this.path, encoding);
        this.encoding = fileData.encoding || "utf-8";
        return fileData.content;
    }

    get filePath(): string {
        return this.path;
    }

    private onFileChange = (batch: PathWatchBatch) => {
        if (batch.ended && !this.hasReceivedBatch) return;
        if (!batch.ended) this.hasReceivedBatch = true;
        if (!batch.ended && batch.changes.length === 0 && !batch.rescan) return;
        const newStat = getFileStats(this.path);
        this.stat = newStat;
        this.onChange();
    }

    private hasReceivedBatch = false;
}

/**
 * Recursive directory watcher (US-624). A disposable wrapper over the shared
 * path-watch service. Used by the Git Tree editor to auto-refresh when the repo
 * changes on disk.
 *
 * `onChange` receives the changed path relative to `dirPath` (when the platform
 * reports it; `undefined` otherwise). Callers that don't care which file changed
 * can ignore the argument. Note: the callback is debounced, so when several files
 * change inside one window the path is the LAST event's — fine for "something
 * changed, re-scan" consumers; consumers that key off the path should tolerate a
 * coalesced report.
 */
export class DirectoryWatcher {
    private unWatch: () => void;

    constructor(
        dirPath: string,
        onChange: (filename?: string) => void,
        debounceMs = 500,
        label = "directory watcher",
    ) {
        if (isArchivePath(dirPath) || isAsarPath(dirPath)) {
            this.unWatch = () => {};
            return;
        }

        let hasReceivedBatch = false;
        let isEnded = false;
        let canonicalDirPath = dirPath;
        try {
            canonicalDirPath = nodefs.realpathSync.native(dirPath);
        } catch {
            // Keep the requested path; the service will report an unsupported target.
        }
        this.unWatch = subscribe(dirPath, (batch) => {
            if (isEnded) return;
            if (batch.ended) {
                isEnded = true;
                if (hasReceivedBatch) onChange();
                return;
            }
            hasReceivedBatch = true;
            if (!batch.changes.length && !batch.rescan) return;
            const lastPath = batch.changes.at(-1)?.path;
            onChange(lastPath ? fpRelative(canonicalDirPath, lastPath) : undefined);
        }, { recursive: true, debounceMs, label });
    }

    dispose = () => {
        this.unWatch();
    };
}
