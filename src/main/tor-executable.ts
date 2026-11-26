import { isLinux } from "../shared/platform";
import { findLinuxExecutable } from "./linux-executable-lookup";

export const TOR_NOT_FOUND_MESSAGE = "Tor not found on PATH. Install Tor or set the Tor executable path in Settings.";

export function resolveTorExecutable(configuredPath: string): { executable?: string; error?: string } {
    if (!isLinux) {
        return configuredPath
            ? { executable: configuredPath }
            : { error: "Tor is not configured: set tor.exe-path in Settings." };
    }
    if (!configuredPath) {
        const executable = findLinuxExecutable("tor");
        return executable ? { executable } : { error: TOR_NOT_FOUND_MESSAGE };
    }
    const executable = findLinuxExecutable(configuredPath);
    return executable
        ? { executable }
        : { error: `Tor executable not found or not executable: ${configuredPath}` };
}
