import fs from "node:fs";
import path from "node:path";
import type { FSWatcher, Stats } from "node:fs";
import { errMessage } from "../shared/utils";
import type { PathWatchBatch, PathWatchChange, PathWatchOwner } from "../ipc/api-types";

const DEFAULT_DEBOUNCE_MS = 300;
const MIN_DEBOUNCE_MS = 50;
const MAX_PENDING_PATHS = 1000;
const MAX_DIAGNOSTIC_ENTRIES = 500;
const MAX_DIAGNOSTIC_CHANGES = 20;

type WatchEventType = "rename" | "change";
type ChangeType = PathWatchChange["type"];
type SubscriptionKind = "file" | "folder";
type RawEventRecord = { at: string; kind: "raw"; watcherRoot: string; eventType: WatchEventType; filename: string | null };
type BatchRecord = { at: string; kind: "batch"; subscriptionId: string; changes: PathWatchChange[]; changeCount: number; rescan?: true; ended?: PathWatchBatch["ended"] };
type DiagnosticEntry = RawEventRecord | BatchRecord;

interface WatcherRecord {
    id: string;
    key: string;
    root: string;
    recursive: boolean;
    watcher?: FSWatcher;
    subscriptionIds: Set<string>;
    createdAt: string;
    eventCount: number;
    lastEventAt: string | null;
    lastError: string | null;
}

interface PathWatchSubscribeOptions {
    owner: PathWatchOwner;
    recursive?: boolean;
    debounceMs?: number;
    label: string;
    pathFilter?: (candidatePath: string) => boolean;
}

interface SubscriptionRecord {
    id: string;
    path: string;
    key: string;
    recursive: boolean;
    kind: SubscriptionKind;
    owner: PathWatchOwner;
    label: string;
    watcherKey: string;
    debounceMs: number;
    pathFilter?: (candidatePath: string) => boolean;
    onBatch: (batch: PathWatchBatch) => void;
    pending: Map<string, { events: WatchEventType[]; path: string }>;
    pendingRescan: boolean;
    timer?: NodeJS.Timeout;
    batchesSent: number;
    lastBatchAt: string | null;
}

export interface PathWatchSubscribeResult {
    id: string;
    dispose: () => void;
}

let idCounter = 0;
const watchers = new Map<string, WatcherRecord>();
const subscriptions = new Map<string, SubscriptionRecord>();
const diagnosticEntries: DiagnosticEntry[] = [];
let totalEvents = 0;
let totalBatches = 0;
let totalRescans = 0;

function now(): string {
    return new Date().toISOString();
}

function isMissingPathError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) return false;
    const code = (error as { code?: unknown }).code;
    return code === "ENOENT" || code === "ENOTDIR";
}

function makeId(): string {
    idCounter += 1;
    return `path-watch-${idCounter}`;
}

function normalizePath(input: string): { path: string; key: string } {
    // URL schemes have two or more letters; a single letter is a Windows drive. Archive inner
    // paths ("x.zip!inner") need no check: they do not exist on disk, so subscribe rejects them.
    if (typeof input !== "string" || input.length === 0 || /(?:^|[\\/])[^\\/]*\.asar(?:[\\/]|$)/i.test(input) || /^(?:[a-z]{2,}:|\\\\\\?\\)/i.test(input)) {
        throw new Error("Path watch supports local filesystem paths only.");
    }
    const resolved = path.resolve(input);
    const parsed = path.parse(resolved);
    const normalized = resolved.length > parsed.root.length
        ? resolved.replace(/[\\/]+$/, "")
        : resolved;
    return { path: normalized, key: process.platform === "win32" ? normalized.toLowerCase() : normalized };
}

function isWithin(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function statPath(target: string): Promise<Stats | undefined> {
    try {
        return await fs.promises.stat(target);
    } catch (error: unknown) {
        if (!isMissingPathError(error)) {
            console.warn(`Path-watch stat failed: ${errMessage(error)}`);
        }
        return undefined;
    }
}

function appendDiagnostic(entry: DiagnosticEntry): void {
    diagnosticEntries.push(entry);
    if (diagnosticEntries.length > MAX_DIAGNOSTIC_ENTRIES) diagnosticEntries.shift();
}

function watcherId(pathKey: string, recursive: boolean): string {
    return `${pathKey}\0${recursive ? "recursive" : "single"}`;
}

function findWatcher(pathKey: string, recursive: boolean, kind: SubscriptionKind, targetPath: string): WatcherRecord | undefined {
    // W2(a): a recursive watcher on the requested path or nearest existing ancestor.
    const recursiveCandidates = [...watchers.values()]
        .filter(record => record.recursive && isWithin(record.root, targetPath))
        .sort((left, right) => right.root.length - left.root.length);
    if (recursiveCandidates.length) return recursiveCandidates[0];

    if (!recursive && kind === "folder") {
        const exact = [...watchers.values()].find(record => record.key === pathKey && !record.recursive);
        if (exact) return exact;
    }
    if (kind === "file") {
        const parent = normalizePath(path.dirname(targetPath));
        const exact = [...watchers.values()].find(record => record.key === parent.key && !record.recursive);
        if (exact) return exact;
    }
    return undefined;
}

function openWatcher(rootPath: string, recursive: boolean): WatcherRecord {
    const normalizedRoot = normalizePath(rootPath);
    const id = watcherId(normalizedRoot.key, recursive);
    const existing = watchers.get(id);
    if (existing && existing.recursive === recursive) return existing;

    const record: WatcherRecord = {
        id,
        key: normalizedRoot.key,
        root: normalizedRoot.path,
        recursive,
        subscriptionIds: new Set(),
        createdAt: now(),
        eventCount: 0,
        lastEventAt: null,
        lastError: null,
    };
    const watcher = fs.watch(normalizedRoot.path, recursive ? { recursive: true } : {}, (eventType, filename) => {
        if (watchers.get(id) === record) {
            void handleRawEvent(record, eventType, filename === null ? null : filename.toString());
        }
    });
    record.watcher = watcher;
    watchers.set(record.id, record);
    watcher.on("error", error => {
        void handleWatcherError(record, errMessage(error, "Filesystem watcher failed."));
    });
    return record;
}

function scopeAccepts(subscription: SubscriptionRecord, candidate: string): boolean {
    if (subscription.kind === "file") return normalizePath(candidate).key === subscription.key;
    if (subscription.recursive) return isWithin(subscription.path, candidate);
    return normalizePath(path.dirname(candidate)).key === subscription.key || normalizePath(candidate).key === subscription.key;
}

/**
 * W3 classification of one path's raw events in a batch. A `rename` toggles existence, so the
 * rename count's parity plus the path's state at flush gives the net effect: odd + present =
 * created, odd + missing = deleted, even + present = changed (deleted then recreated, as an
 * atomic save does), even + missing = created then deleted (dropped). Without renames the path
 * existed throughout unless it is gone now.
 */
function classify(events: WatchEventType[], existsNow: boolean): ChangeType | undefined {
    const renames = events.filter(eventType => eventType === "rename").length;
    if (renames % 2 === 1) return existsNow ? "created" : "deleted";
    if (renames > 0) return existsNow ? "changed" : undefined;
    return existsNow ? "changed" : "deleted";
}

/**
 * Canonical long-form path for a subscription target. `fs.watch` on Windows misreports
 * filenames when its root is given in 8.3 short form (`C:\Users\ANDRII~1\...`): libuv slices
 * the relative name at the long path's length. Missing files resolve through their parent.
 */
function realpathNative(value: string): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.realpath.native(value, (error, resolved) => (error ? reject(error) : resolve(resolved)));
    });
}

async function canonicalPath(input: string): Promise<string> {
    const resolved = normalizePath(input).path;
    try {
        return await realpathNative(resolved);
    } catch (error: unknown) {
        if (!isMissingPathError(error)) throw error;
        try {
            return path.join(await realpathNative(path.dirname(resolved)), path.basename(resolved));
        } catch (parentError: unknown) {
            if (isMissingPathError(parentError)) return resolved;
            throw parentError;
        }
    }
}

function enqueue(subscription: SubscriptionRecord, candidate: string, eventType: WatchEventType): void {
    const key = normalizePath(candidate).key;
    const pending = subscription.pending.get(key);
    if (pending) pending.events.push(eventType);
    else subscription.pending.set(key, { events: [eventType], path: normalizePath(candidate).path });
    scheduleFlush(subscription);
}

function scheduleFlush(subscription: SubscriptionRecord): void {
    if (subscription.timer) clearTimeout(subscription.timer);
    subscription.timer = setTimeout(() => {
        subscription.timer = undefined;
        void flushSubscription(subscription);
    }, subscription.debounceMs);
}

function sendBatch(subscription: SubscriptionRecord, batch: PathWatchBatch): void {
    if (!subscriptions.has(subscription.id)) return;
    subscription.batchesSent += 1;
    subscription.lastBatchAt = now();
    totalBatches += 1;
    if (batch.rescan) totalRescans += 1;
    appendDiagnostic({
        at: subscription.lastBatchAt,
        kind: "batch",
        subscriptionId: subscription.id,
        changes: batch.changes.slice(0, MAX_DIAGNOSTIC_CHANGES).map(change => ({ ...change })),
        changeCount: batch.changes.length,
        ...(batch.rescan ? { rescan: true as const } : {}),
        ...(batch.ended ? { ended: batch.ended } : {}),
    });
    try {
        subscription.onBatch(batch);
    } catch (error: unknown) {
        console.warn(`Path-watch batch delivery failed: ${errMessage(error)}`);
    }
}

async function flushSubscription(subscription: SubscriptionRecord, ended?: PathWatchBatch["ended"]): Promise<void> {
    if (!subscriptions.has(subscription.id)) return;
    const pendingEntries = [...subscription.pending.entries()];
    subscription.pending.clear();
    let changes: PathWatchChange[] = [];
    let rescan = subscription.pendingRescan;
    subscription.pendingRescan = false;

    if (pendingEntries.length > MAX_PENDING_PATHS) {
        rescan = true;
    } else {
        const candidates = pendingEntries.map(([key, value]) => ({ key, ...value }));
        const rootKey = subscription.key;
        const hasChildEvent = candidates.some(candidate => candidate.key !== rootKey && isWithin(subscription.path, candidate.path));
        for (const candidate of candidates) {
            if (candidate.key === rootKey && hasChildEvent) continue;
            const displayPath = candidate.path;
            const result = classify(candidate.events, Boolean(await statPath(displayPath)));
            changes = changes.filter(change => normalizePath(change.path).key !== candidate.key);
            if (result) changes.push({ path: displayPath, type: result });
        }
    }

    const ownFolderDeleted = subscription.kind === "folder"
        && changes.some(change => normalizePath(change.path).key === subscription.key && change.type === "deleted");
    const terminal = ended ?? (ownFolderDeleted ? "removed" : undefined);
    sendBatch(subscription, {
        changes,
        ...(rescan ? { rescan: true as const } : {}),
        ...(terminal ? { ended: terminal } : {}),
    });
    if (terminal) removeSubscription(subscription.id);
}

async function handleRawEvent(record: WatcherRecord, eventType: string, filename: string | null): Promise<void> {
    if (!watchers.has(record.id)) return;
    const normalizedType: WatchEventType = eventType === "rename" ? "rename" : "change";
    const at = now();
    record.eventCount += 1;
    record.lastEventAt = at;
    totalEvents += 1;
    appendDiagnostic({ at, kind: "raw", watcherRoot: record.root, eventType: normalizedType, filename: filename?.slice(0, 512) ?? null });

    // When the watched folder itself is deleted or moved, libuv reports the root as an absolute
    // `\\?\C:\...` filename, repeatedly until the watcher closes. Strip the prefix so it resolves
    // to the root. A rename of the root ends the watch: stat cannot confirm it, because our open
    // handle keeps a deleted folder "delete pending" (stat fails with EPERM, not ENOENT).
    const plainFilename = filename?.startsWith("\\\\?\\") ? filename.slice(4) : filename;
    const candidate = plainFilename === null || plainFilename === undefined ? undefined : path.resolve(record.root, plainFilename);
    const isRootEvent = candidate !== undefined && normalizePath(candidate).key === record.key;
    if (isRootEvent && normalizedType === "rename") {
        endWatcher(record, "removed");
        return;
    }
    if (filename === null || isRootEvent) {
        try {
            await fs.promises.stat(record.root);
            if (!watchers.has(record.id)) return;
        } catch (error: unknown) {
            if (!watchers.has(record.id)) return;
            if (isMissingPathError(error) || (error as NodeJS.ErrnoException).code === "EPERM") {
                endWatcher(record, "removed");
                return;
            }
            record.lastError = errMessage(error, "Failed to inspect filesystem watcher root.");
        }
    }

    for (const id of [...record.subscriptionIds]) {
        const subscription = subscriptions.get(id);
        if (!subscription) continue;
        if (filename === null) {
            subscription.pendingRescan = true;
            scheduleFlush(subscription);
            continue;
        }
        if (!candidate || !scopeAccepts(subscription, candidate)) continue;
        if (subscription.pathFilter) {
            try {
                if (!subscription.pathFilter(candidate)) continue;
            } catch (error: unknown) {
                console.warn(`Path-watch filter failed: ${errMessage(error)}`);
                continue;
            }
        }
        enqueue(subscription, candidate, normalizedType);
    }
}

async function handleWatcherError(record: WatcherRecord, message: string): Promise<void> {
    if (!watchers.has(record.id)) return;
    record.lastError = message;
    try {
        await fs.promises.stat(record.root);
        endWatcher(record, "error");
    } catch (error: unknown) {
        if (!isMissingPathError(error)) record.lastError = errMessage(error, message);
        endWatcher(record, isMissingPathError(error) ? "removed" : "error");
    }
}

function endWatcher(record: WatcherRecord, ended: "removed" | "error"): void {
    for (const id of [...record.subscriptionIds]) {
        const subscription = subscriptions.get(id);
        if (!subscription) continue;
        if (subscription.timer) clearTimeout(subscription.timer);
        subscription.timer = undefined;
        void flushSubscription(subscription, ended);
    }
    closeWatcher(record);
}

function closeWatcher(record: WatcherRecord): void {
    if (!watchers.has(record.id)) return;
    watchers.delete(record.id);
    try {
        record.watcher?.close();
    } catch (error: unknown) {
        record.lastError = errMessage(error, "Failed to close filesystem watcher.");
    }
}

function removeSubscription(id: string): void {
    const subscription = subscriptions.get(id);
    if (!subscription) return;
    subscriptions.delete(id);
    if (subscription.timer) clearTimeout(subscription.timer);
    const watcher = watchers.get(subscription.watcherKey);
    if (!watcher) return;
    watcher.subscriptionIds.delete(id);
    if (watcher.subscriptionIds.size === 0) closeWatcher(watcher);
}

async function createSubscription(targetPath: string, options: PathWatchSubscribeOptions, onBatch: (batch: PathWatchBatch) => void): Promise<PathWatchSubscribeResult> {
    const requestedFolder = /[\\/]$/.test(targetPath);
    const target = normalizePath(await canonicalPath(targetPath));
    const recursive = options.recursive ?? false;
    const label = typeof options.label === "string" ? options.label.slice(0, 120) : "unknown";
    const owner: PathWatchOwner = options.owner.kind === "board"
        ? { ...options.owner, boardName: options.owner.boardName.slice(0, 120) }
        : { ...options.owner };
    const stats = await statPath(target.path);
    const parentPath = path.dirname(target.path);
    const parentStats = stats ? undefined : await statPath(parentPath);
    const kind: SubscriptionKind = stats?.isDirectory() ? "folder" : "file";
    if (!stats && (!parentStats?.isDirectory() || recursive || requestedFolder)) {
        throw new Error("A missing path can only be watched as a file when its parent folder exists.");
    }
    if (stats && !stats.isDirectory() && recursive) {
        throw new Error("Recursive path watches require a folder.");
    }

    const requestedRoot = kind === "file" ? parentPath : target.path;
    const requestedRecursive = kind === "folder" && recursive;
    let watcher = findWatcher(target.key, recursive, kind, target.path);
    if (!watcher) watcher = openWatcher(requestedRoot, requestedRecursive);

    const id = makeId();
    const requestedDebounce = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const debounceMs = Number.isFinite(requestedDebounce)
        ? Math.max(MIN_DEBOUNCE_MS, Math.floor(requestedDebounce))
        : DEFAULT_DEBOUNCE_MS;
    const subscription: SubscriptionRecord = {
        id,
        path: target.path,
        key: target.key,
        recursive,
        kind,
        owner,
        label,
        watcherKey: watcher.id,
        debounceMs,
        pathFilter: options.pathFilter,
        onBatch,
        pending: new Map(),
        pendingRescan: false,
        batchesSent: 0,
        lastBatchAt: null,
    };
    subscriptions.set(id, subscription);
    watcher.subscriptionIds.add(id);
    return { id, dispose: () => removeSubscription(id) };
}

export const pathWatchService = {
    subscribe: createSubscription,
    unsubscribeOwner(owner: PathWatchOwner): void {
        for (const subscription of [...subscriptions.values()]) {
            if (JSON.stringify(subscription.owner) === JSON.stringify(owner)) removeSubscription(subscription.id);
        }
    },
    endSubscription(id: string, ended: "revoked"): void {
        const subscription = subscriptions.get(id);
        if (!subscription) return;
        if (subscription.timer) clearTimeout(subscription.timer);
        subscription.timer = undefined;
        void flushSubscription(subscription, ended);
    },
    getSummary() {
        return {
            watcherCount: watchers.size,
            subscriptionCount: subscriptions.size,
            events: totalEvents,
            batches: totalBatches,
            rescans: totalRescans,
        };
    },
    getWatchers() {
        return [...watchers.values()].slice(0, 100).map(record => ({
            root: record.root,
            recursive: record.recursive,
            subscriptionCount: record.subscriptionIds.size,
            createdAt: record.createdAt,
            eventCount: record.eventCount,
            lastEventAt: record.lastEventAt,
            lastError: record.lastError,
        }));
    },
    getSubscriptions() {
        return [...subscriptions.values()].slice(0, 100).map(subscription => ({
            id: subscription.id,
            path: subscription.path,
            recursive: subscription.recursive,
            owner: { ...subscription.owner },
            label: subscription.label,
            servedBy: watchers.get(subscription.watcherKey)?.root ?? subscription.watcherKey,
            debounceMs: subscription.debounceMs,
            batchesSent: subscription.batchesSent,
            lastBatchAt: subscription.lastBatchAt,
            pendingChanges: subscription.pending.size,
        }));
    },
    getRecent(limit = 50): DiagnosticEntry[] {
        const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.min(MAX_DIAGNOSTIC_ENTRIES, Math.floor(limit))) : 50;
        if (boundedLimit === 0) return [];
        return diagnosticEntries.slice(-boundedLimit).map(entry => entry.kind === "batch"
            ? { ...entry, changes: entry.changes.map(change => ({ ...change })) }
            : { ...entry });
    },
};

export function shutdownPathWatchService(): void {
    for (const subscription of [...subscriptions.values()]) removeSubscription(subscription.id);
    for (const watcher of [...watchers.values()]) closeWatcher(watcher);
}
