import type { ByteRange } from "../shared/range-utils";

export const BOARD_PIPE_READ_CHANNEL = "board-pipe:read" as const;
export const BOARD_PIPE_REPLY_CHANNEL = "board-pipe:reply" as const;

export type BoardPipeChannel =
    | typeof BOARD_PIPE_READ_CHANNEL
    | typeof BOARD_PIPE_REPLY_CHANNEL;

export interface BoardPipeReadRequest {
    requestId: string;
    pageId: string;
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
