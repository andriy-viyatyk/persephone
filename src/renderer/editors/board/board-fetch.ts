import type {
    BoardFetchErrorMsg,
    BoardFetchHeadMsg,
    BoardFetchInit,
    BoardFetchRequestMsg,
    BoardFetchChunkMsg,
} from "../../../ipc/board-bridge-channels";
import { errMessage } from "../../../shared/utils";
import type { IFetchOptions } from "../../api/types/app";

interface ActiveBoardFetch {
    controller: AbortController;
    frame: HTMLIFrameElement;
    generation: number;
    post: (frame: HTMLIFrameElement, generation: number, message: BoardFetchHeadMsg | BoardFetchChunkMsg | BoardFetchErrorMsg,
        transfer?: Transferable[]) => boolean;
    reader?: ReadableStreamDefaultReader<Uint8Array>;
}

const INIT_KEYS = new Set([
    "method", "headers", "body", "timeout", "maxRedirects", "rejectUnauthorized", "tor", "proxy",
]);

export class BoardFetchBridge {
    private readonly active = new Map<number, ActiveBoardFetch>();

    start(
        message: BoardFetchRequestMsg,
        frame: HTMLIFrameElement,
        generation: number,
        post: ActiveBoardFetch["post"],
    ): void {
        const current: ActiveBoardFetch = { controller: new AbortController(), frame, generation, post };
        this.active.set(message.reqId, current);
        void this.run(message, current);
    }

    private async run(message: BoardFetchRequestMsg, current: ActiveBoardFetch): Promise<void> {
        try {
            if (typeof message.url !== "string") throw new TypeError("persephone.fetch() requires a URL string.");
            const init = this.validateInit(message.init);
            const { nodeFetch } = await import("../../api/node-fetch");
            const response = await nodeFetch(message.url, {
                ...init,
                ...(init.body instanceof ArrayBuffer ? { body: new Blob([init.body]).stream() } : {}),
                signal: current.controller.signal,
            } as IFetchOptions);
            if (this.active.get(message.reqId) !== current) return;
            const hasBody = response.body !== null;
            const head: BoardFetchHeadMsg = {
                __persephone: "fetch:head",
                reqId: message.reqId,
                status: response.status,
                statusText: response.statusText,
                headers: [...response.headers.entries()],
                hasBody,
            };
            if (!current.post(current.frame, current.generation, head)) { this.abort(message.reqId); return; }
            if (!response.body) { this.active.delete(message.reqId); return; }
            current.reader = response.body.getReader();
        } catch (error: unknown) {
            if (this.active.get(message.reqId) !== current) return;
            this.active.delete(message.reqId);
            current.post(current.frame, current.generation, {
                __persephone: "fetch:error", reqId: message.reqId, error: errMessage(error),
            });
        }
    }

    private validateInit(value: BoardFetchInit): BoardFetchInit {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("persephone.fetch() init must be an object.");
        for (const [key, entry] of Object.entries(value)) {
            if (!INIT_KEYS.has(key)) throw new TypeError(`persephone.fetch() does not support init.${key}.`);
            if (key === "tor" && typeof entry !== "boolean") throw new TypeError("persephone.fetch() init.tor must be a boolean.");
            if (key === "proxy" && typeof entry !== "string") throw new TypeError("persephone.fetch() init.proxy must be a string.");
        }
        if (value.headers !== undefined && (!value.headers || typeof value.headers !== "object" || Array.isArray(value.headers)
            || Object.values(value.headers).some((header) => typeof header !== "string"))) {
            throw new TypeError("persephone.fetch() init.headers must be a string record.");
        }
        if (value.body !== undefined && typeof value.body !== "string" && !(value.body instanceof ArrayBuffer)) {
            throw new TypeError("persephone.fetch() init.body must be a string or ArrayBuffer.");
        }
        return value;
    }

    async pull(reqId: number): Promise<void> {
        const current = this.active.get(reqId);
        if (!current?.reader) return;
        try {
            const { done, value } = await current.reader.read();
            if (this.active.get(reqId) !== current) return;
            if (done) {
                this.active.delete(reqId);
                current.post(current.frame, current.generation, { __persephone: "fetch:chunk", reqId, done: true });
                return;
            }
            const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
            const message: BoardFetchChunkMsg = { __persephone: "fetch:chunk", reqId, chunk: buffer, done: false };
            if (!current.post(current.frame, current.generation, message, [buffer])) this.abort(reqId);
        } catch (error: unknown) {
            if (this.active.get(reqId) !== current) return;
            this.active.delete(reqId);
            current.post(current.frame, current.generation, { __persephone: "fetch:error", reqId, error: errMessage(error) });
        }
    }

    abort(reqId: number): void {
        const current = this.active.get(reqId);
        if (!current) return;
        this.active.delete(reqId);
        current.controller.abort();
        void current.reader?.cancel().catch(() => {});
    }

    dispose(): void {
        for (const reqId of this.active.keys()) this.abort(reqId);
    }
}
