import { pages } from "../../api/pages";
import { settings } from "../../api/settings";
import { shell } from "../../api/shell";
import { boardRegistry } from "../../api/boards/board-registry";
import { api } from "../../../ipc/renderer/api";
import { DialogButton, dialogButton } from "../../ui/dialogs/dialog-buttons";
import { showConfirmationDialog } from "../../ui/dialogs/ConfirmationDialog";
import { t } from "../../../shared/i18n/t";
import type { ILinkAction, ILinkData } from "../../../shared/link-data";

const OPEN_EXTERNAL_LINK = "Open";

export async function openBrowserAction(
    data: ILinkData,
    _action: Extract<ILinkAction, { kind: "browser" }>,
): Promise<void> {
    const browserMode = data.browserMode;
    const openInBrowser = data.target === "browser";

    if (data.browserPageId) {
        const page = pages.query.findPage(data.browserPageId);
        const editor = page?.mainEditor;
        if (editor) {
            const { BrowserEditor } = await import("../../editors/browser/BrowserEditor");
            if (editor instanceof BrowserEditor) {
                const tabMode = data.browserTabMode ?? "addTab";
                if (tabMode === "navigate") editor.navigate(data.url);
                else editor.addTab(data.url);
            }
        }
        return;
    }

    if (browserMode === "os-default") {
        await launchExternal(data);
    } else if (browserMode === "incognito") {
        await pages.openUrlInBrowserTab(data.url, { incognito: true });
    } else if (browserMode?.startsWith("profile:")) {
        await pages.openUrlInBrowserTab(data.url, { profileName: browserMode.slice("profile:".length) });
    } else if (browserMode === "internal") {
        await pages.openUrlInBrowserTab(data.url, { external: true });
    } else {
        const behavior = settings.get("link-open-behavior");
        if (behavior === "internal-browser" || openInBrowser) {
            await pages.openUrlInBrowserTab(data.url, { external: openInBrowser });
        } else {
            await launchExternal(data);
        }
    }
}

async function launchExternal(data: ILinkData): Promise<void> {
    const decision = await externalLaunchDecision(data);
    if (decision === "deny") return;
    if (decision === "internal") {
        await pages.openUrlInBrowserTab(data.url, { external: true });
        return;
    }
    shell.openExternal(data.url);
}

async function externalLaunchDecision(data: ILinkData): Promise<"allow" | "internal" | "deny"> {
    if (!data.boardRoot) {
        if (!data.unattributedPopup) return "allow";
        return await showConfirmationDialog({
            title: t("api.externalLinkTitle"),
            message: t("api.externalLinkUnattributed", { url: data.url ?? "" }),
            buttons: [dialogButton(OPEN_EXTERNAL_LINK), dialogButton(DialogButton.cancel)],
        }) === OPEN_EXTERNAL_LINK ? "allow" : "deny";
    }
    if (boardRegistry.grant(data.boardRoot)?.allows("openExternal")) return "allow";
    const isWebLink = /^https?:\/\//i.test(data.url ?? "");
    const message = isWebLink
        ? `"openExternal" is not enabled in board-manifest.json; opened in an internal Browser tab: ${data.url}`
        : `Blocked external launch: ${data.url}`;
    void api.appendBoardLog(data.boardRoot, isWebLink ? "info" : "warning", message).catch(() => {});
    return isWebLink ? "internal" : "deny";
}
