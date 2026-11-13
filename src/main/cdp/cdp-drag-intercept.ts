import type { WebContents } from "electron";
import type { DragData } from "../../ipc/browser-ipc";
import type { CdpTarget } from "./CdpTarget";

interface DragInterceptState { promise: Promise<DragData>; cleanup: () => void; result?: DragData; taken?: boolean }
export interface DragInterceptContext { webContents: WebContents; cdp: CdpTarget; sessionId?: string; isBoard: boolean }
const dragIntercepts = new Map<string, DragInterceptState>();

export async function armDragIntercept(context: DragInterceptContext, key: string, sessionId?: string): Promise<string> {
    if (context.isBoard && (context.sessionId || undefined) !== (sessionId || undefined)) throw new Error("Drag interception session does not match the selected target.");
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let resolve!: (data: DragData) => void;
    const promise = new Promise<DragData>(done => { resolve = done; });
    let cleanup = () => {};
    const state: DragInterceptState = { promise, cleanup: () => cleanup() };
    cleanup = context.cdp.subscribeCdpEvents((method, raw, eventSessionId) => {
        if (method !== "Input.dragIntercepted" || (eventSessionId || undefined) !== (sessionId || undefined)) return;
        if (!raw || typeof raw !== "object") return;
        const data = (raw as { data?: unknown }).data;
        if (!data || typeof data !== "object") return;
        state.result = data as DragData;
        cleanup();
        resolve(state.result);
    });
    dragIntercepts.set(token, state);
    return token;
}

export async function takeDragIntercept(token: string, waitMs: number): Promise<DragData | null> {
    const state = dragIntercepts.get(token);
    if (!state || state.taken) return null;
    state.taken = true;
    const delay = Number.isFinite(waitMs) ? Math.max(0, Math.min(waitMs, 5000)) : 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([state.promise, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), delay); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); state.cleanup(); dragIntercepts.delete(token); }
}
