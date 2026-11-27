import { MAX_OPEN_PROVIDER_WRITES } from "../shared/board-pipe-constants";
import type { RendererLease } from "./renderer-lease";

export interface ProviderWriteImplementation {
    writeBegin(config: Record<string, unknown>, context: { signal: AbortSignal }): Promise<unknown> | unknown;
    writeChunk(handle: unknown, data: Uint8Array, context: { signal: AbortSignal }): Promise<unknown> | unknown;
    writeCommit(handle: unknown, context: { signal: AbortSignal }): Promise<unknown> | unknown;
    writeAbort(handle: unknown): Promise<unknown> | unknown;
}

interface Session {
    readonly id: string;
    readonly lease: RendererLease;
    readonly type: string;
    readonly config: Record<string, unknown>;
    readonly implementation: ProviderWriteImplementation;
    state: "starting" | "open" | "busy" | "aborting" | "committed" | "aborted";
    handle?: unknown;
    hasHandle: boolean;
    operation?: Promise<void>;
    cleanup?: Promise<void>;
}

function isAborting(session: Session): boolean {
    return session.state === "aborting";
}

/** Owns provider write IDs, cross-lease access checks, and serialized cleanup. */
export class ProviderWriteSessions {
    private readonly sessions = new Map<string, Session>();

    async begin(
        lease: RendererLease,
        id: string,
        type: string,
        config: Record<string, unknown>,
        implementation: ProviderWriteImplementation,
        signal: AbortSignal,
    ): Promise<void> {
        if (this.sessions.size >= MAX_OPEN_PROVIDER_WRITES) throw new Error("Provider write service is busy (16 open sessions).");
        if (this.sessions.has(id)) throw new Error("Duplicate provider write ID.");
        const session: Session = { id, lease, type, config, implementation, state: "starting", hasHandle: false };
        this.sessions.set(id, session);
        const onAbort = (): void => { void this.abortSession(session).catch((): undefined => undefined); };
        signal.addEventListener("abort", onAbort, { once: true });
        try {
            const handle = await implementation.writeBegin(config, { signal });
            session.handle = handle;
            session.hasHandle = true;
            if (session.state === "aborting" || signal.aborted) {
                await this.abortSession(session);
                throw new Error("Provider write begin was cancelled.");
            }
            session.state = "open";
        } catch (error: unknown) {
            if (session.hasHandle) await this.abortSession(session);
            else this.sessions.delete(id);
            throw error;
        } finally {
            signal.removeEventListener("abort", onAbort);
        }
    }

    async chunk(lease: RendererLease, id: string, type: string, data: Uint8Array, signal: AbortSignal): Promise<void> {
        const session = this.require(lease, id, type);
        await this.run(session, signal, () => session.implementation.writeChunk(session.handle, data, { signal }));
    }

    async commit(lease: RendererLease, id: string, type: string, signal: AbortSignal): Promise<void> {
        const session = this.require(lease, id, type);
        try {
            await this.run(session, signal, () => session.implementation.writeCommit(session.handle, { signal }));
            if (session.state === "aborting" || signal.aborted) {
                await this.abortSession(session);
                throw new Error("Provider write commit was cancelled.");
            }
            session.state = "committed";
            this.sessions.delete(id);
        } catch (error: unknown) {
            await this.abortSession(session);
            throw error;
        }
    }

    async abort(lease: RendererLease, id: string, type?: string): Promise<void> {
        const session = this.sessions.get(id);
        if (!session) throw new Error("Unknown provider write ID.");
        if (session.lease !== lease || (type !== undefined && session.type !== type)) throw new Error("Unknown provider write ID.");
        await this.abortSession(session);
    }

    async closeLease(lease: RendererLease): Promise<void> {
        const owned = [...this.sessions.values()].filter(session => session.lease === lease);
        await Promise.all(owned.map(session => this.abortSession(session)));
    }

    private require(lease: RendererLease, id: string, type: string): Session {
        const session = this.sessions.get(id);
        if (!session || session.lease !== lease || session.type !== type || session.state !== "open") {
            throw new Error("Unknown, busy, or terminated provider write ID.");
        }
        return session;
    }

    private async run(session: Session, signal: AbortSignal, operation: () => Promise<unknown> | unknown): Promise<void> {
        if (session.state !== "open") throw new Error("Provider write session is not open.");
        session.state = "busy";
        const onAbort = (): void => {
            session.state = "aborting";
        };
        signal.addEventListener("abort", onAbort, { once: true });
        const running = Promise.resolve().then(operation).then((): undefined => undefined);
        session.operation = running;
        try {
            await running;
            if (session.state === "busy") session.state = "open";
        } catch (error: unknown) {
            session.state = "aborting";
            await this.abortSession(session).catch((): undefined => undefined);
            throw error;
        } finally {
            signal.removeEventListener("abort", onAbort);
            session.operation = undefined;
        }
        if (signal.aborted || isAborting(session)) await this.abortSession(session);
    }

    private abortSession(session: Session): Promise<void> {
        if (session.state === "committed" || session.state === "aborted") return Promise.resolve();
        session.state = "aborting";
        if (session.cleanup) return session.cleanup;
        session.cleanup = Promise.resolve().then(async () => {
            if (session.operation) await session.operation.catch((): undefined => undefined);
            if (!session.hasHandle) {
                session.cleanup = undefined;
                return;
            }
            try {
                await session.implementation.writeAbort(session.handle);
            } finally {
                session.state = "aborted";
                this.sessions.delete(session.id);
            }
        });
        return session.cleanup;
    }
}
