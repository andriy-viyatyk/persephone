import type { VideoStreamSessionConfig, VideoStreamSessionResult } from "../api-param-types";

export interface MediaApi {
    createVideoStreamSession: (config: VideoStreamSessionConfig, port?: number) => Promise<VideoStreamSessionResult>;
    deleteVideoStreamSession: (sessionId: string) => Promise<void>;
    deleteVideoStreamSessionsByPage: (pageId: string) => Promise<void>;
    openInVlc: (url: string, vlcPath?: string) => Promise<void>;
    capturePageRegion: (rect: CaptureRect) => Promise<Uint8Array>;
}

export interface CaptureRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

