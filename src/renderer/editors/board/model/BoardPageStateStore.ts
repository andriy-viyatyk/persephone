import { validateBoardPageStateKey, validateBoardPageStateValue } from "../../../../shared/board/page-state-validation";
import { api } from "../../../../ipc/renderer/api";
import { KeyedSerialQueue } from "../../../../shared/serial-queue";
import { fs as appFs } from "../../../api/fs";

export interface BoardPageStateStoreOptions {
    readonly editorId: string;
    readonly boardRoot: () => string | undefined;
}

export class BoardPageStateStore {
    private readonly queues = new KeyedSerialQueue();
    private storageKeyPromise: Promise<string> | undefined;

    constructor(private readonly options: BoardPageStateStoreOptions) { }

    private getNamespace(): Promise<string> {
        if (this.storageKeyPromise) return this.storageKeyPromise;
        const boardRoot = this.options.boardRoot();
        if (!boardRoot) return Promise.reject(new Error("Board page state requires a board root."));
        const pending = api.getBoardStorageKey(boardRoot).then((boardKey) => {
            if (!/^[0-9a-f]{64}$/.test(boardKey)) {
                throw new Error("The host returned an invalid board storage key.");
            }
            return boardKey;
        });
        this.storageKeyPromise = pending;
        void pending.catch(() => {
            if (this.storageKeyPromise === pending) this.storageKeyPromise = undefined;
        });
        return pending;
    }

    private enqueue<T>(key: string, operation: (cacheName: string) => Promise<T>): Promise<T> {
        validateBoardPageStateKey(key);
        return this.getNamespace().then((boardKey) => {
            return this.queues.run(`${boardKey}:${key}`, () => operation(`board-state-${boardKey}-${key}`));
        });
    }

    get(key: string): Promise<string | undefined> {
        return this.enqueue(key, (cacheName) => appFs.getCacheFile(this.options.editorId, cacheName));
    }

    set(key: string, value: string): Promise<void> {
        validateBoardPageStateValue(value);
        return this.enqueue(key, (cacheName) => appFs.saveCacheFile(this.options.editorId, value, cacheName));
    }

    remove(key: string): Promise<void> {
        return this.enqueue(key, (cacheName) => appFs.deleteCacheFile(this.options.editorId, cacheName));
    }
}
