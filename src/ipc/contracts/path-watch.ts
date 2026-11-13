import type { TimeoutExemptions } from "../timeout-exemptions";
import type { EventObject } from "./event-object";

export interface PathWatchApi {
    subscribePathWatch: (request: PathWatchSubscribeRequest) => Promise<void>;
    unsubscribePathWatch: (request: PathWatchUnsubscribeRequest) => Promise<void>;
    beginPathMove: (request: BeginPathMoveRequest) => Promise<string>;
    completePathMove: (request: CompletePathMoveRequest) => Promise<void>;
}

export interface PathWatchEvents {
    ePathWatchBatch: EventObject<PathWatchEvent>;
}

export type PathWatchChange =
    | { path: string; type: "created" | "changed" | "deleted" }
    | { path: string; type: "moved"; to: string };

export interface PathWatchBatch {
    changes: PathWatchChange[];
    rescan?: true;
    ended?: "removed" | "error" | "revoked";
}

export type PathWatchOwner =
    | { kind: "window"; windowIndex: number }
    | { kind: "board"; boardRoot: string; boardName: string };

export interface PathWatchSubscribeRequest {
    clientId: string;
    path: string;
    recursive: boolean;
    debounceMs: number;
    label: string;
}

export interface PathWatchUnsubscribeRequest {
    clientId: string;
}

export interface BeginPathMoveRequest { from: string; to: string }

export interface CompletePathMoveRequest { moveId: string; succeeded: boolean }

export interface PathWatchEvent {
    clientId: string;
    batch: PathWatchBatch;
}


export const pathWatchTimeoutExemptions = {
    beginPathMove: "Canonicalization and stats can wait on a slow volume.",
} satisfies TimeoutExemptions<PathWatchApi>;
