import { BrowserWindow, ipcMain, session } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { appPartition } from "./constants";

export const IPC_AUTHORIZATION_ERROR = "Unauthorized IPC sender";

type IpcEvent = IpcMainEvent | IpcMainInvokeEvent;

export type SenderPolicy = (event: IpcEvent) => boolean;

export interface SenderPolicyOptions {
    policy?: SenderPolicy;
    deny?: "ignore" | (() => unknown);
}

const warnedChannelsBySender = new WeakMap<WebContents, Set<string>>();

export function isAppRenderer(event: IpcEvent): boolean {
    return event.sender.session === session.fromPartition(appPartition)
        && !event.sender.isDestroyed()
        && event.sender.mainFrame === event.senderFrame
        && !!BrowserWindow.fromWebContents(event.sender);
}

/** Returns false and logs once when an IPC event did not come from an app main frame. */
export function guardIpcSender(event: IpcEvent, channel: string): boolean {
    if (isAppRenderer(event)) return true;

    let warnedChannels = warnedChannelsBySender.get(event.sender);
    if (!warnedChannels) {
        warnedChannels = new Set<string>();
        warnedChannelsBySender.set(event.sender, warnedChannels);
    }

    if (!warnedChannels.has(channel)) {
        warnedChannels.add(channel);
        console.warn(`[IPC] Rejected sender for ${channel} (webContents ${event.sender.id})`);
    }
    return false;
}

export function guardedIpcOn<Args extends unknown[]>(
    channel: string,
    listener: (event: IpcMainEvent, ...args: Args) => void,
    options: SenderPolicyOptions = {},
): void {
    ipcMain.on(channel, (event, ...args) => {
        if (!guardIpcSender(event, channel)) return;
        if (options.policy && !options.policy(event)) {
            if (typeof options.deny === "function") throw options.deny();
            return;
        }
        listener(event, ...(args as Args));
    });
}

export function guardedIpcHandle<Args extends unknown[], Result>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
    options: SenderPolicyOptions = {},
): void {
    ipcMain.handle(channel, (event, ...args) => {
        if (!guardIpcSender(event, channel)) throw new Error(IPC_AUTHORIZATION_ERROR);
        if (options.policy && !options.policy(event)) {
            if (typeof options.deny === "function") throw options.deny();
            if (options.deny !== "ignore") throw new Error(IPC_AUTHORIZATION_ERROR);
            return undefined;
        }
        return listener(event, ...(args as Args));
    });
}
