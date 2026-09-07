import type { IProvider, IProviderDescriptor, IProviderStat } from "../../api/types/io.provider";
import { api } from "../../../ipc/renderer/api";
import { fs as appFs } from "../../api/fs";
import { isCanonicalGuidePath, guideUrl } from "../../../shared/guides/guide-links";
import { parseGuideFile } from "../../../shared/guides/front-matter";

/** Read-only provider for a guide resolved from the current installation's assets. */
export class GuideProvider implements IProvider {
    readonly type = "guide";
    readonly displayName: string;
    readonly sourceUrl: string;
    readonly restorable = true;
    readonly writable = false;

    constructor(private readonly path: string) {
        if (!isCanonicalGuidePath(path)) {
            throw new Error(`Invalid guide provider path "${path}".`);
        }
        this.displayName = path;
        this.sourceUrl = guideUrl(path);
    }

    async readBinary(): Promise<Buffer> {
        const source = await appFs.readBinary(await this.getAssetPath());
        // Guides ship with the application and are always UTF-8; unlike user files,
        // decode here only to strip shared front matter, then re-encode the body as UTF-8.
        const body = parseGuideFile(`${this.path}.md`, source.toString("utf-8")).content;
        return Buffer.from(body, "utf-8");
    }

    async stat(): Promise<IProviderStat> {
        const stats = await appFs.stat(await this.getAssetPath());
        if (!stats.exists) return { exists: false };
        return {
            size: stats.size,
            mtime: new Date(stats.mtime).toISOString(),
            exists: true,
        };
    }

    toDescriptor(): IProviderDescriptor {
        return {
            type: "guide",
            config: { path: this.path },
        };
    }

    private async getAssetPath(): Promise<string> {
        return api.getAssetsPath(`guides/${this.path}.md`);
    }
}
