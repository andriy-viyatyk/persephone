import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { BoardRoot } from "../shared/board/board-root";
import { applicationProfileDirectory, applicationProfileName } from "./application-profile";
import { boardWindowKey } from "./board-root-hashes";
import { linuxDesktopInvocation, serializeDesktopEntryValue, serializeDesktopExec } from "./linux-desktop-entry";

interface LinuxBoardShortcutRequest {
    boardRoot: string;
    linkPath: string;
    displayName: string;
    overwrite?: boolean;
}

export async function createLinuxBoardShortcut(request: LinuxBoardShortcutRequest, png: Buffer): Promise<boolean> {
    const root = path.resolve(request.boardRoot);
    const iconPath = path.join(app.getPath("userData"), "board-icons", `${boardWindowKey(BoardRoot.from(root))}.png`);
    await fs.mkdir(path.dirname(iconPath), { recursive: true });
    await fs.writeFile(iconPath, png);

    // `--name=value` keeps each value attached: Chromium moves switches ahead of positional arguments in the
    // command line a running instance receives (`second-instance`), which would separate `--board <root>`.
    const launchArguments = [`--board=${root}`];
    const profileName = applicationProfileName();
    const profileDirectory = applicationProfileDirectory();
    if (profileName) launchArguments.push(`--profile=${profileName}`);
    if (profileDirectory) launchArguments.push(`--profile-dir=${profileDirectory}`);
    const exec = serializeDesktopExec(linuxDesktopInvocation(launchArguments));
    const content = [
        "[Desktop Entry]",
        "Type=Application",
        `Name=${serializeDesktopEntryValue(request.displayName)}`,
        `Icon=${serializeDesktopEntryValue(iconPath)}`,
        `Exec=${exec}`,
        "",
    ].join("\n");
    await fs.writeFile(request.linkPath, content, { encoding: "utf8", flag: request.overwrite ? "w" : "wx" });

    const [writtenEntry, writtenIcon] = await Promise.all([
        fs.readFile(request.linkPath, "utf8"),
        fs.readFile(iconPath),
    ]);
    if (writtenEntry !== content || !writtenIcon.equals(png)) throw new Error("Board launcher verification failed.");
    return true;
}
