import { settings } from "../../api/settings";
import { fpBasename, fpJoin } from "../../core/utils/file-path";

// This synchronous probe is intentionally local to folder resolution. The
// async app.fs API cannot serve the synchronous matcher contract.
const nodefs = require("fs") as typeof import("fs");

/** Check the enabled Git marker directory without spawning Git. */
export function isGitRepoDir(folderPath: string): boolean {
    try {
        if (!settings.get("git.enabled") || fpBasename(folderPath) !== ".git") return false;
        return nodefs.existsSync(fpJoin(folderPath, "HEAD"))
            && nodefs.existsSync(fpJoin(folderPath, "objects"));
    } catch {
        return false;
    }
}
