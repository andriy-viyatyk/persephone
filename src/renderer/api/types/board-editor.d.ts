import type {
    IBrowserElementLocator,
    IBrowserClickOptions,
    IBrowserHoverOptions,
    IBrowserTypeOptions,
    IBrowserSelectOptions,
    IBrowserActionOptions,
    IBrowserKeyboardOptions,
    IBrowserNetworkRequest,
    IBrowserResponse,
    IBrowserResponseWaitOptions,
    IBrowserScreenshot,
    IBrowserTab,
    IBrowserDialogPolicy,
    IBrowserDialogRecord,
    IBrowserConsoleLevel,
    IBrowserConsoleMessage,
    IBrowserPageError,
    IBrowserDragOptions,
    IBrowserFormField,
    IBrowserScreenshotOptions,
    IBrowserEvaluateOptions,
    IBrowserEvaluateFunction,
} from "./browser-editor";

export type BoardRenderState = "trusted" | "bundled" | "untrusted" | "not-found";

export interface IBoardSecondaryViewDeclaration {
    readonly id: string;
    readonly html?: string;
    readonly title?: string;
}

export interface IBoardContentProviderDeclaration {
    readonly type: string;
    readonly schemes?: readonly string[];
}

export interface IBoardCapabilityDeclaration {
    readonly id: string;
    readonly representation?: string;
    readonly version?: number;
    readonly priority?: number;
    readonly accepts?: readonly string[];
    readonly payloadSchema?: unknown;
    readonly title?: string;
    readonly headless?: boolean;
    readonly alwaysOpensNewPage?: boolean;
}

export interface IBoardSettingDeclaration {
    readonly id: string;
    readonly type: "string" | "boolean" | "number" | "enum";
    readonly default: string | boolean | number;
    readonly options?: readonly string[];
    readonly format?: string;
    readonly label?: string;
    readonly description?: string;
}

export interface IBoardManifest {
    readonly schemaVersion: number;
    readonly name?: string;
    readonly description?: string;
    readonly author?: string;
    readonly repository?: string;
    readonly version?: string;
    readonly standalone?: boolean;
    readonly singleInstance?: boolean;
    readonly minAppVersion?: string;
    readonly permissions?: readonly string[];
    readonly minBridgeVersion?: string;
    readonly service?: string;
    readonly contentProviders?: readonly IBoardContentProviderDeclaration[];
    readonly capabilities?: readonly IBoardCapabilityDeclaration[];
    readonly settings?: readonly IBoardSettingDeclaration[];
    readonly fileMasks?: readonly string[];
    readonly browserUrlMasks?: readonly string[];
    readonly folderMasks?: readonly string[];
    /** Direct folder claims matching the folder itself; unlike `folderMasks`, not a file gate. */
    readonly folderEditorMasks?: readonly string[];
    readonly contentMasks?: readonly string[];
    /** Direct folder resolution priority for `folderEditorMasks`. */
    readonly folderEditorPriority?: number;
    readonly editorPriority?: number;
    readonly editorName?: string;
    readonly editorKind?: "simple" | "content-host" | "stream-host";
    readonly editorSources?: "local" | "any";
    readonly secondaryViews?: readonly IBoardSecondaryViewDeclaration[];
    readonly guides?: string;
}

export interface IBoardSecondaryView {
    readonly id: string;
    readonly panelId: string;
    readonly html?: string;
    readonly title?: string;
    readonly expanded?: boolean;
}

export interface IBoardReloadResult {
    readonly refreshed: true;
    readonly pageId: string;
    readonly frameReady: boolean;
    readonly renderState: BoardRenderState;
}

export interface IBoardEditor {
    readonly id: "board-view" | `board-editor:${string}`;
    readonly name: string;
    readonly boardRoot: string | undefined;
    /** The absolute folder claimed by this board, distinct from its installed board root. */
    readonly folderPath: string | undefined;
    readonly boardName: string | undefined;
    readonly renderState: BoardRenderState;
    getManifest(): Promise<IBoardManifest | undefined>;
    readonly secondaryViews: readonly IBoardSecondaryView[] | undefined;
    readonly statusText: string | undefined;
    readonly busy: boolean | undefined;
    readonly frameReady: boolean | undefined;
    readonly contentHostError: string | undefined;
    reload(): Promise<IBoardReloadResult>;
    /** Main frame and declared secondary-view frames. */
    readonly tabs: IBrowserTab[];
    /** The selected board frame. */
    readonly activeTab: IBrowserTab | undefined;
    /** Get a board accessibility snapshot; `root`, `interactive`, `maxNodes`, and `maxChars` narrow or bound the tree. */
    snapshot(options?: { tabId?: string; root?: string | { ref: string }; interactive?: boolean; maxNodes?: number; maxChars?: number }): Promise<string>;
    click(locator: IBrowserElementLocator, options?: IBrowserClickOptions): Promise<void>;
    hover(locator: IBrowserElementLocator, options?: IBrowserHoverOptions): Promise<void>;
    type(locator: IBrowserElementLocator, text: string, options?: IBrowserTypeOptions): Promise<void>;
    select(locator: IBrowserElementLocator, values: string | string[], options?: IBrowserSelectOptions): Promise<void>;
    check(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void>;
    uncheck(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void>;
    clear(locator: IBrowserElementLocator, options?: IBrowserTypeOptions): Promise<void>;
    drag(source: IBrowserElementLocator, destination: IBrowserElementLocator, options?: IBrowserDragOptions): Promise<void>;
    fillForm(fields: IBrowserFormField[]): Promise<void>;
    setInputFiles(locator: IBrowserElementLocator, paths: string[], options?: { tabId?: string }): Promise<void>;
    pressKey(key: string, options?: IBrowserKeyboardOptions): Promise<void>;
    keyDown(key: string, options?: IBrowserKeyboardOptions): Promise<void>;
    keyUp(key: string, options?: IBrowserKeyboardOptions): Promise<void>;
    evaluate(expression: string | IBrowserEvaluateFunction, options?: IBrowserEvaluateOptions): Promise<unknown>;
    waitFor(options: {
        selector?: string;
        state?: "attached" | "detached" | "visible" | "hidden";
        text?: string;
        textGone?: string;
        time?: number;
        timeout?: number;
        tabId?: string;
    }): Promise<void>;
    screenshot(options?: IBrowserScreenshotOptions): Promise<IBrowserScreenshot | undefined>;
    networkRequests(options?: { tabId?: string }): Promise<IBrowserNetworkRequest[]>;
    /** Wait for a matching completed response on the board frame; owned existing OOPIFs are included. */
    waitForResponse(urlOrRegex: string | RegExp, options?: IBrowserResponseWaitOptions): Promise<IBrowserResponse>;
    /** Read and optionally update dialog policy for the selected board frame. */
    dialogs(options?: { tabId?: string; policy?: IBrowserDialogPolicy }): Promise<{ policy: IBrowserDialogPolicy; dialogs: IBrowserDialogRecord[] }>;
    /** Resolve a pending JavaScript dialog in the selected board frame. */
    handleDialog(accept: boolean, promptText?: string, options?: { tabId?: string }): Promise<void>;
    /** Read recent console messages from the selected board frame. */
    consoleMessages(options?: { tabId?: string; since?: number; level?: IBrowserConsoleLevel }): Promise<IBrowserConsoleMessage[]>;
    /** Read recent uncaught errors from the selected board frame. */
    pageErrors(options?: { tabId?: string }): Promise<IBrowserPageError[]>;
    /** Switch to the main frame or a declared secondary-view frame. */
    switchTab(tabId: string): Promise<void>;
}
