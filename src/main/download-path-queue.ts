/** Downloads of one page that may be queued for their Save dialog (the open one included); more are cancelled. */
const MAX_QUEUED_PER_PAGE = 3;

interface PageQueue {
    tail: Promise<void>;
    queued: number;
}

/**
 * Save dialogs of browser downloads, one at a time per initiating page (`webContents` id): a page's
 * downloads wait for the previous dialog to close, so a download loop cannot stack native dialogs.
 */
export class SavePathQueue {
    private readonly pages = new Map<number, PageQueue>();

    hasRoom(pageId: number): boolean {
        return (this.pages.get(pageId)?.queued ?? 0) < MAX_QUEUED_PER_PAGE;
    }

    enqueue(pageId: number, ask: () => Promise<void>): void {
        const queue = this.pages.get(pageId) ?? { tail: Promise.resolve(), queued: 0 };
        queue.queued++;
        this.pages.set(pageId, queue);
        queue.tail = queue.tail.then(ask).catch((): void => undefined).finally(() => {
            queue.queued--;
            if (queue.queued === 0 && this.pages.get(pageId) === queue) this.pages.delete(pageId);
        });
    }
}
