import { TComponentState } from "../../core/state/state";
import type { BrowserEditor } from "./BrowserEditor";

export interface BrowserFindState {
    findBarVisible: boolean;
    findText: string;
    findActiveMatch: number;
    findTotalMatches: number;
}

const DEFAULT_FIND_STATE: BrowserFindState = {
    findBarVisible: false,
    findText: "",
    findActiveMatch: 0,
    findTotalMatches: 0,
};

/** Owns find-in-page state and commands for the active browser guest. */
export class BrowserFindModel {
    readonly state = new TComponentState<BrowserFindState>(DEFAULT_FIND_STATE);

    constructor(private readonly model: BrowserEditor) {}

    open = (): void => {
        this.state.update((state) => { state.findBarVisible = true; });
    };

    close = (): void => {
        this.model.webview.getActiveWebview()?.stopFindInPage("clearSelection");
        this.state.set(DEFAULT_FIND_STATE);
    };

    reset = (): void => {
        this.state.set(DEFAULT_FIND_STATE);
    };

    setText = (text: string): void => {
        this.state.update((state) => { state.findText = text; });
        const webview = this.model.webview.getActiveWebview();
        if (!webview) return;
        if (text) {
            // Electron's `findNext` begins a new find session for changed text.
            webview.findInPage(text, { findNext: true });
        } else {
            webview.stopFindInPage("clearSelection");
            this.state.update((state) => {
                state.findActiveMatch = 0;
                state.findTotalMatches = 0;
            });
        }
    };

    next = (): void => {
        const { findText } = this.state.get();
        if (!findText) return;
        this.model.webview.getActiveWebview()?.findInPage(findText, { forward: true, findNext: false });
    };

    prev = (): void => {
        const { findText } = this.state.get();
        if (!findText) return;
        this.model.webview.getActiveWebview()?.findInPage(findText, { forward: false, findNext: false });
    };

    foundInPage = (result: Electron.FoundInPageResult): void => {
        if (!result.finalUpdate) return;
        this.state.update((state) => {
            state.findActiveMatch = result.activeMatchOrdinal - 1;
            state.findTotalMatches = result.matches;
        });
    };
}
