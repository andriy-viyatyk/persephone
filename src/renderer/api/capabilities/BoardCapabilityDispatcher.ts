import { BoardRoot } from "../../../shared/board/board-root";
import {
    type CapabilityOutcome,
    type CapabilityRegistration,
    type IntentRequest,
} from "../../../ipc/capability-bus-channels";
import { CapabilityError, toCapabilityError } from "../capability-error";
import { pages } from "../pages";
import type { PageModel } from "../pages/PageModel";

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

class BoardCapabilityDispatcher {
    private readonly frames = new Map<string, BoardCapabilityFrame>();
    private readonly routes = new Map<string, DispatchRoute>();
    private readonly reservationsByRoot = new Map<string, PageReservation>();
    private readonly reservationsByPage = new Map<string, PageReservation>();
    private readonly initialIntentByPage = new Map<string, IntentRequest>();

    registerFrame(frame: BoardCapabilityFrame): void {
        this.frames.set(frame.pageId, frame);
        this.onFrame(frame);
    }

    unregisterFrame(pageId: string, frame?: BoardCapabilityFrame): void {
        if (!frame || this.frames.get(pageId) === frame) this.frames.delete(pageId);
    }

    takeInitialIntent(pageId: string): IntentRequest | undefined {
        const intent = this.initialIntentByPage.get(pageId);
        this.initialIntentByPage.delete(pageId);
        return intent;
    }

    private frameForPage(pageId: string): BoardCapabilityFrame | undefined {
        return this.frames.get(pageId);
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
        const rootKey = BoardRoot.from(root).key;
        const producesPage = registration.alwaysOpensNewPage === true;
        let reservation = producesPage ? undefined : this.reservationsByRoot.get(rootKey);
        const existingPage = !producesPage && !reservation ? pages.boardPageRouter.findPagesByBoardRoot(root)[0] : undefined;
        if (!reservation) {
            reservation = this.createReservation(rootKey, root);
            if (!producesPage) this.reservationsByRoot.set(rootKey, reservation);
            if (existingPage) {
                this.bindPage(reservation, existingPage);
                pages.navigation.showPage(existingPage.id);
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
        const reservation = route.reservation;
        if (!reservation) return;
        if (route.active) {
            const frame = reservation.page ? this.frameForPage(reservation.page.id) : undefined;
            try { frame?.cancel(requestId); } catch { /* best effort */ }
        }
        reservation.queue.splice(reservation.queue.indexOf(route), 1);
        if (reservation.initialRequestId === requestId) {
            reservation.initialRequestId = undefined;
            if (reservation.page) this.initialIntentByPage.delete(reservation.page.id);
        }
        this.removeRoute(route);
        if (route.active) this.scheduleAdvance(reservation);
    }

    /** The request id currently running on a board page, or undefined when it is idle. A nested invoke names it as its parent. */
    activeRequestForPage(pageId: string): string | undefined {
        const route = this.reservationsByPage.get(pageId)?.queue[0];
        return route?.active ? route.request.requestId : undefined;
    }

    private createReservation(key: string, root: string): PageReservation {
        return { key, root, queue: [], opening: false, createdPage: false, advanceQueued: false };
    }

    private openReservation(reservation: PageReservation, opener: DispatchRoute): void {
        reservation.opening = true;
        void pages.boardPageRouter.openBoardHandlerPage(
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
            const normalized = toCapabilityError(error, "The board request failed.");
            for (const route of [...reservation.queue]) {
                this.removeRoute(route);
                route.reject(normalized);
            }
            if (this.reservationsByRoot.get(reservation.key) === reservation) this.reservationsByRoot.delete(reservation.key);
            if (reservation.page) {
                this.reservationsByPage.delete(reservation.page.id);
                this.initialIntentByPage.delete(reservation.page.id);
            }
        });
    }

    private bindPage(reservation: PageReservation, page: PageModel): void {
        reservation.page = page;
        this.reservationsByPage.set(page.id, reservation);
        reservation.queue.forEach((route) => this.bindRouteToPage(reservation, route, page));
        if (reservation.createdPage && reservation.queue[0]) {
            reservation.initialRequestId = reservation.queue[0].request.requestId;
            this.initialIntentByPage.set(page.id, reservation.queue[0].request);
        }
        page.disposed.subscribe(() => this.closePage(reservation));
        this.onFrame(this.frameForPage(page.id));
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
            this.reservationsByPage.delete(reservation.page.id);
            this.initialIntentByPage.delete(reservation.page.id);
        }
        if (this.reservationsByRoot.get(reservation.key) === reservation) {
            this.reservationsByRoot.delete(reservation.key);
        }
    }

    private onFrame(frame: BoardCapabilityFrame | undefined): void {
        if (!frame) return;
        const reservation = this.reservationsByPage.get(frame.pageId);
        if (reservation) this.drain(reservation);
    }

    private drain(reservation: PageReservation): void {
        const page = reservation.page;
        const frame = page ? this.frameForPage(page.id) : undefined;
        if (!page || !frame?.ready || reservation.queue.length === 0) return;
        const route = reservation.queue[0];
        if (route.active) return;
        route.active = true;
        const initial = route.request.requestId === reservation.initialRequestId;
        void frame.dispatch(route.request, initial).then(
            (value) => this.finishRoute(reservation, route, undefined, value),
            (error: unknown) => this.finishRoute(reservation, route, toCapabilityError(error, "The board request failed.")),
        );
        if (initial) reservation.initialRequestId = undefined;
    }

    markFrameReady(pageId: string, generation: number): void {
        const frame = this.frames.get(pageId);
        if (!frame || frame.generation !== generation) return;
        const reservation = this.reservationsByPage.get(pageId);
        if (reservation) this.drain(reservation);
    }

    failFrame(pageId: string, generation: number, error: CapabilityError): void {
        const frame = this.frames.get(pageId);
        if (!frame || frame.generation !== generation) return;
        const reservation = this.reservationsByPage.get(pageId);
        const route = reservation?.queue[0];
        if (!reservation || !route || route.request.requestId !== reservation.initialRequestId) return;
        reservation.initialRequestId = undefined;
        this.initialIntentByPage.delete(pageId);
        reservation.queue.shift();
        this.removeRoute(route);
        route.reject(error);
    }

    private finishRoute(reservation: PageReservation, route: DispatchRoute, error?: CapabilityError, value?: unknown): void {
        if (this.routes.get(route.request.requestId) !== route) return;
        const pageId = reservation.page?.id;
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

    private removeRoute(route: DispatchRoute): void {
        this.routes.delete(route.request.requestId);
        route.pageUnsubscribe?.();
        route.pageUnsubscribe = undefined;
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

export const boardCapabilityDispatcher = new BoardCapabilityDispatcher();
