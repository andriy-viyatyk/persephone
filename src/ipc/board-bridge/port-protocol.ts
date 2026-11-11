/** Private typed contract for the transferred board-to-main MessagePort. */
import type { CapabilityJson } from "../../shared/capability-contract";
import type { RequestId } from "../../shared/pending-requests";
import type { WireError } from "../../shared/wire-error";
import type { PathWatchBatch } from "../api-types";
import type { CapabilityClientInvoke, CapabilityClientOptions, CapabilityClientResult, CapabilityProvider } from "../capability-bus-channels";
import {
    RunnerChannel,
    type RunnerChunkMsg,
    type RunnerErrorMsg,
    type RunnerExitMsg,
    type RunnerJobMsg,
    type RunnerKillMsg,
    type RunnerStartMsg,
    type RunnerStdinMsg,
} from "../runner-channels";
import type { BoardThemePalette } from "./boot";
import type { BoardServiceStatus } from "../module-service-channels";

export type BoardNotifyType = "info" | "success" | "warning" | "error";
export interface BoardNotifyMsg { message: string; type?: BoardNotifyType; persistent?: boolean }
export interface BoardOpenRawLinkOptions { editor?: string; revealLine?: number; highlightText?: string; reuseKey?: string }
export type BoardFileEncoding = "utf8" | "base64" | "binary";
export type BoardWatchOptions = { recursive?: boolean; debounceMs?: number };
export interface BoardFolderListOptions { recursive?: boolean; masks?: string[]; limit?: number; cursor?: string }
export interface BoardServiceProvider { provider: string; title: string; version: number; boardName: string }
export interface BoardServiceProviderSelector { provider: string; version: number }
export interface BoardFolderEntry { name: string; path: string; isDirectory: boolean; size: number; mtime: number }
export interface BoardFolderPage { entries: BoardFolderEntry[]; nextCursor?: string; truncated: boolean }
export interface BoardFileAccess { read: boolean; write: boolean }
export type BoardJsonValue = null | string | boolean | number | BoardJsonValue[] | { [key: string]: BoardJsonValue };
export interface BoardJobInfo { jobId: string; command: string; name?: string }
export interface BoardCallRequest { path: string; args?: unknown[]; value?: unknown; maxLength?: number; timeoutMs?: number }

/** Positional arguments and result types for every private board RPC. */
export interface BoardPortMethods {
    openRawLink: { params: [href: string, options?: BoardOpenRawLinkOptions]; result: void };
    openBoard: { params: [folder: string]; result: void };
    openFileDialog: { params: [params: unknown]; result: string[] | undefined };
    saveFileDialog: { params: [params: unknown]; result: string | undefined };
    openFolderDialog: { params: [params: unknown]; result: string[] | undefined };
    listFolder: { params: [path: string, options?: unknown]; result: BoardFolderPage };
    rememberFolder: { params: [path: string]; result: boolean };
    rememberFile: { params: [path: string]; result: boolean };
    getFileAccess: { params: [path: string]; result: BoardFileAccess };
    readFile: { params: [path: string, encoding?: BoardFileEncoding]; result: string | Uint8Array };
    writeFile: { params: [path: string, data: string | Uint8Array | ArrayBuffer, encoding?: BoardFileEncoding]; result: void };
    trashFile: { params: [path: string]; result: void };
    registerTypeScriptProject: { params: [root: string]; result: void };
    unregisterTypeScriptProject: { params: [root: string]; result: void };
    watch: { params: [watchId: number, path: string, options?: BoardWatchOptions]; result: void };
    unwatch: { params: [watchId: number]; result: void };
    getJobs: { params: []; result: BoardJobInfo[] };
    serviceRequest: { params: [message: unknown]; result: unknown };
    serviceOpenChannel: { params: [openMessage: unknown]; result: string };
    servicesList: { params: [interfaceId: string]; result: BoardServiceProvider[] };
    servicesConnect: { params: [interfaceId: string, selector: BoardServiceProviderSelector, openMessage: unknown]; result: string };
    capabilityList: { params: []; result: CapabilityClientResult<CapabilityProvider[]> };
    capabilityProviders: { params: [id: string]; result: CapabilityClientResult<CapabilityProvider[]> };
    capabilityGet: { params: [id: string, options?: CapabilityClientOptions]; result: CapabilityClientResult<CapabilityProvider | null> };
    capabilityInvoke: { params: [request: CapabilityClientInvoke]; result: CapabilityClientResult<CapabilityJson | { channelId: string }> };
    capabilityCancel: { params: [requestId: string]; result: CapabilityClientResult<void> };
    serviceStatus: { params: []; result: BoardServiceStatus | undefined };
    serviceStop: { params: []; result: void };
    storageGet: { params: [key: string]; result: BoardJsonValue | undefined };
    storageSet: { params: [key: string, value: BoardJsonValue]; result: void };
    storageDelete: { params: [key: string]; result: boolean };
    storageKeys: { params: []; result: string[] };
    clipboardWriteImage: { params: [data: Uint8Array | ArrayBuffer]; result: void };
    clipboardWriteText: { params: [text: string]; result: void };
    call: { params: [request: BoardCallRequest]; result: unknown };
}
export type BoardRpcMethod = keyof BoardPortMethods;
export type BoardPortParams<M extends BoardRpcMethod> = BoardPortMethods[M]["params"];
export type BoardPortResult<M extends BoardRpcMethod> = BoardPortMethods[M]["result"];
export type BoardPermissionRequirement = "service-interface" | "service" | "dialog";

export interface BoardToMainEvents {
    connected: Record<string, never>;
    notify: BoardNotifyMsg;
    [RunnerChannel.start]: RunnerStartMsg;
    [RunnerChannel.stdin]: RunnerStdinMsg;
    [RunnerChannel.endStdin]: RunnerJobMsg;
    [RunnerChannel.kill]: RunnerKillMsg;
}
export interface MainToBoardEvents {
    watch: { watchId: number; batch: PathWatchBatch };
    theme: { palette: BoardThemePalette };
    [RunnerChannel.stdout]: RunnerChunkMsg;
    [RunnerChannel.stderr]: RunnerChunkMsg;
    [RunnerChannel.exit]: RunnerExitMsg;
    [RunnerChannel.error]: RunnerErrorMsg;
}
export type BoardPortRequest = { [M in BoardRpcMethod]: { __persephone: "req"; id: RequestId; method: M; params: BoardPortParams<M> } }[BoardRpcMethod];
export type BoardPortResponse =
    | { __persephone: "res"; id: RequestId; ok: true; value: unknown }
    | { __persephone: "res"; id: RequestId; ok: false; error: WireError };
export type BoardPortEvent<Events> = { [E in keyof Events & string]: { __persephone: "evt"; name: E; payload: Events[E] } }[keyof Events & string];
export type BoardToMain = BoardPortRequest | BoardPortEvent<BoardToMainEvents>;
export type MainToBoard = BoardPortResponse | BoardPortEvent<MainToBoardEvents>;
export type BoardFireMethod = "notify";
export type BoardRunnerOutMsg = Extract<
    BoardPortEvent<BoardToMainEvents>,
    { name: typeof RunnerChannel.start | typeof RunnerChannel.stdin | typeof RunnerChannel.endStdin | typeof RunnerChannel.kill }
>;
