import { api } from "../../ipc/renderer/api";
import type { GuideSource, GuideSourceEntry } from "../../shared/guides";
import { fs as appFs } from "../api/fs";
import { fpJoin } from "../core/utils/file-path";
import { isSafeGuidePath } from "../../shared/guides/guide-links";

/**
 * Renderer-side adapter for a guide corpus rooted at one folder. The default root is the packaged
 * `assets/guides`; US-1406 also instantiates one per mounted board, rooted at that board's own
 * guides folder, so containment is PER INSTANCE rather than measured against `assets/guides`.
 */
export class RendererGuideSource implements GuideSource {
    private readonly rootPromise: Promise<string>;

    constructor(root?: string) {
        this.rootPromise = root === undefined ? api.getAssetsPath("guides") : Promise.resolve(root);
    }

    async readDirectory(relativeDirectory: string): Promise<readonly GuideSourceEntry[]> {
        const directoryPath = await this.resolvePath(relativeDirectory, true);
        const entries = await appFs.listDirWithTypes(directoryPath);
        const result: GuideSourceEntry[] = [];
        for (const entry of entries) {
            if (entry.isDirectory) {
                result.push({ name: entry.name, kind: "directory" });
            } else {
                const filePath = fpJoin(directoryPath, entry.name);
                const stats = await appFs.stat(filePath);
                result.push({ name: entry.name, kind: "file", mtimeMs: stats.mtime });
            }
        }
        return result;
    }

    async readFile(relativePath: string): Promise<string> {
        return appFs.read(await this.resolvePath(relativePath));
    }

    private async resolvePath(relativePath: string, allowEmpty = false): Promise<string> {
        if ((!allowEmpty && !relativePath) || (relativePath && !isSafeGuidePath(relativePath))) {
            throw new Error(`Unsafe guide path "${relativePath}".`);
        }
        const root = await this.rootPromise;
        const segments = relativePath ? relativePath.split("/") : [];
        return fpJoin(root, ...segments);
    }
}
