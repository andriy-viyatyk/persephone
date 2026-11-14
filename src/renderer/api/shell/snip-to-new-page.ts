import { errMessage } from "../../../shared/utils";
import { englishMessage, t } from "../../../shared/i18n/t";
import { app } from "../app";
import { pages } from "../pages";
import { startScreenSnip } from "./shell-calls";

export async function snipToNewPage(hideWindows: boolean): Promise<void> {
    try {
        const dataUrl = await startScreenSnip(hideWindows);
        if (!dataUrl) return;
        const blob = await (await fetch(dataUrl)).blob();
        const blobUrl = URL.createObjectURL(blob);
        await pages.openImageInNewTab(blobUrl, "Snip");
    } catch (error) {
        app.ui.notify(t("shell.snipFailed", { product: englishMessage("shell.snipProduct"), error: errMessage(error) } as never), "error");
    }
}
