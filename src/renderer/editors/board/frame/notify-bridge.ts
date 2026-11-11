import type { BoardToHostEvents } from "../../../../ipc/board-bridge/frame-protocol";
import { logRemoteNotify } from "../../../scripting/ai-vision/event-log";
import type { BoardEditorModel } from "../BoardEditorModel";
import { boardNotifyLimiter } from "./board-notify-limiter";

export class NotifyBridge {
    handleAiVisionNotify(
        message: BoardToHostEvents["aiVision.notify"],
        model: BoardEditorModel,
    ): void {
        if (typeof message.text !== "string") return;
        const pageId = model.page?.id;
        if (!pageId) return;
        const normalizedText = message.text.replace(/\s+/g, " ").trim();
        if (!normalizedText) return;
        const text = normalizedText.length > 512
            ? `${normalizedText.slice(0, 509)}...`
            : normalizedText;
        if (!boardNotifyLimiter.accept()) return;
        const path = `pages[${JSON.stringify(pageId)}].editor.app`;
        logRemoteNotify(text, path, "board");
    }
}
