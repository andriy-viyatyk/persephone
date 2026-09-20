import type { IProvider } from "../api/types/io.provider";
import { ProxyProvider } from "./providers/ProxyProvider";

export class BoardProviderUnavailableError extends Error {
    readonly code = "proxy-provider-not-installed";

    constructor(
        readonly boardRoot: string,
        readonly providerType: string,
    ) {
        super(`Board provider "${providerType}" is unavailable: proxy provider is not installed.`);
        this.name = "BoardProviderUnavailableError";
    }
}

export type BoardProviderFactory = (
    boardRoot: string,
    providerType: string,
    config: Record<string, unknown>,
) => IProvider;

let boardProviderFactory: BoardProviderFactory = (boardRoot, providerType) => {
    throw new BoardProviderUnavailableError(boardRoot, providerType);
};

const availabilityListeners = new Set<() => void>();

/** Create the provider for a trusted board declaration. US-1473 installs the real delegate. */
export function createBoardProvider(
    boardRoot: string,
    providerType: string,
    config: Record<string, unknown>,
): IProvider {
    return boardProviderFactory(boardRoot, providerType, config);
}

/** Install the board provider implementation without changing manifest registration. */
export function installBoardProviderFactory(factory: BoardProviderFactory): void {
    boardProviderFactory = factory;
    for (const listener of availabilityListeners) listener();
}

/** Subscribe to replacement of the deferred board-provider implementation. */
export function subscribeBoardProviderAvailability(listener: () => void): () => void {
    availabilityListeners.add(listener);
    return () => availabilityListeners.delete(listener);
}

installBoardProviderFactory(
    (boardRoot, providerType, config) => new ProxyProvider(boardRoot, providerType, config),
);
