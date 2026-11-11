import type { WebContents } from "electron";
import { EventEndpoint } from "../../ipc/api-types";
import type { BoardNotifyMsg, BoardToMain } from "../../ipc/board-bridge/port-protocol";
import { appCallTimeoutRangeMessage, isValidAppCallTimeout } from "../../shared/ai-vision-timeout";
import { BoardRoot } from "../../shared/board/board-root";
import { onWebContentsGone } from "../webcontents-lifetime";
import * as boardLog from "../board-log";
import { BoardBridgeConnection, type BoardWatchRecord } from "./BoardBridgeConnection";

export interface BoardBridgeConnectionsOptions {
    getBoardRootForHost: (host: string) => string | undefined;
    dispatchMessage: (connection: BoardBridgeConnection, data: BoardToMain) => void;
    disposeSink: (ownerId: string, boardId: string) => void;
    clearBusy: () => void;
    reapHostOwners: (hostWebContentsId: number) => void;
    reapAllOwners: () => void;
}

/** Owns the live connection index and state shared across all board ports. */
export class BoardBridgeConnections {
    private readonly connections = new Map<string, BoardBridgeConnection>();
    private readonly pendingWatchReservations = new Map<string, number>();
    private readonly wiredHosts = new Set<number>();
    private boardCallTimeoutMs: number | undefined;

    public constructor(private readonly options: BoardBridgeConnectionsOptions) {}

    public get(boardId: string): BoardBridgeConnection | undefined {
        return this.connections.get(boardId);
    }

    public values(): IterableIterator<BoardBridgeConnection> {
        return this.connections.values();
    }

    public entries(): IterableIterator<[string, BoardBridgeConnection]> {
        return this.connections.entries();
    }

    public add(connection: BoardBridgeConnection): void {
        this.connections.set(connection.boardId, connection);
    }

    public isCurrent(connection: BoardBridgeConnection): boolean {
        return this.connections.get(connection.boardId) === connection;
    }

    public currentTimeout(): number | undefined {
        return this.boardCallTimeoutMs;
    }

    public setTimeout(timeoutMs: number): void {
        if (!isValidAppCallTimeout(timeoutMs)) throw new TypeError(appCallTimeoutRangeMessage);
        this.boardCallTimeoutMs = timeoutMs;
    }

    public liveWatches(): BoardWatchRecord[] {
        return [...this.connections.values()].flatMap((connection) => [...connection.watches.values()]);
    }

    public liveWatchCount(rootKey: string): number {
        let count = 0;
        for (const connection of this.connections.values()) {
            for (const record of connection.watches.values()) {
                if (BoardRoot.from(record.boardRoot).key === rootKey) count++;
            }
        }
        return count;
    }

    public reserveWatch(rootKey: string): void {
        this.pendingWatchReservations.set(rootKey, (this.pendingWatchReservations.get(rootKey) ?? 0) + 1);
    }

    public releaseWatch(rootKey: string): void {
        const pending = this.pendingWatchReservations.get(rootKey) ?? 0;
        if (pending <= 1) this.pendingWatchReservations.delete(rootKey);
        else this.pendingWatchReservations.set(rootKey, pending - 1);
    }

    public pendingWatchCount(rootKey: string): number {
        return this.pendingWatchReservations.get(rootKey) ?? 0;
    }

    public removeWatch(connection: BoardBridgeConnection, record: Parameters<BoardBridgeConnection["removeWatch"]>[0], disposeService: boolean): void {
        connection.removeWatch(record, disposeService);
    }

    public disposeBoardPort(boardId: string, reason = "port-disposed"): void {
        const connection = this.connections.get(boardId);
        if (!connection) return;
        connection.dispose(reason);
        if (this.connections.get(boardId) === connection) this.connections.delete(boardId);
        this.options.disposeSink(connection.ownerId, boardId);
    }

    public disposeAllBoardPorts(): void {
        this.options.clearBusy();
        for (const boardId of [...this.connections.keys()]) this.disposeBoardPort(boardId, "app-quit");
        this.options.reapAllOwners();
        this.wiredHosts.clear();
    }

    public reapHost(hostWebContentsId: number): void {
        for (const [boardId, connection] of [...this.connections]) {
            if (connection.hostWebContents.id === hostWebContentsId) this.disposeBoardPort(boardId, "host-gone");
        }
        this.options.reapHostOwners(hostWebContentsId);
        this.wiredHosts.delete(hostWebContentsId);
    }

    public reportBoardLoadFailure(hostWebContents: WebContents, root: string, detail: string): void {
        if (root) void boardLog.append(root, "error", detail).catch(() => {});
        try {
            hostWebContents.send(EventEndpoint.eBoardNotify, {
                message: `Board failed to load: ${detail}`,
                type: "error",
            } satisfies BoardNotifyMsg);
        } catch {
            // Window gone — nothing to toast.
        }
    }

    public ensureHostWired(hostWebContents: WebContents): void {
        if (this.wiredHosts.has(hostWebContents.id)) return;
        this.wiredHosts.add(hostWebContents.id);
        hostWebContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (isMainFrame || errorCode === -3 || !validatedURL || !validatedURL.startsWith("board://")) return;
            let host: string;
            try { host = new URL(validatedURL).host; }
            catch { return; }
            const root = this.options.getBoardRootForHost(host);
            if (!root) return;
            this.reportBoardLoadFailure(hostWebContents, root, `${errorCode} ${errorDescription} ${validatedURL}`);
        });
        onWebContentsGone(hostWebContents, () => this.reapHost(hostWebContents.id), {
            events: ["destroyed", "render-process-gone"],
            repeat: true,
        });
    }
}
