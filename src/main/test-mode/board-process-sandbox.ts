import { app } from "electron";
import { isLinux, isWindows } from "../../shared/platform";
import { isTestInstance } from "./instance-options";
import { applyLinuxBoardProcessSandbox } from "./board-process-sandbox-linux";
import { applyWindowsBoardProcessSandbox } from "./board-process-sandbox-windows";

/** Apply profile and PATH isolation to board-owned processes in an owned test instance. */
export function applyBoardProcessSandbox(environment: NodeJS.ProcessEnv): void {
    if (!isTestInstance()) return;

    const userData = app.getPath("userData");
    if (isWindows) applyWindowsBoardProcessSandbox(environment, userData);
    else if (isLinux) applyLinuxBoardProcessSandbox(environment, userData);
}
