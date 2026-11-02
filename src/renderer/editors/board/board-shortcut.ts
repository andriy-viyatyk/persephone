import { api } from "../../../ipc/renderer/api";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { fs } from "../../api/fs";
import { ui } from "../../api/ui";
import { fpBasename, fpJoin } from "../../core/utils/file-path";
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

export async function createBoardShortcut(root: string): Promise<void> {
    try {
        const manifest = await readNormalizedBoardManifest(root);
        if (manifest) await ensureBoardDisplayText(root, manifest);
        const fallback = manifest?.name?.trim() || fpBasename(root);
        const displayName = boardDisplayText(root, manifest, boardMetadataKeys.name, fallback);
        const fileName = safeShortcutName(displayName) || safeShortcutName(fpBasename(root)) || "Board";
        const linkPath = await fs.showSaveDialog({
            defaultPath: fpJoin(root, `${fileName}.lnk`),
            filters: [{ name: t("shell.boardShortcutFileType"), extensions: ["lnk"] }],
        });
        if (!linkPath) return;

        const iconDataUrl = await renderBoardIconDataUrl(root);
        const created = await api.createBoardShortcut({ boardRoot: root, linkPath, displayName, iconDataUrl });
        if (!created) {
            ui.notify(t("shell.boardShortcutFailed", { error: t("shell.boardShortcutVerificationFailed") }), "error");
            return;
        }
        ui.notify(t("shell.boardShortcutCreated", { name: displayName }), "success");
    } catch (error) {
        ui.notify(t("shell.boardShortcutFailed", { error: errMessage(error) }), "error");
    }
}
