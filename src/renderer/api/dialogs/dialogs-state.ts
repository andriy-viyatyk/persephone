import { Subscription } from "../../core/state/events";
import { TGlobalState } from "../../core/state/state";
import type { IDialogViewData, IPopperViewData } from "./dialog-types";

export const dialogsState = new TGlobalState<IDialogViewData[]>([]);

export const popperState = new TGlobalState<IPopperViewData[]>([]);

export const onDialogClosed = new Subscription<void>();

export async function showDialog<R>(data: IDialogViewData): Promise<R> {
    data.internalId = crypto.randomUUID();
    data.model.result = new Promise<R>(resolve => {
        data.model.onClose = res => {
            dialogsState.set(oldState => oldState.filter(item => item !== data));
            onDialogClosed.send(undefined);
            resolve(res as R);
        };
        dialogsState.set(oldState => [...oldState, data]);
    });

    return data.model.result as Promise<R>;
}

export async function showPopper<R>(data: IPopperViewData): Promise<R> {
    data.model.result = new Promise<R>((resolve) => {
        data.model.onClose = (res) => {
            const poppers = popperState.get();
            if (poppers.includes(data)) {
                popperState.set(poppers.filter((popper) => popper !== data));
            }
            resolve(res);
        };
        popperState.set((state) => [...state, data]);
    });

    return data.model.result;
}

export const closePopper = (viewId: symbol) => {
    const currentPopper = popperState.get().find((popper) => popper.viewId === viewId);
    if (currentPopper) currentPopper.model.close(currentPopper);
};

export const visiblePoppers = () => popperState.get();
