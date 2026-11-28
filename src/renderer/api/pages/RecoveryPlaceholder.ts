import type { PageDescriptor } from "../../../shared/persistence";
import { fs } from "../fs";

export class RecoveryPlaceholder {
    private retryPromise?: Promise<void>;
    private invalidated = false;
    private closeAuthorized = false;
    private protectionOwned = true;
    private cleanupRequested = false;
    private cleanupStarted = false;
    onInvalidated?: () => void;
    onCloseCancelled?: () => void;

    constructor(readonly descriptor: PageDescriptor) {}

    get isInvalidated(): boolean { return this.invalidated; }

    trackRetry(promise: Promise<void>): void { this.retryPromise = promise; }

    clearRetry(promise?: Promise<void>): void {
        if (promise !== undefined && this.retryPromise !== promise) return;
        this.retryPromise = undefined;
    }

    async cancel(): Promise<void> {
        this.invalidated = true;
        this.onInvalidated?.();
        // A restore may be waiting for a user prompt. Closing a page must not wait for it.
        this.scheduleCleanupAfterRetry();
    }

    async authorizeClose(confirm: () => Promise<boolean>): Promise<boolean> {
        if (this.invalidated) return false;
        this.invalidated = true;
        if (!(await confirm())) {
            this.invalidated = false;
            const retry = this.retryPromise;
            if (retry) void retry.then(() => this.onCloseCancelled?.(), () => this.onCloseCancelled?.());
            else this.onCloseCancelled?.();
            return false;
        }
        this.closeAuthorized = true;
        this.onInvalidated?.();
        this.scheduleCleanupAfterRetry();
        return true;
    }

    releaseCacheProtection(): void {
        if (!this.protectionOwned) return;
        this.protectionOwned = false;
        fs.releaseCacheIds(this.descriptor.editors.map((editor) => editor.id));
    }

    async disposeAfterClose(): Promise<void> {
        if (!this.closeAuthorized) return;
        if (this.retryPromise) {
            this.cleanupRequested = true;
            return;
        }
        await this.cleanupAfterClose();
    }

    private scheduleCleanupAfterRetry(): void {
        const retry = this.retryPromise;
        if (!retry || !this.closeAuthorized) return;
        this.cleanupRequested = true;
        void retry.then(
            () => { if (this.cleanupRequested) void this.cleanupAfterClose(); },
            () => { if (this.cleanupRequested) void this.cleanupAfterClose(); },
        );
    }

    private async cleanupAfterClose(): Promise<void> {
        if (!this.closeAuthorized || this.cleanupStarted) return;
        this.cleanupStarted = true;
        this.cleanupRequested = false;
        const ids = [...new Set(this.descriptor.editors.map((editor) => editor.id).filter(Boolean))];
        this.releaseCacheProtection();
        for (const id of ids) {
            await fs.deleteCacheFiles(id);
            if (!fs.isCacheIdProtected(id)) await fs.removeDir(fs.resolveCachePath(id), true);
        }
    }
}
