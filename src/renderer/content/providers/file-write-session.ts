import type { IProviderWrite } from "../../api/types/io.provider";
import { fpBasename, fpDirname, fpJoin } from "../../core/utils/file-path";
import { MAX_BOARD_PIPE_CHUNK_BYTES } from "../../../shared/board-pipe-constants";

const nodefs = require("fs");
const { randomUUID } = require("crypto") as typeof import("crypto");

/** A sibling staging file keeps the old destination intact until rename succeeds. */
export async function createFileWriteSession(
    target: string,
    signal: AbortSignal | undefined,
    onSettled: (session: IProviderWrite) => void,
): Promise<IProviderWrite> {
    if (signal?.aborted) throw new Error("Provider write was cancelled.");
    const temporary = fpJoin(fpDirname(target), `.${fpBasename(target)}.persephone-write-${randomUUID()}.tmp`);
    const handle = await nodefs.promises.open(temporary, "wx");
    const session = new FileWriteSession(target, temporary, handle, signal, onSettled);
    if (signal?.aborted) await session.abort();
    if (signal?.aborted) throw new Error("Provider write was cancelled.");
    return session;
}

class FileWriteSession implements IProviderWrite {
    private state: "open" | "committed" | "aborted" = "open";
    private busy = false;
    private position = 0;
    private abortPromise?: Promise<void>;
    private readonly onSignalAbort: () => void;

    constructor(
        private readonly target: string,
        private readonly temporary: string,
        private readonly handle: { write(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>; close(): Promise<void> },
        private readonly signal: AbortSignal | undefined,
        private readonly onSettled: (session: IProviderWrite) => void,
    ) {
        this.onSignalAbort = () => { void this.abort().catch((): undefined => undefined); };
        signal?.addEventListener("abort", this.onSignalAbort, { once: true });
    }

    async write(chunk: Buffer): Promise<void> {
        this.assertOperation("write");
        if (!Buffer.isBuffer(chunk) || chunk.byteLength > MAX_BOARD_PIPE_CHUNK_BYTES) {
            throw new Error("Provider write chunk must be a Buffer of at most 1 MiB.");
        }
        this.busy = true;
        try {
            this.assertOpen();
            let offset = 0;
            while (offset < chunk.byteLength) {
                this.assertOpen();
                const result = await this.handle.write(chunk, offset, chunk.byteLength - offset, this.position);
                if (result.bytesWritten <= 0) throw new Error("Provider write made no progress.");
                offset += result.bytesWritten;
                this.position += result.bytesWritten;
            }
        } catch (error: unknown) {
            this.busy = false;
            await this.abort();
            throw error;
        } finally {
            this.busy = false;
        }
    }

    async commit(): Promise<void> {
        this.assertOperation("commit");
        this.busy = true;
        try {
            this.assertOpen();
            await this.handle.close();
            this.assertOpen();
            await nodefs.promises.rename(this.temporary, this.target);
            this.state = "committed";
            this.finish();
        } catch (error: unknown) {
            await this.cleanup();
            throw error;
        } finally {
            this.busy = false;
        }
    }

    abort(): Promise<void> {
        if (this.state !== "open") return this.abortPromise ?? Promise.resolve();
        if (this.busy) {
            if (!this.abortPromise) {
                this.abortPromise = Promise.resolve().then(async () => {
                    while (this.busy) await new Promise<void>(resolve => setTimeout(resolve, 0));
                    if (this.state === "open") await this.cleanup();
                });
            }
            return this.abortPromise;
        }
        this.abortPromise = this.cleanup();
        return this.abortPromise;
    }

    private assertOperation(name: string): void {
        if (this.busy) throw new Error(`Concurrent provider write ${name} is not allowed.`);
        this.assertOpen();
    }

    private assertOpen(): void {
        if (this.signal?.aborted) throw new Error("Provider write was cancelled.");
        if (this.state !== "open") throw new Error("Provider write session has terminated.");
    }

    private async cleanup(): Promise<void> {
        if (this.state !== "open") return;
        this.state = "aborted";
        try { await this.handle.close(); } catch { /* A failed write may already close it. */ }
        await nodefs.promises.unlink(this.temporary).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
        this.finish();
    }

    private finish(): void {
        this.signal?.removeEventListener("abort", this.onSignalAbort);
        this.onSettled(this);
    }
}
