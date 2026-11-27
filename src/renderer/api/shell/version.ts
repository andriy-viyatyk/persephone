import { api } from "../../../ipc/renderer/api";
import type { IVersionService, IRuntimeVersions, IUpdateInfo } from "../types/shell";
import { mapUpdateResult } from "./map-update-result";

class VersionService implements IVersionService {
    async runtimeVersions(): Promise<IRuntimeVersions> {
        return api.getRuntimeVersions();
    }

    async checkForUpdates(force?: boolean): Promise<IUpdateInfo> {
        const result = await api.checkForUpdates(force);
        return mapUpdateResult(result);
    }
}

export const version = new VersionService();
