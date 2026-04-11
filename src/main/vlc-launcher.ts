import { spawn } from "child_process";
import fs from "node:fs";

const DEFAULT_VLC_PATHS = [
    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
    "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
];

export function openInVlc(url: string, configuredPath?: string): void {
    const vlcPath = resolveVlcPath(configuredPath);
    if (!vlcPath) {
        throw new Error(
            "VLC not found. Please set the VLC path in Settings → Video Player.",
        );
    }
    const proc = spawn(vlcPath, [url], {
        detached: true,
        stdio: "ignore",
    });
    proc.unref();
}

function resolveVlcPath(configured?: string): string | undefined {
    if (configured) return configured;
    return DEFAULT_VLC_PATHS.find((p) => fs.existsSync(p));
}
