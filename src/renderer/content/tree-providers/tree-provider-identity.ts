import type { TreeProviderDescriptor } from "./tree-provider-factory";

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [
            key,
            stableValue((value as Record<string, unknown>)[key]),
        ]));
    }
    return value;
}

export function stableJson(value: unknown): string {
    return JSON.stringify(stableValue(value));
}

/** Stable persisted identity shared by tree providers and board openTree page reuse. */
export function boardTreeSourceIdentity(descriptor: Pick<TreeProviderDescriptor, "type" | "config" | "rootPath">): string {
    return `board-tree:${stableJson([descriptor.type, descriptor.config ?? null, descriptor.rootPath])}`;
}

/** Identity for a board tree's backing store across roots that may overlap. */
export function boardTreeBackingStoreIdentity(descriptor: Pick<TreeProviderDescriptor, "type" | "config">): string {
    return `board-tree-store:${stableJson([descriptor.type, descriptor.config ?? null])}`;
}
