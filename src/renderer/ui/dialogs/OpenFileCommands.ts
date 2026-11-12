import { createLinkData } from "../../../shared/link-data";
import { t } from "../../../shared/i18n/t";
import { api } from "../../../ipc/renderer/api";
import { showOpenUrlDialog } from "./OpenUrlDialog";

async function sendOpenRawLink(href: string): Promise<void> {
    const { app } = await import("../../api/app");
    await app.events.openRawLink.sendAsync(createLinkData(href));
}

export async function openFileWithDialog(): Promise<void> {
    const result = await showOpenUrlDialog();
    if (!result) return;

    if (result.type === "url") {
        await sendOpenRawLink(result.value);
    } else if (result.type === "file") {
        await openFileFromDialog();
    }
}

export async function openFileFromDialog(): Promise<void> {
    const filePaths = await api.showOpenFileDialog({
        title: t("dialogs.openUrlFile"),
        multiSelections: false,
    });
    if (filePaths && filePaths.length > 0) {
        await sendOpenRawLink(filePaths[0]);
    }
}
