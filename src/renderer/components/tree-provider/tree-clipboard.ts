import type { ILink, ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import { api } from "../../../ipc/renderer/api";
import { treeTransferCapability } from "../../content/tree-providers/tree-provider-capabilities";
import { sameHref } from "./href-utils";
import { t } from "../../../shared/i18n/t";

export interface TreeClipboardRecord {
    generation: string;
    text: string;
    items: ILink[];
    provider: ITreeProvider;
    sourceIdentity: string;
    cut: boolean;
    leases: number;
    retired: boolean;
    sourceRefresh?: WeakRef<{ refreshClipboardSource(identity: string): Promise<void> }>;
}

export interface TreeClipboardSourceRefresh {
    refreshClipboardSource(identity: string): Promise<void>;
}

export type TreeClipboardRead =
    | { kind: "board"; record: TreeClipboardRecord; release(): void }
    | { kind: "os"; paths: string[]; dropEffect?: string };

let generation = crypto.randomUUID();
let record: TreeClipboardRecord | undefined;
let writeQueue = Promise.resolve();

function nextGeneration(): string {
    generation = crypto.randomUUID();
    return generation;
}

function disposeWhenUnused(value: TreeClipboardRecord): void {
    value.retired = true;
    if (value.leases === 0) value.provider.dispose?.();
}

function replaceRecord(value?: TreeClipboardRecord): void {
    if (record && record !== value) disposeWhenUnused(record);
    record = value;
}

async function readClipboardSnapshot(): Promise<{ paths: string[]; dropEffect: string; text: string }> {
    const firstText = await api.clipboardReadText();
    const firstFiles = await api.clipboardReadFilePaths();
    const text = await api.clipboardReadText();
    const files = await api.clipboardReadFilePaths();
    const filesUnchanged = firstFiles.dropEffect === files.dropEffect
        && firstFiles.paths.length === files.paths.length
        && firstFiles.paths.every((path, index) => path === files.paths[index]);
    return {
        paths: files.paths,
        dropEffect: files.dropEffect,
        text: firstText === text && filesUnchanged ? text : "",
    };
}

function selectedLink(item: ITreeProviderItem): ILink {
    return {
        title: item.title,
        href: item.href,
        category: item.category,
        tags: [...item.tags],
        isDirectory: item.isDirectory,
        size: item.size,
        mtime: item.mtime,
    };
}

/** Store board items in memory and put only their hrefs on the OS text clipboard. */
export async function writeBoardTreeClipboard(
    source: ITreeProvider,
    selected: ITreeProviderItem[],
    cut: boolean,
    sourceRefresh?: TreeClipboardSourceRefresh,
): Promise<void> {
    const sourceCapability = treeTransferCapability(source);
    if (!sourceCapability || sourceCapability.sourceKind !== "board") {
        throw new Error(t("menus.treeClipboardSourceUnavailable"));
    }
    if (!selected.length || selected.some((item) => sameHref(item.href, source.rootPath))) {
        throw new Error(t("menus.treeClipboardRootUnsupported"));
    }
    if (cut && (!source.writable || !source.deleteItem)) {
        throw new Error(t("menus.treeClipboardCutUnavailable"));
    }

    const writeGeneration = nextGeneration();
    replaceRecord();
    const items = selected.map(selectedLink);
    const text = items.map((item) => item.href).join("\n");
    const owned = sourceCapability.createClipboardSource?.();
    if (!owned) throw new Error(t("menus.treeClipboardSourceUnavailable"));
    const ownedCapability = treeTransferCapability(owned);
    if (!ownedCapability || ownedCapability.sourceKind !== "board") {
        owned.dispose?.();
        throw new Error(t("menus.treeClipboardSourceUnavailable"));
    }

    try {
        await ownedCapability.assertAvailable();
        const parents = [...new Set(items.map((item) => item.category))];
        const listed = new Map<string, ILink>();
        for (const parent of parents) {
            for (const item of await owned.list(parent)) listed.set(item.href, item);
        }
        const verified = items.map((item) => {
            const fresh = listed.get(item.href);
            if (!fresh || fresh.title !== item.title || fresh.category !== item.category
                || fresh.isDirectory !== item.isDirectory) {
                throw new Error(t("menus.treeClipboardItemUnavailable", { name: item.title }));
            }
            return fresh;
        });
        if (cut) {
            await ownedCapability.assertAvailable();
            for (const item of verified) {
                const path = ownedCapability.pathForLink(item);
                const { stat, kind } = await ownedCapability.stat(path);
                if (!stat.exists || !ownedCapability.deletionMode({
                    link: item, path, name: item.title, kind,
                })) {
                    throw new Error(t("menus.treeClipboardCutUnavailable"));
                }
            }
        }
        const candidate: TreeClipboardRecord = {
            generation: writeGeneration,
            text,
            items: verified,
            provider: owned,
            sourceIdentity: sourceCapability.sourceIdentity,
            cut,
            leases: 0,
            retired: false,
            sourceRefresh: sourceRefresh ? new WeakRef(sourceRefresh) : undefined,
        };
        const queuedWrite = writeQueue.then(async () => {
            if (writeGeneration !== generation) {
                owned.dispose?.();
                return;
            }
            await api.clipboardWriteText(text);
            if (writeGeneration !== generation) {
                owned.dispose?.();
                return;
            }
            replaceRecord(candidate);
        });
        writeQueue = queuedWrite.catch((): void => undefined);
        await queuedWrite;
    } catch (error) {
        owned.dispose?.();
        throw error;
    }
}

/** Serialize local tree copy/cut writes with board writes so stale preparation cannot win. */
export async function writeLocalTreeClipboard(paths: string[], cut: boolean): Promise<boolean> {
    if (!paths.length) return true;
    const writeGeneration = nextGeneration();
    replaceRecord();
    const queuedWrite = writeQueue.then(async () => {
        if (writeGeneration !== generation) return false;
        const ok = await api.clipboardWriteFilePaths(paths, cut);
        if (writeGeneration !== generation) return false;
        return ok;
    });
    writeQueue = queuedWrite.then((): void => undefined, (): void => undefined);
    return queuedWrite;
}

/** Read the actual OS clipboard and lease a matching in-memory board source if present. */
export async function readTreeClipboard(): Promise<TreeClipboardRead> {
    let paths: string[];
    let dropEffect: string | undefined;
    let text: string;
    try {
        ({ paths, dropEffect, text } = await readClipboardSnapshot());
    } catch (error) {
        nextGeneration();
        replaceRecord();
        throw error;
    }

    const current = record;
    if (current && !paths.length && text === current.text && current.generation === generation) {
        current.leases++;
        return {
            kind: "board",
            record: current,
            release: () => {
                current.leases--;
                if (current.retired && current.leases === 0) current.provider.dispose?.();
            },
        };
    }
    if (current) {
        nextGeneration();
        replaceRecord();
    }
    return { kind: "os", paths, dropEffect };
}

export async function consumeBoardCut(recordToConsume: TreeClipboardRecord): Promise<void> {
    if (record !== recordToConsume || recordToConsume.generation !== generation || !recordToConsume.cut) return;
    let snapshot: Awaited<ReturnType<typeof readClipboardSnapshot>>;
    try {
        snapshot = await readClipboardSnapshot();
    } catch (error) {
        if (record === recordToConsume) {
            nextGeneration();
            replaceRecord();
        }
        throw error;
    }
    if (record !== recordToConsume || recordToConsume.generation !== generation) return;
    if (snapshot.paths.length || snapshot.text !== recordToConsume.text) {
        nextGeneration();
        replaceRecord();
        return;
    }
    const clearGeneration = nextGeneration();
    replaceRecord();
    const queuedClear = writeQueue.then(async () => {
        if (clearGeneration !== generation) return;
        const current = await readClipboardSnapshot();
        if (clearGeneration !== generation || current.paths.length || current.text !== recordToConsume.text) return;
        await api.clipboardWriteText("");
    });
    writeQueue = queuedClear.then((): void => undefined, (): void => undefined);
    await queuedClear;
}

export async function assertBoardClipboardCurrent(recordToCheck: TreeClipboardRecord): Promise<void> {
    if (record !== recordToCheck || recordToCheck.generation !== generation) {
        throw new Error(t("menus.treeClipboardChanged"));
    }
    let snapshot: Awaited<ReturnType<typeof readClipboardSnapshot>>;
    try {
        snapshot = await readClipboardSnapshot();
    } catch (error) {
        if (record === recordToCheck) {
            nextGeneration();
            replaceRecord();
        }
        throw error;
    }
    const { paths, text } = snapshot;
    if (record !== recordToCheck || recordToCheck.generation !== generation
        || paths.length || text !== recordToCheck.text) {
        if (record === recordToCheck) {
            nextGeneration();
            replaceRecord();
        }
        throw new Error(t("menus.treeClipboardChanged"));
    }
}

window.addEventListener("beforeunload", () => {
    nextGeneration();
    replaceRecord();
});
