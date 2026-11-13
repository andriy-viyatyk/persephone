import type { WebContents, WebFrameMain } from "electron";

type GrantTarget = number | WebContents;

interface GrantRecord {
    expiresAt: number;
    target?: WebContents;
    frame?: WebFrameMain;
    onDestroyed?: () => void;
}

export interface OneShotFrameGrantOptions {
    ttlMs: number;
    cleanupDelayMs: number;
    bindFrame: boolean;
    platform?: NodeJS.Platform;
    resolveTarget?: (id: number) => WebContents | undefined;
    validateTarget?: (target: WebContents) => boolean;
    listenForDestroyed?: boolean;
    clearExpiredHas?: boolean;
    clearBeforePlatformCheck?: boolean;
    clearBeforeTargetResolution?: boolean;
    validateBeforeClear?: boolean;
}

/** Owns the expiry, optional frame binding, and destruction cleanup for one media grant kind. */
export class OneShotFrameGrant {
    private readonly grants = new Map<number, GrantRecord>();

    constructor(private readonly options: OneShotFrameGrantOptions) {}

    arm(target: GrantTarget): void {
        const id = typeof target === "number" ? target : target.id;
        if (this.options.clearBeforePlatformCheck) this.clear(id);
        if (this.options.platform && process.platform !== this.options.platform) return;
        if (this.options.clearBeforeTargetResolution) this.clear(id);

        const contents = typeof target === "number" ? this.options.resolveTarget?.(target) : target;
        if (this.options.validateBeforeClear && contents && (
            (this.options.validateTarget !== undefined && !this.options.validateTarget(contents))
            || (this.options.bindFrame && contents.isDestroyed())
        )) return;
        this.clear(id);
        if (this.options.bindFrame && (!contents || contents.isDestroyed())) return;
        if (contents && this.options.validateTarget && !this.options.validateTarget(contents)) return;

        const expiresAt = Date.now() + this.options.ttlMs;
        const record: GrantRecord = { expiresAt };
        if (contents && (this.options.bindFrame || this.options.listenForDestroyed)) {
            record.target = contents;
            if (this.options.bindFrame) record.frame = contents.mainFrame;
            if (this.options.listenForDestroyed) {
                record.onDestroyed = () => this.clear(id);
                contents.once("destroyed", record.onDestroyed);
            }
        }
        this.grants.set(id, record);
        setTimeout(() => {
            if ((this.grants.get(id)?.expiresAt ?? 0) <= Date.now()) this.clear(id);
        }, this.options.cleanupDelayMs);
    }

    has(target: GrantTarget, frame?: WebFrameMain): boolean {
        const id = typeof target === "number" ? target : target.id;
        const grant = this.grants.get(id);
        const expired = !grant || grant.expiresAt <= Date.now();
        const invalidTarget = !!grant?.target && (
            grant.target.isDestroyed()
            || (this.options.validateTarget !== undefined && !this.options.validateTarget(grant.target))
            || (this.options.bindFrame && grant.target.mainFrame !== grant.frame)
        );
        const invalidFrame = !!grant?.frame && !!frame && grant.frame !== frame;
        if (expired || invalidTarget || invalidFrame) {
            if (grant && expired && this.options.clearExpiredHas === false) return false;
            else this.clear(id);
            return false;
        }
        return true;
    }

    consume(frame: WebFrameMain | null): boolean {
        if (!frame) return false;
        for (const [id, grant] of this.grants) {
            if (grant.frame === frame && this.has(id, frame)) {
                this.clear(id);
                return true;
            }
        }
        return false;
    }

    clear(target?: GrantTarget): void {
        const ids = target === undefined
            ? Array.from(this.grants.keys())
            : [typeof target === "number" ? target : target.id];
        for (const id of ids) {
            const grant = this.grants.get(id);
            if (!grant) continue;
            this.grants.delete(id);
            if (grant.target && grant.onDestroyed) grant.target.removeListener("destroyed", grant.onDestroyed);
        }
    }
}
