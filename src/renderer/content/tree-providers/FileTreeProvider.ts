import type {
    ITreeProvider,
    ITreeProviderItem,
    ITreeStat,
} from "../../api/types/io.tree";
import { encodeCategoryLink } from "./tree-provider-link";

// Direct Node.js imports — FileTreeProvider is a low-level filesystem provider
// that intentionally bypasses app.fs archive transparency. Listed in
// coding-style.md exceptions alongside FileProvider and CacheFileProvider.
const nodefs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

/**
 * ITreeProvider for local filesystem directories.
 *
 * Uses Node.js fs/path directly — no archive-aware wrappers.
 * Archive browsing is handled by the separate ZipTreeProvider.
 */
export class FileTreeProvider implements ITreeProvider {
    readonly type = "file";
    readonly displayName: string;
    readonly navigable = true;
    readonly writable = true;
    readonly pinnable = false;
    readonly hasTags = false;
    readonly hasHostnames = false;

    readonly rootPath: string;

    constructor(public readonly sourceUrl: string) {
        this.displayName = path.basename(sourceUrl);
        this.rootPath = sourceUrl;
    }

    async list(dirPath: string): Promise<ITreeProviderItem[]> {
        let entries: import("fs").Dirent[];
        try {
            entries = nodefs.readdirSync(dirPath, { withFileTypes: true });
        } catch {
            return [];
        }

        const folders: ITreeProviderItem[] = [];
        const files: ITreeProviderItem[] = [];

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const isDir = entry.isDirectory();

            if (isDir) {
                folders.push({
                    name: entry.name,
                    href: fullPath,
                    category: dirPath,
                    tags: [],
                    isDirectory: true,
                });
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                files.push({
                    name: entry.name,
                    href: fullPath,
                    category: dirPath,
                    tags: ext ? [ext] : [],
                    isDirectory: false,
                });
            }
        }

        // Folders first (alphabetical), then files by extension then name
        folders.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => {
            const extA = a.tags[0] ?? "";
            const extB = b.tags[0] ?? "";
            const extCmp = extA.localeCompare(extB);
            if (extCmp !== 0) return extCmp;
            return a.name.localeCompare(b.name);
        });

        return [...folders, ...files];
    }

    async stat(filePath: string): Promise<ITreeStat> {
        try {
            const s = nodefs.statSync(filePath);
            return {
                exists: true,
                isDirectory: s.isDirectory(),
                size: s.size,
                mtime: s.mtime.toISOString(),
            };
        } catch {
            return { exists: false, isDirectory: false };
        }
    }

    resolveLink(filePath: string): string {
        return filePath;
    }

    getNavigationUrl(item: ITreeProviderItem): string {
        if (!item.isDirectory) return item.href;
        return encodeCategoryLink({ type: this.type, url: this.sourceUrl, category: item.href });
    }

    async getNavigationUrlByHref(href: string): Promise<string> {
        const s = await this.stat(href);
        if (s.isDirectory) {
            return encodeCategoryLink({ type: this.type, url: this.sourceUrl, category: href });
        }
        return href;
    }

    async mkdir(dirPath: string): Promise<void> {
        nodefs.mkdirSync(dirPath, { recursive: true });
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        nodefs.renameSync(oldPath, newPath);
    }

    async deleteItem(href: string): Promise<void> {
        const s = nodefs.statSync(href);
        if (s.isDirectory()) {
            nodefs.rmSync(href, { recursive: true });
        } else {
            nodefs.unlinkSync(href);
        }
    }
}
