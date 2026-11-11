import { api } from "../../../../ipc/renderer/api";
import { isPlainLocalPath } from "../../../core/utils/file-path";
import type { BoardSourceContext } from "../../../../shared/board-source-context";
import { PERSEPHONE_BOARD_PREFIX } from "../../../content/persephone-board-link";

/** Most context-item paths granted per source hand-off (the source path counts toward it). */
export const MAX_SOURCE_GRANT_PATHS = 5000;

/** Grant the board read access to the plain local source path and the context items it was opened from. */
export async function grantBoardSourceReads(
    boardRoot: string, sourceUrl: string | undefined, context: BoardSourceContext | undefined,
): Promise<void> {
    const sourcePaths = sourceUrl && isPlainLocalPath(sourceUrl) ? [sourceUrl] : [];
    const contextPaths = (context?.items ?? []).map((item) => item.href).filter(isPlainLocalPath)
        .slice(0, Math.max(0, MAX_SOURCE_GRANT_PATHS - sourcePaths.length));
    if (sourcePaths.length || contextPaths.length) {
        await api.grantBoardSourceReads(boardRoot, sourcePaths, contextPaths);
    }
}

export interface BoardPendingSource {
    readonly sourceUrl: string;
    readonly privateSession: boolean;
    readonly context?: BoardSourceContext;
}

export interface BoardSourceInboxOptions {
    readonly getSource: () => { url?: string; filePath?: string };
    readonly blockRestore: () => void;
}

export class BoardSourceInbox {
    private readonly pending: BoardPendingSource[] = [];
    private readonly sessionHandles = new Map<string, string>();
    private readonly sessionHandleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly sessionBoundSources = new Set<string>();
    private readonly listeners = new Set<() => void>();
    private initialPrivateSession = false;
    private restoreBlocked = false;

    constructor(private readonly options: BoardSourceInboxOptions) { }

    restore(blocked: boolean): void {
        this.restoreBlocked = blocked;
    }

    currentSourceUrl(): string | undefined {
        if (this.restoreBlocked) return undefined;
        const source = this.options.getSource();
        const url = source.url ?? source.filePath;
        if (url?.startsWith(PERSEPHONE_BOARD_PREFIX)) return undefined;
        return url;
    }

    registerSession(sourceUrl: string, sessionHandle?: string): void {
        if (!sourceUrl || !sessionHandle) return;
        const previousTimer = this.sessionHandleTimers.get(sourceUrl);
        if (previousTimer) clearTimeout(previousTimer);
        this.sessionHandles.set(sourceUrl, sessionHandle);
        this.sessionBoundSources.add(sourceUrl);
        if (sourceUrl === this.currentSourceUrl()) this.initialPrivateSession = true;
        this.options.blockRestore();
        const timer = setTimeout(() => {
            if (this.sessionHandles.get(sourceUrl) !== sessionHandle) return;
            this.sessionHandles.delete(sourceUrl);
            this.sessionHandleTimers.delete(sourceUrl);
        }, 5 * 60 * 1000);
        this.sessionHandleTimers.set(sourceUrl, timer);
    }

    enqueue(sourceUrl: string, sessionHandle?: string, context?: BoardSourceContext): void {
        if (!sourceUrl) return;
        this.registerSession(sourceUrl, sessionHandle);
        this.pending.push({ sourceUrl, privateSession: Boolean(sessionHandle), context });
        for (const listener of this.listeners) listener();
    }

    onPending(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    peek(): BoardPendingSource | undefined {
        return this.pending[0];
    }

    consume(): void {
        this.pending.shift();
    }

    isInitialPrivateSession(): boolean {
        const sourceUrl = this.currentSourceUrl();
        return this.initialPrivateSession
            || (sourceUrl !== undefined && this.sessionBoundSources.has(sourceUrl));
    }

    sessionHandleFor(sourceUrl: string): string | undefined {
        const handle = this.sessionHandles.get(sourceUrl);
        if (!handle && this.sessionBoundSources.has(sourceUrl)) {
            throw new Error("The private session for this source has expired. Open the link again from its page.");
        }
        return handle;
    }

    consumeSessionHandle(sourceUrl: string, expected: string): void {
        if (this.sessionHandles.get(sourceUrl) !== expected) return;
        this.sessionHandles.delete(sourceUrl);
        const timer = this.sessionHandleTimers.get(sourceUrl);
        if (timer) clearTimeout(timer);
        this.sessionHandleTimers.delete(sourceUrl);
    }

    dispose(): void {
        this.pending.length = 0;
        for (const timer of this.sessionHandleTimers.values()) clearTimeout(timer);
        this.sessionHandles.clear();
        this.sessionHandleTimers.clear();
        this.sessionBoundSources.clear();
        this.listeners.clear();
    }
}
