import { EditorFacadeBase } from "./EditorFacadeBase";
import { AutomationSurface } from "./AutomationSurface";
import type {
    BoardRenderState,
    IBoardEditor,
    IBoardManifest,
    IBoardReloadResult,
    IBoardSecondaryView,
} from "../../api/types/board-editor";
import type {
    IBrowserElementLocator,
    IBrowserClickOptions,
    IBrowserHoverOptions,
    IBrowserActionOptions,
    IBrowserKeyboardOptions,
    IBrowserNetworkRequest,
    IBrowserResponse,
    IBrowserResponseWaitOptions,
    IBrowserScreenshot,
    IBrowserSelectOptions,
    IBrowserTab,
    IBrowserTypeOptions,
    IBrowserConsoleLevel,
    IBrowserDragOptions,
    IBrowserFormField,
    IBrowserScreenshotOptions,
    IBrowserEvaluateOptions,
    IBrowserEvaluateFunction,
} from "../../api/types/browser-editor";
import {
    createRemoteProxy,
    type IAiRemoteRequest,
    type IAiRemoteResponse,
    type IAiVisible,
    type IAiVisionDescriptor,
} from "ai-vision";
import { BOARD_CDP_TAB } from "../../../ipc/api-types";
import { BOARD_EDITOR_ID_PREFIX } from "../../../shared/board/board-editor-id";
import type { BoardEditorModel } from "../../editors/board/BoardEditorModel";
import type { BoardAiVisionRegistration } from "../../editors/board/model/BoardAiVisionChannel";
import type { ITargetTab } from "../../automation/types";
import { ensureTargetReady } from "../../automation/page-events";
import { boardDialogs, answerBoardDialog } from "../../editors/board/board-dialogs";
import { boardRegistry } from "../../api/boards/board-registry";
import { boardSecondaryPanelId } from "../../editors/board/board-secondary";
import { projectBoardManifest } from "./board-manifest-projection";
import { BROWSER_AUTOMATION_MEMBERS } from "../ai-vision/browser-automation-members";
import { appCallTimeout } from "../../api/ai-vision-call-timeout";
import { isPositiveIntegerTimeout, resolveBoardCallTimeout } from "../../../shared/ai-vision-timeout";
import type { IAiCallContext } from "../ai-vision/root";
import { errMessage } from "../../../shared/utils";
import {
    APP_MEMBER,
    BOARD_AUTOMATION_TAB_MEMBERS,
    BOARD_ELEMENTS,
    BOARD_HELP,
    BOARD_MEMBERS,
} from "./board-editor-facade-definitions";


export class BoardEditorFacade extends EditorFacadeBase<BoardEditorModel> implements IAiVisible, IBoardEditor {
    private readonly automation: AutomationSurface;
    constructor(
        private readonly editor: BoardEditorModel,
        readonly id: "board-view" | `board-editor:${string}`,
        readonly name: string,
        private readonly callContext?: IAiCallContext,
    ) {
        super(id, name);
        this.setEditor(editor);
        this.automation = new AutomationSurface({ target: editor.target, host: "board" });
    }

    get aiVision(): IAiVisionDescriptor {
        const registration = this.editor.aiVision.getRegistration();
        const app = registration ? this.getAiVisionProxy(registration) : undefined;
        return this.describeEditor({
            kind: "BoardEditor",
            summary: "Board chrome, trust, metadata, frame automation, panels, and reload facade.",
            members: [
                ...BROWSER_AUTOMATION_MEMBERS,
                ...BOARD_AUTOMATION_TAB_MEMBERS,
                ...BOARD_MEMBERS,
                ...(app ? [APP_MEMBER] : []),
            ],
            identitySummaries: {
                id: `The concrete board editor id: board-view or ${BOARD_EDITOR_ID_PREFIX}<root>.`,
                name: "The board editor's registry display name.",
            },
            identityIndex: BROWSER_AUTOMATION_MEMBERS.length + BOARD_AUTOMATION_TAB_MEMBERS.length,
            help: BOARD_HELP,
            elements: () => [...BOARD_ELEMENTS, ...this.editor.chrome.getLiveToolbarElementDeclarations()],
            highlightOptions: { all: true },
            provide: elementProvide => name =>
                name === "app" && app ? { value: app } : elementProvide(name),
            restricted: () => this.restricted(),
            summarize: () => ({
                kind: "BoardEditor",
                id: this.id,
                name: this.name,
                ...(this.boardRoot !== undefined ? { boardRoot: this.boardRoot } : {}),
                ...(this.folderPath !== undefined ? { folderPath: this.folderPath } : {}),
                ...(this.boardName !== undefined ? { boardName: this.boardName } : {}),
                renderState: this.renderState,
                ...(this.frameReady !== undefined ? { frameReady: this.frameReady } : {}),
                ...(this.busy !== undefined ? { busy: this.busy } : {}),
                ...(this.working !== undefined ? { working: this.working } : {}),
                ...(this.statusText !== undefined ? { statusText: this.statusText } : {}),
            }),
        });
    }

    /** List the board's main frame and declared secondary-view frames without attaching to CDP. */
    get tabs(): IBrowserTab[] {
        return this.editor.target.tabs.map(toBrowserTab);
    }

    /** Read the selected board frame without attaching to CDP. */
    get activeTab(): IBrowserTab | undefined {
        const tab = this.editor.target.activeTab;
        return tab ? toBrowserTab(tab) : undefined;
    }

    /** Build an accessibility snapshot for the selected or explicitly requested board frame. */
    snapshot(options?: TabOption & {
        root?: string | { ref: string };
        interactive?: boolean;
        maxNodes?: number;
        maxChars?: number;
    }): Promise<string> { return this.automation.snapshot(options); }

    /** Click a board element by CSS selector or explicit snapshot ref. */
    click(locator: IBrowserElementLocator, options?: IBrowserClickOptions): Promise<void> { return this.automation.click(locator, options); }

    /** Hover a board element by CSS selector or explicit snapshot ref. */
    hover(locator: IBrowserElementLocator, options?: IBrowserHoverOptions): Promise<void> { return this.automation.hover(locator, options); }

    /** Type into a board input by CSS selector or explicit snapshot ref. */
    type(locator: IBrowserElementLocator, text: string, options?: IBrowserTypeOptions): Promise<void> { return this.automation.type(locator, text, options); }

    /** Select a board option by CSS selector or explicit snapshot ref. */
    select(
        locator: IBrowserElementLocator,
        values: string | string[],
        options?: IBrowserSelectOptions,
    ): Promise<void> { return this.automation.select(locator, values, options); }

    check(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> { return this.automation.check(locator, options); }

    uncheck(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> { return this.automation.uncheck(locator, options); }

    clear(locator: IBrowserElementLocator, options?: IBrowserTypeOptions): Promise<void> { return this.automation.clear(locator, options); }

    /** Press a key or compound key in the selected board frame. */
    pressKey(key: string, options?: IBrowserKeyboardOptions): Promise<void> { return this.automation.pressKey(key, options); }

    keyDown(key: string, options?: IBrowserKeyboardOptions): Promise<void> { return this.automation.keyDown(key, options); }

    keyUp(key: string, options?: IBrowserKeyboardOptions): Promise<void> { return this.automation.keyUp(key, options); }

    /** Evaluate JavaScript in the selected or explicitly requested board frame. */
    evaluate(expression: string | IBrowserEvaluateFunction, options?: IBrowserEvaluateOptions): Promise<unknown> { return this.automation.evaluate(expression, options); }

    /** Wait for exactly one selector, text, textGone, or time condition in a board frame. */
    waitFor(options: WaitForOption): Promise<void> { return this.automation.waitFor(options); }

    /** Capture the selected board frame as PNG, or undefined when its session is unavailable. */
    screenshot(options?: IBrowserScreenshotOptions): Promise<IBrowserScreenshot | undefined> { return this.automation.screenshot(options); }

    drag(
        source: IBrowserElementLocator,
        destination: IBrowserElementLocator,
        options?: IBrowserDragOptions,
    ): Promise<void> { return this.automation.drag(source, destination, options); }

    fillForm(fields: IBrowserFormField[]): Promise<void> { return this.automation.fillForm(fields); }

    setInputFiles(locator: IBrowserElementLocator, paths: string[], options?: TabOption): Promise<void> { return this.automation.setInputFiles(locator, paths, options); }

    /** Read recorded network requests for the selected board frame. */
    networkRequests(options?: TabOption): Promise<IBrowserNetworkRequest[]> { return this.automation.networkRequests(options); }

    waitForResponse(urlOrRegex: string | RegExp, options?: IBrowserResponseWaitOptions): Promise<IBrowserResponse> {
        return this.automation.waitForResponse(urlOrRegex, options);
    }

    async dialogs(options?: TabOption): Promise<{ dialogs: Awaited<ReturnType<typeof boardDialogs>> }> {
        return { dialogs: await boardDialogs(this.editor.id, options?.tabId ?? this.editor.frameRegistry.activeTabId) };
    }

    async handleDialog(accept: boolean, promptText?: string, options?: TabOption): Promise<void> {
        await answerBoardDialog(
            this.editor.id,
            options?.tabId ?? this.editor.frameRegistry.activeTabId,
            accept,
            promptText,
        );
    }

    async consoleMessages(options?: TabOption & { since?: number; level?: IBrowserConsoleLevel }) {
        return this.automation.consoleMessages(options);
    }

    async pageErrors(options?: TabOption) {
        return this.automation.pageErrors(options);
    }

    /** Select a board frame and wait until a secondary frame is attachable. */
    async switchTab(tabId: string): Promise<void> {
        await this.editor.target.switchTab(tabId);
        await ensureTargetReady(this.editor.target, tabId);
    }

    get boardRoot(): string | undefined {
        return this.editor.state.get().boardRoot;
    }

    get folderPath(): string | undefined {
        return this.editor.state.get().folderPath;
    }

    get boardName(): string | undefined {
        return this.editor.state.get().selectedBoard;
    }

    get renderState(): BoardRenderState {
        const state = this.editor.state.get();
        if (!state.boardRoot || !state.selectedBoard) return "not-found";
        return boardRegistry.permissionOrigin(state.boardRoot) ?? "untrusted";
    }

    async getManifest(): Promise<IBoardManifest | undefined> {
        const manifest = await this.editor.readManifestForFacade();
        return manifest ? projectBoardManifest(manifest) : undefined;
    }

    get secondaryViews(): readonly IBoardSecondaryView[] | undefined {
        const state = this.editor.state.get();
        if (!state.boardRoot || !state.selectedBoard) return undefined;
        const page = this.editor.page;
        return (state.secondaryViewDefs ?? []).map((view) => {
            const panelId = boardSecondaryPanelId(view.id);
            return {
                id: view.id,
                panelId,
                ...(view.html !== undefined ? { html: view.html } : {}),
                ...(view.title !== undefined ? { title: view.title } : {}),
                ...(page ? { expanded: page.activePanelId === panelId } : {}),
            };
        });
    }

    get statusText(): string | undefined {
        if (!this.isResolvedBoard()) return undefined;
        return this.editor.chrome.state.get().statusText || undefined;
    }

    get busy(): boolean | undefined {
        if (!this.isResolvedBoard()) return undefined;
        return this.editor.state.get().busy ?? false;
    }

    get working(): boolean | undefined {
        if (!this.isResolvedBoard()) return undefined;
        return this.editor.workingState.get() === true;
    }

    get frameReady(): boolean | undefined {
        if (!this.isResolvedBoard()) return undefined;
        const registry = this.editor.frameRegistry;
        if (!registry.hasFrame(BOARD_CDP_TAB)) return undefined;
        return registry.isLoaded(BOARD_CDP_TAB);
    }

    get contentHostError(): string | undefined {
        return this.renderState === "trusted" || this.renderState === "bundled"
            ? this.editor.state.get().contentHostError
            : undefined;
    }

    reload(): Promise<IBoardReloadResult> {
        const pageId = this.editor.page?.id;
        return this.automation.runHostOperation("reload", undefined, async () => {
            if (!pageId) throw new Error("Board reload unavailable: no page host attached.");
            const boardRoot = this.boardRoot;
            if (!boardRoot) throw new Error("Board reload unavailable: no board root is attached.");
            const renderState = this.renderState;
            if (renderState !== "trusted" && renderState !== "bundled") {
                return { refreshed: true, pageId, frameReady: false, renderState };
            }
            const result = await this.editor.reloadAndWait();
            return result.cancelled
                ? { refreshed: false, cancelled: true, pageId, frameReady: result.frameReady, renderState }
                : { refreshed: true, pageId, frameReady: result.frameReady, renderState };
        }, { passive: false, tip: false });
    }

    private isResolvedBoard(): boolean {
        const state = this.editor.state.get();
        return !!state.boardRoot && !!state.selectedBoard;
    }

    private restricted(): string | undefined {
        return this.renderState === "untrusted"
            ? "This board's content is restricted until the user answers the Trust-this-Board dialog "
                + "(shown as \"Trust this board?\"). The facade reports trust state but never grants trust "
                + "or accepts a trust decision."
            : undefined;
    }

    private aiVisionProxy?: { token: number; value: IAiVisible };

    private getAiVisionProxy(
        registration: BoardAiVisionRegistration,
    ): IAiVisible {
        if (this.aiVisionProxy?.token === registration.token) return this.aiVisionProxy.value;
        // The proxy is built from ONE registration's shape, so every request it later emits must be
        // checked against that registration's *remote* — a reload re-registers under a new
        // incarnation, and a proxy handed out before it must fail loudly rather than address the
        // new document. A `refresh()` from the same live remote keeps the incarnation and only
        // bumps the token, so the proxy is rebuilt for the new shape while requests already on the
        // wire still complete.
        const incarnation = registration.incarnation;
        const value = createRemoteProxy(registration.shape, (request) => this.sendAiVision(request, incarnation), {
            restricted: () => this.restricted(),
            onWarning: (message) => this.editor.aiVision.warn(message),
            onError: (error) => this.editor.aiVision.warn(errMessage(error)),
        });
        this.aiVisionProxy = { token: registration.token, value };
        return value;
    }

    private async sendAiVision(request: IAiRemoteRequest, incarnation: number): Promise<IAiRemoteResponse> {
        return this.editor.aiVision.request(request, incarnation, () => {
            const timeout = resolveBoardCallTimeout(
                isPositiveIntegerTimeout(this.callContext?.timeoutMs) ? this.callContext?.timeoutMs : undefined,
                isPositiveIntegerTimeout(request.timeoutMs) ? request.timeoutMs : undefined,
                appCallTimeout.explicit(),
            );
            const pageId = this.editor.page?.id;
            const path = request.path || "<root>";
            const agentPath = pageId
                ? `pages[${JSON.stringify(pageId)}].editor.app.${path}`
                : `app.${path}`;
            const timeoutError = new Error(
                `AiVision request timed out at level ${timeout.level} (${timeout.label}) for path `
                    + `${JSON.stringify(agentPath)}.`,
            );
            return {
                timeoutMs: timeout.ms,
                timeoutError,
                aggregateTimeoutError: (views) => new Error(
                    `AiVision elements aggregation timed out at level ${timeout.level} (${timeout.label}) `
                        + `while querying views: ${views.join(", ")}.`,
                ),
            };
        });
    }
}

interface TabOption {
    tabId?: string;
}

interface WaitForOption extends TabOption {
    selector?: string;
    state?: "attached" | "detached" | "visible" | "hidden";
    text?: string;
    textGone?: string;
    time?: number;
    timeout?: number;
}

function toBrowserTab(tab: ITargetTab): IBrowserTab {
    return {
        id: tab.id,
        ...(tab.url ? { url: tab.url } : {}),
        ...(tab.title ? { title: tab.title } : {}),
        loading: tab.loading,
        active: tab.active,
    };
}
