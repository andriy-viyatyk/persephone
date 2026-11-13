import type { WebContents } from "electron";
import { AI_VISION_HOST_SIGNAL } from "ai-vision";
import type { CdpTarget } from "./CdpTarget";

type DebuggerMessageHandler = (
    event: Electron.Event,
    method: string,
    params: unknown,
    sessionId: string,
) => void;

interface AiVisionBindingState {
    handler: DebuggerMessageHandler;
    installed: boolean;
    installing?: Promise<void>;
}

const defaultExecutionContexts = new WeakMap<WebContents, Map<number, string>>();
const mainFrameIds = new WeakMap<WebContents, string>();
const aiVisionBindingStates = new WeakMap<WebContents, AiVisionBindingState>();
const contextHandlers = new WeakMap<WebContents, DebuggerMessageHandler>();

export function onTargetAttached(wc: WebContents): void {
    const contexts = new Map<number, string>();
    defaultExecutionContexts.set(wc, contexts);
    const contextHandler: DebuggerMessageHandler = (_event, method, raw, sessionId) => {
        if (sessionId || !raw || typeof raw !== "object") return;
        const event = raw as { context?: { id?: unknown; auxData?: { isDefault?: unknown; frameId?: unknown } }; executionContextId?: unknown };
        if (method === "Runtime.executionContextCreated" && typeof event.context?.id === "number"
            && event.context.auxData?.isDefault === true && typeof event.context.auxData.frameId === "string") {
            contexts.set(event.context.id, event.context.auxData.frameId);
        } else if (method === "Runtime.executionContextDestroyed" && typeof event.executionContextId === "number") {
            contexts.delete(event.executionContextId);
        } else if (method === "Runtime.executionContextsCleared") contexts.clear();
    };
    wc.debugger.on("message", contextHandler);
    contextHandlers.set(wc, contextHandler);
}

export function clearAiVisionBinding(wc: WebContents): void {
    const state = aiVisionBindingStates.get(wc);
    if (!state) return;
    try {
        if (!wc.isDestroyed()) wc.debugger.removeListener("message", state.handler);
    } catch {
        // WebContents may already be destroyed.
    }
    aiVisionBindingStates.delete(wc);
}

export function onTargetDetached(wc: WebContents): void {
    const contextHandler = contextHandlers.get(wc);
    try {
        if (contextHandler && !wc.isDestroyed()) wc.debugger.removeListener("message", contextHandler);
    } catch { /* WebContents may already be destroyed. */ }
    contextHandlers.delete(wc);
    defaultExecutionContexts.delete(wc);
    mainFrameIds.delete(wc);
    clearAiVisionBinding(wc);
}

export async function ensureAiVisionBinding(
    wc: WebContents,
    attach: (wc: WebContents) => CdpTarget,
    onAiVisionSignal: (webContents: WebContents, payload: string, executionContextId: number, mainContext: boolean) => void,
): Promise<void> {
    const existing = aiVisionBindingStates.get(wc);
    if (existing?.installed) return;
    if (existing?.installing) return existing.installing;

    const state: AiVisionBindingState = existing || {
        handler: (_event, method, params) => {
            if (method !== "Runtime.bindingCalled") return;
            if (!params || typeof params !== "object") return;
            const binding = params as { name?: unknown; payload?: unknown; executionContextId?: unknown };
            if (binding.name !== AI_VISION_HOST_SIGNAL) return;
            if (typeof binding.payload !== "string" || Buffer.byteLength(binding.payload, "utf8") > 262_144
                || typeof binding.executionContextId !== "number") return;
            const frame = mainFrameIds.get(wc);
            const mainContext = !!frame && defaultExecutionContexts.get(wc)?.get(binding.executionContextId) === frame;
            onAiVisionSignal(wc, binding.payload, binding.executionContextId, mainContext);
        },
        installed: false,
    };
    if (!existing) {
        aiVisionBindingStates.set(wc, state);
        wc.debugger.on("message", state.handler);
    }

    const installing = (async () => {
        const tree = await wc.debugger.sendCommand("Page.getFrameTree") as { frameTree?: { frame?: { id?: string } } };
        if (!tree.frameTree?.frame?.id) throw new Error("Missing main frame");
        mainFrameIds.set(wc, tree.frameTree.frame.id);
        await attach(wc).enableDomain("Runtime");
        await wc.debugger.sendCommand("Runtime.addBinding", { name: AI_VISION_HOST_SIGNAL });
        if (aiVisionBindingStates.get(wc) === state) state.installed = true;
    })().catch(() => {
        if (aiVisionBindingStates.get(wc) === state) clearAiVisionBinding(wc);
    }).finally(() => {
        if (aiVisionBindingStates.get(wc) === state) state.installing = undefined;
    });
    state.installing = installing;
    return installing;
}
