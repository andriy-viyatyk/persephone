import { BrowserWindow, type IpcMainEvent, type WebContents } from "electron";
import { Endpoint, EventEndpoint, type PathWatchSubscribeRequest, type PathWatchUnsubscribeRequest, type PathWatchOwner, type BeginPathMoveRequest, type CompletePathMoveRequest } from "../api-types";
import { bindEndpoint } from "./endpoint-registry";
import { openWindows } from "../../main/open-windows";
import { pathWatchService, type PathWatchSubscribeResult } from "../../main/path-watch-service";

export type PathWatchEndpoint = "subscribePathWatch" | "unsubscribePathWatch" | "beginPathMove" | "completePathMove";

interface ClientSubscription {
    cancelled: boolean;
    serviceId?: string;
    dispose?: () => void;
}

const clientsBySender = new Map<number, Map<string, ClientSubscription>>();
const watchedSenders = new WeakSet<WebContents>();
// Recorded while the sender is alive: a destroyed WebContents can no longer be mapped to its window.
const ownersBySender = new Map<number, PathWatchOwner>();

function getOwner(event: IpcMainEvent): PathWatchOwner {
    const window = BrowserWindow.fromWebContents(event.sender);
    const windowIndex = window ? openWindows.findByWindow(window)?.index : undefined;
    if (windowIndex === undefined || windowIndex < 0) throw new Error("Path-watch sender window is unavailable.");
    return { kind: "window", windowIndex };
}

function releaseSender(sender: WebContents): void {
    const owner = ownersBySender.get(sender.id);
    ownersBySender.delete(sender.id);
    const clients = clientsBySender.get(sender.id);
    if (clients) {
        for (const client of clients.values()) {
            client.cancelled = true;
            client.dispose?.();
        }
        clients.clear();
        clientsBySender.delete(sender.id);
    }
    if (owner) pathWatchService.unsubscribeOwner(owner);
}

function trackSender(sender: WebContents): void {
    if (watchedSenders.has(sender)) return;
    watchedSenders.add(sender);
    sender.once("destroyed", () => releaseSender(sender));
    // `did-navigate` fires only once a main-frame, cross-document navigation commits.
    // `did-start-navigation` also fires for navigations `will-navigate` then cancels (a dropped
    // file, a clicked link), which would drop every subscription of a renderer that never reloaded.
    sender.on("did-navigate", () => releaseSender(sender));
}

export function initPathWatchHandlers(): void {
    bindEndpoint(Endpoint.subscribePathWatch, async (event, request: PathWatchSubscribeRequest) => {
        trackSender(event.sender);
        const owner = getOwner(event);
        ownersBySender.set(event.sender.id, owner);
        const clients = clientsBySender.get(event.sender.id) ?? new Map<string, ClientSubscription>();
        clientsBySender.set(event.sender.id, clients);
        const previous = clients.get(request.clientId);
        previous?.dispose?.();
        const client: ClientSubscription = { cancelled: false };
        clients.set(request.clientId, client);
        let result: PathWatchSubscribeResult;
        try {
            result = await pathWatchService.subscribe(request.path, {
                owner,
                recursive: request.recursive,
                debounceMs: request.debounceMs,
                label: request.label,
            }, batch => {
                if (client.cancelled || event.sender.isDestroyed()) return;
                try {
                    event.sender.send(EventEndpoint.ePathWatchBatch, { clientId: request.clientId, batch });
                } catch {
                    // Sender teardown can race a queued watcher batch.
                }
            });
        } catch (error: unknown) {
            if (clients.get(request.clientId) === client) clients.delete(request.clientId);
            throw error;
        }
        client.serviceId = result.id;
        client.dispose = result.dispose;
        if (client.cancelled || clients.get(request.clientId) !== client) {
            result.dispose();
            return;
        }
    });

    bindEndpoint(Endpoint.unsubscribePathWatch, async (event, request: PathWatchUnsubscribeRequest) => {
        const clients = clientsBySender.get(event.sender.id);
        const client = clients?.get(request.clientId);
        if (client) {
            client.cancelled = true;
            client.dispose?.();
            clients?.delete(request.clientId);
            if (clients?.size === 0) clientsBySender.delete(event.sender.id);
        }
    });

    bindEndpoint(Endpoint.beginPathMove, async (_event, request: BeginPathMoveRequest) => {
        return pathWatchService.beginMove(request.from, request.to);
    });

    bindEndpoint(Endpoint.completePathMove, async (_event, request: CompletePathMoveRequest) => {
        pathWatchService.completeMove(request.moveId, request.succeeded);
    });
}
