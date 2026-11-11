import type { BoardFetchHead, BoardFetchInit, HostToBoardEvents } from "../../../ipc/board-bridge/frame-protocol";
import { errMessage } from "../../../shared/utils";
import { BoardGrant, type BoardNetworkPolicy } from "../../../shared/board/board-grant";
import type { IFetchOptions } from "../../api/types/app";
import { boardRegistry } from "../../api/boards/board-registry";
import { api } from "../../../ipc/renderer/api";

type FetchEventName = "fetch.chunk" | "fetch.error";
type FetchEmitter = <E extends FetchEventName>(name: E, payload: HostToBoardEvents[E], transfer?: Transferable[]) => boolean;
interface ActiveBoardFetch {
    readonly controller: AbortController;
    readonly frame: HTMLIFrameElement;
    readonly generation: number;
    readonly emit: FetchEmitter;
    reader?: ReadableStreamDefaultReader<Uint8Array>;
}
const INIT_KEYS = new Set(["method", "headers", "body", "timeout", "maxRedirects", "rejectUnauthorized", "tor", "proxy"]);

/** Owns the streaming fetch lifetime; envelope correlation stays in BoardFrameEndpoint. */
export class BoardFetchBridge {
    private readonly active = new Map<number, ActiveBoardFetch>();

    start(id: number, params: { url: string; init: BoardFetchInit }, boardRoot: string, frame: HTMLIFrameElement, generation: number, emit: FetchEmitter): Promise<BoardFetchHead> {
        const current: ActiveBoardFetch = { controller: new AbortController(), frame, generation, emit };
        this.active.set(id, current);
        return this.run(id, params, boardRoot, current);
    }

    private async run(id: number, params: { url: string; init: BoardFetchInit }, boardRoot: string, current: ActiveBoardFetch): Promise<BoardFetchHead> {
        try {
            if (typeof params.url !== "string") throw new TypeError("persephone.fetch() requires a URL string.");
            const init = this.validateInit(params.init);
            const grant = boardRegistry.grant(boardRoot) ?? BoardGrant.NONE;
            if (grant.networkMode() === false) throw BoardGrant.deny("network");
            const mcpUrl = await api.getBoardMcpEndpoint();
            const { nodeFetch } = await import("../../api/node-fetch");
            const response = await nodeFetch(params.url, {
                ...init,
                ...(init.body instanceof ArrayBuffer ? { body: new Blob([init.body]).stream() } : {}),
                signal: current.controller.signal,
                boardNetworkPolicy: grant.networkPolicy({ mcpUrl }),
            } as IFetchOptions & { boardNetworkPolicy: BoardNetworkPolicy });
            if (this.active.get(id) !== current) throw new Error("The board fetch was cancelled.");
            const hasBody = response.body !== null;
            const head: BoardFetchHead = { status: response.status, statusText: response.statusText, headers: [...response.headers.entries()], hasBody };
            if (!response.body) this.active.delete(id);
            else current.reader = response.body.getReader();
            return head;
        } catch (error: unknown) {
            if (this.active.get(id) === current) this.active.delete(id);
            throw error;
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

    async pull(id: number): Promise<void> {
        const current = this.active.get(id);
        if (!current?.reader) return;
        try {
            const { done, value } = await current.reader.read();
            if (this.active.get(id) !== current) return;
            if (done) {
                this.active.delete(id);
                current.emit("fetch.chunk", { id, done: true });
                return;
            }
            const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
            if (!current.emit("fetch.chunk", { id, chunk: buffer, done: false }, [buffer])) this.abort(id);
        } catch (error: unknown) {
            if (this.active.get(id) !== current) return;
            this.active.delete(id);
            current.emit("fetch.error", { id, message: errMessage(error) });
        }
    }

    abort(id: number): void {
        const current = this.active.get(id);
        if (!current) return;
        this.active.delete(id);
        current.controller.abort();
        void current.reader?.cancel().catch(() => {});
    }
    dispose(): void { for (const id of this.active.keys()) this.abort(id); }
}
