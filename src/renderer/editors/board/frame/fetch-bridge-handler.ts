import type {
    BoardToHostRequests,
    BoardToHostEvents,
    RequestParams,
} from "../../../../ipc/board-bridge/frame-protocol";
import { BoardFetchBridge } from "../board-fetch";
import { BoardFrameSession } from "./BoardFrameSession";
import { BoardFrameEndpoint } from "./BoardFrameEndpoint";

interface FetchContext {
    requestId?: string | number;
    frame: HTMLIFrameElement;
    generation: number
}

export class FetchBridgeHandler {
    private readonly unsubscribeRetire: () => void;
    private readonly fetch = new BoardFetchBridge();
    constructor(
        private readonly boardRoot: string,
        session: BoardFrameSession,
        private readonly endpoint: BoardFrameEndpoint,
    ) {
        this.unsubscribeRetire = session.onRetire(() => this.fetch.dispose());
    }
    start(params: RequestParams<BoardToHostRequests, "fetch">, context: FetchContext) {
        if (typeof context.requestId !== "number") throw new Error("Malformed fetch request id.");
        return this.fetch.start(context.requestId, params, this.boardRoot, context.frame, context.generation,
            (name, payload, transfer) => this.endpoint.emit(name, payload, { transfer, from: context }));
    }
    abortContext(context: FetchContext): void {
        if (typeof context.requestId === "number") this.fetch.abort(context.requestId);

    }
    pull({ id }: BoardToHostEvents["fetch.pull"]): void {
        if (typeof id === "number") void this.fetch.pull(id);

    }
    abort({ id }: BoardToHostEvents["fetch.abort"]): void {
        if (typeof id === "number") this.fetch.abort(id);

    }
    reject({ id }: BoardToHostEvents["fetch.abort"]): void {
        if (typeof id === "number") {
            this.fetch.abort(id);
            this.endpoint.emit("fetch.error", { id, message: "This board is no longer trusted." });

        }
    }
    detach(): void {
        this.unsubscribeRetire();

    }

}
