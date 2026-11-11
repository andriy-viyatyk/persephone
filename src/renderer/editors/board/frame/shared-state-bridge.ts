import type { BoardToHostEvents } from "../../../../ipc/board-bridge/frame-protocol";
import type { BoardEditorModel } from "../BoardEditorModel";
import { BoardFrameSession } from "./BoardFrameSession";
import { BoardFrameEndpoint } from "./BoardFrameEndpoint";

export class SharedStateBridge {
    private unsubscribe: (() => void) | undefined;

    constructor(
        private readonly model: BoardEditorModel,
        private readonly session: BoardFrameSession,
        private readonly endpoint: BoardFrameEndpoint,
    ) { }

    set({ state }: BoardToHostEvents["state.set"]): void {
        this.model.setSharedState(state ?? {});

    }
    merge({ partial }: BoardToHostEvents["state.merge"]): void {
        this.model.mergeSharedState(partial ?? {});

    }
    init({ defaults, restorableKeys }: BoardToHostEvents["state.init"]): void {
        this.model.initSharedState(defaults ?? {}, restorableKeys);

    }
    setSecondaryViews({ views }: BoardToHostEvents["secondaryViews.set"]): void {
        this.model.setSecondaryViews(views);

    }

    sendSnapshot(): void {
        this.endpoint.emit("state.sync", { state: this.model.state.get().sharedState ?? {}, seq: this.model.sharedStateSeq });
    }

    start(): void {
        this.unsubscribe = this.model.state.subscribe((sharedState) => {
            if (!this.session.isAlive) return;
            this.endpoint.emit("state.sync", { state: (sharedState as Record<string, unknown>) ?? {}, seq: this.model.sharedStateSeq });
        }, (state) => state.sharedState);
    }

    dispose(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;

    }
}
