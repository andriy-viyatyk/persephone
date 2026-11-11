import type { BoardRpcSlice } from "./types";

const handlers = {
capabilityList: { liveFrameOnly: true, handle: (entry) => entry.capabilities.list() },
capabilityProviders: { liveFrameOnly: true, handle: (entry, id) => entry.capabilities.providers(id) },
capabilityGet: { liveFrameOnly: true, handle: (entry, id, options) => entry.capabilities.get(id, options) },
capabilityInvoke: {
        liveFrameOnly: true,
        handle: (entry, request) => entry.capabilities.invoke(request, {
            methods: "any",
            delivery: () => ({ kind: "board-frame" as const, webContents: entry.hostWebContents, boardId: entry.boardId }),
        }),
    },
capabilityCancel: { liveFrameOnly: true, handle: (entry, requestId) => entry.capabilities.cancel(requestId) }
} satisfies BoardRpcSlice<CapabilitiesDomainKeys>;

export const capabilityHandlers = handlers;

export type CapabilitiesDomainKeys = "capabilityList" | "capabilityProviders" | "capabilityGet" | "capabilityInvoke" | "capabilityCancel";
