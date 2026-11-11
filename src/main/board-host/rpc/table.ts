import type { BoardRpcHandlerTable, BoardRpcMethod } from "./types";
import { createAppHandlers } from "./app";
import { capabilityHandlers } from "./capabilities";
import { fileHandlers } from "./files";
import { serviceHandlers } from "./services";
import { storageHandlers } from "./storage";
import { createWatchHandlers } from "./watch";
import type { BoardBridgeConnections } from "../BoardBridgeConnections";
import type { BoardJobRetention } from "../BoardJobRetention";
import { hostRequest } from "./context";

type Disjoint<A, B> = Extract<keyof A, keyof B> extends never ? B : never;

function merge<A extends object, B extends object>(a: A, b: B & Disjoint<A, B>): A & B {
    return { ...a, ...b };
}

export function createBoardRpcHandlers(dependencies: {
    connections: BoardBridgeConnections;
    retention: BoardJobRetention;
    currentTimeout: () => number | undefined;
}): {
    handlers: BoardRpcHandlerTable;
    recheckBoardWatches: (boardRoot: string) => Promise<void>;
} {
    const watchDomain = createWatchHandlers(dependencies.connections);
    const appHandlers = createAppHandlers({
        retention: dependencies.retention,
        currentTimeout: dependencies.currentTimeout,
        hostRequest,
    });
    const handlers = merge(merge(merge(merge(merge(
        fileHandlers,
        watchDomain.handlers,
    ), serviceHandlers), capabilityHandlers), storageHandlers), appHandlers);
    return {
        handlers: handlers satisfies BoardRpcHandlerTable,
        recheckBoardWatches: watchDomain.recheckBoardWatches,
    };
}

export type { BoardRpcMethod };
