import type { IpcMainEvent } from "electron";
import type {
    CapabilityClientInvoke,
    CapabilityClientOptions,
    CapabilityInvokeContext,
} from "../capability-bus-channels";
import { capabilityRegistry } from "../../main/capability-registry";
import { capabilityRouter } from "../../main/capability-router";
import { capabilityClientForWindow, capabilityResult } from "../../main/capability-client";
import { requireAppWindow } from "../../main/ipc-sender-policies";
import type { CapabilitiesApi } from "../contracts/capabilities";
import { bindDomain } from "./endpoint-registry";
export function initCapabilityHandlers(): void {
    bindDomain<CapabilitiesApi>({
        capabilityList: async (event: IpcMainEvent, asAgent?: boolean) =>
            capabilityClientForWindow(event.sender).list(asAgent),
        capabilityProviders: async (event: IpcMainEvent, id: string, asAgent?: boolean) =>
            capabilityClientForWindow(event.sender).providers(id, asAgent),
        capabilityGet: async (event: IpcMainEvent, id: string, options?: CapabilityClientOptions) =>
            capabilityClientForWindow(event.sender).get(id, options),
        capabilityInvoke: async (
            event: IpcMainEvent,
            request: CapabilityClientInvoke,
            context?: CapabilityInvokeContext,
        ) => capabilityClientForWindow(event.sender).invoke(request, {
            methods: "value",
            ...(context ? { context } : {}),
        }),
        capabilityCancel: async (event: IpcMainEvent, requestId: string) => {
            capabilityClientForWindow(event.sender).cancel(requestId);
        },
        getCapabilityIndex: async () => capabilityRegistry.snapshot(),
        setCapabilityPreferences: async (_event: IpcMainEvent, preferences: Record<string, string>) =>
            capabilityRouter.setPreferences(preferences),
        connectCapabilityChannel: async (event: IpcMainEvent, request: CapabilityClientInvoke) => {
            const result = await capabilityClientForWindow(event.sender).invoke(request, {
                methods: "channel", agentCallers: false,
                delivery: () => ({ kind: "renderer" as const, webContents: event.sender }),
            });
            return "value" in result
                ? { ok: true as const, value: result.value.channelId }
                : { ok: false as const, error: result.error };
        },
    }, {
        capabilityList: {
            policy: requireAppWindow,
            deny: () => capabilityResult(() => {
                throw Object.assign(new Error("Permission denied."), { code: "permission-denied" });
            }),
        },
        capabilityProviders: {
            policy: requireAppWindow,
            deny: () => capabilityResult(() => {
                throw Object.assign(new Error("Permission denied."), { code: "permission-denied" });
            }),
        },
        capabilityGet: {
            policy: requireAppWindow,
            deny: () => capabilityResult(() => {
                throw Object.assign(new Error("Permission denied."), { code: "permission-denied" });
            }),
        },
        capabilityInvoke: {
            policy: requireAppWindow,
            deny: () => capabilityResult(() => {
                throw Object.assign(new Error("Permission denied."), { code: "permission-denied" });
            }),
        },
        capabilityCancel: {
            policy: requireAppWindow,
            deny: () => Object.assign(new Error("Permission denied."), { code: "permission-denied" }),
        },
        getCapabilityIndex: { policy: requireAppWindow, deny: () => new Error("permission-denied") },
        setCapabilityPreferences: { policy: requireAppWindow, deny: () => new Error("permission-denied") },
        connectCapabilityChannel: { policy: requireAppWindow, deny: () => new Error("permission-denied") }
    });
}

