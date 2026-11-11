import type { BoardToHostRequests, RequestParams } from "../../../../ipc/board-bridge/frame-protocol";
import { errMessage } from "../../../../shared/utils";
import { boardNavigationReturnService } from "../../../api/board-navigation-return";
import type { BoardEditorModel } from "../BoardEditorModel";
import { grantBoardSourceReads } from "../model/BoardSourceInbox";
import { BoardFrameSession } from "./BoardFrameSession";
import { BoardFrameEndpoint } from "./BoardFrameEndpoint";

interface SourceContext {
    host: string;
    frame: HTMLIFrameElement;
    generation: number
}

export class SourceBridge {
    private unsubscribe: (() => void) | undefined;
    constructor(
        private readonly model: BoardEditorModel,
        private readonly boardRoot: string,
        private readonly isMain: boolean,
        private readonly session: BoardFrameSession,
        private readonly endpoint: BoardFrameEndpoint,
    ) { }

    async navigate({ href }: RequestParams<BoardToHostRequests, "source.navigate">): Promise<void> {
        await this.model.navigateSource(href);

    }
    createReturnUrl(context: SourceContext) {
        if (!this.session.isCurrent(context.generation, context.frame) || !context.frame.contentWindow) {
            throw new Error("The board frame is unavailable.");
        }
        return boardNavigationReturnService.createBoardClaim({
            pageId: this.model.page?.id, model: this.model, frame: context.frame, tabId: this.session.tabId,
            targetOrigin: `board://${context.host}`, generation: context.generation,
            currentGeneration: () => this.session.generation,
            isCurrent: () => this.session.isCurrent(context.generation, context.frame),
        });
    }
    start(): void {
        this.unsubscribe = this.model.sourceInbox.onPending(() => this.flushPendingSourceUrls());
    }
    dispose(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    /** Push queued runtime source identities to the live main board frame in FIFO order. */
    private flushingPendingSources = false;

    async flushPendingSourceUrls(): Promise<void> {
        if (!this.isMain || !this.session.isAlive || !this.session.host) return;
        if (this.flushingPendingSources) return;
        this.flushingPendingSources = true;
        const stamp = this.session.current();
        try {
            if (!stamp) return;
            while (true) {
                const pending = this.model.sourceInbox.peek();
                if (pending === undefined) return;
                if (!this.session.isCurrent(stamp.generation, stamp.frame)) return;
                await grantBoardSourceReads(this.boardRoot, pending.sourceUrl, pending.context);
                if (!this.session.isCurrent(stamp.generation, stamp.frame)) return;
                const message = {
                    sourceUrl: pending.sourceUrl,
                    ...(pending.privateSession ? { privateSession: true } : {}),
                    ...(pending.context ? { context: pending.context } : {}),
                };
                if (!this.endpoint.emit("source.opened", message, { from: stamp })) return;
                this.model.sourceInbox.consume();
            }
        } catch (error: unknown) {
            this.session.log("warn", `Could not grant source file reads to the board: ${errMessage(error)}`);
        } finally {
            this.flushingPendingSources = false;
        }
    }

}
