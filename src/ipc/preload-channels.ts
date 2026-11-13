import type { Api, EventApi } from "./api-types";
import { ENDPOINT_REPLY_CHANNEL, RendererEvent } from "./api-types";
import type { BoardPipeChannel } from "./board-pipe-channels";
import { BoardServiceSettingsChannel } from "./board-service-settings-channels";

type BoardServiceSettingsChannelName = typeof BoardServiceSettingsChannel[keyof typeof BoardServiceSettingsChannel];
type PortEventKey = "eBoardPort" | "eBoardServiceChannel" | "eModuleServicePort";

export type PreloadSendChannel = keyof Api | keyof EventApi | PortEventKey | BoardPipeChannel | BoardServiceSettingsChannelName | RendererEvent;
export type PreloadListenerChannel = typeof ENDPOINT_REPLY_CHANNEL | keyof EventApi | PortEventKey | BoardPipeChannel;
export type PreloadOnceChannel = keyof Api | BoardPipeChannel;
export type PreloadPortChannel = keyof EventApi | PortEventKey;
