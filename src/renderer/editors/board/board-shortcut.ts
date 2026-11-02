import { api } from "../../../ipc/renderer/api";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { fs } from "../../api/fs";
import { ui } from "../../api/ui";
import { fpBasename, fpIsAbsolute, fpJoin, fpResolve } from "../../core/utils/file-path";
import { boardDisplayText, boardMetadataKeys, ensureBoardDisplayText } from "./board-display-text";
import { readNormalizedBoardManifest } from "./board-manifest";
import { renderBoardIconDataUrl } from "./board-window-icon";

function safeShortcutName(name: string): string {
    const forbidden = '<>:"/\\|?*';
    return Array.from(name)
        .filter((character) => character.charCodeAt(0) >= 32 && !forbidden.includes(character))
        .join("")
        .replace(/[. ]+$/g, "");
}

export interface CreateBoardShortcutOptions {
    linkPath?: string;
    overwrite?: boolean;
}

export async function createBoardShortcutCore(
    root: string,
    options?: CreateBoardShortcutOptions,
): Promise<{ linkPath: string; displayName: string } | null> {
    const manifest = await readNormalizedBoardManifest(root);
    if (manifest) await ensureBoardDisplayText(root, manifest);
    const fallback = manifest?.name?.trim() || fpBasename(root);
    const displayName = boardDisplayText(root, manifest, boardMetadataKeys.name, fallback);
    const fileName = safeShortcutName(displayName) || safeShortcutName(fpBasename(root)) || "Board";
    const dialogPath = options?.linkPath !== undefined ? undefined : await fs.showSaveDialog({
        defaultPath: fpJoin(root, `${fileName}.lnk`),
        filters: [{ name: t("shell.boardShortcutFileType"), extensions: ["lnk"] }],
    });
    const linkPath = options?.linkPath ?? dialogPath;
    if (!linkPath) return null;
    if (!fpIsAbsolute(linkPath)) throw new Error("linkPath must be absolute.");
    const resolvedLinkPath = fpResolve(linkPath);

    const iconDataUrl = await renderBoardIconDataUrl(root);
    const created = await api.createBoardShortcut({
        boardRoot: root,
        linkPath: resolvedLinkPath,
        overwrite: options?.linkPath !== undefined ? options.overwrite : true,
        displayName,
        iconDataUrl,
    });
    if (!created) throw new Error("Shortcut creation or verification failed.");
    return { linkPath: resolvedLinkPath, displayName };
}

export async function createBoardShortcut(root: string): Promise<void> {
    try {
        const result = await createBoardShortcutCore(root);
        if (!result) return;
        ui.notify(t("shell.boardShortcutCreated", { name: result.displayName }), "success");
    } catch (error) {
        ui.notify(t("shell.boardShortcutFailed", { error: errMessage(error) }), "error");
    }
}
