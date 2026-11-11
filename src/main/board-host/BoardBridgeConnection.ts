import type { MessagePortMain, WebContents } from "electron";
import type { BoardToMain, BoardFolderEntry } from "../../ipc/board-bridge/port-protocol";
import { BoardRoot } from "../../shared/board/board-root";
import { boardRootDigest } from "../board-root-hashes";
import { CapabilityClient } from "../capability-client";
import { errMessage } from "../../shared/utils";

export interface BoardFolderCursor {
    root: string;
    boardRoot: string;
    boardId: string;
    entries: BoardFolderEntry[];
    offset: number;
    expires: number;
    truncated: boolean;
}

export interface BoardWatchRecord {
    boardId: string;
    watchId: number;
    entry: BoardBridgeConnection;
    boardRoot: string;
    requestedPath: string;
    authorizedPath: string;
    filterScope: { path: string };
    scopeKind: "file" | "folder";
    intent: "read" | "list";
    hostedDocument: boolean;
    recursive: boolean;
    serviceId: string;
    dispose: () => void;
}

export interface BoardBridgeConnectionOptions {
    boardId: string;
    port: MessagePortMain;
    root: string;
    host: string;
    ownerId: string;
    hostWebContents: WebContents;
    hostedFilePath: string | null;
    token: string;
    dispatchMessage: (connection: BoardBridgeConnection, data: BoardToMain) => void;
    isCurrent: (connection: BoardBridgeConnection) => boolean;
    reportLoadFailure: (host: WebContents, root: string, detail: string) => void;
    liveWatchCount: (rootKey: string) => number;
    pendingWatchCount: (rootKey: string) => number;
    reserveWatch: (rootKey: string) => void;
    releaseWatch: (rootKey: string) => void;
    closeServiceChannels: (boardId: string) => void;
    releaseTsProjects: (connection: BoardBridgeConnection) => Promise<void>;
}

/** Identity and lifecycle owner for one main-side board port. */
export class BoardBridgeConnection {
    public readonly boardId: string;
    public readonly port: MessagePortMain;
    public readonly root: string;
    public readonly host: string;
    public readonly ownerId: string;
    public readonly hostWebContents: WebContents;
    public hostedFilePath: string | null;
    public token: string;
    public connected = false;
    public watchdog: ReturnType<typeof setTimeout> | undefined;
    public readonly watches = new Map<number, BoardWatchRecord>();
    public readonly capabilities: CapabilityClient;
    public readonly tsProjectRoots = new Set<string>();
    public readonly folderCursors = new Map<string, BoardFolderCursor>();
    private disposed = false;

    public constructor(private readonly options: BoardBridgeConnectionOptions) {
        this.boardId = options.boardId;
        this.port = options.port;
        this.root = options.root;
        this.host = options.host;
        this.ownerId = options.ownerId;
        this.hostWebContents = options.hostWebContents;
        this.hostedFilePath = options.hostedFilePath;
        this.token = options.token;
        this.capabilities = new CapabilityClient({
            owner: this.hostWebContents,
            retainChannelRequests: true,
            caller: () => ({ kind: "board-page", provider: boardRootDigest(BoardRoot.from(this.root)) }),
        });
    }

    public start(): void {
        this.port.on("message", (event) => {
            this.options.dispatchMessage(this, event.data as BoardToMain);
        });
        this.port.start();
    }

    public startWatchdog(timeoutMs: number): void {
        if (!this.root) return;
        this.watchdog = setTimeout(() => {
            if (!this.connected) {
                this.options.reportLoadFailure(
                    this.hostWebContents,
                    this.root,
                    "board bridge did not connect (the board loaded but its script bridge never initialized)",
                );
            }
        }, timeoutMs);
    }

    public updateHostedPath(host: WebContents, token: string, hostedPath: string | null): boolean {
        if (this.disposed || this.hostWebContents !== host || this.token !== token || host.isDestroyed()) return false;
        this.hostedFilePath = hostedPath;
        return true;
    }

    /** Run the ordered teardown once; the collection removes the identity afterwards. */
    public dispose(_reason: string): void {
        if (this.disposed) return;
        this.disposed = true;
        this.hostedFilePath = null;
        this.token = "";
        this.capabilities.dispose();
        this.options.closeServiceChannels(this.boardId);
        if (this.watchdog) {
            clearTimeout(this.watchdog);
            this.watchdog = undefined;
        }
        for (const record of [...this.watches.values()]) this.removeWatchInternal(record, true);
        try { this.port.close(); } catch { /* already closed */ }
        if (this.tsProjectRoots.size && !this.hostWebContents.isDestroyed()) {
            void this.options.releaseTsProjects(this)
                .catch((error: unknown) => console.warn(`Releasing TypeScript projects failed: ${errMessage(error)}`));
        }
        this.tsProjectRoots.clear();
        this.folderCursors.clear();
    }

    public isCurrent(): boolean {
        return !this.disposed && this.options.isCurrent(this);
    }

    public addWatch(record: BoardWatchRecord): void {
        this.watches.set(record.watchId, record);
    }

    public getWatch(watchId: number): BoardWatchRecord | undefined {
        return this.watches.get(watchId);
    }

    public liveWatchCount(rootKey: string): number {
        return this.options.liveWatchCount(rootKey);
    }

    public pendingWatchCount(rootKey: string): number {
        return this.options.pendingWatchCount(rootKey);
    }

    public reserveWatch(rootKey: string): void {
        this.options.reserveWatch(rootKey);
    }

    public releaseWatch(rootKey: string): void {
        this.options.releaseWatch(rootKey);
    }

    public removeWatch(record: BoardWatchRecord, disposeService: boolean): void {
        this.removeWatchInternal(record, disposeService);
    }

    private removeWatchInternal(record: BoardWatchRecord, disposeService: boolean): void {
        if (this.watches.get(record.watchId) !== record) return;
        this.watches.delete(record.watchId);
        if (disposeService) record.dispose();
    }
}
