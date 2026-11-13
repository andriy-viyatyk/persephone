import type { WindowApi, WindowEvents } from "./contracts/window";
import type { AppApi, AppEvents } from "./contracts/app";
import type { FilesApi, FilesEvents } from "./contracts/files";
import type { DownloadsApi, DownloadsEvents } from "./contracts/downloads";
import type { CapabilitiesApi, CapabilitiesEvents } from "./contracts/capabilities";
import type { McpMnemeApi, McpMnemeEvents } from "./contracts/mcp-mneme";
import type { AudioApi, AudioEvents } from "./contracts/audio";
import type { ClipboardApi, ClipboardEvents } from "./contracts/clipboard";
import type { RecordingApi } from "./contracts/recording";
import type { MediaApi } from "./contracts/media";
import type { ShellApi } from "./contracts/shell";
import type { GitApi } from "./contracts/git";
import type { BoardsApi, BoardsEvents } from "./contracts/boards";
import type { ModuleServicesApi, ModuleServicesEvents } from "./contracts/module-services";
import type { VoiceTypingApi, VoiceTypingEvents } from "./contracts/voice-typing";
import type { BoardPipesApi } from "./contracts/board-pipes";
import type { SiteExtensionsApi, SiteExtensionsEvents } from "./contracts/site-extensions";
import type { PathWatchApi, PathWatchEvents } from "./contracts/path-watch";
import type { BrowserApi, BrowserEvents } from "./contracts/browser";
import type { EventObject } from "./contracts/event-object";
import type { WireError } from "../shared/wire-error";

export const ENDPOINT_REPLY_CHANNEL = "endpoint-reply" as const;
export type EndpointReply =
    | { id: number; ok: true; result: unknown }
    | { id: number; ok: false; error: WireError };

export const BOARD_CDP_TAB = "main";

export const APP_WINDOW_CDP_KEY = "__app-window__";

export type Api =
    WindowApi & AppApi & FilesApi & DownloadsApi & CapabilitiesApi & McpMnemeApi & AudioApi &
    ClipboardApi & RecordingApi & MediaApi & ShellApi & GitApi & BoardsApi & ModuleServicesApi &
    VoiceTypingApi & BoardPipesApi & SiteExtensionsApi & PathWatchApi & BrowserApi;
export type EventApi =
    WindowEvents & AppEvents & FilesEvents & DownloadsEvents & CapabilitiesEvents & McpMnemeEvents &
    AudioEvents & ClipboardEvents & BoardsEvents & ModuleServicesEvents & VoiceTypingEvents &
    SiteExtensionsEvents & PathWatchEvents & BrowserEvents;
export type { EventObject };
export type { HostServiceChannelRequest } from "./contracts/module-services";
export type { CreateBoardShortcutRequest } from "./contracts/window";
export type { PathWatchChange } from "./contracts/path-watch";
export type { PathWatchBatch } from "./contracts/path-watch";
export type { PathWatchOwner } from "./contracts/path-watch";
export type { PathWatchSubscribeRequest } from "./contracts/path-watch";
export type { PathWatchUnsubscribeRequest } from "./contracts/path-watch";
export type { BeginPathMoveRequest } from "./contracts/path-watch";
export type { CompletePathMoveRequest } from "./contracts/path-watch";
export type { PathWatchEvent } from "./contracts/path-watch";
export type { BoardLogLevel } from "./contracts/boards";
export type { CaptureRect } from "./contracts/media";
export type { McpStatus } from "./contracts/mcp-mneme";
export type { MnemeStatus } from "./contracts/mcp-mneme";
export type { WindowCloseResolution } from "./contracts/window";
export type { SiteExtensionTrustGrant } from "./contracts/site-extensions";
export type { SiteExtensionTrustSnapshot } from "./contracts/site-extensions";
export type { ModuleServicePortPayload } from "./contracts/module-services";

export enum RendererEvent { fileDropped = "file-dropped" }
