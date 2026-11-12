import type { PageDescriptor } from "../../../shared/persistence";
import { fs } from "../fs";

export class RecoveryPlaceholder {
    private retryPromise?: Promise<void>;
    private invalidated = false;
    private closeAuthorized = false;
    private protectionOwned = true;

    constructor(readonly descriptor: PageDescriptor) {}

    get isInvalidated(): boolean { return this.invalidated; }

    trackRetry(promise: Promise<void>): void { this.retryPromise = promise; }

    clearRetry(promise?: Promise<void>): void {
        if (promise !== undefined && this.retryPromise !== promise) return;
        this.retryPromise = undefined;
    }

    async cancel(): Promise<void> {
        this.invalidated = true;
        await this.retryPromise;
    }

    async authorizeClose(confirm: () => Promise<boolean>): Promise<boolean> {
        if (this.invalidated) return false;
        this.invalidated = true;
        if (!(await confirm())) {
            this.invalidated = false;
            return false;
        }
        await this.retryPromise;
        this.closeAuthorized = true;
        return true;
    }

    releaseCacheProtection(): void {
        if (!this.protectionOwned) return;
        this.protectionOwned = false;
        fs.releaseCacheIds(this.descriptor.editors.map((editor) => editor.id));
    }

    async disposeAfterClose(): Promise<void> {
        if (!this.closeAuthorized) return;
        const ids = [...new Set(this.descriptor.editors.map((editor) => editor.id).filter(Boolean))];
        this.releaseCacheProtection();
        for (const id of ids) {
            await fs.deleteCacheFiles(id);
            if (!fs.isCacheIdProtected(id)) await fs.removeDir(fs.resolveCachePath(id), true);
        }
    }
}
