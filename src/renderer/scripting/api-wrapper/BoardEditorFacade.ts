import { withEditorGuideHelp } from "./editor-guide-help";
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
import { ui } from "../../api/ui";
import { createElements } from "ai-vision/dom";
import { activatePageAndWaitForLayout, pageScopeSelector } from "../ai-vision/page-elements";
import { BOARD_CDP_TAB } from "../../../ipc/api-types";
import type { BoardEditorModel } from "../../editors/board/BoardEditorModel";
import type { BoardAiVisionRegistration } from "../../editors/board/model/BoardAiVisionChannel";
import type { ITargetTab } from "../../automation/types";
import {
    clickElement,
    checkElement,
    clearElement,
    ensureTargetReady,
    evaluateInTarget,
    boardDialogs,
    answerBoardDialog,
    consoleMessages,
    pageErrors,
    installAutomationActivity,
    hoverElement,
    keyDownOnTarget,
    keyUpOnTarget,
    networkRequests,
    pressKeyOnTarget,
    resolveElementLocator,
    selectOption,
    takeScreenshot,
    snapshot,
    typeTextInto,
    uncheckElement,
    waitFor,
    dragElements,
    fillForm as fillFormOperation,
    setInputFiles as setInputFilesOperation,
    waitForResponse as waitForResponseOperation,
} from "../../automation/operations";
import type { WaitMode } from "../../automation/operations";
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


export class BoardEditorFacade implements IAiVisible, IBoardEditor {
    constructor(
        private readonly editor: BoardEditorModel,
        readonly id: "board-view" | `board-editor:${string}`,
        readonly name: string,
        private readonly callContext?: IAiCallContext,
    ) {}

    get aiVision(): IAiVisionDescriptor {
        const pageId = this.editor.page?.id;
        const declarations = [...BOARD_ELEMENTS, ...this.editor.chrome.getLiveToolbarElementDeclarations()];
        const elements = createElements(declarations, ui.highlightElement.bind(ui), {
            scopeSelector: pageId ? pageScopeSelector(pageId) : undefined,
            beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined,
            highlightOptions: { all: true },
        });
        const registration = this.editor.aiVision.getRegistration();
        const app = registration ? this.getAiVisionProxy(registration) : undefined;
        return {
            kind: "BoardEditor",
            summary: "Board chrome, trust, metadata, frame automation, panels, and reload facade.",
            members: [
                ...BROWSER_AUTOMATION_MEMBERS,
                ...BOARD_AUTOMATION_TAB_MEMBERS,
                ...BOARD_MEMBERS,
                ...(app ? [APP_MEMBER] : []),
                ...elements.members,
            ],
            help: withEditorGuideHelp(this.id, BOARD_HELP),
            elements: declarations,
            provide: (name) => name === "app" && app ? { value: app } : elements.provide(name),
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
        };
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
    async snapshot(options?: TabOption & {
        root?: string | { ref: string };
        interactive?: boolean;
        maxNodes?: number;
        maxChars?: number;
    }): Promise<string> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        return snapshot(this.editor.target, options?.tabId, { ...options, overlayHint: true, host: "board" });
    }

    /** Click a board element by CSS selector or explicit snapshot ref. */
    async click(locator: IBrowserElementLocator, options?: IBrowserClickOptions): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await clickElement(this.editor.target, resolveElementLocator(locator), options);
    }

    /** Hover a board element by CSS selector or explicit snapshot ref. */
    async hover(locator: IBrowserElementLocator, options?: IBrowserHoverOptions): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await hoverElement(this.editor.target, resolveElementLocator(locator), options);
    }

    /** Type into a board input by CSS selector or explicit snapshot ref. */
    async type(locator: IBrowserElementLocator, text: string, options?: IBrowserTypeOptions): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await typeTextInto(this.editor.target, resolveElementLocator(locator), text, {
            tabId: options?.tabId,
            slowly: options?.slowly,
            submit: options?.submit,
            synthetic: options?.synthetic,
            nth: options?.nth,
            timeout: options?.timeout,
            force: options?.force,
        });
    }

    /** Select a board option by CSS selector or explicit snapshot ref. */
    async select(
        locator: IBrowserElementLocator,
        values: string | string[],
        options?: IBrowserSelectOptions,
    ): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await selectOption(this.editor.target, resolveElementLocator(locator), values, options);
    }

    async check(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await checkElement(this.editor.target, resolveElementLocator(locator), options);
    }

    async uncheck(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await uncheckElement(this.editor.target, resolveElementLocator(locator), options);
    }

    async clear(locator: IBrowserElementLocator, options?: IBrowserTypeOptions): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await clearElement(this.editor.target, resolveElementLocator(locator), options);
    }

    /** Press a key or compound key in the selected board frame. */
    async pressKey(key: string, options?: IBrowserKeyboardOptions): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await pressKeyOnTarget(this.editor.target, key, options);
    }

    async keyDown(key: string, options?: IBrowserKeyboardOptions): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await keyDownOnTarget(this.editor.target, key, options);
    }

    async keyUp(key: string, options?: IBrowserKeyboardOptions): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await keyUpOnTarget(this.editor.target, key, options);
    }

    /** Evaluate JavaScript in the selected or explicitly requested board frame. */
    async evaluate(expression: string | IBrowserEvaluateFunction, options?: IBrowserEvaluateOptions): Promise<unknown> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        return evaluateInTarget(this.editor.target, expression, options);
    }

    /** Wait for exactly one selector, text, textGone, or time condition in a board frame. */
    async waitFor(options: WaitForOption): Promise<void> {
        if (options.state !== undefined && options.selector === undefined) {
            throw new Error("'state' can only be used with 'selector'.");
        }
        const modes = [options.selector, options.text, options.textGone, options.time]
            .filter(value => value !== undefined);
        if (modes.length !== 1) {
            throw new Error("Expected exactly one of 'selector', 'text', 'textGone', or 'time'.");
        }
        let mode: WaitMode;
        if (options.time !== undefined) {
            mode = { kind: "time", seconds: options.time };
        } else if (options.selector !== undefined) {
            mode = { kind: "selector", selector: options.selector, state: options.state ?? "attached" };
        } else if (options.text !== undefined) {
            mode = { kind: "text", text: options.text };
        } else {
            mode = { kind: "textGone", text: options.textGone! };
        }
        await ensureTargetReady(this.editor.target, options.tabId);
        await waitFor(this.editor.target, { mode, timeout: options.timeout, tabId: options.tabId });
    }

    /** Capture the selected board frame as PNG, or undefined when its session is unavailable. */
    async screenshot(options?: IBrowserScreenshotOptions): Promise<IBrowserScreenshot | undefined> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        return takeScreenshot(this.editor.target, options?.tabId, {
            ...options,
            host: "board",
            returnUndefinedIfUnavailable: true,
        });
    }

    async drag(
        source: IBrowserElementLocator,
        destination: IBrowserElementLocator,
        options?: IBrowserDragOptions,
    ): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await dragElements(
            this.editor.target,
            resolveElementLocator(source),
            resolveElementLocator(destination),
            options,
        );
    }

    async fillForm(fields: IBrowserFormField[]): Promise<void> {
        await ensureTargetReady(this.editor.target, fields.find(field => field.options?.tabId)?.options?.tabId);
        await fillFormOperation(this.editor.target, fields);
    }

    async setInputFiles(locator: IBrowserElementLocator, paths: string[], options?: TabOption): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await setInputFilesOperation(this.editor.target, resolveElementLocator(locator), paths, options);
    }

    /** Read recorded network requests for the selected board frame. */
    async networkRequests(options?: TabOption): Promise<IBrowserNetworkRequest[]> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        return networkRequests(this.editor.target, options?.tabId);
    }

    waitForResponse(urlOrRegex: string | RegExp, options?: IBrowserResponseWaitOptions): Promise<IBrowserResponse> {
        return waitForResponseOperation(this.editor.target, urlOrRegex, options);
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
        return consoleMessages(this.editor.target, options);
    }

    async pageErrors(options?: TabOption) {
        return pageErrors(this.editor.target, options?.tabId);
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
        if (!pageId) throw new Error("Board reload unavailable: no page host attached.");
        const boardRoot = this.boardRoot;
        if (!boardRoot) throw new Error("Board reload unavailable: no board root is attached.");

        const renderState = this.renderState;
        if (renderState !== "trusted" && renderState !== "bundled") {
            return Promise.resolve({ refreshed: true, pageId, frameReady: false, renderState });
        }
        return this.editor.reloadAndWait().then((result) => result.cancelled
            ? { refreshed: false, cancelled: true, pageId, frameReady: result.frameReady, renderState }
            : { refreshed: true, pageId, frameReady: result.frameReady, renderState });
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

installAutomationActivity(BoardEditorFacade.prototype, [
    "snapshot", "click", "hover", "type", "select", "check", "uncheck", "clear", "pressKey", "keyDown", "keyUp",
    "evaluate",
    "waitFor",
    "screenshot",
    "networkRequests",
    "waitForResponse",
    "consoleMessages",
    "pageErrors",
    "drag",
    "fillForm",
    "setInputFiles",
    "reload",
], instance => (instance as unknown as { editor: BoardEditorModel }).editor.target);

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
