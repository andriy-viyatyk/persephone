import type { BoardServiceStatus } from "../ipc/module-service-channels";
import type { ServicePortInbox } from "./service-port-inbox";
import type { MainPortChannel } from "./main-port-channel";
import type { HostFrameChannel } from "./board-host-frame-channel";
import { createServiceChannel, domPort, type ServiceChannel, type ServiceChannelKind } from "../shared/service-channel";
import { errMessage } from "../shared/utils";

class ProviderRegistrationServiceOnlyError extends Error {
    readonly code = "provider-registration-service-only";
    constructor() {
        super("persephone.providers.register() is available only in the board module service.");
        this.name = "ProviderRegistrationServiceOnlyError";
    }
}

export function createServiceApi(deps: {
    mainPort: MainPortChannel;
    hostFrame: HostFrameChannel;
    servicePortInbox: ServicePortInbox;
}) {
    const { mainPort, hostFrame, servicePortInbox } = deps;
    const activeServiceChannels = new Set<ServiceChannel>();

    function waitForServiceChannel(channelId: string, kind: ServiceChannelKind): Promise<ServiceChannel> {
        return servicePortInbox.wait(channelId).then((channelPort) => {
            const channel = createServiceChannel(domPort(channelPort), { kind });
            activeServiceChannels.add(channel);
            channel.onClose(() => activeServiceChannels.delete(channel));
            return channel;
        });
    }

    function openServiceChannel(openMessage: unknown): Promise<ServiceChannel> {
        try { structuredClone(openMessage); }
        catch (error) { return Promise.reject(Object.assign(new Error(errMessage(error, "Channel message is not structured-cloneable.")), { code: "rejected" })); }
        return mainPort.rpc("serviceOpenChannel", openMessage).then((value) => waitForServiceChannel(String(value), "service"));
    }

    hostFrame.on("service.channelPort", (payload, context) => {
        if (typeof payload.channelId !== "string" || !context.ports[0]) return;
        servicePortInbox.receive(payload.channelId, context.ports[0]);
    });

    function closeActiveChannels(): void {
        for (const channel of activeServiceChannels) channel.close({ code: "renderer-reloaded", message: "The board page closed or navigated away." });
        activeServiceChannels.clear();
    }

    const api = {
        service: {
            request(message: unknown): Promise<unknown> { return mainPort.rpc("serviceRequest", message); },
            openChannel: openServiceChannel,
            status(): Promise<BoardServiceStatus | undefined> { return mainPort.rpc("serviceStatus"); },
            stop(): Promise<void> { return mainPort.rpc("serviceStop"); },
        },
        services: {
            list(interfaceId: string): Promise<Array<{ provider: string; title: string; version: number; boardName: string }>> {
                return mainPort.rpc("servicesList", interfaceId);
            },
            connect(interfaceId: string, selector: { provider: string; version: number }, openMessage?: unknown): Promise<ServiceChannel> {
                try { structuredClone(openMessage); }
                catch (error) { return Promise.reject(Object.assign(new Error(errMessage(error, "Channel message is not structured-cloneable.")), { code: "rejected" })); }
                return mainPort.rpc("servicesConnect", interfaceId, selector, openMessage).then((value) => waitForServiceChannel(String(value), "service"));
            },
        },
        providers: {
            register(_type: string, _implementation: unknown): never { throw new ProviderRegistrationServiceOnlyError(); },
        },
    };

    return { api, waitForServiceChannel, closeActiveChannels };
}
