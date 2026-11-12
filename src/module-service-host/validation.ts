import type { MessagePortMain, ParentPort } from "electron";
import type { ServiceHostConfig, ServiceParentMessage } from "../ipc/module-service-channels";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function eventData(event: unknown): unknown {
    return isRecord(event) && "data" in event ? event.data : event;
}

export function isMessagePortMain(value: unknown): value is MessagePortMain {
    return isRecord(value) && typeof value.postMessage === "function" && typeof value.close === "function"
        && typeof value.start === "function" && typeof value.on === "function";
}

export function messagePortFromEvent(event: unknown): MessagePortMain | undefined {
    if (!isRecord(event) || !Array.isArray(event.ports)) return undefined;
    const [port] = event.ports;
    return isMessagePortMain(port) ? port : undefined;
}

export function validateHostConfig(config: unknown): config is ServiceHostConfig {
    if (!isRecord(config) || !Array.isArray(config.capabilityCalls)) return false;
    return config.capabilityCalls.every((entry: unknown): boolean => isRecord(entry) && typeof entry.id === "string"
        && Number.isSafeInteger(entry.version) && typeof entry.method === "string");
}

export function isLifecycleMessage(message: Record<string, unknown>): message is Extract<ServiceParentMessage, { kind: "init" | "probe" | "request" | "shutdown" }> {
    if (message.kind === "init") return typeof message.nonce === "number" && validateHostConfig(message.config);
    if (message.kind === "probe") return typeof message.nonce === "number";
    if (message.kind === "request") return typeof message.requestId === "string" && "message" in message;
    if (message.kind === "shutdown") return typeof message.nonce === "number"
        && ["untrusted", "explicit", "quit"].includes(String(message.reason));
    return false;
}

export function isAttachRendererMessage(value: Record<string, unknown>): value is Extract<ServiceParentMessage, { kind: "attach-renderer" }> {
    return value.kind === "attach-renderer" && Number.isInteger(value.generation) && typeof value.leaseNonce === "string";
}

export function isDropRendererMessage(value: Record<string, unknown>): value is Extract<ServiceParentMessage, { kind: "drop-renderer" }> {
    return value.kind === "drop-renderer" && Number.isInteger(value.generation) && typeof value.leaseNonce === "string"
        && ["superseded", "stopping", "untrusted", "quit", "service-exited", "renderer-port-attach-failed"].includes(String(value.reason));
}

export function isChannelOpenMessage(value: Record<string, unknown>): value is Extract<ServiceParentMessage, { kind: "channel-open" }> {
    return value.kind === "channel-open" && typeof value.channelId === "string" && typeof value.boardId === "string"
        && Number.isInteger(value.generation) && isRecord(value.info) && isRecord(value.info.page)
        && typeof value.info.page.boardId === "string";
}

export function isChannelCloseMessage(value: Record<string, unknown>): value is Extract<ServiceParentMessage, { kind: "channel-close" }> {
    return value.kind === "channel-close" && typeof value.channelId === "string"
        && isRecord(value.reason) && typeof value.reason.code === "string" && typeof value.reason.message === "string";
}

export type HostMessageListener = (...args: unknown[]) => void;
export type HostRawPortMethod = (...args: unknown[]) => ParentPort;
