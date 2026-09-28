import {
    isCapabilityErrorCode,
    type CapabilityOutcome,
    type CapabilityRegistration,
    type CapabilityTransport,
    type IntentRequest,
} from "../../ipc/capability-bus-channels";
import { CapabilityError } from "./capability-bus";
import { pagesModel } from "./pages";
import { boardPagesForRoot } from "./board-updates";
import type { PageModel } from "./pages/PageModel";
import { fpNormalizeForCompare } from "../core/utils/file-path";
import { errMessage } from "../../shared/utils";

export interface BoardCapabilityFrame {
    readonly boardRoot: string;
    readonly pageId: string;
    readonly generation: number;
    readonly iframe: HTMLIFrameElement;
    readonly contentWindow: Window;
    ready: boolean;
    dispatch(request: IntentRequest, initial?: boolean): Promise<unknown>;
    cancel(requestId: string): void;
}

const frames = new Map<string, BoardCapabilityFrame>();
const frameListeners = new Set<(frame: BoardCapabilityFrame) => void>();

export function registerBoardCapabilityFrame(frame: BoardCapabilityFrame): void {
    frames.set(frame.pageId, frame);
    for (const listener of frameListeners) listener(frame);
}

export function unregisterBoardCapabilityFrame(
    pageId: string,
    frame?: BoardCapabilityFrame,
): void {
    if (!frame || frames.get(pageId) === frame) frames.delete(pageId);
}

export function boardCapabilityFrameForPage(pageId: string): BoardCapabilityFrame | undefined {
    return frames.get(pageId);
}

export function subscribeBoardCapabilityFrames(
    listener: (frame: BoardCapabilityFrame) => void,
): () => void {
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
}

export function markBoardCapabilityFrameReady(pageId: string, generation: number): void {
    boardCapabilityTransport.markFrameReady(pageId, generation);
}

export function failBoardCapabilityFrame(pageId: string, generation: number, error: CapabilityError): void {
    boardCapabilityTransport.failFrame(pageId, generation, error);
}

type DispatchRoute = {
    readonly registration: CapabilityRegistration;
    readonly request: IntentRequest;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: CapabilityError) => void;
    reservation?: PageReservation;
    page?: PageModel;
    pageUnsubscribe?: () => void;
    active: boolean;
};

interface PageReservation {
    readonly key: string;
    readonly root: string;
    readonly queue: DispatchRoute[];
    page?: PageModel;
    createdPage: boolean;
    opening: boolean;
    initialRequestId?: string;
    advanceQueued: boolean;
}

const reservationsByRoot = new Map<string, PageReservation>();
const reservationsByPage = new Map<string, PageReservation>();
const initialIntentByPage = new Map<string, IntentRequest>();

export function takeInitialIntent(pageId: string): IntentRequest | undefined {
    const intent = initialIntentByPage.get(pageId);
    initialIntentByPage.delete(pageId);
    return intent;
}

function boardRootOf(registration: CapabilityRegistration): string | undefined {
    return registration.origin === "board" ? registration.boardRoot : undefined;
}

function capabilityTitle(registration: CapabilityRegistration, request: IntentRequest): string {
    const payload = request.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const title = (payload as { title?: unknown }).title;
        if (typeof title === "string" && title.trim()) return title;
    }
    return registration.boardName || "Untitled Board";
}

function normalizeTransportError(error: unknown): CapabilityError {
    if (error instanceof CapabilityError) return error;
    if (error && typeof error === "object") {
        const value = error as { code?: unknown; message?: unknown };
        if (isCapabilityErrorCode(value.code)) {
            return new CapabilityError(
                value.code,
                typeof value.message === "string" ? value.message : "The board request failed.",
            );
        }
    }
    return new CapabilityError("rejected", errMessage(error, "The board request failed."));
}

class BoardCapabilityTransport implements CapabilityTransport {
    private readonly routes = new Map<string, DispatchRoute>();
    private readonly pageChains = new Map<string, { requestId: string; chain: string[]; depth: number }>();
    constructor() {
        subscribeBoardCapabilityFrames((frame) => this.onFrame(frame));
    }

    dispatch(registration: CapabilityRegistration, request: IntentRequest): Promise<unknown> {
        const root = boardRootOf(registration);
        if (!root) {
            return Promise.reject(new CapabilityError(
                "no-handler",
                "The capability handler board is unavailable.",
            ));
        }
        const settlers: {
            resolve: (value: unknown) => void;
            reject: (error: CapabilityError) => void;
        } = {
            resolve: () => { throw new Error("Capability dispatch promise is not initialized."); },
            reject: () => { throw new Error("Capability dispatch promise is not initialized."); },
        };
        const promise = new Promise<unknown>((resolve, reject) => {
            settlers.resolve = resolve;
            settlers.reject = reject;
        });
        const route: DispatchRoute = {
            registration,
            request,
            resolve: (value) => settlers.resolve(value),
            reject: (error) => settlers.reject(error),
            active: false,
        };
        this.routes.set(request.requestId, route);
        const rootKey = fpNormalizeForCompare(root);
        const producesPage = registration.alwaysOpensNewPage === true;
        let reservation = producesPage ? undefined : reservationsByRoot.get(rootKey);
        const existingPage = !producesPage && !reservation ? boardPagesForRoot(root)[0] : undefined;
        if (!reservation) {
            reservation = this.createReservation(rootKey, root);
            if (!producesPage) reservationsByRoot.set(rootKey, reservation);
            if (existingPage) {
                this.bindPage(reservation, existingPage);
                pagesModel.navigation.showPage(existingPage.id);
            }
            else this.openReservation(reservation, route);
        }
        route.reservation = reservation;
        reservation.queue.push(route);
        if (reservation.page) this.bindRouteToPage(reservation, route, reservation.page);
        if (!reservation.opening) this.drain(reservation);
        return promise;
    }

    cancel(registration: CapabilityRegistration, requestId: string): void {
        const route = this.routes.get(requestId);
        if (!route || route.registration !== registration) return;
        const reservation = this.reservationForRoute(route);
        if (!reservation) return;
        if (route.active) {
            const frame = reservation.page ? boardCapabilityFrameForPage(reservation.page.id) : undefined;
            try { frame?.cancel(requestId); } catch { /* best effort */ }
            if (this.pageChains.get(reservation.page?.id ?? "")?.requestId === requestId) {
                this.pageChains.delete(reservation.page?.id ?? "");
            }
        }
        reservation.queue.splice(reservation.queue.indexOf(route), 1);
        if (reservation.initialRequestId === requestId) {
            reservation.initialRequestId = undefined;
            if (reservation.page) initialIntentByPage.delete(reservation.page.id);
        }
        this.removeRoute(route);
        if (route.active) this.scheduleAdvance(reservation);
    }

    chainForPage(pageId: string | undefined): { chain: readonly string[]; depth: number } {
        const current = pageId === undefined ? undefined : this.pageChains.get(pageId);
        return current ? { chain: [...current.chain], depth: current.depth } : { chain: [], depth: 0 };
    }

    private createReservation(key: string, root: string): PageReservation {
        return { key, root, queue: [], opening: false, createdPage: false, advanceQueued: false };
    }

    private openReservation(reservation: PageReservation, opener: DispatchRoute): void {
        reservation.opening = true;
        void pagesModel.lifecycle.openBoardHandlerPage(
            reservation.root,
            capabilityTitle(opener.registration, opener.request),
            (page) => {
                reservation.createdPage = true;
                this.bindPage(reservation, page);
            },
        ).then((page) => {
            reservation.opening = false;
            if (!page) throw new CapabilityError("handler-closed", "The capability handler page did not open.");
            if (!reservation.page) this.bindPage(reservation, page);
            this.drain(reservation);
        }).catch((error: unknown) => {
            reservation.opening = false;
            const normalized = normalizeTransportError(error);
            for (const route of [...reservation.queue]) {
                this.removeRoute(route);
                route.reject(normalized);
            }
            if (reservationsByRoot.get(reservation.key) === reservation) reservationsByRoot.delete(reservation.key);
            if (reservation.page) {
                reservationsByPage.delete(reservation.page.id);
                initialIntentByPage.delete(reservation.page.id);
            }
        });
    }

    private bindPage(reservation: PageReservation, page: PageModel): void {
        reservation.page = page;
        reservationsByPage.set(page.id, reservation);
        reservation.queue.forEach((route) => this.bindRouteToPage(reservation, route, page));
        if (reservation.createdPage && reservation.queue[0]) {
            reservation.initialRequestId = reservation.queue[0].request.requestId;
            initialIntentByPage.set(page.id, reservation.queue[0].request);
        }
        page.disposed.subscribe(() => this.closePage(reservation));
        this.onFrame(boardCapabilityFrameForPage(page.id));
    }

    private bindRouteToPage(reservation: PageReservation, route: DispatchRoute, page: PageModel): void {
        if (route.page === page) return;
        route.pageUnsubscribe?.();
        route.page = page;
        route.pageUnsubscribe = page.disposed.subscribe(() => this.closePage(reservation));
    }

    private closePage(reservation: PageReservation): void {
        const error = new CapabilityError("handler-closed", "The capability handler page was closed.");
        for (const route of [...reservation.queue]) {
            this.removeRoute(route);
            route.reject(error);
        }
        if (reservation.page) {
            reservationsByPage.delete(reservation.page.id);
            initialIntentByPage.delete(reservation.page.id);
            this.pageChains.delete(reservation.page.id);
        }
        if (reservationsByRoot.get(reservation.key) === reservation) {
            reservationsByRoot.delete(reservation.key);
        }
    }

    private onFrame(frame: BoardCapabilityFrame | undefined): void {
        if (!frame) return;
        const reservation = reservationsByPage.get(frame.pageId);
        if (reservation) this.drain(reservation);
    }

    private drain(reservation: PageReservation): void {
        const page = reservation.page;
        const frame = page ? boardCapabilityFrameForPage(page.id) : undefined;
        if (!page || !frame?.ready || reservation.queue.length === 0) return;
        const route = reservation.queue[0];
        if (route.active) return;
        route.active = true;
        const initial = route.request.requestId === reservation.initialRequestId;
        this.setActiveChain(page.id, route);
        void frame.dispatch(route.request, initial).then(
            (value) => this.finishRoute(reservation, route, undefined, value),
            (error: unknown) => this.finishRoute(reservation, route, normalizeTransportError(error)),
        );
        if (initial) reservation.initialRequestId = undefined;
    }

    markFrameReady(pageId: string, generation: number): void {
        const frame = frames.get(pageId);
        if (!frame || frame.generation !== generation) return;
        const reservation = reservationsByPage.get(pageId);
        if (reservation) this.drain(reservation);
    }

    failFrame(pageId: string, generation: number, error: CapabilityError): void {
        const frame = frames.get(pageId);
        if (!frame || frame.generation !== generation) return;
        const reservation = reservationsByPage.get(pageId);
        const route = reservation?.queue[0];
        if (!reservation || !route || route.request.requestId !== reservation.initialRequestId) return;
        reservation.initialRequestId = undefined;
        initialIntentByPage.delete(pageId);
        reservation.queue.shift();
        this.removeRoute(route);
        route.reject(error);
    }

    private setActiveChain(pageId: string, route: DispatchRoute): void {
        this.pageChains.set(pageId, {
            requestId: route.request.requestId,
            chain: [...route.request.chain, route.registration.handlerKey],
            depth: route.request.depth + 1,
        });
    }

    private finishRoute(reservation: PageReservation, route: DispatchRoute, error?: CapabilityError, value?: unknown): void {
        if (this.routes.get(route.request.requestId) !== route) return;
        const pageId = reservation.page?.id;
        if (pageId && this.pageChains.get(pageId)?.requestId === route.request.requestId) this.pageChains.delete(pageId);
        reservation.queue.shift();
        this.removeRoute(route);
        if (error) route.reject(error);
        else {
            const outcome = value && typeof value === "object" ? value as CapabilityOutcome : { result: value };
            if (outcome.discardPage && reservation.createdPage) void reservation.page?.close();
            route.resolve({
                ...(!outcome.discardPage || !reservation.createdPage
                    ? outcome.pageId ? { pageId: outcome.pageId } : pageId ? { pageId } : {}
                    : {}),
                ...(Object.prototype.hasOwnProperty.call(outcome, "result") ? { result: outcome.result } : {}),
                ...(outcome.discardPage ? { discardPage: true } : {}),
            });
        }
        this.drain(reservation);
    }

    private reservationForRoute(route: DispatchRoute): PageReservation | undefined {
        return route.reservation;
    }

    private removeRoute(route: DispatchRoute): void {
        this.routes.delete(route.request.requestId);
        route.pageUnsubscribe?.();
        route.pageUnsubscribe = undefined;
        if (route.page && this.pageChains.get(route.page.id)?.requestId === route.request.requestId) this.pageChains.delete(route.page.id);
    }

    private scheduleAdvance(reservation: PageReservation): void {
        if (reservation.advanceQueued) return;
        reservation.advanceQueued = true;
        queueMicrotask(() => {
            reservation.advanceQueued = false;
            this.drain(reservation);
        });
    }

}

export const boardCapabilityTransport = new BoardCapabilityTransport();
