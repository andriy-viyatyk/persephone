import {
    parsePath,
    type IAiElement,
    type IAiElementDeclaration,
    type IAiNodeShape,
    type IAiRemoteRequest,
    type IAiRemoteResponse,
    type IAiVisionShape,
} from "ai-vision";
import { boardRegistry } from "../../../api/boards/board-registry";
import { BOARD_CDP_TAB } from "../../../../ipc/api-types";
import { boardSecondaryPanelId } from "../board-secondary";
import { BoardFrameRegistry } from "./BoardFrameRegistry";

export type BoardAiVisionRequestHandler = (
    request: IAiRemoteRequest, timeoutMs: number, timeoutError: Error,
) => Promise<IAiRemoteResponse>;

export interface BoardAiVisionTransport {
    readonly iframe: HTMLIFrameElement;
    readonly generation: number;
    readonly request: BoardAiVisionRequestHandler;
}

export interface BoardAiVisionRegistration extends BoardAiVisionTransport {
    readonly shape: IAiVisionShape;
    readonly token: number;
    readonly incarnation: number;
    readonly warning: (message: string) => void;
}

export interface BoardAiVisionChannelOptions {
    readonly frameRegistry: BoardFrameRegistry;
    readonly boardRoot: () => string | undefined;
    readonly ensureReady: (tabId: string) => Promise<void>;
}

export interface BoardAiVisionRegistrationInput {
    readonly shape: unknown;
    readonly schemaVersion: unknown;
    readonly request: BoardAiVisionRequestHandler;
    readonly warning: (message: string) => void;
    readonly onValid: (reason: "register" | "refresh") => void;
}

export interface BoardAiVisionRequestOptions {
    readonly timeoutMs: number;
    readonly timeoutError: Error;
    readonly aggregateTimeoutError: (views: readonly string[]) => Error;
}

type BoardElementDeclaration = IAiElementDeclaration & { readonly view?: string };

export class BoardAiVisionChannel {
    private registration: BoardAiVisionRegistration | undefined;
    private registrationToken = 0;
    private incarnation = 0;
    private reloadAwaitingRegistration = false;
    private disposed = false;
    private readonly transports = new Map<string, BoardAiVisionTransport>();

    constructor(private readonly options: BoardAiVisionChannelOptions) {}

    register(
        input: BoardAiVisionRegistrationInput,
        frame: HTMLIFrameElement,
        generation: number,
        reason: "register" | "refresh",
    ): boolean {
        if (!isAiVisionShape(input.shape)
            || !isSchemaMajorOne(input.schemaVersion)
            || !isSchemaMajorOne(input.shape.schemaVersion)) {
            input.warning("Ignored invalid or untrusted AiVision registration.");
            return false;
        }
        input.onValid(reason);
        warnUnknownAiVisionViews(input.shape, this.options.frameRegistry, input.warning);
        const boardRoot = this.options.boardRoot();
        if (this.disposed || !boardRoot || !boardRegistry.isPermitted(boardRoot)
            || !this.options.frameRegistry.isCurrentFrame(BOARD_CDP_TAB, frame)) return false;
        const current = this.registration;
        const sameRemote = reason === "refresh" && current !== undefined
            && current.iframe === frame && current.generation === generation;
        this.registration = {
            shape: input.shape,
            iframe: frame,
            generation,
            token: ++this.registrationToken,
            incarnation: sameRemote ? current.incarnation : ++this.incarnation,
            request: input.request,
            warning: input.warning,
        };
        return true;
    }

    attachTransport(tabId: string, transport: BoardAiVisionTransport): void {
        const boardRoot = this.options.boardRoot();
        if (!boardRoot || !boardRegistry.isPermitted(boardRoot)
            || !this.options.frameRegistry.isCurrentFrame(tabId, transport.iframe)) return;
        this.transports.set(tabId, transport);
    }

    detach(tabId: string): void {
        this.transports.delete(tabId);
        if (tabId === BOARD_CDP_TAB) this.clearRegistration();
    }

    getRegistration(): BoardAiVisionRegistration | undefined {
        const boardRoot = this.options.boardRoot();
        if (!this.registration || !boardRoot || !boardRegistry.isPermitted(boardRoot)) {
            if (this.registration) this.clearRegistration();
            return undefined;
        }
        return this.registration;
    }

    clearRegistration(): void {
        this.registration = undefined;
    }

    warn(message: string): void {
        this.registration?.warning(message);
    }

    beginReload(): void {
        this.reloadAwaitingRegistration = true;
        this.clearRegistration();
    }

    resetReload(): void {
        this.reloadAwaitingRegistration = false;
    }

    consumeReloadRegistration(): boolean {
        if (!this.reloadAwaitingRegistration) return false;
        this.reloadAwaitingRegistration = false;
        return true;
    }

    beginDispose(): void {
        this.disposed = true;
        this.resetReload();
    }

    async request(
        req: IAiRemoteRequest,
        incarnation: number,
        getOptions: () => BoardAiVisionRequestOptions,
    ): Promise<IAiRemoteResponse> {
        const registration = this.getRegistration();
        if (!registration || registration.incarnation !== incarnation) {
            return {
                ok: false,
                error: "This board re-registered its AiVision model (a reload, or a second expose()). "
                    + "Read pages[i].editor.app again to pick up the new one.",
            };
        }
        const timeout = getOptions();
        const route = this.resolveRoute(req, registration);
        if (route.kind === "elements") {
            return this.readElements(req, route.declarations, timeout);
        }
        return this.sendToView(req, route.view, timeout.timeoutMs, timeout.timeoutError);
    }

    dispose(): void {
        this.clearRegistration();
        this.transports.clear();
        this.resetReload();
    }

    private resolveRoute(
        request: IAiRemoteRequest,
        registration: BoardAiVisionRegistration,
    ): { kind: "elements"; declarations: readonly BoardElementDeclaration[] }
        | { kind: "view"; view: string } {
        if (request.action === "ai:elements") {
            const declarations = this.getNode(request.path, registration.shape.root)?.elements;
            if (!declarations) {
                throw new Error(`AiVision elements are not available at ${JSON.stringify(request.path)}.`);
            }
            const boardDeclarations = declarations as readonly BoardElementDeclaration[];
            this.validateElementViews(boardDeclarations);
            return { kind: "elements", declarations: boardDeclarations };
        }
        if (request.action === "ai:highlight") {
            const declaration = this.getNode(request.path, registration.shape.root)?.elements
                ?.find((element) => element.name === request.name) as BoardElementDeclaration | undefined;
            if (!declaration) throw new Error(`Unknown AiVision element ${JSON.stringify(request.name ?? "")}.`);
            const view = declaration.view ?? "main";
            this.validateElementView(view);
            return { kind: "view", view };
        }
        const view = request.view ?? "main";
        this.validateElementView(view);
        return { kind: "view", view };
    }

    private getNode(path: string, root: IAiNodeShape): IAiNodeShape | undefined {
        let node: IAiNodeShape | undefined = root;
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
        if (view !== "main" && !this.options.frameRegistry.hasSecondaryView(view)) {
            throw new Error(`Unknown board view '${view}'.`);
        }
    }

    private async sendToView(
        request: IAiRemoteRequest,
        view: string,
        timeoutMs: number,
        timeoutError: Error,
    ): Promise<IAiRemoteResponse> {
        const deadline = Date.now() + timeoutMs;
        if (view !== "main") {
            await this.awaitBeforeDeadline(
                this.options.ensureReady(boardSecondaryPanelId(view)), deadline, timeoutError,
            );
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw timeoutError;
        return this.dispatch({ ...request, view }, remaining, timeoutError);
    }

    private async readElements(
        request: IAiRemoteRequest,
        declarations: readonly BoardElementDeclaration[],
        options: BoardAiVisionRequestOptions,
    ): Promise<IAiRemoteResponse> {
        const views = [...new Set(declarations.map((declaration) => declaration.view ?? "main"))];
        const aggregateTimeoutError = options.aggregateTimeoutError(views);
        const deadline = Date.now() + options.timeoutMs;
        const resultsByView = new Map<string, readonly IAiElement[]>();
        const unqueriedViews = new Set<string>();
        for (const view of views) {
            const tabId = view === "main" ? BOARD_CDP_TAB : boardSecondaryPanelId(view);
            if (view !== "main" && !this.isTransportReady(tabId)) {
                unqueriedViews.add(view);
                continue;
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw aggregateTimeoutError;
            const response = await this.dispatch({ ...request, view }, remaining, aggregateTimeoutError);
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

    private isTransportReady(tabId: string): boolean {
        const boardRoot = this.options.boardRoot();
        const transport = this.transports.get(tabId);
        return !!boardRoot && boardRegistry.isPermitted(boardRoot)
            && transport !== undefined
            && this.options.frameRegistry.isCurrentFrame(tabId, transport.iframe)
            && this.options.frameRegistry.isLoaded(tabId);
    }

    private dispatch(
        request: IAiRemoteRequest,
        timeoutMs: number,
        timeoutError: Error,
    ): Promise<IAiRemoteResponse> {
        const view = request.view;
        if (view !== undefined && view !== "main") {
            if (!this.options.frameRegistry.hasSecondaryView(view)) {
                return Promise.reject(new Error(`Unknown board view '${view}'.`));
            }
            const tabId = boardSecondaryPanelId(view);
            const transport = this.transports.get(tabId);
            const boardRoot = this.options.boardRoot();
            if (!transport || !this.options.frameRegistry.isCurrentFrame(tabId, transport.iframe) || !boardRoot
                || !boardRegistry.isPermitted(boardRoot)) {
                return Promise.reject(new Error(`The board view '${view}' is unavailable or untrusted.`));
            }
            return transport.request(request, timeoutMs, timeoutError);
        }
        const registration = this.getRegistration();
        if (!registration) return Promise.reject(new Error("The board has no trusted AiVision root."));
        if (!this.options.frameRegistry.isCurrentFrame(BOARD_CDP_TAB, registration.iframe)) {
            return Promise.reject(new Error("The board main frame is unavailable."));
        }
        return registration.request(request, timeoutMs, timeoutError);
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

function isSchemaMajorOne(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Math.floor(value) === 1;
}

function isAiVisionShape(value: unknown): value is IAiVisionShape {
    if (!value || typeof value !== "object") return false;
    const shape = value as { schemaVersion?: unknown; root?: unknown };
    if (!isSchemaMajorOne(shape.schemaVersion) || !shape.root || typeof shape.root !== "object") return false;
    const root = shape.root as { kind?: unknown; summary?: unknown; members?: unknown };
    return typeof root.kind === "string" && typeof root.summary === "string" && Array.isArray(root.members);
}

function warnUnknownAiVisionViews(
    shape: IAiVisionShape,
    frameRegistry: BoardFrameRegistry,
    warning: (message: string) => void,
): void {
    const visited = new Set<object>();
    const visit = (node: IAiVisionShape["root"]): void => {
        if (visited.has(node)) return;
        visited.add(node);
        for (const element of node.elements ?? []) {
            const view = (element as IAiElementWithView).view;
            if (view !== undefined && (typeof view !== "string"
                || (view !== "main" && !frameRegistry.hasSecondaryView(view)))) {
                warning(`Unknown AiVision element view ${JSON.stringify(view)} for ${JSON.stringify(element.name)}.`);
            }
        }
        for (const member of node.members) {
            if (member.node) visit(member.node);
            if (member.item) visit(member.item);
        }
        if (node.item) visit(node.item);
    };
    visit(shape.root);
}

interface IAiElementWithView {
    readonly view?: unknown;
}
