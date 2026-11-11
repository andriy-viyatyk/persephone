import type { HostFrameChannel } from "./board-host-frame-channel";
import { Listeners, SettledValue } from "./primitives";

export function createSharedStateApi(deps: { hostFrame: HostFrameChannel }) {
    const { hostFrame } = deps;
    let sharedState: Record<string, unknown> = {};
    let sharedStateSeq = -1;
    const sharedStateReady = new SettledValue<void>();
    const sharedStateListeners = new Listeners<[Record<string, unknown>]>("persephone.state.onChange callback error:");
    const applyStateSync = (state: Record<string, unknown>, seq: number): void => {
        if (seq <= sharedStateSeq) return;
        sharedStateSeq = seq;
        sharedState = state;
        sharedStateReady.settle(undefined);
        sharedStateListeners.emit(state);
    };
    hostFrame.on("state.sync", (data) => applyStateSync(data.state ?? {}, typeof data.seq === "number" ? data.seq : 0));

    return {
        api: {
            state: {
                init(defaults: Record<string, unknown>, options?: { restorableKeys?: string[] }): void {
                    try { hostFrame.emit("state.init", { defaults: defaults ?? {}, restorableKeys: options?.restorableKeys }); } catch { /* parent gone */ }
                },
                get(): Promise<Record<string, unknown>> { return sharedStateReady.get().then(() => sharedState); },
                set(next: Record<string, unknown>): void {
                    try { hostFrame.emit("state.set", { state: next ?? {} }); } catch { /* parent gone */ }
                },
                merge(partial: Record<string, unknown>): void {
                    try { hostFrame.emit("state.merge", { partial: partial ?? {} }); } catch { /* parent gone */ }
                },
                onChange(cb: (state: Record<string, unknown>) => void): () => void { return sharedStateListeners.add(cb); },
            },
            var: {
                get(name: string, env?: string): Promise<string | undefined> { return hostFrame.request("var.get", { name, ...(env === undefined ? {} : { env }) }); },
                set(name: string, value: string, env?: string): Promise<void> { return hostFrame.request("var.set", { name, value, ...(env === undefined ? {} : { env }) }); },
                list(env?: string): Promise<string[]> { return hostFrame.request("var.list", env === undefined ? {} : { env }); },
                show(): Promise<void> { return hostFrame.request("var.show", {}); },
            },
        },
    };
}
