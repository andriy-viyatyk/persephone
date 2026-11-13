import { ipcMain, type IpcMainEvent } from "electron";
import { ENDPOINT_REPLY_CHANNEL, type Api, type EndpointReply } from "../api-types";
import { errMessage } from "../../shared/utils";
import { wireError } from "../../shared/wire-error";
import { guardIpcSender, IPC_AUTHORIZATION_ERROR, type SenderPolicy } from "../../main/ipc-sender-guard";

export interface EndpointBindOptions {
    policy?: SenderPolicy;
    deny?: () => unknown;
}

type AddEventParam<T> = T extends (...args: infer Args) => infer Return
    ? (event: IpcMainEvent, ...args: Args) => Return
    : never;

/** Main-side API signatures, derived from the renderer API contract. */
export type MainApi = { [K in keyof Api]: AddEventParam<Api[K]> };

export type MainHandlers<XApi> = { [K in keyof XApi]: AddEventParam<XApi[K]> };

export type DomainBindOptions<XApi> = {
    [K in keyof XApi]?: EndpointBindOptions;
};

/** Endpoint registration preserves the API contract while centralizing reply/error wiring. */
export type BindEndpoint = <K extends keyof Api>(command: K, handler: MainApi[K], options?: EndpointBindOptions) => void;

/** Register an `Endpoint` request/reply handler using the renderer API's
 * established channel and error semantics. Service registrars compose this
 * instead of each owning their own `ipcMain.on` wrapper. */
export const bindEndpoint: BindEndpoint = (command, handler, options) => {
    ipcMain.on(command, async (event, arg, commandId) => {
        const reply = (payload: EndpointReply) => event.reply(ENDPOINT_REPLY_CHANNEL, payload);
        if (!guardIpcSender(event, command)) {
            reply({ id: commandId, ok: false, error: wireError(IPC_AUTHORIZATION_ERROR) });
            return;
        }
        if (options?.policy && !options.policy(event)) {
            try {
                const denied = options.deny ? await options.deny() : new Error(IPC_AUTHORIZATION_ERROR);
                if (denied instanceof Error) throw denied;
                reply({ id: commandId, ok: true, result: denied });
            } catch (e) {
                console.error("Api Error:", e);
                reply({ id: commandId, ok: false, error: wireError(errMessage(e, "Unknown error")) });
            }
            return;
        }
        try {
            const invoke = handler as (...args: unknown[]) => unknown;
            const result = await invoke(event, ...arg);
            reply({ id: commandId, ok: true, result });
        } catch (e) {
            console.error("Api Error:", e);
            reply({ id: commandId, ok: false, error: wireError(errMessage(e, "Unknown error")) });
        }
    });
};

/** Register every method in a domain contract through the existing request transport. */
export function bindDomain<XApi>(handlers: MainHandlers<XApi>, options?: DomainBindOptions<XApi>): void {
    for (const [key, handler] of Object.entries(handlers)) {
        bindEndpoint(
            key as keyof Api,
            handler as MainApi[keyof Api],
            options?.[key as keyof XApi],
        );
    }
}
