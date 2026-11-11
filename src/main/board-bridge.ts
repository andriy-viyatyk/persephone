/** Main-side composition root for board ports, RPC handlers and lifecycle services. */
import { MessageChannelMain, type WebContents } from "electron";
import { EventEndpoint } from "../ipc/api-types";
import { frameEvent } from "../ipc/board-bridge/frame-protocol";
import type { BoardThemePalette } from "../ipc/board-bridge/boot";
import type { BoardToMain } from "../ipc/board-bridge/port-protocol";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { getBoardRootForHost } from "./board-protocol-service";
import { BoardBridgeConnection } from "./board-host/BoardBridgeConnection";
import { BoardBridgeConnections } from "./board-host/BoardBridgeConnections";
import { BoardJobRetention } from "./board-host/BoardJobRetention";
import { createBoardEventDispatcher } from "./board-host/rpc/events";
import { createBoardRpcHandlers } from "./board-host/rpc/table";
import { handleBoardMessage } from "./board-host/rpc/dispatch";
import { hostRequest } from "./board-host/rpc/context";

const eventDispatcher = createBoardEventDispatcher();
const BOARD_HANDSHAKE_TIMEOUT_MS = 5000;

function dispatchBoardMessage(connection: BoardBridgeConnection, data: BoardToMain): void {
    handleBoardMessage(connection, data, rpcComposition.handlers, eventDispatcher);
}

const jobRetention = new BoardJobRetention({
    hasLivePort: (ownerId) => [...boardConnections.values()].some((entry) => entry.ownerId === ownerId),
    removeOwnerWatches: (ownerId) => {
        for (const record of boardConnections.liveWatches()) {
            if (record.entry.ownerId === ownerId) boardConnections.removeWatch(record.entry, record, true);
        }
    },
});

const boardConnections = new BoardBridgeConnections({
    getBoardRootForHost,
    dispatchMessage: dispatchBoardMessage,
    disposeSink: (ownerId, boardId) => jobRetention.disposeSink(ownerId, boardId),
    clearBusy: () => jobRetention.clearBusy(),
    reapHostOwners: (hostId) => jobRetention.reapHostOwners(hostId),
    reapAllOwners: () => jobRetention.reapAllOwners(),
});

// The retention callback references the connection collection during teardown.
// The collection is fully constructed before any port can be created or disposed.
const rpcComposition = createBoardRpcHandlers({
    connections: boardConnections,
    retention: jobRetention,
    currentTimeout: () => boardConnections.currentTimeout(),
});
export function recheckBoardWatches(boardRoot: string): Promise<void> {
    return rpcComposition.recheckBoardWatches(boardRoot);
}

export function reapBoardOwner(ownerId: string): void {
    jobRetention.reapBoardOwner(ownerId);
}

export function setBoardBusy(ownerId: string, busy: boolean): void {
    jobRetention.setBoardBusy(ownerId, busy);
}

export function setBoardCallTimeout(timeoutMs: number): void {
    boardConnections.setTimeout(timeoutMs);
}

export function ensureHostWired(hostWebContents: WebContents): void {
    boardConnections.ensureHostWired(hostWebContents);
}

/** Mint a per-board port pair and deliver its host end to the requesting renderer. */
export function createBoardPort(
    hostWebContents: WebContents,
    boardId: string,
    host: string,
    ownerId: string,
    hostedPath: string | null,
    token: string,
): void {
    if (boardConnections.get(boardId)) disposeBoardPort(boardId);
    const root = getBoardRootForHost(host) ?? "";
    const { port1, port2 } = new MessageChannelMain();
    const entry = new BoardBridgeConnection({
        boardId,
        port: port2,
        root,
        host,
        ownerId,
        hostWebContents,
        hostedFilePath: hostedPath,
        token,
        dispatchMessage: dispatchBoardMessage,
        isCurrent: (connection) => boardConnections.isCurrent(connection),
        reportLoadFailure: (target, boardRoot, detail) => boardConnections.reportBoardLoadFailure(target, boardRoot, detail),
        liveWatchCount: (rootKey) => boardConnections.liveWatchCount(rootKey),
        pendingWatchCount: (rootKey) => boardConnections.pendingWatchCount(rootKey),
        reserveWatch: (rootKey) => boardConnections.reserveWatch(rootKey),
        releaseWatch: (rootKey) => boardConnections.releaseWatch(rootKey),
        closeServiceChannels: (id) => moduleServiceSupervisor.closeBoardChannels(id, {
            code: "renderer-reloaded",
            message: "The board page closed or was reloaded.",
        }),
        releaseTsProjects: (connection) => hostRequest(connection, "releaseTsProjects", { owner: connection.boardId }),
    });
    boardConnections.add(entry);
    jobRetention.indexOwnerSink(ownerId, boardId, hostWebContents.id);
    entry.start();
    ensureHostWired(hostWebContents);
    entry.startWatchdog(BOARD_HANDSHAKE_TIMEOUT_MS);
    hostWebContents.postMessage(EventEndpoint.eBoardPort, { boardId }, [port1]);
}

/** Update only the live port created by this host renderer for this exact load. */
export function updateBoardHostedPath(
    hostWebContents: WebContents,
    boardId: string,
    token: string,
    hostedPath: string | null,
): boolean {
    return boardConnections.get(boardId)?.updateHostedPath(hostWebContents, token, hostedPath) ?? false;
}

/** Dispose one port; busy owners retain their jobs until whole-owner teardown. */
export function disposeBoardPort(boardId: string): void {
    boardConnections.disposeBoardPort(boardId);
}

/** Push the current theme to every live board port. */
export function pushThemeToBoards(palette: BoardThemePalette): void {
    for (const entry of boardConnections.values()) {
        try {
            entry.port.postMessage(frameEvent("theme", { palette }));
        } catch {
            // port closed — ignore
        }
    }
}

/** Dispose all board ports and retained jobs during app quit. */
export function disposeAllBoardPorts(): void {
    boardConnections.disposeAllBoardPorts();
}
