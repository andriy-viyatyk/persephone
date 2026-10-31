import { app } from "../app";
import { pagesModel } from "../pages";
import { createLinkData } from "../../../shared/link-data";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { ui } from "../ui";
import type { McpCommandHandler } from "./types";

export const handleBoardOpenRawLink: McpCommandHandler = async (params) => {
    if (!params || typeof params.target !== "string" || !params.target.trim()
        || typeof params.boardRoot !== "string" || !params.boardRoot) {
        throw new Error("Invalid board openRawLink request.");
    }
    const { target, boardRoot } = params;
    const editor = typeof params.editor === "string" ? params.editor : undefined;
    const revealLine = typeof params.revealLine === "number" ? params.revealLine : undefined;
    const highlightText = typeof params.highlightText === "string" ? params.highlightText : undefined;
    const reuseKey = typeof params.reuseKey === "string" ? params.reuseKey : undefined;

    try {
        if (editor === "image-view" && target.startsWith("data:image/")) {
            const blob = await (await fetch(target)).blob();
            await pagesModel.openImageInNewTab(URL.createObjectURL(blob), "Image");
            return { result: null };
        }

        if (editor === "browser-view" && reuseKey !== undefined) {
            await pagesModel.lifecycle.openBoardRunPage(boardRoot, reuseKey, target);
            return { result: null };
        }

        await app.events.openRawLink.sendAsync(createLinkData(target, {
            sourceId: "board",
            boardRoot,
            target: editor,
            revealLine,
            highlightText,
            waitForPageReady: true,
        }));
        return { result: null };
    } catch (error: unknown) {
        const action = editor === "image-view" ? t("api.failedToOpenImage") : t("api.failedToOpenLink");
        void ui.notify(t("api.actionFailed", { action, error: errMessage(error) }), "error");
        throw error;
    }
};
