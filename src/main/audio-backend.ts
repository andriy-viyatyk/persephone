import { codedError } from "../shared/coded-error";
import type { audioService } from "./audio-service";
import type { CapabilityBackend, CapabilityBackendCall, CapabilityBackendChannelOpen } from "./capability-backend";

/** Adapts the audio service to the router's backend interface; all audio rules stay in `audio-service`. */
export class AudioBackend implements CapabilityBackend {
    constructor(private readonly service: Pick<typeof audioService, "callDevices" | "openCapabilityChannel">) {}

    call({ bound, method, args, invocation, reauthorize }: CapabilityBackendCall): Promise<unknown> {
        return this.service.callDevices(bound, method, args, invocation, reauthorize);
    }
    openChannel({ bound, method, argument, invocation, delivery, reauthorize }: CapabilityBackendChannelOpen) {
        return this.service.openCapabilityChannel(bound, method, argument, invocation, delivery, reauthorize);
    }
    checkChannelArguments(method: string, args: readonly unknown[]): void {
        if (method === "muteApp" && args.length !== 0) throw codedError("rejected");
    }
}
