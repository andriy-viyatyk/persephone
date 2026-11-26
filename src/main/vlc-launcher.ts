import { spawn } from "child_process";
import fs from "node:fs";
import { isLinux } from "../shared/platform";
import { findLinuxExecutable } from "./linux-executable-lookup";

const DEFAULT_VLC_PATHS = [
    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
    "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
];

export function openInVlc(url: string, configuredPath?: string): Promise<void> {
    const vlcPath = resolveVlcPath(configuredPath);
    if (!vlcPath) {
        return Promise.reject(new Error(
            "VLC not found. Please set the VLC path in Settings → Video Player.",
        ));
    }
    const proc = spawn(vlcPath, [url], {
        detached: true,
        stdio: "ignore",
    });
    return new Promise((resolve, reject) => {
        proc.once("spawn", () => {
            proc.unref();
            resolve();
        });
        proc.once("error", reject);
    });
}

function resolveVlcPath(configured?: string): string | undefined {
    if (configured) return configured;
    if (isLinux) return findLinuxExecutable("vlc");
    return DEFAULT_VLC_PATHS.find((p) => fs.existsSync(p));
}
