import type { IProvider } from "../api/types/io.provider";
import { ProxyProvider } from "./providers/ProxyProvider";

export function createBoardProvider(
    boardRoot: string,
    providerType: string,
    config: Record<string, unknown>,
): IProvider {
    return new ProxyProvider(boardRoot, providerType, config);
}
