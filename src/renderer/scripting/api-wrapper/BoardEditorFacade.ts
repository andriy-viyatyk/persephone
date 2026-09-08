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
    IBrowserNetworkRequest,
    IBrowserScreenshot,
    IBrowserTab,
} from "../../api/types/browser-editor";
import { createRemoteProxy, parsePath, type IAiElement, type IAiElementDeclaration, type IAiMember, type IAiNodeShape, type IAiRemoteRequest, type IAiRemoteResponse, type IAiVisible, type IAiVisionDescriptor } from "ai-vision";
import { ui } from "../../api/ui";
import { createElements } from "ai-vision/dom";
import { activatePageAndWaitForLayout, pageScopeSelector } from "../ai-vision/page-elements";
import { BOARD_CDP_TAB } from "../../../ipc/api-types";
import type { BoardEditorModel } from "../../editors/board/BoardEditorModel";
import type { ITargetTab } from "../../automation/types";
import {
    clickElement,
    ensureTargetReady,
    evaluateInTarget,
    hoverElement,
    networkRequests,
    pressKeyOnTarget,
    resolveElementLocator,
    selectOption,
    takeScreenshot,
    snapshot,
    typeTextInto,
    waitFor,
} from "../../automation/operations";
import type { WaitMode } from "../../automation/operations";
import { boardTrust } from "../../api/board-trust";
import { boardSecondaryPanelId } from "../../editors/board/board-secondary";
import type { BoardManifest, SecondaryViewDecl } from "../../editors/board/board-manifest";
import { BROWSER_AUTOMATION_MEMBERS } from "../ai-vision/browser-automation-members";
import { explicitBoardCallTimeoutMs } from "../../api/boards";
import { isPositiveIntegerTimeout, resolveBoardCallTimeout } from "../../../shared/ai-vision-timeout";
import type { IAiCallContext } from "../ai-vision/root";
import { errMessage } from "../../../shared/utils";

const BOARD_ELEMENTS: readonly IAiElementDeclaration[] = [
    { name: "board-toolbar-explorer", purpose: "Locate the toolbar control that toggles the board's Explorer navigator.", where: "left edge of the board toolbar" },
    { name: "board-toolbar-reload", purpose: "Locate the toolbar Reload board control; the facade action is reload().", where: "left side of the board toolbar, after File Explorer" },
    { name: "board-toolbar-log", purpose: "Locate the control that opens the board's ui.log.", where: "left side of the board toolbar, after Reload" },
    { name: "board-toolbar-properties", purpose: "Locate the control that opens Board Info/properties.", where: "right side of the board toolbar, before the editor switch" },
    { name: "board-trust", purpose: "Locate the Trust board action in the untrusted placeholder.", where: "center of the untrusted board placeholder, when the board is untrusted" },
];

const BOARD_MEMBERS: readonly IAiMember[] = [
    { name: "id", kind: "property", summary: "The concrete board editor id: board-view or board-editor:<root>." },
    { name: "name", kind: "property", summary: "The board editor's registry display name." },
    { name: "boardRoot", kind: "property", summary: "The board root path, or undefined before a board root is attached." },
    { name: "boardName", kind: "property", summary: "The resolved board folder name, or undefined when the board is not found." },
    { name: "renderState", kind: "property", summary: "Model-backed trusted, untrusted, or not-found state." },
    { name: "getManifest", kind: "method", signature: "getManifest(): Promise<IBoardManifest | undefined>", summary: "Read a copied board manifest snapshot, or undefined when it is absent or malformed." },
    { name: "secondaryViews", kind: "property", summary: "Copied declared board-secondary panel records, or undefined when the board is unresolved." },
    { name: "statusText", kind: "property", summary: "The model-backed board status text, or undefined when cleared or unresolved." },
    { name: "busy", kind: "property", summary: "The model-backed busy flag, or undefined when the board is unresolved." },
    { name: "frameReady", kind: "property", summary: "Whether the mounted main board frame is registered and ready." },
    { name: "contentHostError", kind: "property", summary: "The trusted content-host restore error, when present." },
    { name: "reload", kind: "method", signature: "reload(): Promise<IBoardReloadResult>", summary: "Reload the board and report whether its main frame became ready." },
];

const BOARD_AUTOMATION_TAB_MEMBERS: readonly IAiMember[] = [
    { name: "tabs", kind: "property", summary: "List the board's main frame and declared secondary-view frames." },
    { name: "activeTab", kind: "property", summary: "The selected board frame, or undefined when no frame is active." },
    { name: "switchTab", kind: "method", signature: "switchTab(tabId: string): Promise<void>", summary: "Select the main frame or a declared board-secondary:<viewId> frame and wait until it is attachable." },
];

const APP_MEMBER: IAiMember = {
    name: "app",
    kind: "property",
    node: true,
    summary: "The trusted board-owned remote object model exposed through AiVision.",
};

const BOARD_HELP = `Access via pages[i].editor after narrowing editor.id to "board-view" or
"board-editor:<root>". This facade describes board chrome, trust state, manifest metadata, reload,
statusText, busy state, and declared secondary panels. It does not accept or return a trust decision:
untrusted content remains restricted until the user answers the Trust-this-Board dialog, shown as
"Trust this board?". The live dialog is dialogs[0]; its implementation is
src/renderer/ui/dialogs/TrustBoardDialog.ts and its scripting adapter is
src/renderer/scripting/ai-vision/dialogs/trust-board.ts. restricted() returns text only while
renderState is "untrusted"; trusted and not-found boards are unrestricted, and not-found means an
unavailable or empty board rather than a privacy boundary.

getManifest() returns copied known metadata and never exposes the parsed manifest object.
secondaryViews contains copied board-secondary:* declarations and current expansion state; sidebar
expansion and closure belong to page.panels. statusText, busy, renderState, contentHostError, and
frameReady are model-backed and never read from the footer or board iframe. reload() uses the shared
model waiter and returns frameReady: false when a trusted frame times out or is disposed; untrusted
and not-found boards return immediately with frameReady: false.

When a trusted board registers an AiVision shape, app is its board-owned remote tree; use app.$help or helpSearch to discover it.

Board content is rendered in a cross-origin iframe, and the shared automation members reach that
content. Use snapshot() for the iframe's complete accessibility content and pass its returned refs
as { ref: "..." }; plain strings are always CSS selectors. The board page's own chrome--toolbar
controls, the Trust-this-Board prompt, and secondary-view controls--is what elements names and
highlight points at, not iframe content. Everything rendered inside the iframe is reachable only
through snapshot() and its returned refs and never appears in elements; a board control absent from
a snapshot belongs in elements, while iframe content absent from elements belongs in snapshot().

tabs contains the main frame and declared board-secondary:<viewId> frames. Call switchTab(tabId)
before driving a secondary view and wait for it to complete. Navigation and creating or closing
tabs are not supported and are absent from this member list. Untrusted content remains restricted
by the existing Trust-this-Board gate; trusted and not-found render states differ, and not-found
is not a privacy grant. screenshot() returns the existing metadata-plus-image call result when
available. As verified live by US-1335, snapshots contain no password or plain-text input values;
evaluate() and existing value reads remain capable of exposing page data.`;

export class BoardEditorFacade implements IAiVisible, IBoardEditor {
    constructor(
        private readonly editor: BoardEditorModel,
        readonly id: "board-view" | `board-editor:${string}`,
        readonly name: string,
        private readonly callContext?: IAiCallContext,
    ) {}

    get aiVision(): IAiVisionDescriptor {
        const pageId = this.editor.page?.id;
        const elements = createElements(BOARD_ELEMENTS, ui.highlightElement.bind(ui), {
            scopeSelector: pageId ? pageScopeSelector(pageId) : undefined,
            beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined,
            highlightOptions: { all: true },
        });
        const registration = this.editor.getAiVisionRegistration();
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
            elements: BOARD_ELEMENTS,
            provide: (name) => name === "app" && app ? { value: app } : elements.provide(name),
            restricted: () => this.restricted(),
            summarize: () => ({
                kind: "BoardEditor",
                id: this.id,
                name: this.name,
                ...(this.boardRoot !== undefined ? { boardRoot: this.boardRoot } : {}),
                ...(this.boardName !== undefined ? { boardName: this.boardName } : {}),
                renderState: this.renderState,
                ...(this.frameReady !== undefined ? { frameReady: this.frameReady } : {}),
                ...(this.busy !== undefined ? { busy: this.busy } : {}),
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
    async snapshot(options?: TabOption): Promise<string> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        return snapshot(this.editor.target, options?.tabId, { overlayHint: true });
    }

    /** Click a board element by CSS selector or explicit snapshot ref. */
    async click(locator: IBrowserElementLocator, options?: TabOption): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await clickElement(this.editor.target, resolveElementLocator(locator), options?.tabId);
    }

    /** Hover a board element by CSS selector or explicit snapshot ref. */
    async hover(locator: IBrowserElementLocator, options?: TabOption): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await hoverElement(this.editor.target, resolveElementLocator(locator), options?.tabId);
    }

    /** Type into a board input by CSS selector or explicit snapshot ref. */
    async type(locator: IBrowserElementLocator, text: string, options?: TypeOption): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await typeTextInto(this.editor.target, resolveElementLocator(locator), text, {
            tabId: options?.tabId,
            slowly: options?.slowly,
            submit: options?.submit,
        });
    }

    /** Select a board option by CSS selector or explicit snapshot ref. */
    async select(locator: IBrowserElementLocator, values: string | string[], options?: TabOption): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await selectOption(this.editor.target, resolveElementLocator(locator), values, options?.tabId);
    }

    /** Press a key or compound key in the selected board frame. */
    async pressKey(key: string, options?: TabOption): Promise<void> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        await pressKeyOnTarget(this.editor.target, key, options?.tabId);
    }

    /** Evaluate JavaScript in the selected or explicitly requested board frame. */
    async evaluate(expression: string, options?: TabOption): Promise<unknown> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        return evaluateInTarget(this.editor.target, expression, options?.tabId);
    }

    /** Wait for exactly one selector, text, textGone, or time condition in a board frame. */
    async waitFor(options: WaitForOption): Promise<void> {
        const modes = [options.selector, options.text, options.textGone, options.time]
            .filter(value => value !== undefined);
        if (modes.length !== 1) {
            throw new Error("Expected exactly one of 'selector', 'text', 'textGone', or 'time'.");
        }
        let mode: WaitMode;
        if (options.time !== undefined) {
            mode = { kind: "time", seconds: options.time };
        } else if (options.selector !== undefined) {
            mode = { kind: "selector", selector: options.selector };
        } else if (options.text !== undefined) {
            mode = { kind: "text", text: options.text };
        } else {
            mode = { kind: "textGone", text: options.textGone! };
        }
        await ensureTargetReady(this.editor.target, options.tabId);
        await waitFor(this.editor.target, { mode, timeout: options.timeout, tabId: options.tabId });
    }

    /** Capture the selected board frame as PNG, or undefined when its session is unavailable. */
    async screenshot(options?: TabOption): Promise<IBrowserScreenshot | undefined> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        return takeScreenshot(this.editor.target, options?.tabId, { returnUndefinedIfUnavailable: true });
    }

    /** Read recorded network requests for the selected board frame. */
    async networkRequests(options?: TabOption): Promise<IBrowserNetworkRequest[]> {
        await ensureTargetReady(this.editor.target, options?.tabId);
        return networkRequests(this.editor.target, options?.tabId);
    }

    /** Select a board frame and wait until a secondary frame is attachable. */
    async switchTab(tabId: string): Promise<void> {
        await this.editor.target.switchTab(tabId);
        await ensureTargetReady(this.editor.target, tabId);
    }

    get boardRoot(): string | undefined {
        return this.editor.state.get().boardRoot;
    }

    get boardName(): string | undefined {
        return this.editor.state.get().selectedBoard;
    }

    get renderState(): BoardRenderState {
        const state = this.editor.state.get();
        if (!state.boardRoot || !state.selectedBoard) return "not-found";
        return boardTrust.isTrusted(state.boardRoot) ? "trusted" : "untrusted";
    }

    async getManifest(): Promise<IBoardManifest | undefined> {
        const manifest = await this.editor.readManifestForFacade();
        return manifest ? copyManifest(manifest) : undefined;
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
        return this.editor.state.get().statusText || undefined;
    }

    get busy(): boolean | undefined {
        if (!this.isResolvedBoard()) return undefined;
        return this.editor.state.get().busy ?? false;
    }

    get frameReady(): boolean | undefined {
        if (!this.isResolvedBoard()) return undefined;
        if (!this.editor.getFrame(BOARD_CDP_TAB)) return undefined;
        return this.editor.loadedTabs.has(BOARD_CDP_TAB);
    }

    get contentHostError(): string | undefined {
        return this.renderState === "trusted"
            ? this.editor.state.get().contentHostError
            : undefined;
    }

    reload(): Promise<IBoardReloadResult> {
        const pageId = this.editor.page?.id;
        if (!pageId) throw new Error("Board reload unavailable: no page host attached.");
        const boardRoot = this.boardRoot;
        if (!boardRoot) throw new Error("Board reload unavailable: no board root is attached.");

        const renderState = this.renderState;
        if (renderState !== "trusted") {
            return Promise.resolve({ refreshed: true, pageId, frameReady: false, renderState });
        }
        return this.editor.reloadAndWait().then((frameReady) => ({
            refreshed: true,
            pageId,
            frameReady,
            renderState,
        }));
    }

    private isResolvedBoard(): boolean {
        const state = this.editor.state.get();
        return !!state.boardRoot && !!state.selectedBoard;
    }

    private restricted(): string | undefined {
        return this.renderState === "untrusted"
            ? "This board's content is restricted until the user answers the Trust-this-Board dialog (shown as \"Trust this board?\"). The facade reports trust state but never grants trust or accepts a trust decision."
            : undefined;
    }

    private aiVisionProxy?: { token: number; value: IAiVisible };

    private getAiVisionProxy(registration: NonNullable<ReturnType<BoardEditorModel["getAiVisionRegistration"]>>): IAiVisible {
        if (this.aiVisionProxy?.token === registration.token) return this.aiVisionProxy.value;
        // The proxy is built from ONE registration's shape, so every request it later emits must be
        // checked against that registration — a reload re-registers a new shape under a new token,
        // and a proxy handed out before it must fail loudly rather than address the new document.
        const token = registration.token;
        const value = createRemoteProxy(registration.shape, (request) => this.sendAiVision(request, token), {
            restricted: () => this.restricted(),
            onWarning: (message) => this.editor.appendAiVisionWarning(message),
            onError: (error) => this.editor.appendAiVisionWarning(errMessage(error)),
        });
        this.aiVisionProxy = { token: registration.token, value };
        return value;
    }

    private async sendAiVision(request: IAiRemoteRequest, token: number): Promise<IAiRemoteResponse> {
        const current = this.editor.getAiVisionRegistration();
        if (!current || current.token !== token) {
            return {
                ok: false,
                error: "This board re-registered its AiVision model (a reload, or a second expose()). "
                    + "Read pages[i].editor.app again to pick up the new one.",
            };
        }
        const timeout = resolveBoardCallTimeout(
            isPositiveIntegerTimeout(this.callContext?.timeoutMs) ? this.callContext?.timeoutMs : undefined,
            isPositiveIntegerTimeout(request.timeoutMs) ? request.timeoutMs : undefined,
            explicitBoardCallTimeoutMs(),
        );
        const pageId = this.editor.page?.id;
        const path = request.path || "<root>";
        const agentPath = pageId
            ? `pages[${JSON.stringify(pageId)}].editor.app.${path}`
            : `app.${path}`;
        const timeoutError = new Error(
            `AiVision request timed out at level ${timeout.level} (${timeout.label}) for path ${JSON.stringify(agentPath)}.`,
        );
        const route = this.resolveBoardElementRoute(request);
        if (route.kind === "elements") {
            return this.readElementsAcrossMountedViews(request, route.declarations, timeout);
        }
        return this.sendToViewAfterReady({ ...request, view: route.view }, route.view, timeout.ms, timeoutError);
    }

    private resolveBoardElementRoute(request: IAiRemoteRequest):
        | { kind: "elements"; declarations: readonly BoardElementDeclaration[] }
        | { kind: "view"; view: string } {
        if (request.action === "ai:elements") {
            const declarations = this.getBoardElementNode(request.path)?.elements;
            if (!declarations) throw new Error(`AiVision elements are not available at ${JSON.stringify(request.path)}.`);
            const boardDeclarations = declarations as readonly BoardElementDeclaration[];
            this.validateElementViews(boardDeclarations);
            return { kind: "elements", declarations: boardDeclarations };
        }
        if (request.action === "ai:highlight") {
            const declaration = this.getBoardElementNode(request.path)?.elements
                ?.find((element) => element.name === request.name) as BoardElementDeclaration | undefined;
            if (!declaration) {
                throw new Error(`Unknown AiVision element ${JSON.stringify(request.name ?? "")}.`);
            }
            const view = declaration.view ?? "main";
            this.validateElementView(view);
            return { kind: "view", view };
        }
        const view = request.view ?? "main";
        this.validateElementView(view);
        return { kind: "view", view };
    }

    private getBoardElementNode(path: string): IAiNodeShape | undefined {
        let node = this.editor.getAiVisionRegistration()?.shape.root;
        if (!node) return undefined;
        try {
            for (const segment of parsePath(path)) {
                if (segment.type === "member") {
                    node = node.members.find((member) => member.name === segment.name)?.node;
                } else if (segment.type === "index") {
                    node = node?.item;
                } else {
                    return undefined;
                }
                if (!node) return undefined;
            }
        } catch {
            return undefined;
        }
        return node;
    }

    private validateElementViews(declarations: readonly BoardElementDeclaration[]): void {
        for (const declaration of declarations) this.validateElementView(declaration.view ?? "main");
    }

    private validateElementView(view: string): void {
        if (view === "main") return;
        const known = (this.editor.state.get().secondaryViewDefs ?? []).some((definition) => definition.id === view);
        if (!known) throw new Error(`Unknown board view '${view}'.`);
    }

    private async sendToViewAfterReady(
        request: IAiRemoteRequest,
        view: string,
        timeoutMs: number,
        timeoutError: Error,
    ): Promise<IAiRemoteResponse> {
        const deadline = Date.now() + timeoutMs;
        if (view !== "main") {
            await this.awaitBeforeDeadline(
                this.editor.target.ensureReady(boardSecondaryPanelId(view)),
                deadline,
                timeoutError,
            );
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw timeoutError;
        return this.editor.requestAiVision(request, remaining, timeoutError);
    }

    private async readElementsAcrossMountedViews(
        request: IAiRemoteRequest,
        declarations: readonly BoardElementDeclaration[],
        timeout: ReturnType<typeof resolveBoardCallTimeout>,
    ): Promise<IAiRemoteResponse> {
        const views = [...new Set(declarations.map((declaration) => declaration.view ?? "main"))];
        const aggregateTimeoutError = new Error(
            `AiVision elements aggregation timed out at level ${timeout.level} (${timeout.label}) while querying views: ${views.join(", ")}.`,
        );
        const deadline = Date.now() + timeout.ms;
        const resultsByView = new Map<string, readonly IAiElement[]>();
        const unqueriedViews = new Set<string>();
        for (const view of views) {
            const tabId = view === "main" ? BOARD_CDP_TAB : boardSecondaryPanelId(view);
            if (view !== "main" && !this.editor.isAiVisionTransportReady(tabId)) {
                unqueriedViews.add(view);
                continue;
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw aggregateTimeoutError;
            const response = await this.editor.requestAiVision(
                { ...request, view },
                remaining,
                aggregateTimeoutError,
            );
            if (!response.ok) return response;
            if (!Array.isArray(response.result)) {
                throw new Error(`AiVision elements response for view '${view}' was not an array.`);
            }
            resultsByView.set(view, response.result as readonly IAiElement[]);
        }

        const result = declarations.map((declaration) => {
            const view = declaration.view ?? "main";
            const frameResult = resultsByView.get(view)?.find((element) => element.name === declaration.name);
            if (frameResult) return frameResult;
            if (unqueriedViews.has(view)) {
                return {
                    name: declaration.name,
                    purpose: declaration.purpose,
                    ...(declaration.where !== undefined ? { where: declaration.where } : {}),
                    selector: declaration.selector ?? `[data-name="${declaration.name}"]`,
                    visible: false,
                    visibilityNote: `View "${view}" is not mounted; it was not queried. highlight mounts it.`,
                };
            }
            throw new Error(`AiVision element ${JSON.stringify(declaration.name)} was missing from view '${view}'.`);
        });
        return { ok: true, result };
    }

    private async awaitBeforeDeadline(
        promise: Promise<void>,
        deadline: number,
        timeoutError: Error,
    ): Promise<void> {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw timeoutError;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                promise,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(timeoutError), remaining);
                }),
            ]);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }
}

type BoardElementDeclaration = IAiElementDeclaration & { readonly view?: string };

function copyManifest(manifest: BoardManifest): IBoardManifest | undefined {
    if (typeof manifest.schemaVersion !== "number") return undefined;
    const copy: Partial<MutableBoardManifest> = { schemaVersion: manifest.schemaVersion };
    if (typeof manifest.name === "string") copy.name = manifest.name;
    if (typeof manifest.description === "string") copy.description = manifest.description;
    if (typeof manifest.author === "string") copy.author = manifest.author;
    if (typeof manifest.repository === "string") copy.repository = manifest.repository;
    if (typeof manifest.version === "string") copy.version = manifest.version;
    if (typeof manifest.standalone === "boolean") copy.standalone = manifest.standalone;
    if (typeof manifest.minAppVersion === "string") copy.minAppVersion = manifest.minAppVersion;
    if (Array.isArray(manifest.fileMasks)) copy.fileMasks = manifest.fileMasks.filter(isString);
    if (Array.isArray(manifest.folderMasks)) copy.folderMasks = manifest.folderMasks.filter(isString);
    if (typeof manifest.editorPriority === "number") copy.editorPriority = manifest.editorPriority;
    if (typeof manifest.editorName === "string") copy.editorName = manifest.editorName;
    if (manifest.editorKind === "simple" || manifest.editorKind === "content-host") copy.editorKind = manifest.editorKind;
    if (manifest.editorSources === "local" || manifest.editorSources === "any") copy.editorSources = manifest.editorSources;
    if (Array.isArray(manifest.secondaryViews)) {
        copy.secondaryViews = manifest.secondaryViews
            .filter((view): view is SecondaryViewDecl => !!view && typeof view.id === "string")
            .map((view) => ({
                id: view.id,
                ...(typeof view.html === "string" ? { html: view.html } : {}),
                ...(typeof view.title === "string" ? { title: view.title } : {}),
            }));
    }
    return copy as IBoardManifest;
}

type MutableBoardManifest = {
    -readonly [Key in keyof IBoardManifest]: IBoardManifest[Key];
};

function isString(value: unknown): value is string {
    return typeof value === "string";
}

interface TabOption {
    tabId?: string;
}

interface TypeOption extends TabOption {
    slowly?: boolean;
    submit?: boolean;
}

interface WaitForOption extends TabOption {
    selector?: string;
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
