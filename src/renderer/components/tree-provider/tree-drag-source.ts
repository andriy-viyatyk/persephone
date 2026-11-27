import type { ITreeProvider } from "../../api/types/io.tree";
import { treeTransferCapability } from "../../content/tree-providers/tree-provider-capabilities";
import { registerHostDragCleanup } from "../../core/traits/dnd";

const sources = new Map<string, ITreeProvider>();
let activeToken: string | undefined;
registerHostDragCleanup(() => clearTreeDragSource());

export function registerTreeDragSource(provider: ITreeProvider): string | undefined {
    if (!treeTransferCapability(provider) || provider.type === "archive") return undefined;
    clearTreeDragSource(activeToken);
    const token = crypto.randomUUID();
    activeToken = token;
    sources.set(token, provider);
    return token;
}

export function resolveTreeDragSource(token: unknown): ITreeProvider | undefined {
    return typeof token === "string" ? sources.get(token) : undefined;
}

export function clearTreeDragSource(token?: string): void {
    const target = token ?? activeToken;
    if (!target) return;
    sources.delete(target);
    if (activeToken === target) activeToken = undefined;
}
