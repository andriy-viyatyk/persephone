import type { BoardToHostRequests, RequestParams } from "../../../../ipc/board-bridge/frame-protocol";
import type { BoardEditorModel } from "../BoardEditorModel";

export class PageStateBridge {
    constructor(private readonly model: BoardEditorModel) { }

    async get({ key }: RequestParams<BoardToHostRequests, "pageState.get">) {
        return this.model.pageStateStore.get(key);

    }
    async set({ key, value }: RequestParams<BoardToHostRequests, "pageState.set">): Promise<void> {
        await this.model.pageStateStore.set(key, value);

    }
    async remove({ key }: RequestParams<BoardToHostRequests, "pageState.remove">): Promise<void> {
        await this.model.pageStateStore.remove(key);

    }
}
