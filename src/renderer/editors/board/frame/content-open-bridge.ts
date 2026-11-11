import { api } from "../../../../ipc/renderer/api";
import {
    NO_REPLY,
    type BoardToHostRequests,
    type RequestParams,
    type RequestResult,
} from "../../../../ipc/board-bridge/frame-protocol";
import { boardPipeResourcePath, parseBoardOriginRoute } from "../../../../ipc/board-bridge/origin-routes";
import { BoardGrant } from "../../../../shared/board/board-grant";
import { errMessage } from "../../../../shared/utils";
import { boardRegistry } from "../../../api/boards/board-registry";
import type { BoardEditorModel } from "../BoardEditorModel";
import { resolveBoardOpenContent } from "../board-open-content";
import { BoardFrameSession } from "./BoardFrameSession";

interface ContentContext {
    host: string;
    frame: HTMLIFrameElement;
    generation: number
}

export class ContentOpenBridge {
    private readonly unsubscribeRetire: () => void;
    private readonly pendingContentOpen = new Set<AbortController>();

    constructor(
        private readonly model: BoardEditorModel,
        private readonly boardRoot: string,
        private readonly session: BoardFrameSession,
    ) {
        this.unsubscribeRetire = session.onRetire(({ generation }) => {
            for (const controller of this.pendingContentOpen) controller.abort();
            this.pendingContentOpen.clear();
            this.model.contentResources.releaseForFrame(this.session.tabId, generation);
        });
    }

    readonly open = async (params: RequestParams<BoardToHostRequests, "contentOpen">, context: ContentContext) => {
        const { host, frame, generation } = context;
        const controller = new AbortController();
        this.pendingContentOpen.add(controller);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        try {
            const grant = boardRegistry.grant(this.boardRoot) ?? BoardGrant.NONE;
            if (/^https?:/i.test(params.link) && grant.networkMode() === false) throw BoardGrant.deny("network");
            if (typeof params.link !== "string") throw new Error("content.open() requires a link string.");
            if (params.timeoutMs !== undefined && (!Number.isSafeInteger(params.timeoutMs) || params.timeoutMs <= 0)) {
                throw new Error("content.open() timeoutMs must be a positive integer.");
            }
            if (params.timeoutMs !== undefined) timer = setTimeout(() => {
                timedOut = true;
                controller.abort();

            }, params.timeoutMs);
            if (!this.session.isCurrent(generation, frame) || !frame.contentWindow) {
                throw new Error("The board frame is unavailable.");
            }
            const mcpUrl = await api.getBoardMcpEndpoint();
            const info = await this.model.contentResources.open(
                params.link,
                this.session.tabId,
                generation,
                controller.signal,
                {
                    host,
                    networkPolicy: grant.networkPolicy({ mcpUrl, boardRoot: this.boardRoot }),
                    isCurrent: () => this.session.isCurrent(generation, frame) && !!frame.contentWindow,
                },
            );
            if (!info) return NO_REPLY;
            return {
                url: `board://${host}${boardPipeResourcePath(info.resourceId)}`,
                size: info.size,
                contentType: info.contentType,
            };
        } catch (error: unknown) {
            throw new Error(
                timedOut
                    ? "content.open() timed out while resolving the resource."
                    : errMessage(error, "The content resource could not be opened."),
            );
        } finally {
            if (timer !== undefined) clearTimeout(timer);
            this.pendingContentOpen.delete(controller);
        }
    };
    readonly undelivered = (value: RequestResult<BoardToHostRequests, "contentOpen">, _context: ContentContext) => {
        const route = parseBoardOriginRoute(new URL(value.url).pathname);
        if (route?.kind === "pipe-resource") this.model.contentResources.release(route.resourceId);
    };
    readonly openContent = ({ request }: RequestParams<BoardToHostRequests, "openContent">) => {
        const reply = resolveBoardOpenContent(request);
        if (reply.error) throw new Error(reply.error);
        if (!reply.pageId) throw new Error("Board content could not be opened.");
        return reply.pageId;
    };
    detach(): void {
        this.unsubscribeRetire();
    }

}
