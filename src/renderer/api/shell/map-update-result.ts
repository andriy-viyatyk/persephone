import type { UpdateCheckResult } from "../../../ipc/api-param-types";
import type { IUpdateInfo } from "../types/shell";

export function mapUpdateResult(result: UpdateCheckResult): IUpdateInfo {
    const releaseInfo = result.releaseInfo;
    return {
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        updateAvailable: result.updateAvailable,
        releaseUrl: releaseInfo?.htmlUrl ?? null,
        downloadUrl: releaseInfo?.downloadUrl ?? null,
        releaseVersion: releaseInfo?.version ?? null,
        publishedAt: releaseInfo?.publishedAt ?? null,
        releaseNotes: releaseInfo?.body ?? null,
        error: result.error,
    };
}
