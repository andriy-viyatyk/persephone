import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type { CdpTarget } from "./CdpTarget";

const MAX_INIT_SCRIPT_SOURCE_CHARS = 1_000_000;
const MAX_INIT_SCRIPTS_PER_TARGET = 50;

interface InitScriptRecord {
    id: string;
    source: string;
    cdpIdentifier?: string;
}

interface InitScriptTarget {
    key: string;
    webContents: WebContents;
    cdp: CdpTarget;
}

const scriptsByKey = new Map<string, InitScriptRecord[]>();
const keysByWebContents = new Map<WebContents, Set<string>>();
const operationsByKey = new Map<string, Promise<void>>();
const attachGenerations = new WeakMap<WebContents, number>();
const keyEpochs = new Map<string, number>();

function advanceAttachGeneration(webContents: WebContents): number {
    const generation = (attachGenerations.get(webContents) ?? 0) + 1;
    attachGenerations.set(webContents, generation);
    return generation;
}

function associateTarget(key: string, webContents: WebContents): void {
    let keys = keysByWebContents.get(webContents);
    if (!keys) {
        keys = new Set();
        keysByWebContents.set(webContents, keys);
    }
    keys.add(key);
}

function withTargetLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = operationsByKey.get(key) ?? Promise.resolve();
    const current = previous.catch((): undefined => undefined).then(operation);
    const settled = current.then((): undefined => undefined, (): undefined => undefined);
    operationsByKey.set(key, settled);
    void settled.finally(() => {
        if (operationsByKey.get(key) === settled) operationsByKey.delete(key);
    });
    return current;
}

async function installRecord(target: InitScriptTarget, record: InitScriptRecord): Promise<void> {
    if (record.cdpIdentifier) return;
    const generation = attachGenerations.get(target.webContents) ?? 0;
    await target.cdp.enableDomain("Page");
    const result = await target.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: record.source,
    }) as { identifier?: unknown };
    if (typeof result?.identifier !== "string" || !result.identifier) {
        throw new Error("CDP did not return an init script identifier.");
    }
    if (attachGenerations.get(target.webContents) === generation && target.cdp.attached) {
        record.cdpIdentifier = result.identifier;
    }
}

async function ensureRestored(target: InitScriptTarget, preparePageErrors: () => Promise<void>): Promise<void> {
    associateTarget(target.key, target.webContents);
    await withTargetLock(target.key, async () => {
        const records = scriptsByKey.get(target.key) ?? [];
        if (records.length > 0) await preparePageErrors();
        for (const record of records) await installRecord(target, record);
    });
}

export function onTargetAttached(webContents: WebContents): void {
    advanceAttachGeneration(webContents);
    for (const key of keysByWebContents.get(webContents) ?? []) {
        for (const record of scriptsByKey.get(key) ?? []) record.cdpIdentifier = undefined;
    }
}

export function onTargetDetached(webContents: WebContents): void {
    advanceAttachGeneration(webContents);
    for (const key of keysByWebContents.get(webContents) ?? []) {
        for (const record of scriptsByKey.get(key) ?? []) record.cdpIdentifier = undefined;
    }
}

export function clearKey(key: string): void {
    keyEpochs.set(key, (keyEpochs.get(key) ?? 0) + 1);
    const records = scriptsByKey.get(key) ?? [];
    for (const record of records) record.cdpIdentifier = undefined;
    scriptsByKey.delete(key);
    for (const [webContents, keys] of keysByWebContents) {
        keys.delete(key);
        if (keys.size === 0) keysByWebContents.delete(webContents);
    }
}

export function registerInitScript(
    target: InitScriptTarget,
    source: string,
    preparePageErrors: () => Promise<void>,
): Promise<string> {
    if (typeof source !== "string") throw new TypeError("Init script source must be a string.");
    if (source.length > MAX_INIT_SCRIPT_SOURCE_CHARS) {
        throw new Error(`Init script source exceeds the ${MAX_INIT_SCRIPT_SOURCE_CHARS.toLocaleString()} character limit.`);
    }
    associateTarget(target.key, target.webContents);
    const epoch = keyEpochs.get(target.key) ?? 0;
    return withTargetLock(target.key, async () => {
        if ((keyEpochs.get(target.key) ?? 0) !== epoch) throw new Error("Browser tab closed before the init script could be registered.");
        const records = scriptsByKey.get(target.key) ?? [];
        if (records.length >= MAX_INIT_SCRIPTS_PER_TARGET) {
            throw new Error(`A browser tab can have at most ${MAX_INIT_SCRIPTS_PER_TARGET} init scripts.`);
        }
        await preparePageErrors();
        const record: InitScriptRecord = { id: randomUUID(), source };
        await installRecord(target, record);
        if ((keyEpochs.get(target.key) ?? 0) !== epoch) throw new Error("Browser tab closed before the init script could be registered.");
        records.push(record);
        scriptsByKey.set(target.key, records);
        return record.id;
    });
}

export function removeInitScript(target: InitScriptTarget, id: string): Promise<boolean> {
    associateTarget(target.key, target.webContents);
    return withTargetLock(target.key, async () => {
        const records = scriptsByKey.get(target.key) ?? [];
        const index = records.findIndex(record => record.id === id);
        if (index < 0) return false;
        const record = records[index];
        if (record.cdpIdentifier) {
            await target.webContents.debugger.sendCommand("Page.removeScriptToEvaluateOnNewDocument", {
                identifier: record.cdpIdentifier,
            });
        }
        records.splice(index, 1);
        if (records.length === 0) scriptsByKey.delete(target.key);
        return true;
    });
}

export function clearInitScripts(target: InitScriptTarget): Promise<number> {
    associateTarget(target.key, target.webContents);
    return withTargetLock(target.key, async () => {
        const records = scriptsByKey.get(target.key) ?? [];
        const removedCount = records.length;
        while (records.length > 0) {
            const record = records[0];
            if (record.cdpIdentifier) {
                await target.webContents.debugger.sendCommand("Page.removeScriptToEvaluateOnNewDocument", {
                    identifier: record.cdpIdentifier,
                });
            }
            records.shift();
        }
        scriptsByKey.delete(target.key);
        return removedCount;
    });
}

export function restoreInitScripts(target: InitScriptTarget, preparePageErrors: () => Promise<void>): Promise<void> {
    return ensureRestored(target, preparePageErrors);
}
