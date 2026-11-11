import type { BoundOpenDispatch, CapabilityOutcome } from "../../../ipc/capability-bus-channels";
import { boardCapabilityDispatcher } from "./BoardCapabilityDispatcher";
import { noHandlerError } from "../capability-error";
import { builtinOpenHandlers } from "./builtin-open-handlers";
import { validatePlatformPayload } from "./platform-payload-validators";
import type { RendererRpcServer } from "../renderer-rpc";

/** Registers main's `capabilityOpen` request: validate once, then run the board dispatcher or the built-in handler. */
export function registerCapabilityOpenRpc(server: RendererRpcServer): void {
    server.register("capabilityOpen", ({ registration, request }, signal) => dispatchCapabilityOpen({ registration, request }, signal));
}

/** Runs one bound open that main dispatched; `signal` aborts when main cancels, times out or loses the caller. */
export async function dispatchCapabilityOpen({ registration, request }: BoundOpenDispatch, signal: AbortSignal): Promise<CapabilityOutcome> {
    validatePlatformPayload(registration.id, request.payload);
    if (registration.headless) throw noHandlerError(registration.id, registration.version);
    if (registration.origin === "board") {
        const cancel = (): void => boardCapabilityDispatcher.cancel(registration, request.requestId);
        signal.addEventListener("abort", cancel, { once: true });
        try { return await boardCapabilityDispatcher.dispatch(registration, request) as CapabilityOutcome; }
        finally { signal.removeEventListener("abort", cancel); }
    }
    const handler = builtinOpenHandlers.resolve(registration);
    if (!handler) throw noHandlerError(registration.id, registration.version);
    const result = await handler(request.payload);
    return { pageId: result.pageId, result: null };
}
