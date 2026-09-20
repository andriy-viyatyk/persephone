import type {
    BoardNavigationReturnMsg,
} from "../../ipc/board-bridge-channels";
import { pagesModel } from "./pages";
import { browserUrlChanged, type BrowserUrlEvent } from "../core/state/events";
import type { BoardEditorModel } from "../editors/board/BoardEditorModel";

const RETURN_HOST_SUFFIX = ".board-return.persephone.invalid";
const RETURN_PATH = "/";
const RETIRED_CLAIM_TTL_MS = 10 * 60 * 1000;

export interface BoardNavigationReturnEvent {
    readonly url: string;
    readonly query: Readonly<Record<string, readonly string[]>>;
    readonly hash: Readonly<Record<string, readonly string[]>>;
}

export interface NativeNavigationReturnClaimOptions {
    pageId?: string;
    onReturn: (event: BoardNavigationReturnEvent) => void;
}

export interface NavigationReturnClaim {
    readonly url: string;
    dispose(): void;
}

export interface BoardNavigationReturnClaimOptions {
    pageId?: string;
    model: BoardEditorModel;
    frame: HTMLIFrameElement;
    tabId: string;
    targetOrigin: string;
    generation: number;
    currentGeneration: () => number;
    isCurrent: () => boolean;
}

interface BoardFrameOwner {
    readonly model: BoardEditorModel;
    readonly frame: HTMLIFrameElement;
    readonly tabId: string;
    readonly targetOrigin: string;
    readonly generation: number;
    readonly currentGeneration: () => number;
    readonly isCurrent: () => boolean;
}

interface ReturnClaimRecord {
    readonly hostname: string;
    readonly origin: string;
    readonly pageId?: string;
    readonly boardOwner?: BoardFrameOwner;
    readonly deliver: (event: BoardNavigationReturnEvent) => void;
    retiredTimer?: ReturnType<typeof setTimeout>;
}

function createParameterMap(value: string): Readonly<Record<string, readonly string[]>> {
    const result: Record<string, string[]> = {};
    new URLSearchParams(value).forEach((item, key) => {
        const values = Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
        if (values) {
            values.push(item);
            return;
        }
        const next = [item];
        Object.defineProperty(result, key, {
            value: next,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    });
    for (const values of Object.values(result)) Object.freeze(values);
    return Object.freeze(result) as Readonly<Record<string, readonly string[]>>;
}

function parseReturnEvent(url: string): BoardNavigationReturnEvent {
    const parsed = new URL(url);
    return {
        url,
        query: createParameterMap(parsed.search.slice(1)),
        hash: createParameterMap(parsed.hash.slice(1)),
    };
}

function mintReturnUrl(): { url: string; hostname: string; origin: string } {
    const nonce = globalThis.crypto.randomUUID();
    const hostname = `${nonce}${RETURN_HOST_SUFFIX}`;
    return {
        url: `https://${hostname}${RETURN_PATH}`,
        hostname,
        origin: `https://${hostname}`,
    };
}

/**
 * Renderer-owned navigation-return registry. It is deliberately independent of
 * the board port and browser editor: both native renderers and board frames use
 * the same nonce-scoped claim path, which stays live until its owner goes away.
 */
class BoardNavigationReturnService {
    private readonly activeClaims = new Map<string, ReturnClaimRecord>();
    private readonly retiredClaims = new Map<string, ReturnClaimRecord>();
    private initialized = false;

    initialize(): void {
        if (this.initialized) return;
        this.initialized = true;
        browserUrlChanged.subscribe(this.handleBrowserUrl);
    }

    createNativeClaim(options: NativeNavigationReturnClaimOptions): NavigationReturnClaim {
        const claim = this.registerClaim({
            pageId: options.pageId,
            deliver: options.onReturn,
        });
        return {
            url: claim.url,
            dispose: () => this.retireClaim(claim.hostname),
        };
    }

    createBoardClaim(options: BoardNavigationReturnClaimOptions): string {
        const owner: BoardFrameOwner = {
            model: options.model,
            frame: options.frame,
            tabId: options.tabId,
            targetOrigin: options.targetOrigin,
            generation: options.generation,
            currentGeneration: options.currentGeneration,
            isCurrent: options.isCurrent,
        };
        const claim = this.registerClaim({
            pageId: options.pageId,
            boardOwner: owner,
            deliver: (event) => this.deliverToBoard(owner, event),
        });
        return claim.url;
    }

    releaseBoardFrame(model: BoardEditorModel, frame: HTMLIFrameElement, tabId: string): void {
        this.retireMatchingBoardClaims(model, frame, tabId);
    }

    resetBoardFrame(model: BoardEditorModel, frame: HTMLIFrameElement, tabId: string): void {
        this.retireMatchingBoardClaims(model, frame, tabId);
    }

    private registerClaim(options: {
        pageId?: string;
        boardOwner?: BoardFrameOwner;
        deliver: (event: BoardNavigationReturnEvent) => void;
    }): ReturnClaimRecord & { url: string } {
        const minted = mintReturnUrl();
        const claim: ReturnClaimRecord & { url: string } = {
            ...minted,
            pageId: options.pageId,
            boardOwner: options.boardOwner,
            deliver: options.deliver,
        };
        this.activeClaims.set(claim.hostname, claim);
        return claim;
    }

    private retireMatchingBoardClaims(
        model: BoardEditorModel,
        frame: HTMLIFrameElement,
        tabId: string,
    ): void {
        for (const [hostname, claim] of this.activeClaims) {
            const owner = claim.boardOwner;
            if (owner?.model === model && owner.frame === frame && owner.tabId === tabId) {
                this.retireClaim(hostname);
            }
        }
    }

    private retireClaim(hostname: string): void {
        const claim = this.activeClaims.get(hostname);
        if (!claim) return;
        this.activeClaims.delete(hostname);
        claim.retiredTimer = setTimeout(() => {
            if (this.retiredClaims.get(hostname) === claim) this.retiredClaims.delete(hostname);
        }, RETIRED_CLAIM_TTL_MS);
        this.retiredClaims.set(hostname, claim);
    }

    private readonly handleBrowserUrl = (event: BrowserUrlEvent): void => {
        let parsed: URL;
        try {
            parsed = new URL(event.url);
        } catch {
            return;
        }
        if (parsed.protocol !== "https:" || parsed.pathname !== RETURN_PATH) return;

        const claim = this.activeClaims.get(parsed.hostname) ?? this.retiredClaims.get(parsed.hostname);
        if (!claim || parsed.origin !== claim.origin) return;

        event.handled = true;
        // A retired nonce is consumed: it exists only so a late return rewinds the browser
        // instead of stranding it, and there is no longer an owner to deliver to. An ACTIVE
        // claim is NOT consumed - the owner mints one URL for its whole lifetime and may
        // return through it repeatedly (Excalidraw's library browser is reopened all the
        // time). It ends at frame disposal or reload, never at first use.
        if (this.retiredClaims.get(parsed.hostname) === claim) {
            if (claim.retiredTimer !== undefined) clearTimeout(claim.retiredTimer);
            this.retiredClaims.delete(parsed.hostname);
            return;
        }

        if (claim.boardOwner && !this.isBoardOwnerCurrent(claim.boardOwner)) return;
        if (claim.pageId && !pagesModel.findPage(claim.pageId)) return;
        if (claim.pageId) pagesModel.showPage(claim.pageId);
        try {
            claim.deliver(parseReturnEvent(event.url));
        } catch (error: unknown) {
            console.error("Board navigation return callback failed:", error);
        }
    }

    private isBoardOwnerCurrent(owner: BoardFrameOwner): boolean {
        return owner.model.frames.get(owner.tabId) === owner.frame
            && owner.isCurrent()
            && owner.currentGeneration() === owner.generation;
    }

    private deliverToBoard(owner: BoardFrameOwner, event: BoardNavigationReturnEvent): void {
        if (!this.isBoardOwnerCurrent(owner)) return;
        const contentWindow = owner.frame.contentWindow;
        if (!contentWindow) return;
        const message: BoardNavigationReturnMsg = {
            __persephone: "navigation:return",
            url: event.url,
            query: event.query,
            hash: event.hash,
        };
        contentWindow.postMessage(message, owner.targetOrigin);
    }
}

export const boardNavigationReturnService = new BoardNavigationReturnService();

export function initBoardNavigationReturn(): void {
    boardNavigationReturnService.initialize();
}
