import { IpcMainEvent } from "electron";
import { CaptureRect } from "../api-types";
import { VideoStreamSessionConfig } from "../api-param-types";
import { capturePageRegion } from "../../main/page-capture";
import type { MediaApi } from "../contracts/media";
import { bindDomain } from "./endpoint-registry";
import { createSession, deleteSession, deleteSessionsByPage } from "../../main/video-stream-server";
import { openInVlc } from "../../main/vlc-launcher";

export function initMediaHandlers(): void {
    bindDomain<MediaApi>({
        createVideoStreamSession: async (
            event: IpcMainEvent,
            config: VideoStreamSessionConfig,
            port?: number,
        ) => createSession(config, port, event.sender),
        deleteVideoStreamSession: async (_event: IpcMainEvent, sessionId: string) =>
            deleteSession(sessionId),
        deleteVideoStreamSessionsByPage: async (_event: IpcMainEvent, pageId: string) =>
            deleteSessionsByPage(pageId),
        openInVlc: async (_event: IpcMainEvent, url: string, vlcPath?: string) =>
            openInVlc(url, vlcPath),
        capturePageRegion: async (event: IpcMainEvent, rect: CaptureRect) => capturePageRegion(event.sender, rect)
    });
}

