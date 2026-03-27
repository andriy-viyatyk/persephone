import type { IProvider, IProviderDescriptor, IProviderStat } from "../../api/types/io.provider";
import { fs as appFs } from "../../api/fs";

const nodefs = require("fs");

/**
 * CacheFileProvider — reads/writes cache files by page ID.
 *
 * Used as the provider for cache pipes: `primaryPipe.cloneWithProvider(new CacheFileProvider(pageId))`.
 * Cache files are stored in the app's cache directory ({userData}/cache/{pageId}.txt).
 *
 * restorable: true — cache files persist on disk across restarts.
 * Never saved in page's pipe descriptor — only used for the internal cache pipe.
 */
export class CacheFileProvider implements IProvider {
    readonly type = "cache";
    readonly restorable = true;
    readonly writable = true;
    readonly sourceUrl: string;
    readonly displayName: string;
    private _cachePath: string | null = null;

    constructor(private readonly pageId: string) {
        this.sourceUrl = `cache://${pageId}`;
        this.displayName = `cache:${pageId}`;
    }

    private async getCachePath(): Promise<string> {
        if (!this._cachePath) {
            this._cachePath = appFs.resolveCachePath(this.pageId + ".txt");
        }
        return this._cachePath;
    }

    async readBinary(): Promise<Buffer> {
        const path = await this.getCachePath();
        try {
            return nodefs.readFileSync(path);
        } catch {
            return Buffer.alloc(0);
        }
    }

    async writeBinary(data: Buffer): Promise<void> {
        const path = await this.getCachePath();
        nodefs.writeFileSync(path, data);
    }

    async stat(): Promise<IProviderStat> {
        const path = await this.getCachePath();
        try {
            const stats = nodefs.statSync(path);
            return {
                size: stats.size,
                mtime: new Date(stats.mtime).toISOString(),
                exists: true,
            };
        } catch {
            return { exists: false };
        }
    }

    toDescriptor(): IProviderDescriptor {
        return {
            type: "cache",
            config: { pageId: this.pageId },
        };
    }

    dispose(): void {
        // No resources to release.
    }
}
