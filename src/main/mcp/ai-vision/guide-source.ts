import fs from "node:fs";
import path from "node:path";

import { getAssetPath } from "../../utils";
import type { GuideSource, GuideSourceEntry } from "../../../shared/guides";

export type GuideEntryKind = "directory" | "file";

/** Main-process adapter for the packaged, outside-the-asar guide corpus. */
export class MainGuideSource implements GuideSource {
    readonly guideRoot = path.resolve(getAssetPath("guides"));

    async readDirectory(relativeDirectory: string): Promise<readonly GuideSourceEntry[]> {
        const directoryPath = this.resolveContainedPath(relativeDirectory);
        const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
        const result: GuideSourceEntry[] = [];
        for (const entry of entries) {
            if (entry.isDirectory()) {
                result.push({ name: entry.name, kind: "directory" });
            } else if (entry.isFile()) {
                const filePath = path.join(directoryPath, entry.name);
                const stats = await fs.promises.stat(filePath);
                result.push({ name: entry.name, kind: "file", mtimeMs: stats.mtimeMs });
            }
        }
        return result;
    }

    async readFile(relativePath: string): Promise<string> {
        const filePath = this.resolveContainedPath(relativePath);
        return fs.promises.readFile(filePath, "utf-8");
    }

    /** A live name snapshot used only to choose the descriptor wrapper for an advertised path. */
    getEntryKind(relativePath: string): GuideEntryKind | undefined {
        try {
            const filePath = this.resolveContainedPath(relativePath);
            const stats = fs.statSync(filePath);
            return stats.isDirectory() ? "directory" : stats.isFile() ? "file" : undefined;
        } catch {
            return undefined;
        }
    }

    private resolveContainedPath(relativePath: string): string {
        if (!isSafeRelativePath(relativePath)) {
            throw new Error(`Unsafe guide path "${relativePath}".`);
        }
        const candidate = path.resolve(this.guideRoot, relativePath);
        const relative = path.relative(this.guideRoot, candidate);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error(`Guide path "${relativePath}" escapes the guide root.`);
        }
        return candidate;
    }
}

function isSafeRelativePath(relativePath: string): boolean {
    if (typeof relativePath !== "string" || path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) return false;
    if (relativePath === "") return true;
    const segments = relativePath.split(/[\\/]/);
    return segments.every(segment => segment !== "" && segment !== "." && segment !== "..");
}
