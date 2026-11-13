import { applicationProfileName } from "./application-profile";
import { app, nativeImage, shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { getLauncherPath } from "./browser-registration";
import { BoardRoot } from "../shared/board/board-root";
import { boardWindowKey } from "./board-root-hashes";

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

export function boardAppId(boardRoot: string): string {
    const name = applicationProfileName();
    return `Persephone.Board.${name ? name + "." : ""}${boardWindowKey(BoardRoot.from(boardRoot))}`;
}

export function boardProfileArgument(): string {
    const name = applicationProfileName();
    return name ? ` --profile ${name}` : "";
}

export function boardWindowIconPath(boardRoot: string): string {
    return path.join(app.getPath("userData"), "board-icons", `${boardWindowKey(BoardRoot.from(boardRoot))}.ico`);
}

/** Resolve a board root for a quoted `--board` argument without a trailing slash. */
export function boardRootForLaunchArgs(boardRoot: string): string {
    const resolved = path.resolve(boardRoot);
    const root = path.parse(resolved).root;
    return resolved.length > root.length ? resolved.replace(/[\\/]+$/, "") : resolved.replace(/\\+$/, (slashes) => slashes + slashes);
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

export async function createBoardShortcut(request: {
    boardRoot: string;
    linkPath: string;
    displayName: string;
    iconDataUrl: string;
    overwrite?: boolean;
}): Promise<boolean> {
    if (!request || typeof request.boardRoot !== "string" || !request.boardRoot.trim()
        || typeof request.linkPath !== "string" || !request.linkPath.trim()
        || typeof request.displayName !== "string" || !request.displayName.trim() || request.displayName.length > 256) {
        throw new Error("Invalid board shortcut details.");
    }
    if (!path.isAbsolute(request.linkPath)) throw new Error("linkPath must be absolute.");
    const resolvedLinkPath = path.resolve(request.linkPath);
    if (path.extname(resolvedLinkPath).toLowerCase() !== ".lnk") throw new Error("linkPath must end in .lnk.");
    const parentPath = path.dirname(resolvedLinkPath);
    if (!existsSync(parentPath) || !statSync(parentPath).isDirectory()) throw new Error("linkPath parent directory does not exist.");
    if (existsSync(resolvedLinkPath) && request.overwrite !== true) throw new Error("File exists; pass overwrite: true.");

    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(request.iconDataUrl);
    if (!match || match[1].length > 7_000_000) throw new Error("Invalid board icon data URL.");
    const image = nativeImage.createFromDataURL(request.iconDataUrl);
    const size = image.getSize();
    if (image.isEmpty() || size.width !== 256 || size.height !== 256) throw new Error("Board icons must be 256x256 PNG images.");

    const iconPath = await writeBoardWindowIcon(request.boardRoot, image.toPNG());
    const details: Electron.ShortcutDetails = {
        target: getBoardLauncherPath(),
        args: `--board "${boardRootForLaunchArgs(request.boardRoot)}"${boardProfileArgument()}`,
        description: request.displayName,
        icon: iconPath,
        iconIndex: 0,
        appUserModelId: boardAppId(request.boardRoot),
    };
    if (!shell.writeShortcutLink(resolvedLinkPath, "create", details)) throw new Error("Failed to create board shortcut.");
    const written = shell.readShortcutLink(resolvedLinkPath);
    const normalizePath = (value: unknown): string | null => typeof value === "string"
        ? path.normalize(path.resolve(value)).replace(/[\\/]+$/, "").toLowerCase()
        : null;
    const verified = normalizePath(written.target) === normalizePath(details.target)
        && written.args === details.args && written.description === details.description
        && normalizePath(written.icon) === normalizePath(details.icon)
        && written.appUserModelId === details.appUserModelId;
    if (!verified) throw new Error("Board shortcut verification failed.");
    return true;
}
