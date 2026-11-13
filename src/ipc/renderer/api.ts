import { isServiceChannelTarget, type ServiceChannelDelivery, type ServiceChannelTarget } from "../../shared/service-channel-target";
import { PendingRequests } from "../../shared/pending-requests";
import { fromWireError, wireError } from "../../shared/wire-error";
import type { Api, EndpointReply, ModuleServicePortPayload } from "../api-types";
import { ENDPOINT_REPLY_CHANNEL } from "../api-types";
import { appTimeoutExemptions } from "../contracts/app";
import { boardTimeoutExemptions } from "../contracts/boards";
import { capabilityTimeoutExemptions } from "../contracts/capabilities";
import { clipboardTimeoutExemptions } from "../contracts/clipboard";
import { fileTimeoutExemptions } from "../contracts/files";
import { gitTimeoutExemptions } from "../contracts/git";
import { mcpMnemeTimeoutExemptions } from "../contracts/mcp-mneme";
import { moduleServiceTimeoutExemptions } from "../contracts/module-services";
import { pathWatchTimeoutExemptions } from "../contracts/path-watch";
import { recordingTimeoutExemptions } from "../contracts/recording";
import { shellTimeoutExemptions } from "../contracts/shell";
import { windowTimeoutExemptions } from "../contracts/window";
import type { EventPayload } from "../event-types";

const IPC_TUNING = {
    defaultTimeoutMs: 30_000,
} as const;

const timeoutExemptions: Partial<Record<keyof Api, string>> = {
    ...appTimeoutExemptions,
    ...boardTimeoutExemptions,
    ...capabilityTimeoutExemptions,
    ...clipboardTimeoutExemptions,
    ...fileTimeoutExemptions,
    ...gitTimeoutExemptions,
    ...mcpMnemeTimeoutExemptions,
    ...moduleServiceTimeoutExemptions,
    ...pathWatchTimeoutExemptions,
    ...recordingTimeoutExemptions,
    ...shellTimeoutExemptions,
    ...windowTimeoutExemptions,
};

const pendingEndpointCalls = new PendingRequests<unknown>();
let replyListenerInstalled = false;

function installReplyListener(): void {
    if (replyListenerInstalled) return;
    replyListenerInstalled = true;
    window.electron.ipcRenderer.on(ENDPOINT_REPLY_CHANNEL, (payload) => {
        const reply = payload as EndpointReply;
        if (reply.ok === true) pendingEndpointCalls.settle(reply.id, reply.result);
        else pendingEndpointCalls.fail(reply.id, fromWireError(reply.error, "Unknown error"));
    });
}

function executeOnce<K extends keyof Api>(key: K, ...args: Parameters<Api[K]>): ReturnType<Api[K]> {
    if (!window.electron) return Promise.reject(new Error("window.electron is undefined")) as ReturnType<Api[K]>;
    if (!window.electron.ipcRenderer) {
        return Promise.reject(new Error("window.electron.ipcRenderer is undefined")) as ReturnType<Api[K]>;
    }

    installReplyListener();
    const message = `IPC request "${key}" timed out after ${IPC_TUNING.defaultTimeoutMs / 1000} s.`;
    const { id, promise } = pendingEndpointCalls.create(
        timeoutExemptions[key] ? undefined : IPC_TUNING.defaultTimeoutMs,
        undefined,
        { timeoutError: () => fromWireError(wireError(message)) },
    );
    window.electron.ipcRenderer.sendMessage(key, [...args], id);
    return promise as ReturnType<Api[K]>;
}

interface ConvenienceApi {
    onCapabilityIndexChanged(callback: (revision: number) => void): () => void;
    onBoardPort(boardId: string, callback: (port: MessagePort) => void): () => void;
    onBoardServiceChannel(callback: (target: ServiceChannelTarget, channelId: string, port: MessagePort) => void): () => void;
    onVoiceTypingShortcut(callback: (event: EventPayload<"eVoiceTypingShortcut">) => void): () => void;
    onModuleServicePort(callback: (payload: ModuleServicePortPayload, port: MessagePort) => void): () => void;
}

const convenienceMethods: ConvenienceApi = {
    onCapabilityIndexChanged: (callback) => window.electron.ipcRenderer.on("eCapabilityIndexChanged", callback),
    onBoardPort: (boardId, callback) => window.electron.ipcRenderer.onPort("eBoardPort", (payload, ports) => {
        const deliveredBoardId = (payload as { boardId?: unknown } | undefined)?.boardId;
        if (deliveredBoardId === boardId && ports[0]) callback(ports[0]);
    }),
    onBoardServiceChannel: (callback) => window.electron.ipcRenderer.onPort("eBoardServiceChannel", (payload, ports) => {
        const delivery = payload as Partial<ServiceChannelDelivery> | undefined;
        const port = ports[0];
        if (!port) return;
        if (!delivery || typeof delivery.channelId !== "string" || !isServiceChannelTarget(delivery.target)) {
            port.close();
            return;
        }
        callback(delivery.target, delivery.channelId, port);
    }),
    onVoiceTypingShortcut: (callback) => window.electron.ipcRenderer.on("eVoiceTypingShortcut", callback as (...args: unknown[]) => void),
    onModuleServicePort: (callback) => window.electron.ipcRenderer.onPort("eModuleServicePort", (rawPayload, ports) => {
        const payload = rawPayload as Partial<ModuleServicePortPayload> | undefined;
        if (typeof payload?.boardRoot !== "string" || payload.boardRoot.length === 0) return;
        if (!Number.isInteger(payload.generation) || payload.generation < 0) return;
        if (typeof payload.leaseNonce !== "string" || payload.leaseNonce.length === 0) return;
        const port = ports[0];
        if (!port || typeof port.start !== "function" || typeof port.postMessage !== "function") return;
        callback({ boardRoot: payload.boardRoot, generation: payload.generation, leaseNonce: payload.leaseNonce }, port);
    }),
};

function isReservedProperty(key: PropertyKey): boolean {
    return typeof key === "symbol" || key === "then" || key === "toJSON" || key === "constructor";
}

const requestMethods = new Map<string, (...args: unknown[]) => unknown>();
const apiClient = new Proxy(convenienceMethods as Api & ConvenienceApi, {
    get(target, key: string | symbol, receiver) {
        if (isReservedProperty(key)) return undefined;
        if (Object.prototype.hasOwnProperty.call(target, key)) return Reflect.get(target, key, receiver);
        if (typeof key !== "string") return undefined;
        const cached = requestMethods.get(key);
        if (cached) return cached;
        const request = (...args: unknown[]) => executeOnce(key as keyof Api, ...args as Parameters<Api[keyof Api]>);
        requestMethods.set(key, request);
        return request;
    },
}) as Api & ConvenienceApi;

export const api = apiClient;
