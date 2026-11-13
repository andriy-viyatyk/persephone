import type { BrowserPermissionPromptData } from "../../../ipc/browser-ipc";
import { globalPopupRateLimiter } from "../../../ipc/popup-rate-limiter";
import { TComponentState } from "../../core/state/state";
import type { BrowserEditor } from "./BrowserEditor";

export interface BrowserPermissionPrompt extends BrowserPermissionPromptData {
    internalTabId: string;
}

export interface BrowserPromptsState {
    blockedPopupCount: number;
    permissionPrompts: BrowserPermissionPrompt[];
}

const DEFAULT_PROMPTS_STATE: BrowserPromptsState = {
    blockedPopupCount: 0,
    permissionPrompts: [],
};

/** Owns transient blocked-popup and permission-prompt state for browser tabs. */
export class BrowserPromptsModel {
    readonly state = new TComponentState<BrowserPromptsState>(DEFAULT_PROMPTS_STATE);

    constructor(private readonly model: BrowserEditor) {}

    countBlockedPopup = (): void => {
        this.state.update((state) => { state.blockedPopupCount++; });
    };

    enqueuePermission = (prompt: BrowserPermissionPromptData, internalTabId: string): void => {
        this.state.update((state) => {
            if (!state.permissionPrompts.some((item) => item.requestId === prompt.requestId)) {
                state.permissionPrompts.push({ ...prompt, internalTabId });
            }
        });
    };

    clearTab = (internalTabId: string): void => {
        this.state.update((state) => {
            state.permissionPrompts = state.permissionPrompts.filter((item) => item.internalTabId !== internalTabId);
        });
    };

    dismissBlockedPopups = (): void => {
        this.state.update((state) => { state.blockedPopupCount = 0; });
    };

    allowPopups = (): void => {
        this.model.webview.popupsAllowed = true;
        globalPopupRateLimiter.allow("tabs");
        this.model.guest.allowPopups();
        this.dismissBlockedPopups();
    };

    resolvePermissionPrompt = (requestId: string, decision: "allow" | "block"): void => {
        this.state.update((state) => {
            state.permissionPrompts = state.permissionPrompts.filter((prompt) => prompt.requestId !== requestId);
        });
        this.model.guest.resolvePermissionRequest(requestId, decision);
    };
}
