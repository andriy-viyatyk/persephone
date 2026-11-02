import { app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { getLauncherPath } from "./browser-registration";

/** electron-builder's uninstall key for appId `com.viyatyk.persephone` (a UUID v5 of the appId). */
const INSTALLED_UNINSTALL_KEY = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\de6947fe-4b42-50ca-ab55-d20f314ae2b2";

let installedLauncher: string | null | undefined;

/** `persephone-launcher.exe` of an installed Persephone (per-user or all-users), or null. */
function findInstalledLauncher(): string | null {
    if (installedLauncher !== undefined) return installedLauncher;
    installedLauncher = null;
    for (const hive of ["HKCU", "HKLM"]) {
        try {
            const output = execFileSync("reg", ["query", `${hive}\\${INSTALLED_UNINSTALL_KEY}`, "/v", "UninstallString"], {
                encoding: "utf-8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
            });
            const uninstaller = /UninstallString\s+REG_SZ\s+"([^"]+)"/.exec(output)?.[1];
            const launcher = uninstaller && path.join(path.dirname(uninstaller), "persephone-launcher.exe");
            if (launcher && existsSync(launcher)) return (installedLauncher = launcher);
        } catch {
            // Key absent in this hive.
        }
    }
    return installedLauncher;
}

/**
 * Target for board shortcuts and board-window relaunch commands. A packaged build uses its own
 * launcher. A dev build (`npm start`) has no launcher beside electron.exe, so it uses the installed
 * Persephone's launcher instead. That launcher hands the board to whichever Persephone is running
 * (they share one launcher pipe), so the board opens in the dev instance while it runs and in the
 * installed one otherwise. Without an installed copy it falls back to `getLauncherPath()`.
 */
export function getBoardLauncherPath(): string {
    if (app.isPackaged) return getLauncherPath();
    return findInstalledLauncher() ?? getLauncherPath();
}

/** Stable board identity shared by board windows and their Windows shortcuts. */
export function boardIdentityHash(boardRoot: string): string {
    return createHash("sha256").update(path.normalize(path.resolve(boardRoot)).toLowerCase()).digest("hex");
}

export function boardWindowIconPath(boardRoot: string): string {
    return path.join(app.getPath("userData"), "board-icons", `${boardIdentityHash(boardRoot)}.ico`);
}

/** Resolve a board root for a quoted `--board` argument without a trailing slash. */
export function boardRootForLaunchArgs(boardRoot: string): string {
    const resolved = path.resolve(boardRoot);
    const root = path.parse(resolved).root;
    return resolved.length > root.length ? resolved.replace(/[\\/]+$/, "") : resolved;
}

function pngBackedIco(png: Buffer): Buffer {
    const header = Buffer.alloc(22);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt8(0, 6);
    header.writeUInt8(0, 7);
    header.writeUInt8(0, 8);
    header.writeUInt8(0, 9);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18);
    return Buffer.concat([header, png]);
}

export async function writeBoardWindowIcon(boardRoot: string, png: Buffer): Promise<string> {
    const iconPath = boardWindowIconPath(boardRoot);
    await fs.mkdir(path.dirname(iconPath), { recursive: true });
    await fs.writeFile(iconPath, pngBackedIco(png));
    return iconPath;
}
