import crypto from "node:crypto";
import type { BoardRpcSlice } from "./types";
import { BoardRpcError } from "./errors";
import { boardTrustService } from "../../board-trust-service";
import { moduleServiceSupervisor } from "../../module-service-supervisor";

const handlers = {
serviceRequest: { permission: "service", handle: (entry, message) => moduleServiceSupervisor.request(
        entry.root, crypto.randomUUID(), message,
    ) },
serviceOpenChannel: { permission: "service", handle: (entry, openMessage) => moduleServiceSupervisor.openChannel(
        entry.root, entry.hostWebContents, entry.boardId, openMessage,
    ) },
servicesList: { permission: "service-interface", handle: async (entry, interfaceId) => {
        if (typeof interfaceId !== "string") throw new BoardRpcError("invalid-argument", "A service interface id is required.");
        await boardTrustService.refresh();
        const uses = boardTrustService.getGrantedUsesFromSnapshot(entry.root);
        const allowedVersions = new Set(uses.filter((use) => use.id === interfaceId).map((use) => use.version));
        if (!allowedVersions.size) throw new BoardRpcError("permission-denied", "The board has no trusted grant for this service interface.");
        return moduleServiceSupervisor.listServiceProviders(interfaceId).filter((provider) => allowedVersions.has(provider.version));
    } },
servicesConnect: { permission: "service-interface", handle: async (entry, interfaceId, selector, openMessage) => {
        if (typeof interfaceId !== "string" || !selector || typeof selector.provider !== "string") {
            throw new BoardRpcError("invalid-argument", "A service interface and provider selector are required.");
        }
        await boardTrustService.refresh();
        return moduleServiceSupervisor.connectServiceChannel(entry.root, entry.hostWebContents, entry.boardId, interfaceId, selector, openMessage);
    } },
serviceStatus: { permission: "service", handle: (entry) => moduleServiceSupervisor.getStatus(entry.root) },
serviceStop: { permission: "service", handle: (entry) => moduleServiceSupervisor.stop(entry.root, "explicit") }
} satisfies BoardRpcSlice<ServicesDomainKeys>;

export const serviceHandlers = handlers;

export type ServicesDomainKeys = "serviceRequest" | "serviceOpenChannel" | "servicesList" | "servicesConnect" | "serviceStatus" | "serviceStop";
