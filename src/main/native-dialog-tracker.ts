import { spawn } from "child_process";
import { BrowserWindow } from "electron";
import { getSnipToolPath } from "./snip-service";
import { errMessage } from "../shared/utils";

export type NativeDialogKind = "file" | "folder" | "messageBox";

interface NativeDialogState {
    activeKinds: Map<NativeDialogKind, number>;
    messageBoxControllers: Set<AbortController>;
}

interface NativeDialogCommandResult {
    cancelled: number;
    titles: string[];
}

const activeDialogs = new WeakMap<BrowserWindow, NativeDialogState>();

function beginNativeDialog(browserWindow: BrowserWindow | undefined, kind: NativeDialogKind): () => void {
    if (!browserWindow) return () => undefined;
    let state = activeDialogs.get(browserWindow);
    if (!state) {
        state = { activeKinds: new Map(), messageBoxControllers: new Set() };
        activeDialogs.set(browserWindow, state);
        browserWindow.once("closed", () => {
            activeDialogs.delete(browserWindow);
        });
    }
    state.activeKinds.set(kind, (state.activeKinds.get(kind) ?? 0) + 1);
    let ended = false;
    return () => {
        if (ended) return;
        ended = true;
        const currentState = activeDialogs.get(browserWindow);
        if (!currentState) return;
        const count = currentState.activeKinds.get(kind) ?? 0;
        if (count <= 1) currentState.activeKinds.delete(kind);
        else currentState.activeKinds.set(kind, count - 1);
        if (currentState.activeKinds.size === 0 && currentState.messageBoxControllers.size === 0) {
            activeDialogs.delete(browserWindow);
        }
    };
}

export function registerNativeDialogAbortController(browserWindow: BrowserWindow, controller: AbortController): () => void {
    let state = activeDialogs.get(browserWindow);
    if (!state) {
        state = { activeKinds: new Map(), messageBoxControllers: new Set() };
        activeDialogs.set(browserWindow, state);
    }
    state.messageBoxControllers.add(controller);
    return () => {
        const currentState = activeDialogs.get(browserWindow);
        currentState?.messageBoxControllers.delete(controller);
        if (currentState && currentState.activeKinds.size === 0 && currentState.messageBoxControllers.size === 0) {
            activeDialogs.delete(browserWindow);
        }
    };
}

export async function withNativeDialog<T>(
    browserWindow: BrowserWindow | undefined,
    kind: NativeDialogKind,
    operation: () => Promise<T>,
): Promise<T> {
    const end = beginNativeDialog(browserWindow, kind);
    try {
        return await operation();
    } finally {
        end();
    }
}

export function withNativeDialogSync<T>(
    browserWindow: BrowserWindow | undefined,
    kind: NativeDialogKind,
    operation: () => T,
): T {
    const end = beginNativeDialog(browserWindow, kind);
    try {
        return operation();
    } finally {
        end();
    }
}

function ownerHwnd(browserWindow: BrowserWindow): string {
    return browserWindow.getNativeWindowHandle().readBigUInt64LE(0).toString(10);
}

function runDialogCommand(args: string[]): Promise<NativeDialogCommandResult | undefined> {
    return new Promise(resolve => {
        let settled = false;
        const finish = (result: NativeDialogCommandResult | undefined): void => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        let child;
        try {
            child = spawn(getSnipToolPath(), args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        } catch (error) {
            console.warn("[native-dialog] Could not start dialog helper: " + errMessage(error));
            finish(undefined);
            return;
        }
        const chunks: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => {
            console.warn("[native-dialog] " + chunk.toString("utf8").trim());
        });
        child.on("error", error => {
            console.warn("[native-dialog] Dialog helper failed: " + errMessage(error));
            finish(undefined);
        });
        child.on("close", code => {
            if (code !== 0) {
                finish(undefined);
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Partial<NativeDialogCommandResult>;
                if (typeof parsed.cancelled !== "number" || !Array.isArray(parsed.titles)
                    || !parsed.titles.every(title => typeof title === "string")) {
                    finish(undefined);
                    return;
                }
                finish({ cancelled: parsed.cancelled, titles: parsed.titles });
            } catch (error) {
                console.warn("[native-dialog] Invalid dialog helper response: " + errMessage(error));
                finish(undefined);
            }
        });
    });
}

export interface NativeDialogSnapshot {
    open: boolean;
    kind?: NativeDialogKind;
    title?: string;
}

export async function getNativeDialogState(browserWindow: BrowserWindow | undefined): Promise<NativeDialogSnapshot> {
    if (!browserWindow || browserWindow.isDestroyed()) return { open: false };
    const state = activeDialogs.get(browserWindow);
    const activeKind = state?.activeKinds.keys().next().value as NativeDialogKind | undefined;
    if (!activeKind) return { open: false };
    const result = await runDialogCommand(["dialog-info", ownerHwnd(browserWindow)]);
    return {
        open: true,
        kind: activeKind,
        ...(result?.titles[0] ? { title: result.titles[0] } : {}),
    };
}

export async function cancelNativeDialogs(browserWindow: BrowserWindow): Promise<NativeDialogCommandResult> {
    const state = activeDialogs.get(browserWindow);
    for (const controller of state?.messageBoxControllers ?? []) controller.abort();
    if (browserWindow.isDestroyed()) return { cancelled: 0, titles: [] };
    const result = await runDialogCommand(["dialog-cancel", ownerHwnd(browserWindow)]);
    return result ?? { cancelled: 0, titles: [] };
}

export async function getNativeDialogAttention(
    browserWindow: BrowserWindow | undefined,
    windowIndex?: number,
): Promise<{ text: string } | undefined> {
    if (!browserWindow || windowIndex === undefined) return undefined;
    const state = await getNativeDialogState(browserWindow);
    if (!state.open || !state.kind) return undefined;
    const dialogName = state.kind === "messageBox" ? "messageBox" : state.kind;
    const title = state.title ? " (title: " + state.title + ")" : "";
    return { text: "Attention: a native " + dialogName + " dialog is open in window " + windowIndex
        + title + "; call windows[" + windowIndex + "].nativeDialog.dismiss() to cancel it." };
}
