import { ipcMain } from "electron";
import { ENDPOINT_REPLY_CHANNEL, Endpoint, type Api, type EndpointReply } from "../api-types";
import { errMessage } from "../../shared/utils";
import { wireError } from "../../shared/wire-error";
import { guardIpcSender, IPC_AUTHORIZATION_ERROR } from "../../main/ipc-sender-guard";

type AddEventParam<T> = T extends (...args: infer Args) => infer Return
    ? (event: Electron.IpcMainEvent, ...args: Args) => Return
    : never;

/** Main-side API signatures, derived from the renderer API contract. */
export type MainApi = { [K in keyof Api]: AddEventParam<Api[K]> };

/** Endpoint registration preserves the API contract while centralizing reply/error wiring. */
export type BindEndpoint = <K extends Endpoint>(command: K, handler: MainApi[K]) => void;

/** Register an `Endpoint` request/reply handler using the renderer API's
 * established channel and error semantics. Service registrars compose this
 * instead of each owning their own `ipcMain.on` wrapper. */
export const bindEndpoint: BindEndpoint = (command, handler) => {
    ipcMain.on(command, async (event, arg, commandId) => {
        const reply = (payload: EndpointReply) => event.reply(ENDPOINT_REPLY_CHANNEL, payload);
        if (!guardIpcSender(event, command)) {
            reply({ id: commandId, ok: false, error: wireError(IPC_AUTHORIZATION_ERROR) });
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
