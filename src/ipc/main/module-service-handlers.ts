import type { IpcMainEvent } from "electron";
import { errMessage } from "../../shared/utils";
import type { HostServiceChannelRequest, ModuleServicesApi } from "../contracts/module-services";
import { bindDomain } from "./endpoint-registry";
import { requireAppWindow } from "../../main/ipc-sender-policies";
import { moduleServiceSupervisor } from "../../main/module-service-supervisor";


export function initModuleServiceHandlers(): void {
    bindDomain<ModuleServicesApi>({
        connectHostServiceChannel: async (event: IpcMainEvent, request: HostServiceChannelRequest): Promise<string> => {
            if (
                !request ||
                typeof request.interfaceId !== "string" ||
                typeof request.provider !== "string" ||
                request.version !== 1
            ) {
                throw new TypeError("Invalid host service selector.");
            }
            return moduleServiceSupervisor.connectHostServiceChannel(
                    event.sender,
                    request,
                    request.openMessage,
                );
        },
        getModuleServiceStatuses: async () =>
            moduleServiceSupervisor.getStatuses(),
        requestModuleServicePort: async (event: IpcMainEvent, boardRoot: string) => {
            try {
                await moduleServiceSupervisor.transferRendererPort(boardRoot, event.sender);
                return { ok: true };
            } catch (error) {
                const candidate = error as { code?: unknown };
                const isServiceError = (error as { name?: unknown } | null)?.name === "ServiceError";
                return {
                    ok: false,
                    error: {
                        code: isServiceError && typeof candidate?.code === "string" && candidate.code.length > 0
                            ? candidate.code
                            : "service-error",
                        message: errMessage(error, "Service port acquisition failed"),
                    },
                };
            }
        },
        requestModuleService: async (_event, boardRoot: string, message: unknown) => {
            const requestId = `main-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            return moduleServiceSupervisor.request(boardRoot, requestId, message);
        },
        startModuleService: async (_event, boardRoot: string): Promise<void> => {
            await moduleServiceSupervisor.start(
                boardRoot,
                "explicit",
            );
        },
        stopModuleService: async (_event, boardRoot: string): Promise<void> => {
            await moduleServiceSupervisor.stop(
                boardRoot,
                "explicit",
            );
        },
    }, {
        connectHostServiceChannel: { policy: requireAppWindow, deny: () => new Error("permission-denied") },
    });
}
