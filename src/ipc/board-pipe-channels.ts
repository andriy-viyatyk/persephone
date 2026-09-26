import type { ByteRange } from "../shared/range-utils";

export const BOARD_PIPE_READ_CHANNEL = "board-pipe:read" as const;
export const BOARD_PIPE_REPLY_CHANNEL = "board-pipe:reply" as const;
/** Main → renderer only, no reply expected. Sent when an HTTP client (e.g. a `<video>` seeking)
 *  abandons the request that originated a chunk read, so the renderer can abort the one matching
 *  pending read without touching the rest of the page (US-1518 section 7a). */
export const BOARD_PIPE_CANCEL_CHANNEL = "board-pipe:cancel" as const;

export type BoardPipeChannel =
    | typeof BOARD_PIPE_READ_CHANNEL
    | typeof BOARD_PIPE_REPLY_CHANNEL
    | typeof BOARD_PIPE_CANCEL_CHANNEL;

export type BoardPipeKind = "page" | "resource";

export interface BoardPipeReadRequest {
    requestId: string;
    pipeKind: BoardPipeKind;
    pipeId: string;
    /** Present only on the first request for a protocol response. */
    rangeHeader?: string;
    /** Present on continuation requests after the first bounded reply. */
    range?: ByteRange;
}

export interface BoardPipeReadSuccess {
    requestId: string;
    ok: true;
    totalSize: number;
    range: ByteRange | null;
    data: Uint8Array;
    contentType: string;
}

export interface BoardPipeReadFailure {
    requestId: string;
    ok: false;
    status: 503;
    error: string;
}

export type BoardPipeReadReply = BoardPipeReadSuccess | BoardPipeReadFailure;

export interface BoardPipeCancelMessage {
    requestId: string;
}
