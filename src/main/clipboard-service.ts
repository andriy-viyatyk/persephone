import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { app, clipboard, nativeImage, webContents } from "electron";
import { EventEndpoint } from "../ipc/api-types";
import type {
    ClipboardDropEffect,
    ClipboardFlavor,
    ClipboardHistoryChanged,
    ClipboardHistoryItem,
    ClipboardHistorySnapshot,
    ClipboardStatus,
} from "../ipc/clipboard-ipc";
import { errMessage } from "../shared/utils";
import { writeClipboardFiles } from "./clip-service";
import { getSnipToolPath } from "./snip-service";
import { openWindows } from "./open-windows";
import { SidecarProcess } from "./sidecar-process";

const READINESS_TIMEOUT_MS = 20_000;
const PING_INTERVAL_MS = 1_000;
const PONG_TIMEOUT_INTERVALS = 3;
const DEAF_AHEAD_PONG_THRESHOLD = 3;
const UINT32_HALF_RANGE = 0x80000000;
const MAX_INDEX_ITEMS = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAYLOAD_EXTENSIONS: Record<ClipboardFlavor, string> = {
    text: "txt",
    html: "html",
    image: "png",
    files: "json",
};
const RECOGNIZED_PAYLOAD_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:txt|html|png|json)$/;

interface ClipboardFormat {
    id: number;
    name: string | null;
}

interface ClipboardChangeEvent {
    type: "clipboard-change";
    sequence: number;
    timestampMs: number;
    formats: ClipboardFormat[];
    exclusion: {
        excludeClipboardContentFromMonitorProcessing: boolean;
        canIncludeInClipboardHistory: { present: boolean; value: number | null };
        inspectionFailed: boolean;
        excluded: boolean;
    };
    files: ClipboardFileListWire | null;
}

interface ClipboardFileListWire {
    paths: string[];
    dropEffect: ClipboardDropEffect;
}

interface ClipboardPong {
    type: "pong";
    sequence: number;
    lastEmittedSequence: number | null;
}

interface ClipboardIndexItem extends ClipboardHistoryItem {
    hash: string;
}

interface ClipboardIndexFile {
    version: 1;
    items: ClipboardIndexItem[];
}

interface CapturedPayload {
    flavor: ClipboardFlavor;
    bytes: Buffer;
}

interface LoadedPayloads {
    bytes: Partial<Record<ClipboardFlavor, Buffer>>;
    images: Partial<Record<ClipboardFlavor, Electron.NativeImage>>;
    files?: ClipboardFileListWire;
}

const payloadFlavors: ClipboardFlavor[] = ["text", "html", "image", "files"];

let historyLoaded = false;
let historyItems: ClipboardIndexItem[] = [];
let maxItems = 100;
let revision = 0;
let mutationQueue: Promise<void> = Promise.resolve();

let enabled = false;
let lastError: string | undefined;
let health: ClipboardStatus["health"] = "disabled";
let lastEmittedSequence: number | null = null;
let lastObservedSequence: number | null = null;
let pendingDeafCount = 0;
let lastPingDeadline = 0;
let pingTimer: NodeJS.Timeout | undefined;
const monitoringOwners = new Set<number>();
const ownerCleanup = new Map<number, () => void>();

function log(line: string): void {
    console.log(`[Clipboard] ${line}`);
}

const sidecar = new SidecarProcess({
    name: "Clipboard",
    isReady: (line) => line === "clipboard-watch: ready",
    readinessTimeoutMs: READINESS_TIMEOUT_MS,
    log: (line) => {
        // Protocol traffic is not diagnostics. A ping runs every second while the
        // Clipboard panel is open, so echoing pongs floods the terminal, and a
        // change event would additionally print copied file paths there. Only
        // lines the protocol does not claim — the readiness sentinel, watcher
        // stderr, and SidecarProcess's own lifecycle messages — reach the log.
        if (!processSidecarLine(line)) log(line);
    },
    onReady: () => {
        lastError = undefined;
        health = "running";
        broadcastStatus();
    },
    onUnexpectedExit: (code) => {
        health = "error";
        lastError = `Clipboard watcher stopped unexpectedly (exit code ${code})`;
        broadcastStatus();
    },
});

function getClipboardDirectory(): string {
    return path.join(app.getPath("userData"), "data", "clipboard");
}

function getIndexPath(): string {
    return path.join(getClipboardDirectory(), "index.json");
}

function getStatus(): ClipboardStatus {
    return {
        enabled,
        running: sidecar.isRunning,
        health,
        monitoring: monitoringOwners.size > 0,
        ...(lastError ? { error: lastError } : {}),
    };
}

function broadcastStatus(): void {
    openWindows.send(EventEndpoint.eClipboardStatusChanged, getStatus());
}

function broadcastHistory(reason: ClipboardHistoryChanged["reason"]): void {
    revision += 1;
    openWindows.send(EventEndpoint.eClipboardHistoryChanged, {
        revision,
        reason,
    } satisfies ClipboardHistoryChanged);
}

function snapshot(): ClipboardHistorySnapshot {
    return {
        revision,
        items: historyItems.map(({ hash: _hash, ...item }) => ({
            ...item,
            payloads: { ...item.payloads },
        })),
    };
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then<void>(() => undefined, () => undefined);
    return result;
}

function isClipboardFlavor(value: unknown): value is ClipboardFlavor {
    return value === "text" || value === "html" || value === "image" || value === "files";
}

function isDropEffect(value: unknown): value is ClipboardDropEffect {
    return value === "copy" || value === "cut" || value === "none";
}

function isValidFilePath(filePath: unknown): filePath is string {
    return typeof filePath === "string" &&
        filePath.length > 0 &&
        !filePath.includes("\0") &&
        (path.win32.isAbsolute(filePath) || path.isAbsolute(filePath));
}

function isValidFileList(value: unknown): value is ClipboardFileListWire {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { paths?: unknown; dropEffect?: unknown };
    return Array.isArray(candidate.paths) &&
        candidate.paths.length > 0 &&
        candidate.paths.every(isValidFilePath) &&
        isDropEffect(candidate.dropEffect);
}

function isUint32(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function isClipboardChange(value: unknown): value is ClipboardChangeEvent {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ClipboardChangeEvent>;
    const exclusion = candidate.exclusion;
    if (candidate.type !== "clipboard-change" ||
        !isUint32(candidate.sequence) ||
        typeof candidate.timestampMs !== "number" ||
        !Number.isFinite(candidate.timestampMs) ||
        !Array.isArray(candidate.formats) ||
        !exclusion ||
        typeof exclusion !== "object") {
        return false;
    }

    const decision = exclusion.canIncludeInClipboardHistory;
    if (typeof exclusion.excludeClipboardContentFromMonitorProcessing !== "boolean" ||
        typeof exclusion.inspectionFailed !== "boolean" ||
        typeof exclusion.excluded !== "boolean" ||
        !decision ||
        typeof decision !== "object" ||
        typeof decision.present !== "boolean" ||
        (decision.value !== null && !isUint32(decision.value)) ||
        (!decision.present && decision.value !== null)) {
        return false;
    }

    if (!candidate.formats.every((format) =>
        !!format &&
        typeof format === "object" &&
        isUint32(format.id) &&
        (typeof format.name === "string" || format.name === null))) {
        return false;
    }

    return candidate.files === null || isValidFileList(candidate.files);
}

function isClipboardPong(value: unknown): value is ClipboardPong {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ClipboardPong>;
    return candidate.type === "pong" &&
        isUint32(candidate.sequence) &&
        (candidate.lastEmittedSequence === null || isUint32(candidate.lastEmittedSequence));
}

function isExpectedPayloadPath(filePath: string, id: string, flavor: ClipboardFlavor): boolean {
    if (!UUID_PATTERN.test(id) || !path.isAbsolute(filePath)) return false;
    const expectedPath = path.join(getClipboardDirectory(), `${id}.${PAYLOAD_EXTENSIONS[flavor]}`);
    return path.resolve(filePath).toLowerCase() === path.resolve(expectedPath).toLowerCase();
}

function isValidIndexItem(value: unknown): value is ClipboardIndexItem {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<ClipboardIndexItem>;
    if (!UUID_PATTERN.test(item.id ?? "") ||
        typeof item.capturedAt !== "number" ||
        !Number.isFinite(item.capturedAt) ||
        !isClipboardFlavor(item.primary) ||
        typeof item.preview !== "string" ||
        typeof item.hash !== "string" ||
        !/^[0-9a-f]{64}$/.test(item.hash) ||
        !item.payloads ||
        typeof item.payloads !== "object") {
        return false;
    }

    for (const [flavor, filePath] of Object.entries(item.payloads)) {
        if (!isClipboardFlavor(flavor) || typeof filePath !== "string" ||
            !isExpectedPayloadPath(filePath, item.id, flavor)) {
            return false;
        }
    }
    return !!item.payloads[item.primary];
}

function isValidIndex(value: unknown): value is ClipboardIndexFile {
    if (!value || typeof value !== "object") return false;
    const index = value as Partial<ClipboardIndexFile>;
    if (index.version !== 1 || !Array.isArray(index.items) || index.items.length > MAX_INDEX_ITEMS) return false;
    const ids = new Set<string>();
    return index.items.every((item) => {
        if (!isValidIndexItem(item) || ids.has(item.id)) return false;
        ids.add(item.id);
        return true;
    });
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function removeFile(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
    } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== "ENOENT") {
            log(`Failed to remove ${filePath}: ${errMessage(err)}`);
        }
    }
}

async function writeIndex(items: ClipboardIndexItem[]): Promise<void> {
    const directory = getClipboardDirectory();
    await fs.mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `index.json.tmp-${process.pid}-${Date.now()}`);
    try {
        await fs.writeFile(
            temporaryPath,
            `${JSON.stringify({ version: 1, items } satisfies ClipboardIndexFile, null, 2)}\n`,
            "utf8",
        );
        await fs.rename(temporaryPath, getIndexPath());
    } catch (err) {
        await removeFile(temporaryPath);
        throw err;
    }
}

async function sweepOrphans(referencedNames: Set<string>): Promise<boolean> {
    let changed = false;
    let names: string[];
    try {
        names = await fs.readdir(getClipboardDirectory());
    } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ENOENT") return false;
        throw err;
    }

    for (const name of names) {
        if (RECOGNIZED_PAYLOAD_PATTERN.test(name) && !referencedNames.has(name)) {
            await removeFile(path.join(getClipboardDirectory(), name));
            changed = true;
        }
    }
    return changed;
}

async function reconcileIndex(index: ClipboardIndexFile): Promise<{ items: ClipboardIndexItem[]; changed: boolean }> {
    const items: ClipboardIndexItem[] = [];
    let changed = false;

    for (const item of index.items) {
        const primaryPath = item.payloads[item.primary];
        if (!primaryPath || !(await pathExists(primaryPath))) {
            for (const filePath of Object.values(item.payloads)) {
                if (filePath) await removeFile(filePath);
            }
            changed = true;
            continue;
        }

        const payloads = { ...item.payloads };
        for (const flavor of payloadFlavors) {
            const filePath = payloads[flavor];
            if (filePath && !(await pathExists(filePath))) {
                delete payloads[flavor];
                changed = true;
            }
        }
        items.push({ ...item, payloads });
    }

    const referencedNames = new Set(
        items.flatMap((item) => Object.values(item.payloads)
            .filter((filePath): filePath is string => !!filePath)
            .map((filePath) => path.basename(filePath))),
    );
    if (await sweepOrphans(referencedNames)) changed = true;
    return { items, changed };
}

async function ensureHistoryLoaded(): Promise<void> {
    if (historyLoaded) return;
    historyLoaded = true;

    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(getIndexPath(), "utf8"));
    } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ENOENT") {
            log("Clipboard history index is absent; starting with empty history.");
        } else {
            log(`Clipboard history index could not be read; starting empty: ${errMessage(err)}`);
        }
        historyItems = [];
        return;
    }

    if (!isValidIndex(parsed)) {
        log("Clipboard history index is malformed; starting empty without deleting files.");
        historyItems = [];
        return;
    }

    try {
        const repaired = await reconcileIndex(parsed);
        historyItems = repaired.items;
        if (repaired.changed) {
            await writeIndex(historyItems);
            broadcastHistory("reconciled");
        }
    } catch (err) {
        log(`Clipboard history reconciliation failed: ${errMessage(err)}`);
        historyItems = parsed.items;
    }
}

async function deleteItemFiles(item: ClipboardIndexItem): Promise<void> {
    await Promise.all(Object.values(item.payloads).filter((filePath): filePath is string => !!filePath).map(removeFile));
}

async function trimHistory(): Promise<boolean> {
    if (historyItems.length <= maxItems) return false;
    const kept = historyItems.slice(0, maxItems);
    const evicted = historyItems.slice(maxItems);
    await writeIndex(kept);
    historyItems = kept;
    await Promise.all(evicted.map(deleteItemFiles));
    return true;
}

function hasFormat(formats: ClipboardFormat[], ids: number[], name?: string): boolean {
    const wantedName = name?.toLowerCase();
    return formats.some((format) =>
        ids.includes(format.id) ||
        (wantedName !== undefined && format.name?.toLowerCase() === wantedName),
    );
}

function compactHtmlPreview(html: string): string {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function getPreview(payloads: CapturedPayload[], files: ClipboardFileListWire | null): string {
    const text = payloads.find((payload) => payload.flavor === "text");
    if (text) return text.bytes.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 240);
    const html = payloads.find((payload) => payload.flavor === "html");
    if (html) return compactHtmlPreview(html.bytes.toString("utf8"));
    if (files) return `${files.paths.length} file(s)`;
    return "Image";
}

function getPrimary(payloads: CapturedPayload[]): ClipboardFlavor {
    for (const flavor of ["files", "html", "image", "text"] as ClipboardFlavor[]) {
        if (payloads.some((payload) => payload.flavor === flavor)) return flavor;
    }
    throw new Error("Clipboard capture has no payload");
}

async function stagePayloads(id: string, payloads: CapturedPayload[]): Promise<Record<ClipboardFlavor, string>> {
    const paths: Record<string, string> = {};
    const staged: string[] = [];
    const committed: string[] = [];
    try {
        await fs.mkdir(getClipboardDirectory(), { recursive: true });
        for (const payload of payloads) {
            const target = path.join(getClipboardDirectory(), `${id}.${PAYLOAD_EXTENSIONS[payload.flavor]}`);
            const temporaryPath = `${target}.tmp`;
            await fs.writeFile(temporaryPath, payload.bytes);
            staged.push(temporaryPath);
            await fs.rename(temporaryPath, target);
            committed.push(target);
            paths[payload.flavor] = target;
        }
        return paths as Record<ClipboardFlavor, string>;
    } catch (err) {
        await Promise.all([...staged, ...committed].map(removeFile));
        throw err;
    }
}

async function captureChange(event: ClipboardChangeEvent): Promise<void> {
    if (!enabled || event.exclusion.excluded) return;

    const formats = event.formats;
    const payloads: CapturedPayload[] = [];
    let files: ClipboardFileListWire | null = null;

    if (event.files && isValidFileList(event.files)) {
        files = event.files;
        payloads.push({
            flavor: "files",
            bytes: Buffer.from(JSON.stringify(files), "utf8"),
        });
    }

    if (hasFormat(formats, [], "HTML Format")) {
        try {
            const html = clipboard.readHTML();
            if (html) payloads.push({ flavor: "html", bytes: Buffer.from(html, "utf8") });
        } catch (err) {
            log(`Failed to capture HTML: ${errMessage(err)}`);
        }
    }

    if (hasFormat(formats, [8, 17, 2], "PNG")) {
        try {
            const image = clipboard.readImage();
            if (!image.isEmpty()) {
                const bytes = image.toPNG();
                if (bytes.length) payloads.push({ flavor: "image", bytes });
            }
        } catch (err) {
            log(`Failed to capture image: ${errMessage(err)}`);
        }
    }

    if (hasFormat(formats, [13, 1, 7])) {
        try {
            payloads.push({ flavor: "text", bytes: Buffer.from(clipboard.readText(), "utf8") });
        } catch (err) {
            log(`Failed to capture text: ${errMessage(err)}`);
        }
    }

    if (!payloads.length) return;

    const primary = getPrimary(payloads);
    const primaryPayload = payloads.find((payload) => payload.flavor === primary);
    if (!primaryPayload) return;

    const hash = createHash("sha256").update(primaryPayload.bytes).digest("hex");
    const duplicateItems = historyItems.filter((item) => item.hash === hash);
    const id = randomUUID();
    let payloadPaths: Record<ClipboardFlavor, string> | undefined;
    try {
        payloadPaths = await stagePayloads(id, payloads);
        const nextItem: ClipboardIndexItem = {
            id,
            capturedAt: event.timestampMs,
            primary,
            preview: getPreview(payloads, files),
            payloads: payloadPaths,
            hash,
        };
        const duplicateIds = new Set(duplicateItems.map((item) => item.id));
        const remaining = historyItems.filter((item) => !duplicateIds.has(item.id));
        const nextItems = [nextItem, ...remaining];
        const kept = nextItems.slice(0, maxItems);
        await writeIndex(kept);
        historyItems = kept;
        await Promise.all([...duplicateItems, ...nextItems.slice(maxItems)].map(deleteItemFiles));
        broadcastHistory("captured");
    } catch (err) {
        if (payloadPaths) {
            await Promise.all(Object.values(payloadPaths).map(removeFile));
        }
        log(`Clipboard capture failed: ${errMessage(err)}`);
    }
}

function markEmittedSequence(sequence: number): void {
    lastEmittedSequence = sequence;
    if (lastObservedSequence !== null && isAheadOrEqual(sequence, lastObservedSequence)) {
        pendingDeafCount = 0;
        if (sidecar.isRunning && monitoringOwners.size > 0 && health === "deaf") {
            health = "healthy";
            lastError = undefined;
            broadcastStatus();
        }
    }
}

function isAheadOrEqual(value: number, reference: number): boolean {
    const distance = (value - reference) >>> 0;
    return distance < UINT32_HALF_RANGE;
}

function processPong(pong: ClipboardPong): void {
    if (monitoringOwners.size === 0) return;
    lastObservedSequence = pong.sequence;
    lastEmittedSequence = pong.lastEmittedSequence;

    if (!sidecar.isRunning) return;
    if (lastEmittedSequence === null) {
        pendingDeafCount = 0;
        health = "healthy";
        lastError = undefined;
        broadcastStatus();
        return;
    }

    const distance = (pong.sequence - lastEmittedSequence) >>> 0;
    const ahead = distance > 0 && distance < UINT32_HALF_RANGE;
    if (ahead) {
        pendingDeafCount += 1;
        if (pendingDeafCount >= DEAF_AHEAD_PONG_THRESHOLD) {
            health = "deaf";
            lastError = "Clipboard watcher is not delivering clipboard changes";
            broadcastStatus();
        }
        return;
    }

    pendingDeafCount = 0;
    if (health === "deaf" || health === "error") {
        health = "healthy";
        lastError = undefined;
        broadcastStatus();
    } else if (health !== "healthy") {
        health = "healthy";
        broadcastStatus();
    }
}

/** Handle one watcher stdout line. Returns whether the protocol claimed it —
 *  the caller logs only what it did not, so protocol traffic stays out of the
 *  terminal. */
function processSidecarLine(line: string): boolean {
    if (!line.startsWith("{")) return false;
    try {
        const parsed: unknown = JSON.parse(line);
        if (isClipboardChange(parsed)) {
            markEmittedSequence(parsed.sequence);
            void enqueue(() => captureChange(parsed));
            return true;
        }
        if (isClipboardPong(parsed)) {
            processPong(parsed);
            return true;
        }
        // Parsed, but no known type: unexpected, so let it through to the log.
        return false;
    } catch (err) {
        log(`Failed to parse watcher output: ${errMessage(err)}`);
        log(line);
        return true;
    }
}

function pingWatcher(): void {
    if (!sidecar.isRunning) return;
    const now = Date.now();
    if (lastPingDeadline !== 0 && now > lastPingDeadline) {
        if (health !== "error") {
            health = "error";
            lastError = "Clipboard watcher did not answer a health ping";
            broadcastStatus();
        }
    }
    if (!sidecar.writeLine('{"type":"ping"}')) {
        health = "error";
        lastError = "Clipboard watcher did not accept a health ping";
        broadcastStatus();
        return;
    }
    lastPingDeadline = now + PONG_TIMEOUT_INTERVALS * PING_INTERVAL_MS;
}

function startPingMonitoring(): void {
    if (pingTimer) return;
    lastPingDeadline = Date.now() + PONG_TIMEOUT_INTERVALS * PING_INTERVAL_MS;
    pingTimer = setInterval(pingWatcher, PING_INTERVAL_MS);
}

function stopPingMonitoring(): void {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = undefined;
    pendingDeafCount = 0;
    lastObservedSequence = null;
    lastPingDeadline = 0;
}

function registerOwner(ownerId: number): void {
    monitoringOwners.add(ownerId);
    const owner = webContents.fromId(ownerId);
    if (owner && !ownerCleanup.has(ownerId)) {
        const cleanup = () => {
            ownerCleanup.delete(ownerId);
            monitoringOwners.delete(ownerId);
            if (monitoringOwners.size === 0) {
                stopPingMonitoring();
                if (sidecar.isRunning && (health === "deaf" || health === "error")) {
                    health = "running";
                    lastError = undefined;
                }
            }
            broadcastStatus();
        };
        ownerCleanup.set(ownerId, cleanup);
        owner.once("destroyed", cleanup);
    }
}

function unregisterOwner(ownerId: number): void {
    monitoringOwners.delete(ownerId);
    const cleanup = ownerCleanup.get(ownerId);
    if (cleanup) {
        const owner = webContents.fromId(ownerId);
        owner?.removeListener("destroyed", cleanup);
        ownerCleanup.delete(ownerId);
    }
    if (monitoringOwners.size === 0) {
        stopPingMonitoring();
        if (sidecar.isRunning && (health === "deaf" || health === "error")) {
            health = "running";
            lastError = undefined;
        }
    }
}

function resetHealthForStart(): void {
    lastError = undefined;
    pendingDeafCount = 0;
    lastObservedSequence = null;
    lastEmittedSequence = null;
    health = "starting";
    broadcastStatus();
}

async function startWatcher(): Promise<ClipboardStatus> {
    resetHealthForStart();
    const result = await sidecar.start(getSnipToolPath(), ["clipboard-watch"], { windowsHide: true });
    if (!result.success) {
        health = "error";
        lastError = result.error ?? "Clipboard watcher failed to start";
        broadcastStatus();
    }
    return getStatus();
}

async function stopWatcher(): Promise<void> {
    stopPingMonitoring();
    await sidecar.stopAndWaitGracefully();
    lastError = undefined;
    health = "disabled";
    broadcastStatus();
}

async function setEnabledInternal(value: boolean, cap: number): Promise<ClipboardStatus> {
    maxItems = cap;
    await ensureHistoryLoaded();
    if (await trimHistory()) broadcastHistory("removed");

    if (!value) {
        enabled = false;
        await stopWatcher();
        return getStatus();
    }

    enabled = true;
    if (sidecar.isRunning) return getStatus();
    return startWatcher();
}

export function setClipboardEnabled(value: boolean, cap: number): Promise<ClipboardStatus> {
    return enqueue(() => setEnabledInternal(value, cap));
}

export function getClipboardStatus(): ClipboardStatus {
    return getStatus();
}

export function getClipboardHistory(): Promise<ClipboardHistorySnapshot> {
    return enqueue(async () => {
        await ensureHistoryLoaded();
        return snapshot();
    });
}

export function removeClipboardItem(id: string): Promise<void> {
    return enqueue(async () => {
        await ensureHistoryLoaded();
        const item = historyItems.find((candidate) => candidate.id === id);
        if (!item) return;
        const nextItems = historyItems.filter((candidate) => candidate.id !== id);
        await writeIndex(nextItems);
        historyItems = nextItems;
        await deleteItemFiles(item);
        broadcastHistory("removed");
    });
}

export function clearClipboardHistory(): Promise<void> {
    return enqueue(async () => {
        await ensureHistoryLoaded();
        const oldItems = historyItems;
        await writeIndex([]);
        historyItems = [];
        let removedPayload = false;
        try {
            const names = await fs.readdir(getClipboardDirectory());
            const payloadNames = names.filter((name) => RECOGNIZED_PAYLOAD_PATTERN.test(name));
            removedPayload = payloadNames.length > 0;
            await Promise.all(payloadNames.map((name) => removeFile(path.join(getClipboardDirectory(), name))));
        } catch (err) {
            const code = (err as { code?: string }).code;
            if (code !== "ENOENT") log(`Failed to clear clipboard payloads: ${errMessage(err)}`);
        }
        if (oldItems.length > 0 || removedPayload) broadcastHistory("cleared");
    });
}

async function decodeUtf8(bytes: Buffer): Promise<string> {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function loadPayloads(item: ClipboardIndexItem): Promise<LoadedPayloads | null> {
    const loaded: LoadedPayloads = { bytes: {}, images: {} };
    try {
        for (const flavor of payloadFlavors) {
            const filePath = item.payloads[flavor];
            if (!filePath) continue;
            const bytes = await fs.readFile(filePath);
            loaded.bytes[flavor] = bytes;
            if (flavor === "text" || flavor === "html") {
                await decodeUtf8(bytes);
            } else if (flavor === "image") {
                const image = nativeImage.createFromBuffer(bytes);
                if (image.isEmpty()) return null;
                loaded.images[flavor] = image;
            } else {
                const text = await decodeUtf8(bytes);
                let parsed: unknown;
                try {
                    parsed = JSON.parse(text);
                } catch (err) {
                    log(`Clipboard file-list JSON is malformed: ${errMessage(err)}`);
                    return null;
                }
                if (!isValidFileList(parsed)) return null;
                loaded.files = parsed;
            }
        }
        return loaded;
    } catch (err) {
        log(`Failed to load clipboard payload: ${errMessage(err)}`);
        return null;
    }
}

export function copyClipboardItem(id: string): Promise<boolean> {
    return enqueue(async () => {
        await ensureHistoryLoaded();
        const item = historyItems.find((candidate) => candidate.id === id);
        if (!item) return false;
        const payloads = await loadPayloads(item);
        if (!payloads) return false;

        try {
            const text = payloads.bytes.text ? await decodeUtf8(payloads.bytes.text) : undefined;
            const html = payloads.bytes.html ? await decodeUtf8(payloads.bytes.html) : undefined;
            const image = payloads.images.image;
            if (item.primary === "text") {
                if (text === undefined) return false;
                clipboard.writeText(text);
                return true;
            }
            if (item.primary === "html") {
                if (html === undefined) return false;
                clipboard.write({ html, ...(text !== undefined ? { text } : {}), ...(image ? { image } : {}) });
                return true;
            }
            if (item.primary === "image") {
                if (!image) return false;
                clipboard.write({ image, ...(text !== undefined ? { text } : {}), ...(html !== undefined ? { html } : {}) });
                return true;
            }
            if (!payloads.files) return false;
            return writeClipboardFiles(payloads.files.paths, payloads.files.dropEffect === "cut");
        } catch (err) {
            log(`Failed to copy clipboard item: ${errMessage(err)}`);
            return false;
        }
    });
}

export function setClipboardHealthMonitoring(ownerId: number, active: boolean): ClipboardStatus {
    if (active) {
        registerOwner(ownerId);
        startPingMonitoring();
    } else {
        unregisterOwner(ownerId);
    }
    broadcastStatus();
    return getStatus();
}

export function restartClipboard(cap: number): Promise<ClipboardStatus> {
    return enqueue(async () => {
        maxItems = cap;
        await ensureHistoryLoaded();
        if (await trimHistory()) broadcastHistory("removed");
        enabled = true;
        stopPingMonitoring();
        await sidecar.stopAndWaitGracefully();
        return startWatcher();
    });
}

export function shutdownClipboard(): void {
    stopPingMonitoring();
    sidecar.stop();
    enabled = false;
    health = "disabled";
    lastError = undefined;
}
