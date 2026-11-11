import type { BoardToHostEvents } from "../../../../ipc/board-bridge/frame-protocol";
import type { IAiRemoteRequest, IAiRemoteResponse } from "ai-vision";
import { boardRegistry } from "../../../api/boards/board-registry";
import { logBoardReloaded, logShapeChanged } from "../../../scripting/ai-vision/event-log";
import type { BoardEditorModel } from "../BoardEditorModel";
import { BoardFrameSession } from "./BoardFrameSession";
import { BoardFrameEndpoint } from "./BoardFrameEndpoint";

export class AiVisionBridge {
    constructor(
        private readonly boardRoot: string,
        private readonly session: BoardFrameSession,
        private readonly endpoint: BoardFrameEndpoint,
    ) { }

    handleAiVisionRegistration(
        message: BoardToHostEvents["aiVision.register"],
        model: BoardEditorModel,
        frame: HTMLIFrameElement,
        generation: number,
    ): void {
        const reason = message.reason === "refresh" ? "refresh" : "register";
        const warning = (text: string): void => this.session.log("warn", text);
        const previousShape = model.aiVision.getRegistration()?.shape;
        const accepted = model.aiVision.register({
            shape: message.shape,
            schemaVersion: message.schemaVersion,
            request: this.requestAiVision,
            warning,
            onValid: (validReason) => {
                if (validReason !== "refresh") {
                    this.endpoint.failPending(
                        "aiVision.request",
                        new Error("Board AiVision registration was replaced."),
                    );
                }
            },
        }, frame, generation, reason);
        const pageId = model.page?.id;
        if (accepted && pageId && reason === "refresh"
            && JSON.stringify(previousShape) !== JSON.stringify(message.shape)) logShapeChanged(pageId);
        const reloadRegistration = accepted && reason === "register" && model.aiVision.consumeReloadRegistration();
        if (reloadRegistration && pageId) logBoardReloaded(pageId);
    }

    readonly requestAiVision = (
        request: IAiRemoteRequest,
        timeoutMs: number,
        timeoutError: Error,
    ): Promise<IAiRemoteResponse> => {
        const stamp = this.session.current();
        if (!stamp || !boardRegistry.isPermitted(this.boardRoot)) {
            return Promise.reject(new Error("The board frame is unavailable or untrusted."));
        }
        return this.endpoint.request("aiVision.request", { request }, {
            timeoutMs,
            timeoutError: () => timeoutError,
            unavailableError: (stage) => new Error(
                stage === "no-frame"
                    ? "The board frame is unavailable or untrusted."
                    : "The board frame is unavailable.",
            ),
        });
    }
}
