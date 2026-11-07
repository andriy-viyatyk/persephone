import type { CapabilityProvider } from "../ipc/capability-bus-channels";

export type CapabilityProxy = { readonly provider: CapabilityProvider } & Readonly<Record<string, unknown>>;

/** Build a fixed provider snapshot with only declared methods. */
export function createCapabilityProxy(provider: CapabilityProvider, invoke: (method: string, args: unknown[]) => Promise<unknown>): CapabilityProxy {
    const proxy: Record<string, unknown> = { provider: Object.freeze(provider) };
    for (const method of Object.keys(provider.methods)) {
        if (method === "then" || method === "provider") continue;
        proxy[method] = (...args: unknown[]) => invoke(method, args);
    }
    return Object.freeze(proxy) as CapabilityProxy;
}
