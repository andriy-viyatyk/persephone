/**
 * Board bridge port wire types ??? the `persephone` integration tier carried over the
 * per-board `MessagePort`, transferred through a `MessageChannelMain` port.
 *
 * A board has no `ipcRenderer` and no preload ??? its only channel to the privileged
 * side is a `MessagePort` minted per board in main. The board???main protocol is the
 * {@link BoardToMain} / {@link MainToBoard} envelope union below; `execute()` rides
 * the same port as `{ kind: "runner", ??? }` envelopes wrapping the existing
 * `runner-channels.ts` messages.
 *
 * Like `runner-channels.ts`, this module is intentionally dependency-free from
 * `src/main` and `src/renderer`, so the injected board shim
 * (`src/board-shim.ts`, a plain browser script) can import its types. Runner message
 * shapes come from `runner-channels.ts`.
 */
import type { CapabilityJson } from "../../shared/capability-contract";
import type {
    CapabilityClientInvoke,
    CapabilityClientOptions,
    CapabilityClientResult,
    CapabilityProvider,
} from "../capability-bus-channels";
import type {
    RunnerChannel,
    RunnerChunkMsg,
    RunnerErrorMsg,
    RunnerExitMsg,
    RunnerJobMsg,
    RunnerKillMsg,
    RunnerStartMsg,
    RunnerStdinMsg,
} from "../runner-channels";
import type { PathWatchBatch } from "../api-types";
import type { BoardThemePalette } from "./boot";
import type { WireError } from "../../shared/wire-error";



export type BoardNotifyType = "info" | "success" | "warning" | "error";

export interface BoardNotifyMsg {
    message: string;
    type?: BoardNotifyType;
    /** Keep the toast until the user closes it (bridge 1.33.0). */
    persistent?: boolean;
}

export interface BoardOpenRawLinkMsg {
    href: string;
    /** Optional registered editor id to open the file with (e.g. "md-view").
     *  Falls back to the default editor when omitted or when the editor doesn't
     *  accept the file. */
    editor?: string;
}

/** Encoding for the board file bridge. "utf8" returns/accepts a plain
 *  string; "base64" returns/accepts base64; "binary" returns/accepts the bytes
 *  "binary" returns and accepts the bytes as a `Uint8Array`, avoiding base64 conversion overhead.
 *
 *  Prefer "binary" for binary files. "base64" costs an encode in main, a ~33% larger
 *  payload over the port, and an `atob` + per-byte decode in the board (measured: 65 ms
 *  of pure conversion on a 20 MB file, and ~3x the transient memory), and it cannot
 *  carry a file over ~400 MB at all, because base64 of one exceeds V8's max string
 *  length. It remains the right choice only when the board actually wants base64 text
 *  (a `data:` URI, say). */
export type BoardFileEncoding = "utf8" | "base64" | "binary";

export interface BoardReadFileMsg {
    /** Absolute, or relative to the board root. */
    path: string;
    encoding?: BoardFileEncoding;
}

export type BoardWatchOptions = { recursive?: boolean; debounceMs?: number };

export interface BoardWriteFileMsg {
    /** Absolute, or relative to the board root. */
    path: string;
    /** File contents — a plain string ("utf8"), base64 ("base64"), or bytes ("binary"). */
    data: string | Uint8Array;
    encoding?: BoardFileEncoding;
}

// ── Port RPC envelopes ────────────────────────────────────
// board ↔ main over the per-board MessagePort. Request/reply uses an `id`; fire-
// and-forget effects carry no id; `execute()` wraps runner-channels messages in a
// `runner` envelope (board→main: start/stdin/end-stdin/kill; main→board: stdout/
// stderr/exit/error). Theme is pushed main→board for live retint.

/** Request/reply methods (board → main, awaited by the shim). */
export type BoardRpcMethod =
    | "openRawLink"
    | "openBoard"
    | "openFileDialog"
    | "saveFileDialog"
    | "openFolderDialog"
    | "listFolder"
    | "rememberFolder"
    | "rememberFile"
    | "getFileAccess"
    | "readFile"
    | "writeFile"
    | "trashFile"
    | "registerTypeScriptProject"
    | "unregisterTypeScriptProject"
    | "watch"
    | "unwatch"
    | "getJobs"
    | "serviceRequest"
    | "serviceOpenChannel"
    | "servicesList"
    | "servicesConnect"
    | "capabilityList" | "capabilityProviders" | "capabilityGet" | "capabilityInvoke" | "capabilityCancel"
    | "serviceStatus"
    | "serviceStop"
    | "storageGet"
    | "storageSet"
    | "storageDelete"
    | "storageKeys"
    | "clipboardWriteImage"
    | "clipboardWriteText";

export interface BoardCapabilityRpc {
    capabilityList: { args: []; result: CapabilityClientResult<CapabilityProvider[]> };
    capabilityProviders: { args: [id: string]; result: CapabilityClientResult<CapabilityProvider[]> };
    capabilityGet: { args: [id: string, options?: CapabilityClientOptions]; result: CapabilityClientResult<CapabilityProvider | null> };
    capabilityInvoke: { args: [request: CapabilityClientInvoke]; result: CapabilityClientResult<CapabilityJson | { channelId: string }> };
    capabilityCancel: { args: [requestId: string]; result: CapabilityClientResult<void> };
}

export interface BoardFolderListOptions { recursive?: boolean; masks?: string[]; limit?: number; cursor?: string }
export interface BoardServiceProvider { provider: string; title: string; version: number; boardName: string }
export interface BoardServiceProviderSelector { provider: string; version: number }
export interface BoardFolderEntry { name: string; path: string; isDirectory: boolean; size: number; mtime: number }
export interface BoardFolderPage { entries: BoardFolderEntry[]; nextCursor?: string; truncated: boolean }
export interface BoardFileAccess { read: boolean; write: boolean }

/** JSON values accepted by the board-owned storage API. Runtime validation also rejects
 * non-finite numbers, cyclic values, class instances, oversized documents, and deep values. */
export type BoardJsonValue = null | string | boolean | number
    | BoardJsonValue[] | { [key: string]: BoardJsonValue };

/** A live job owned by this board — the `getJobs` RPC result element.
 *  Plain data over the port; the shim wraps each in a control handle
 *  (`kill`/`write`/`endStdin` posting the usual runner messages by `jobId`). */
export interface BoardJobInfo {
    jobId: string;
    command: string;
    /** The caller-chosen name from `execute(cmd, { name })`, if any. */
    name?: string;
}

/** Fire-and-forget methods (board → main, no reply). */
export type BoardFireMethod = "notify";

/** Options for the user-visible page navigation request. */
export interface BoardOpenRawLinkOptions {
    editor?: string;
    revealLine?: number;
    highlightText?: string;
    reuseKey?: string;
}

/** JSON-compatible request for the page-scoped AiVision call surface. */
export interface BoardCallRequest {
    path: string;
    args?: unknown[];
    value?: unknown;
    maxLength?: number;
    timeoutMs?: number;
}

/** Correlated result for `persephone.call()`. */
export interface BoardCallResultMsg {
    kind: "call-result";
    id: number;
    result?: unknown;
    error?: string;
}

/** A runner envelope sent board → main (the caller→runner half of `RunnerChannel`). */
export interface BoardRunnerOutMsg {
    kind: "runner";
    channel:
        | RunnerChannel.start
        | RunnerChannel.stdin
        | RunnerChannel.endStdin
        | RunnerChannel.kill;
    msg: RunnerStartMsg | RunnerStdinMsg | RunnerJobMsg | RunnerKillMsg;
}

/** A runner envelope sent main → board (the runner→caller half of `RunnerChannel`). */
export interface BoardRunnerInMsg {
    kind: "runner";
    channel:
        | RunnerChannel.stdout
        | RunnerChannel.stderr
        | RunnerChannel.exit
        | RunnerChannel.error;
    msg: RunnerChunkMsg | RunnerExitMsg | RunnerErrorMsg;
}

/** Everything the board posts to main over the port. */
export type BoardToMain =
    | { kind: "rpc"; id: number; method: BoardRpcMethod; args: unknown[] }
    | { kind: "call"; id: number; request: BoardCallRequest }
    | { kind: "fire"; method: BoardFireMethod; args: unknown[] }
    | { kind: "connected" } // shim → main: confirms the bridge is live after its handshake
    | BoardRunnerOutMsg;

/** Everything main posts to the board over the port. */
export type MainToBoard =
    | { kind: "rpc-result"; id: number; result?: unknown; error?: WireError }
    | BoardCallResultMsg
    | { kind: "watch"; watchId: number; batch: PathWatchBatch }
    | { kind: "theme"; palette: BoardThemePalette }
    | BoardRunnerInMsg;
