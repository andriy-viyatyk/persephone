import { pathToFileURL } from "node:url";
import { errMessage } from "../shared/utils";
import type { MessagePortMain } from "electron";
import type { ServiceMainMessage, ServiceParentMessage } from "../ipc/module-service-channels";
import type { WireError } from "../shared/wire-error";
import { createMainRequestClients } from "./main-requests";
import { eventData, isAttachRendererMessage, isChannelCloseMessage, isChannelOpenMessage, isDropRendererMessage, isLifecycleMessage, isRecord, messagePortFromEvent } from "./validation";
import { createRawProtocolCompat, type RawProtocolCompat } from "./raw-protocol-compat";
import { createServiceChannels } from "./service-channels";
import { createHostLifecycle } from "./lifecycle";
import { createCapabilityHost } from "./capabilities";
import { createServiceApi } from "./service-api";
import { createRendererLeaseManager, type RendererLeaseManager } from "./renderer-lease";
import { createProviderDispatch } from "./provider-dispatch";

type HostLifecycleMessage = ServiceParentMessage & { eventPort?: MessagePortMain };
const parentPort = process.parentPort;
const [serviceEntry] = process.argv.slice(-1);

if (!parentPort || !serviceEntry) {
    console.error("Persephone module service host received invalid startup arguments.");
    process.exit(1);
}

function postMainMessage(message: ServiceMainMessage): void {
    parentPort.postMessage(message);
}

function createRendererLeaseReference(): { get(): RendererLeaseManager; set(manager: RendererLeaseManager): void } {
    let manager: RendererLeaseManager | undefined;
    return {
        get(): RendererLeaseManager {
            if (!manager) throw new Error("Renderer lease manager is not wired.");
            return manager;
        },
        set(value): void { manager = value; },
    };
}

const serviceChannels = createServiceChannels({ post: postMainMessage, serviceError });

let requestNumber = 0;
const lifecycle = createHostLifecycle({
    post: postMainMessage,
    exit: (code: number): never => process.exit(code),
    serviceError,
    closeSettings: (): void => serviceApi.closeSettings(),
    failSettings: (error: Error): void => mainRequests.settings.failAll(error),
    closeChannels: (): void => serviceChannels.closeAll({ code: "service-exited", message: "The board service is shutting down." }),
    revokeEndpoints: (): Promise<boolean> => serviceApi.revokeEndpoints(),
});
const mainRequests = createMainRequestClients({ configReady: lifecycle.configReady, post: postMainMessage, nextSequence: (): number => ++requestNumber });
const rendererLeaseReference = createRendererLeaseReference();
const providerDispatch = createProviderDispatch({
    rendererLeases: rendererLeaseReference.get,
    entryLoaded: (): boolean => lifecycle.entryLoaded,
});
const rendererLeases = createRendererLeaseManager({
    postMain: postMainMessage,
    announceCapabilities: providerDispatch.announceCapabilities,
    handleRequest: providerDispatch.handleRendererRequest,
});
rendererLeaseReference.set(rendererLeases);
const capabilityHost = createCapabilityHost({
    config: (): import("../ipc/module-service-channels").ServiceHostConfig => lifecycle.config,
    post: postMainMessage,
    nextSequence: (): number => ++requestNumber,
    channels: serviceChannels,
});

function serviceError(error: unknown): WireError {
    const candidate = isRecord(error) ? error : undefined;
    const code = typeof candidate?.code === "string" && candidate.code.length > 0
        ? candidate.code
        : "service-error";
    return { code, message: errMessage(error, "Service request failed.") };
}

function handleHostLifecycle(message: HostLifecycleMessage): void {
    if (message.kind === "channel-open") {
        serviceChannels.open(message, message.eventPort);
    } else if (message.kind === "channel-close") {
        serviceChannels.close(message.channelId, message.reason);
    } else if (message.kind === "init" || message.kind === "probe" || message.kind === "request" || message.kind === "shutdown") {
        lifecycle.handleLifecycle(message);
    }
}

const rawCompat = createRawProtocolCompat({
    parentPort,
    isLifecycleMessage,
    handleHostLifecycle,
});
rawCompat.install();
const serviceApi = createServiceApi({
    requests: mainRequests,
    nextSequence: (): number => ++requestNumber,
    protocolMode: (): ReturnType<RawProtocolCompat["getProtocolMode"]> => rawCompat.getProtocolMode(),
    providers: providerDispatch,
    capabilities: capabilityHost,
    lifecycle,
    channels: serviceChannels,
});
rawCompat.onInternalMessage((event: unknown): void => {
    const message = eventData(event);
    if (!isRecord(message)) return;
    if (message.kind === "capability-client-result" && typeof message.requestId === "string") {
        if (capabilityHost.handleResult(message.requestId, message.result)) return;
    }
    if (message.kind === "capability-client-port" && typeof message.requestId === "string") {
        capabilityHost.handlePort(message.requestId, messagePortFromEvent(event));
        return;
    }
    if (capabilityHost.isCallMessage(message)) {
        capabilityHost.handleCall(message);
        return;
    }
    if (message.kind === "capability-cancel" && typeof message.requestId === "string") {
        capabilityHost.handleCancel(message.requestId, message.reason);
        return;
    }
    if (message.kind === "locale-changed") {
        if (typeof message.locale === "string") process.env.PERSEPHONE_LOCALE = message.locale;
        return;
    }
    if (mainRequests.handleResponse(message)) {
        rawCompat.forwardEntryEvent(event, message);
        return;
    }
    if (message.kind === "board-settings-changed") {
        serviceApi.handleSettingsChanged(message.subscriptionId, message.id, message.value);
        rawCompat.forwardEntryEvent(event, message);
        return;
    }
    if (isAttachRendererMessage(message)) {
        rendererLeases.attach(message, messagePortFromEvent(event));
        rawCompat.forwardEntryEvent(event, message);
        return;
    }
    if (isDropRendererMessage(message)) {
        rendererLeases.drop(message);
        rawCompat.forwardEntryEvent(event, message);
        return;
    }
    if (isChannelOpenMessage(message)) {
        serviceChannels.open(message, messagePortFromEvent(event));
        return;
    }
    if (isChannelCloseMessage(message)) {
        serviceChannels.close(message.channelId, message.reason);
        return;
    }
    if (message.kind === "init" && typeof message.nonce === "number") {
        lifecycle.acceptInit(message.nonce, message.config);
    }
    rawCompat.forwardEntryEvent(event, message);
});



process.on("exit", (): void => {
    capabilityHost.cleanup();
    rendererLeases.closeAll("service-exited");
    mainRequests.storage.clear();
    mainRequests.mcp.clear();
    mainRequests.settings.clear();
    serviceApi.cleanup();
});

try {
    await lifecycle.configReady;
    await import(/* @vite-ignore */ pathToFileURL(serviceEntry).href);
    capabilityHost.finishStartup();
    const importState = rawCompat.completeImport();
    lifecycle.completeEntryImport();
    const protocolMode = importState.mode;
    if (protocolMode === "raw" && lifecycle.hasRequestHandler) {
        console.warn("Raw module service protocol detected; persephone.service.onRequest is ignored.");
    }
    if (protocolMode === "host") {
        for (const event of importState.queuedLifecycleEvents) {
            const message = eventData(event);
            if (isRecord(message) && isLifecycleMessage(message)) handleHostLifecycle(message);
        }
    }
    for (const lease of rendererLeases.values()) providerDispatch.announceCapabilities(lease);
} catch (error: unknown) {
    console.error(`Failed to load module service entry ${serviceEntry}:`, errMessage(error, "service-entry-failed"));
    rendererLeases.closeAll("service-exited");
    process.exit(1);
}
