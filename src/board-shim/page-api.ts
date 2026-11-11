import type { BoardPortInitMsg } from "../ipc/board-bridge/frame-protocol";
import { errMessage } from "../shared/utils";
import type { HostFrameChannel } from "./board-host-frame-channel";
import { Listeners, SettledValue } from "./primitives";

export function createPageApi(deps: { hostFrame: HostFrameChannel }) {
    const { hostFrame } = deps;
    let busyState: boolean | null = null;
    const busyReady = new SettledValue<void>();
    let pageVisible = false;
    const pageVisibilityListeners = new Listeners<[boolean]>("persephone.page.onVisibilityChange callback error:", { replay: () => [pageVisible] });
    let voiceTypingAutoStopSilenceMs = 0;
    const voiceTypingAutoStopListeners = new Listeners<[number]>("persephone.voiceTyping.onAutoStopSilenceChange callback error:", { replay: () => [voiceTypingAutoStopSilenceMs] });
    let saveHandlerId = 0;
    const saveHandlers = new Map<number, () => void | boolean | Promise<void | boolean>>();
    const discardListeners = new Listeners<[]>("");
    const muteToggleListeners = new Listeners<[]>("persephone.page.onMuteToggle callback error:");

    function activeSaveRegistration(): { id: number; handler: () => void | boolean | Promise<void | boolean> } | undefined {
        const entry = [...saveHandlers.entries()].at(-1);
        return entry ? { id: entry[0], handler: entry[1] } : undefined;
    }
    function setVoiceTypingAutoStopSilence(value: unknown): void {
        if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0
            || value === voiceTypingAutoStopSilenceMs) return;
        voiceTypingAutoStopSilenceMs = value;
        voiceTypingAutoStopListeners.emit(value);
    }
    function setPageVisibility(visible: boolean): void {
        if (pageVisible === visible) return;
        pageVisible = visible;
        pageVisibilityListeners.emit(visible);
    }

    hostFrame.handle("save", async ({ discard }) => {
        if (discard === true) {
            await discardListeners.emitSettled();
            return { success: true };
        }
        const registration = activeSaveRegistration();
        if (!registration) return { success: false, error: "The board has no active Save handler." };
        try {
            const result = await registration.handler();
            const current = activeSaveRegistration();
            return current?.id === registration.id
                ? { success: result !== false }
                : { success: false, error: "The board's Save handler changed while it was saving." };
        } catch (error: unknown) {
            return { success: false, error: errMessage(error, "The board failed to save its changes.") };
        }
    });
    hostFrame.on("save.handlerSync", () => {
        const active = activeSaveRegistration();
        if (active) hostFrame.emit("saveHandler", { handlerId: active.id, registered: true });
    });
    hostFrame.on("page.muteToggle", () => muteToggleListeners.emit());
    hostFrame.on("page.visibility", (data) => {
        if (typeof data.visible === "boolean") setPageVisibility(data.visible);
    });
    hostFrame.on("voiceTyping.autoStopSilenceChanged", (data) => setVoiceTypingAutoStopSilence(data.milliseconds));

    return {
        api: {
            page: {
                get visible(): boolean { return pageVisible; },
                setModified(modified: boolean): void { hostFrame.emit("modified.set", { modified: modified === true }); },
                setMuted(muted: boolean | null): void { hostFrame.emit("muted.set", { muted: muted === null ? null : muted === true }); },
                onMuteToggle(callback: () => void): () => void {
                    if (typeof callback !== "function") throw new TypeError("persephone.page.onMuteToggle expects a function.");
                    return muteToggleListeners.add(callback);
                },
                onVisibilityChange(callback: (visible: boolean) => void): () => void {
                    if (typeof callback !== "function") throw new TypeError("persephone.page.onVisibilityChange expects a function.");
                    return pageVisibilityListeners.add(callback);
                },
            },
            voiceTyping: {
                get autoStopSilenceMs(): number { return voiceTypingAutoStopSilenceMs; },
                onAutoStopSilenceChange(callback: (milliseconds: number) => void): () => void {
                    if (typeof callback !== "function") throw new TypeError("persephone.voiceTyping.onAutoStopSilenceChange expects a function.");
                    return voiceTypingAutoStopListeners.add(callback);
                },
            },
            onDiscardRequest(handler: () => void | Promise<void>): () => void {
                if (typeof handler !== "function") throw new TypeError("persephone.onDiscardRequest expects a function.");
                return discardListeners.add(handler);
            },
            onSaveRequest(handler: () => void | boolean | Promise<void | boolean>): () => void {
                if (typeof handler !== "function") throw new TypeError("persephone.onSaveRequest expects a function.");
                const id = ++saveHandlerId;
                saveHandlers.set(id, handler);
                hostFrame.emit("saveHandler", { handlerId: id, registered: true });
                return () => {
                    if (!saveHandlers.has(id)) return;
                    const wasActive = activeSaveRegistration()?.id === id;
                    saveHandlers.delete(id);
                    hostFrame.emit("saveHandler", { handlerId: id, registered: false });
                    const active = activeSaveRegistration();
                    if (wasActive && active) hostFrame.emit("saveHandler", { handlerId: active.id, registered: true });
                };
            },
            setBoardBusy(busy: boolean): void {
                busyState = !!busy;
                busyReady.settle(undefined);
                try { hostFrame.emit("busy", { busy: !!busy }); } catch { /* parent gone */ }
            },
            getBoardBusy(): Promise<boolean> {
                if (busyState !== null) return Promise.resolve(busyState);
                return busyReady.get().then(() => {
                    if (busyState === null) throw new Error("Board busy state was not initialized.");
                    return busyState;
                });
            },
            setWorking(working: boolean): void {
                try { hostFrame.emit("working", { working: !!working }); } catch { /* parent gone */ }
            },
        },
        initBusy(data: BoardPortInitMsg): void {
            if (busyState === null) {
                busyState = !!data.busy;
                busyReady.settle(undefined);
            }
        },
        initVisibilityAndVoice(data: BoardPortInitMsg): void {
            if (typeof data.pageVisible === "boolean") setPageVisibility(data.pageVisible);
            setVoiceTypingAutoStopSilence(data.voiceTypingAutoStopSilenceMs);
        },
    };
}
