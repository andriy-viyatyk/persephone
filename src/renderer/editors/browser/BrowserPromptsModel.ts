import type { BrowserPermissionPromptData } from "../../../ipc/browser-ipc";
import { TComponentState } from "../../core/state/state";
import type { BrowserEditor } from "./BrowserEditor";

export interface BrowserPermissionPrompt extends BrowserPermissionPromptData {
    internalTabId: string;
    /** Set for a page asking to hand a URL to a board (asked by the renderer, never sent to main). */
    boardScheme?: BoardSchemePrompt;
}

export interface BoardSchemePrompt {
    scheme: string;
    /** The claiming board's display name. */
    board: string;
    /** The URL the page asked for (the latest one while the prompt is up). */
    url: string;
}

export type BrowserPromptDecision = "allow" | "block";

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
    /** Answer callbacks of the prompts the renderer raised itself (board-scheme hand-offs), by request id. */
    private readonly localResolvers = new Map<string, (decision: BrowserPromptDecision) => void>();

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

    /**
     * Ask whether the page in `internalTabId` may hand `boardScheme.url` to its board. A repeat request
     * for the same tab, origin and scheme while the bar is up updates that prompt instead of stacking
     * another; `onDecision` gets the user's answer (not called when the prompt is dropped).
     */
    askBoardScheme = (internalTabId: string, origin: string, boardScheme: BoardSchemePrompt, onDecision: (decision: BrowserPromptDecision) => void): void => {
        const pending = this.state.get().permissionPrompts.find((item) => item.internalTabId === internalTabId
            && item.topLevelOrigin === origin && item.boardScheme?.scheme === boardScheme.scheme);
        const requestId = pending?.requestId ?? crypto.randomUUID();
        this.localResolvers.set(requestId, onDecision);
        this.state.update((state) => {
            const existing = state.permissionPrompts.find((item) => item.requestId === requestId);
            if (existing) existing.boardScheme = boardScheme;
            else state.permissionPrompts.push({ requestId, topLevelOrigin: origin, permissions: [], boardScheme, internalTabId });
        });
    };

    /** A tab started a navigation: its permission prompts go, and a new document also drops its popup bar. */
    clearTab = (internalTabId: string, sameDocument = false): void => {
        for (const prompt of this.state.get().permissionPrompts) {
            if (prompt.internalTabId === internalTabId) this.localResolvers.delete(prompt.requestId);
        }
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

    resolvePermissionPrompt = (requestId: string, decision: BrowserPromptDecision): void => {
        this.state.update((state) => {
            state.permissionPrompts = state.permissionPrompts.filter((prompt) => prompt.requestId !== requestId);
        });
        const local = this.localResolvers.get(requestId);
        if (local) {
            this.localResolvers.delete(requestId);
            local(decision);
            return;
        }
        this.model.guest.resolvePermissionRequest(requestId, decision);
    };
}
