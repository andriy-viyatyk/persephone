/**
 * Archive Service — read/write files inside ZIP archives.
 *
 * Uses jszip (loaded via dynamic import) to manipulate ZIP archives.
 * All operations go through a per-archive sequential queue to prevent
 * concurrent read/write on the same archive file.
 *
 * This module uses `require("fs")` directly (documented exception) because
 * it is the low-level provider that fs.ts routes archive paths to — using
 * fs.ts would create a circular dependency.
 */

const nodefs = require("fs") as typeof import("fs");

import type { IFileStat, IDirEntry } from "./types/fs";

// =============================================================================
// Types
// =============================================================================

export interface ArchiveEntry {
    /** Inner path (e.g., "word/document.xml") — always forward slashes */
    path: string;
    /** True if this is a directory entry */
    isDirectory: boolean;
    /** Uncompressed size in bytes (0 for directories) */
    size: number;
    /** Last modified time (ms since epoch) */
    mtime: number;
}

// =============================================================================
// ArchiveService
// =============================================================================

class ArchiveService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private queues = new Map<string, Promise<any>>();

    // ── Public API ───────────────────────────────────────────────────────

    /** List all entries in an archive. */
    async listEntries(archivePath: string): Promise<ArchiveEntry[]> {
        return this.enqueue(archivePath, async () => {
            const zip = await this.loadArchive(archivePath);
            const entries: ArchiveEntry[] = [];
            zip.forEach((relativePath: string, file: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                entries.push({
                    path: relativePath,
                    isDirectory: file.dir,
                    size: file._data?.uncompressedSize ?? 0,
                    mtime: file.date?.getTime() ?? 0,
                });
            });
            return entries;
        });
    }

    /** List immediate children of a directory inside an archive. */
    async listDir(archivePath: string, innerDir: string): Promise<IDirEntry[]> {
        return this.enqueue(archivePath, async () => {
            const zip = await this.loadArchive(archivePath);
            // Normalize: ensure trailing slash for non-root, empty string for root
            const prefix = innerDir ? innerDir.replace(/\/$/, "") + "/" : "";
            const seen = new Map<string, boolean>(); // name → isDirectory

            zip.forEach((relativePath: string) => {
                if (!relativePath.startsWith(prefix)) return;
                const remainder = relativePath.slice(prefix.length);
                if (!remainder) return; // the directory entry itself

                const slashIdx = remainder.indexOf("/");
                if (slashIdx === -1) {
                    // Direct child file
                    seen.set(remainder, false);
                } else {
                    // Direct child folder (take first segment)
                    const folderName = remainder.slice(0, slashIdx);
                    if (!seen.has(folderName)) {
                        seen.set(folderName, true);
                    }
                }
            });

            const entries: IDirEntry[] = [];
            for (const [name, isDirectory] of seen) {
                entries.push({ name, isDirectory });
            }
            // Folders first, then files, alphabetical within each group
            entries.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            return entries;
        });
    }

    /** Read a file from inside an archive. Returns raw Buffer. */
    async readFile(archivePath: string, innerPath: string): Promise<Buffer> {
        return this.enqueue(archivePath, async () => {
            const zip = await this.loadArchive(archivePath);
            const file = zip.file(innerPath);
            if (!file) {
                throw new Error(`File not found in archive: ${innerPath}`);
            }
            return file.async("nodebuffer");
        });
    }

    /** Write a file into an archive (read → replace → write back). */
    async writeFile(archivePath: string, innerPath: string, content: Buffer): Promise<void> {
        return this.enqueue(archivePath, async () => {
            const zip = await this.loadArchive(archivePath);
            zip.file(innerPath, content);
            const output = await zip.generateAsync({
                type: "nodebuffer",
                compression: "DEFLATE",
                compressionOptions: { level: 6 },
            });
            nodefs.writeFileSync(archivePath, output);
        });
    }

    /** Check if a file or directory exists inside an archive. */
    async exists(archivePath: string, innerPath: string): Promise<boolean> {
        return this.enqueue(archivePath, async () => {
            if (!nodefs.existsSync(archivePath)) return false;
            const zip = await this.loadArchive(archivePath);
            // Check exact path and directory variant (with trailing slash)
            return zip.file(innerPath) !== null
                || zip.file(innerPath + "/") !== null
                || this.hasChildren(zip, innerPath);
        });
    }

    /** Delete a file from inside an archive. */
    async deleteFile(archivePath: string, innerPath: string): Promise<void> {
        return this.enqueue(archivePath, async () => {
            const zip = await this.loadArchive(archivePath);
            zip.remove(innerPath);
            const output = await zip.generateAsync({
                type: "nodebuffer",
                compression: "DEFLATE",
                compressionOptions: { level: 6 },
            });
            nodefs.writeFileSync(archivePath, output);
        });
    }

    /** Rename a file or folder inside an archive. */
    async renameFile(archivePath: string, oldInnerPath: string, newInnerPath: string): Promise<void> {
        return this.enqueue(archivePath, async () => {
            const zip = await this.loadArchive(archivePath);
            const file = zip.file(oldInnerPath);
            if (file) {
                // File rename: read content, add with new name, remove old
                const content = await file.async("nodebuffer");
                zip.file(newInnerPath, content, { date: file.date });
                zip.remove(oldInnerPath);
            } else {
                // Folder rename: move all entries under the old prefix to the new prefix
                const oldPrefix = oldInnerPath.endsWith("/") ? oldInnerPath : oldInnerPath + "/";
                const newPrefix = newInnerPath.endsWith("/") ? newInnerPath : newInnerPath + "/";
                const entriesToMove: { path: string; file: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
                zip.forEach((relativePath: string, zipFile: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                    if (relativePath === oldPrefix || relativePath.startsWith(oldPrefix)) {
                        entriesToMove.push({ path: relativePath, file: zipFile });
                    }
                });
                for (const entry of entriesToMove) {
                    const suffix = entry.path.slice(oldPrefix.length);
                    const renamedPath = newPrefix + suffix;
                    if (entry.file.dir) {
                        zip.file(renamedPath, "", { dir: true, date: entry.file.date });
                    } else {
                        const content = await entry.file.async("nodebuffer");
                        zip.file(renamedPath, content, { date: entry.file.date });
                    }
                    zip.remove(entry.path);
                }
            }
            const output = await zip.generateAsync({
                type: "nodebuffer",
                compression: "DEFLATE",
                compressionOptions: { level: 6 },
            });
            nodefs.writeFileSync(archivePath, output);
        });
    }

    /** Create an empty directory entry inside an archive. */
    async mkdir(archivePath: string, innerPath: string): Promise<void> {
        return this.enqueue(archivePath, async () => {
            const zip = await this.loadArchive(archivePath);
            const dirPath = innerPath.endsWith("/") ? innerPath : innerPath + "/";
            zip.file(dirPath, "", { dir: true });
            const output = await zip.generateAsync({
                type: "nodebuffer",
                compression: "DEFLATE",
                compressionOptions: { level: 6 },
            });
            nodefs.writeFileSync(archivePath, output);
        });
    }

    /** Remove a directory and all its contents from an archive. */
    async removeDir(archivePath: string, innerPath: string): Promise<void> {
        return this.enqueue(archivePath, async () => {
            const zip = await this.loadArchive(archivePath);
            const prefix = innerPath.endsWith("/") ? innerPath : innerPath + "/";
            const toRemove: string[] = [];
            zip.forEach((relativePath: string) => {
                if (relativePath === prefix || relativePath.startsWith(prefix)) {
                    toRemove.push(relativePath);
                }
            });
            // Also remove the directory entry itself (without trailing slash)
            if (zip.file(innerPath)) {
                toRemove.push(innerPath);
            }
            for (const p of toRemove) {
                zip.remove(p);
            }
            const output = await zip.generateAsync({
                type: "nodebuffer",
                compression: "DEFLATE",
                compressionOptions: { level: 6 },
            });
            nodefs.writeFileSync(archivePath, output);
        });
    }

    /** Get metadata for a file inside an archive. */
    async stat(archivePath: string, innerPath: string): Promise<IFileStat> {
        return this.enqueue(archivePath, async () => {
            if (!nodefs.existsSync(archivePath)) {
                return { size: 0, mtime: 0, exists: false, isDirectory: false };
            }
            const zip = await this.loadArchive(archivePath);
            const file = zip.file(innerPath);
            if (file) {
                return {
                    size: file._data?.uncompressedSize ?? 0,
                    mtime: file.date?.getTime() ?? 0,
                    exists: true,
                    isDirectory: false,
                };
            }
            // Check if it's a directory
            const dirPath = innerPath.endsWith("/") ? innerPath : innerPath + "/";
            const dirEntry = zip.file(dirPath);
            if (dirEntry || this.hasChildren(zip, innerPath)) {
                return { size: 0, mtime: dirEntry?.date?.getTime() ?? 0, exists: true, isDirectory: true };
            }
            return { size: 0, mtime: 0, exists: false, isDirectory: false };
        });
    }

    // ── Private ──────────────────────────────────────────────────────────

    /** Load a ZIP archive from disk using jszip (dynamic import). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async loadArchive(archivePath: string): Promise<any> {
        const JSZip = (await import("jszip")).default;
        const data = nodefs.readFileSync(archivePath);
        return JSZip.loadAsync(data);
    }

    /** Check if any entries exist under a given prefix (implicit directory). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private hasChildren(zip: any, prefix: string): boolean {
        const dirPrefix = prefix.endsWith("/") ? prefix : prefix + "/";
        let found = false;
        zip.forEach((relativePath: string) => {
            if (relativePath.startsWith(dirPrefix)) {
                found = true;
            }
        });
        return found;
    }

    /**
     * Sequential promise queue per archive file.
     * Ensures no concurrent operations on the same archive.
     */
    private enqueue<T>(archivePath: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.queues.get(archivePath) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        this.queues.set(archivePath, next);
        next.then(
            () => { if (this.queues.get(archivePath) === next) this.queues.delete(archivePath); },
            () => { if (this.queues.get(archivePath) === next) this.queues.delete(archivePath); },
        );
        return next;
    }
}

export const archiveService = new ArchiveService();
