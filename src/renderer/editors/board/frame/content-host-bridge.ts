import { api } from "../../../../ipc/renderer/api";
import {
    NO_REPLY,
    type BoardToHostEvents,
    type BoardToHostRequests,
    type RequestParams,
} from "../../../../ipc/board-bridge/frame-protocol";
import { errMessage } from "../../../../shared/utils";
import { ui } from "../../../api/ui";
import { isProviderResolutionError } from "../../../content/registry";
import type { BoardEditorModel } from "../BoardEditorModel";
import { resolveBoardFileIcons } from "../board-file-icons";
import { BoardFrameSession, type BoardFrameStamp } from "./BoardFrameSession";
import { BoardFrameEndpoint } from "./BoardFrameEndpoint";

export class ContentHostBridge {
    private unsubscribe: (() => void) | undefined;

    constructor(
        private readonly model: BoardEditorModel,
        private readonly session: BoardFrameSession,
        private readonly endpoint: BoardFrameEndpoint,
    ) { }

    async filePath(
        _params: RequestParams<BoardToHostRequests, "filePath">,
        context: Pick<BoardFrameStamp, "generation" | "frame">,
    ): Promise<string | undefined | typeof NO_REPLY> {
        const token = this.session.hostedPathToken;
        try {
            const path = await this.model.ensureContentPath();
            if (!this.session.isCurrent(context.generation, context.frame) || token !== this.session.hostedPathToken) return NO_REPLY;
            const updated = await api.updateBoardHostedPath(this.session.boardId, token, path ?? null);
            if (!updated || !this.session.isCurrent(context.generation, context.frame)
                || token !== this.session.hostedPathToken) return NO_REPLY;
            return path;
        } catch (error: unknown) {
            if (isProviderResolutionError(error)) ui.notify(errMessage(error), "error");
            throw error;
        }
    }

    async fileIcons({ names }: RequestParams<BoardToHostRequests, "fileIcons">) {
        if (!Array.isArray(names)) throw new Error("icons.forFiles() expects an array of file names.");
        return resolveBoardFileIcons(names);
    }

    setContent({ content }: BoardToHostEvents["content.set"]): void {
        const next = typeof content === "string" ? content : "";
        this.model.applyBoardContent(next);
    }

    saveContent(): void {
        this.model.saveBoardContent();
    }

    sendInitialContent(): void {
        const host = this.model.contentHost;
        if (!host) return;
        const { content, language } = host.state.get();
        this.endpoint.emit("host.content", { content, language });
    }

    start(): void {
        this.unsubscribe?.();
        this.unsubscribe = this.model.subscribeBoardContent((content) => {
            if (!this.session.isAlive) return;
            const host = this.model.contentHost;
            if (host) this.endpoint.emit("host.content", { content, language: host.state.get().language });
        });
    }

    dispose(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
