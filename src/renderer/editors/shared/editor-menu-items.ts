import { api } from "../../../ipc/renderer/api";
import { createLinkData } from "../../../shared/link-data";
import { toClipboard } from "../../core/utils/utils";
import { createIconElement } from "../../uikit/shared/slots";
import type { MenuItem } from "../../uikit/Menu/types";
import type { TextFileModel } from "../text/TextEditorModel";
import { t } from "../../../shared/i18n/t";

/** HTML files that make sense to render in the browser instead of editing. */
const HTML_FILE = /\.(?:x?html?)$/i;

/**
 * "Open in Browser" — for HTML files opened in a text editor. Routes the file
 * through the standard openRawLink pipeline with `target: "browser"`; the
 * internal browser converts the Windows path to a `file://` URL on navigate.
 * Returns an empty array for non-HTML / unsaved files so the item is hidden.
 */
export function openInBrowserMenuItems(filePath: string | undefined): MenuItem[] {
    if (!filePath || !HTML_FILE.test(filePath)) return [];
    return [
        {
            id: "open-in-browser",
            label: t("menus.openInBrowser"),
            icon: createIconElement("globe"),
            startGroup: true,
            onClick: async () => {
                const { app } = await import("../../api/app");
                await app.events.openRawLink.sendAsync(
                    createLinkData(filePath, { target: "browser", browserMode: "internal" }),
                );
            },
        },
    ];
}

/**
 * "Show in File Explorer" + "Copy File Path" — the file-path menu items.
 * Reusable by any editor with an on-disk path: text-bearing editors (via their
 * content host) and standalone PDF / Image / Archive editors. Items are disabled
 * (not hidden) when `filePath` is absent, matching the page-tab UX.
 */
export function filePathMenuItems(filePath: string | undefined): MenuItem[] {
    return [
        {
            id: "show-in-file-explorer",
            label: t("shell.showInFileExplorer"),
            icon: createIconElement("folder-open"),
            onClick: () => {
                if (filePath) api.showItemInFolder(filePath);
            },
            disabled: !filePath,
        },
        {
            id: "copy-file-path",
            label: t("menus.copyFilePath"),
            icon: createIconElement("copy"),
            onClick: () => {
                if (filePath) toClipboard(filePath);
            },
            disabled: !filePath,
        },
    ];
}

/**
 * The full text-file context menu (Save / Save As / Rename / file-path items /
 * encryption group) contributed by a `TextFileModel` content host. This is the
 * single place the text-file menu lives — every text-bearing editor surfaces it
 * via `EditorModel.onGetMenuItems()` → `contentHost.onGetMenuItems()`.
 *
 * The first item carries no `startGroup`; the page tab stamps the separator onto
 * the first contributed item so it sits below the tab-level options.
 */
export function textFileMenuItems(host: TextFileModel): MenuItem[] {
    return [
        {
            id: "save",
            label: t("menus.save"),
            icon: createIconElement("save"),
            onClick: () => host.saveFile(false),
        },
        {
            id: "save-as",
            label: t("menus.saveAs"),
            icon: createIconElement("save"),
            onClick: () => host.saveFile(true),
        },
        {
            id: "rename",
            label: t("menus.rename"),
            icon: createIconElement("rename"),
            onClick: () => host.promptRename(),
        },
        ...filePathMenuItems(host.filePath),
        ...openInBrowserMenuItems(host.filePath),
        {
            id: "decrypt",
            label: t("menus.decrypt"),
            icon: createIconElement("unlock"),
            onClick: () => host.showEncryptionDialog(),
            disabled: !host.encrypted,
            startGroup: true,
        },
        {
            id: host.withEncryption ? "change-password" : "encrypt",
            label: host.withEncryption ? t("menus.changePassword") : t("menus.encrypt"),
            icon: createIconElement("lock"),
            onClick: () => host.showEncryptionDialog(),
            disabled: host.encrypted,
        },
        {
            id: "make-unencrypted",
            label: t("menus.makeUnencrypted"),
            icon: createIconElement("key-off"),
            onClick: () => host.makeUnencrypted(),
            disabled: !host.decrypted,
        },
    ];
}
