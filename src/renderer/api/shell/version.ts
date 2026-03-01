import { api } from "../../../ipc/renderer/api";
import type { IVersionService, IRuntimeVersions, IUpdateInfo } from "../types/shell";

class VersionService implements IVersionService {
    async runtimeVersions(): Promise<IRuntimeVersions> {
        return api.getRuntimeVersions();
    }

    async checkForUpdates(force?: boolean): Promise<IUpdateInfo> {
        const result = await api.checkForUpdates(force);
        const ri = result.releaseInfo;
        return {
            currentVersion: result.currentVersion,
            latestVersion: result.latestVersion,
            updateAvailable: result.updateAvailable,
            releaseUrl: ri?.htmlUrl ?? null,
            releaseVersion: ri?.version ?? null,
            publishedAt: ri?.publishedAt ?? null,
            releaseNotes: ri?.body ?? null,
            error: result.error,
        };
    }
}

export const version = new VersionService();
