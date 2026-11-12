import { fpJoin } from "./utils/file-path";
import { parseJSON5 } from "./utils/parse-utils";
import { getStartupDataPath } from "./utils/startup-data-path";

export interface StartupEnvironment {
    readonly dataDirectory: string;
    readonly settings: Record<string, unknown>;
}

function readStartupSettings(dataDirectory: string): Record<string, unknown> {
    try {
        const nodeFs = require("fs") as typeof import("fs");
        const parsed = parseJSON5(nodeFs.readFileSync(fpJoin(dataDirectory, "appSettings.json"), "utf8"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

const dataDirectory = getStartupDataPath();

/** Shared synchronous snapshot needed before app.fs is ready. */
export const startupEnvironment: StartupEnvironment = {
    dataDirectory,
    settings: readStartupSettings(dataDirectory),
};
