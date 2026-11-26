import { getActiveLocale } from "../../shared/i18n/active-locale";
import { isLinux } from "../../shared/platform";
import { boardProcessEnvironment } from "../board-process-environment";
import { linuxServiceEnvironmentKeys } from "./process-environment-linux";
import { windowsServiceEnvironmentKeys } from "./process-environment-windows";

/** Construct the profile-scoped environment for a module service process. */
export function buildServiceEnvironment(boardRoot: string): NodeJS.ProcessEnv {
    const allowed = isLinux ? linuxServiceEnvironmentKeys : windowsServiceEnvironmentKeys;
    const environment: NodeJS.ProcessEnv = {};
    for (const key of allowed) {
        const value = process.env[key];
        if (value !== undefined) environment[key] = value;
    }
    environment.PERSEPHONE_SERVICE = "1";
    environment.PERSEPHONE_BOARD_ROOT = boardRoot;
    environment.PERSEPHONE_LOCALE = getActiveLocale();
    return boardProcessEnvironment(environment, boardRoot);
}
