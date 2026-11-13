import type { EventObject } from "./event-object";

export interface BrowserApi {

}

export interface BrowserEvents {
    eOpenUrl: EventObject<{ url: string; boardRoot?: string; unattributedPopup?: boolean }>;
    eOpenPipelineCandidate: EventObject<string>;
}

