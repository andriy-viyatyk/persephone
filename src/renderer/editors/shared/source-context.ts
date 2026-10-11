import type { IPageHost } from "../../api/pages/IPageHost";
import type { ITreeProvider, ILink } from "../../api/types/io.tree";
import { fpBasename, fpDirname } from "../../core/utils/file-path";
import type { ILinkData } from "../../../shared/link-data";
import type { BoardSourceContext } from "../../../shared/board-source-context";

const MAX_SOURCE_CONTEXT_ITEMS = 5_000;
const MAX_SOURCE_CONTEXT_BYTES = 1024 * 1024;
const MAX_SOURCE_CONTEXT_LABEL_LENGTH = 256;

/** Compare hrefs the way Windows paths compare: case-insensitive, either slash direction. */
function sameHref(a: string, b: string): boolean {
    return a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
}

export interface GetSiblingItemsOptions {
    page: Pick<IPageHost, "panelEditors">;
    sourceLink?: ILinkData;
    currentHref: string;
    include?: (item: ILink) => boolean;
    limit?: number;
}

/** Find the panel provider that supplied a navigation source id. */
export function findSourceProvider(page: Pick<IPageHost, "panelEditors">, sourceId?: string): ITreeProvider | null {
    if (!sourceId) return null;
    for (const editor of page.panelEditors) {
        if (!("treeProvider" in editor)) continue;
        const provider = (editor as { treeProvider?: ITreeProvider | null }).treeProvider;
        if (sourceId === "explorer" && provider?.type === "file") return provider;
        if ((sourceId === "link-category" || sourceId === "link-tag") && provider?.type === "link") {
            return provider;
        }
    }
    return null;
}

/** Enumerate siblings using the same source selection rules shared by boards and Video Player. */
export async function getSiblingItems(
    options: GetSiblingItemsOptions,
): Promise<{ items: ILink[]; currentIndex: number } | null> {
    const { page, sourceLink, currentHref } = options;
    const provider = findSourceProvider(page, sourceLink?.sourceId);
    if (!provider) return null;

    let allItems: ILink[];
    if (sourceLink?.sourceId === "link-tag" && provider.getTagItems) {
        allItems = provider.getTagItems(sourceLink.selectedTag ?? "");
    } else {
        const parentPath = provider.type === "file"
            ? fpDirname(currentHref || sourceLink?.href || "")
            : sourceLink?.category ?? provider.rootPath;
        if (!parentPath && provider.type === "file") return null;
        allItems = await provider.list(parentPath);
    }

    const items = allItems.filter((item) => !item.isDirectory && (options.include?.(item) ?? true));
    if (items.length === 0) return null;
    const current = currentHref || sourceLink?.href || "";
    return {
        items,
        currentIndex: items.findIndex((item) => sameHref(item.href, current)),
    };
}

function serializeSourceContext(context: BoardSourceContext): string {
    return JSON.stringify(context);
}

function contextBytes(context: BoardSourceContext): number {
    return new TextEncoder().encode(serializeSourceContext(context)).byteLength;
}

function limitDisplayText(value: string): string {
    return Array.from(value).slice(0, MAX_SOURCE_CONTEXT_LABEL_LENGTH).join("");
}

function buildContext(
    provider: ITreeProvider,
    sourceLink: ILinkData,
    currentHref: string,
    items: ILink[],
    start: number,
    end: number,
): BoardSourceContext {
    const sourceId = sourceLink.sourceId;
    const kind = sourceId === "explorer" ? "folder" : sourceId as "link-category" | "link-tag";
    const sourcePath = kind === "folder"
        ? fpDirname(currentHref || sourceLink.href || "")
        : provider.sourceUrl;
    const category = sourceId === "link-category" ? sourceLink.category ?? provider.rootPath : undefined;
    const tag = sourceId === "link-tag" ? sourceLink.selectedTag ?? "" : undefined;
    const label = kind === "folder"
        ? fpBasename(sourcePath)
        : kind === "link-tag"
            ? (tag || "All")
            : (category ? fpBasename(category) : provider.displayName);
    const boundedItems = items.slice(start, end).map((item) => ({
        href: item.href,
        title: limitDisplayText(item.title || item.href),
        ...(provider.type === "link" ? {
            ...(item.id !== undefined ? { id: item.id } : {}),
            category: item.category,
            tags: item.tags,
        } : {}),
    }));
    const currentIndex = items.findIndex((item) => sameHref(item.href, currentHref));
    const index = currentIndex >= start && currentIndex < end ? currentIndex - start : -1;
    return {
        kind,
        sourcePath,
        ...(category !== undefined ? { category } : {}),
        ...(tag !== undefined ? { tag } : {}),
        label: limitDisplayText(label),
        items: boundedItems,
        index,
    };
}

/** Capture a bounded, serializable source-panel snapshot for a board open. */
export async function captureBoardSourceContext(
    options: GetSiblingItemsOptions & { sourceLink: ILinkData },
): Promise<BoardSourceContext | undefined> {
    const { page, sourceLink, currentHref } = options;
    if (sourceLink.sourceId !== "explorer" && sourceLink.sourceId !== "link-category" && sourceLink.sourceId !== "link-tag") {
        return undefined;
    }
    const provider = findSourceProvider(page, sourceLink.sourceId);
    if (!provider) return undefined;
    const result = await getSiblingItems({ ...options, page, sourceLink, currentHref });
    if (!result) return undefined;

    const all = result.items;
    const maxItems = Math.min(MAX_SOURCE_CONTEXT_ITEMS, Math.max(1, options.limit ?? MAX_SOURCE_CONTEXT_ITEMS));
    const currentIndex = result.currentIndex;
    const preferredStart = all.length <= maxItems
        ? 0
        : currentIndex >= 0
            ? Math.max(0, Math.min(currentIndex - Math.floor(maxItems / 2), all.length - maxItems))
            : 0;
    const preferredEnd = Math.min(all.length, preferredStart + maxItems);
    const context = buildContext(provider, sourceLink, currentHref, all, preferredStart, preferredEnd);
    if (contextBytes(context) <= MAX_SOURCE_CONTEXT_BYTES) return context;

    // If the complete list exceeds the serialized bound, shrink a contiguous window around
    // the opened item. A one-item context is the minimum useful snapshot.
    let low = 1;
    let high = preferredEnd - preferredStart - 1;
    let best: BoardSourceContext | undefined;
    while (low <= high) {
        const count = Math.floor((low + high) / 2);
        const start = currentIndex >= 0
            ? Math.max(0, Math.min(currentIndex - Math.floor(count / 2), all.length - count))
            : Math.min(preferredStart, all.length - count);
        const candidate = buildContext(provider, sourceLink, currentHref, all, start, start + count);
        if (contextBytes(candidate) <= MAX_SOURCE_CONTEXT_BYTES) {
            best = candidate;
            low = count + 1;
        } else {
            high = count - 1;
        }
    }
    return best;
}
