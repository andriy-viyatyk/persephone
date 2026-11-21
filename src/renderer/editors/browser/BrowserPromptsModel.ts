import type { BrowserPermissionPromptData } from "../../../ipc/browser-ipc";
import { TComponentState } from "../../core/state/state";
import type { BrowserEditor } from "./BrowserEditor";

export interface BrowserPermissionPrompt extends BrowserPermissionPromptData {
    internalTabId: string;
}

export interface BrowserPromptsState {
    blockedPopupCount: number;
    /** The tab whose popups were last blocked; "Allow" grants that tab's current site. */
    blockedPopupTabId: string;
    permissionPrompts: BrowserPermissionPrompt[];
}

const DEFAULT_PROMPTS_STATE: BrowserPromptsState = {
    blockedPopupCount: 0,
    blockedPopupTabId: "",
    permissionPrompts: [],
};

/** Owns transient blocked-popup and permission-prompt state for browser tabs. */
export class BrowserPromptsModel {
    readonly state = new TComponentState<BrowserPromptsState>(DEFAULT_PROMPTS_STATE);

    constructor(private readonly model: BrowserEditor) {}

    countBlockedPopup = (internalTabId: string): void => {
        this.state.update((state) => {
            if (state.blockedPopupTabId !== internalTabId) state.blockedPopupCount = 0;
            state.blockedPopupTabId = internalTabId;
            state.blockedPopupCount++;
        });
    };

    enqueuePermission = (prompt: BrowserPermissionPromptData, internalTabId: string): void => {
        this.state.update((state) => {
            if (!state.permissionPrompts.some((item) => item.requestId === prompt.requestId)) {
                state.permissionPrompts.push({ ...prompt, internalTabId });
            }
        });
    };

    /** A tab started a navigation: its permission prompts go, and a new document also drops its popup bar. */
    clearTab = (internalTabId: string, sameDocument = false): void => {
        this.state.update((state) => {
            state.permissionPrompts = state.permissionPrompts.filter((item) => item.internalTabId !== internalTabId);
            if (!sameDocument && state.blockedPopupTabId === internalTabId) state.blockedPopupCount = 0;
        });
    };

    dismissBlockedPopups = (): void => {
        this.state.update((state) => { state.blockedPopupCount = 0; });
    };

    allowPopups = (): void => {
        const tabId = this.state.get().blockedPopupTabId;
        if (tabId) this.model.guest.allowPopups(tabId);
        this.dismissBlockedPopups();
    };

    resolvePermissionPrompt = (requestId: string, decision: "allow" | "block"): void => {
        this.state.update((state) => {
            state.permissionPrompts = state.permissionPrompts.filter((prompt) => prompt.requestId !== requestId);
        });
        this.model.guest.resolvePermissionRequest(requestId, decision);
    };
}
