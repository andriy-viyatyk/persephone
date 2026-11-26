import { api } from "../../../../ipc/renderer/api";
import type { BoardEditorModel } from "../BoardEditorModel";
import type { BoardFrameSession } from "./BoardFrameSession";

/** Presents the board's owning page when one of its live frames raises a notification. */
export class BoardNotificationFocus {
    private readonly pageId: string | undefined;
    private readonly windowIndex: Promise<number>;
    private resolvedWindowIndex: number | undefined;

    constructor(private readonly model: BoardEditorModel, private readonly session: BoardFrameSession) {
        this.pageId = model.page?.id;
        this.windowIndex = api.getWindowIndex().then((index) => {
            this.resolvedWindowIndex = index;
            return index;
        });
    }

    show(generation: number, frame: HTMLIFrameElement): void {
        if (!this.isCurrent(generation, frame)) return;
        const windowIndex = this.resolvedWindowIndex;
        if (windowIndex !== undefined) {
            this.present(windowIndex, generation, frame);
            return;
        }
        void this.windowIndex.then((index) => this.present(index, generation, frame));
    }

    private present(windowIndex: number, generation: number, frame: HTMLIFrameElement): void {
        if (!this.isCurrent(generation, frame)) return;
        const pageId = this.pageId;
        if (!pageId) return;
        void api.showWindowPage(windowIndex, pageId);
        if (this.session.isMain) return;
        void this.model.target.switchTab(this.session.tabId).then((): void => {
            if (!this.isCurrent(generation, frame)) return;
        }, (): undefined => undefined);
    }

    private isCurrent(generation: number, frame: HTMLIFrameElement): boolean {
        return !!this.pageId
            && this.model.page?.id === this.pageId
            && this.session.isCurrent(generation, frame);
    }
}
