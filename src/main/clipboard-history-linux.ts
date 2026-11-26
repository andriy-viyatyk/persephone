import { app, BrowserWindow, clipboard } from "electron";
import { createHash } from "node:crypto";
import type { ClipboardFlavor } from "../ipc/clipboard-ipc";
import { errMessage } from "../shared/utils";
import { readLinuxClipboardFiles } from "./clip-service-linux";

// Tuning constants: polling can miss intermediate changes, so keep this interval modest.
const POLL_INTERVAL_MS = 1_000;

type SamplePayload = { flavor: ClipboardFlavor; bytes: Buffer };
type Capture = (payloads: SamplePayload[], files: { paths: string[]; dropEffect: "copy" | "cut" | "none" } | null, capturedAt: number) => Promise<void>;

let capture: Capture | undefined;
let reportError: ((message: string | undefined) => void) | undefined;
let timer: NodeJS.Timeout | undefined;
let activeWindow: BrowserWindow | undefined;
let generation = 0;
let baseline = true;
let lastSignature: string | undefined;
const windowHandlers = new Map<BrowserWindow, { focus: () => void; blur: () => void; closed: () => void }>();
let onBrowserWindowCreated: ((_event: Electron.Event, window: BrowserWindow) => void) | undefined;

function signatureOf(payloads: SamplePayload[], files: { paths: string[]; dropEffect: "copy" | "cut" | "none" } | null): string {
    const hash = createHash("sha256");
    for (const payload of payloads) hash.update(payload.flavor).update("\0").update(payload.bytes).update("\0");
    if (files) hash.update(JSON.stringify(files));
    return hash.digest("hex");
}

async function readSample(): Promise<{ payloads: SamplePayload[]; files: Awaited<ReturnType<typeof readLinuxClipboardFiles>> }> {
    const payloads: SamplePayload[] = [];
    const items = await clipboard.read();
    for (const flavor of ["text", "html", "image"] as const) {
        const mime = flavor === "text" ? "text/plain" : flavor === "html" ? "text/html" : "image/png";
        const item = items.find((candidate) => candidate.types.includes(mime));
        if (!item) continue;
        const blob = await item.getType(mime);
        const bytes = flavor === "image" ? Buffer.from(await blob.arrayBuffer())
            : Buffer.from(await blob.text(), "utf8");
        if (bytes.length) payloads.push({ flavor, bytes });
    }
    const files = await readLinuxClipboardFiles();
    return { payloads, files: files.paths.length ? files : { paths: [], dropEffect: "none" } };
}

function scheduleRead(expectedGeneration: number): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void poll(expectedGeneration); }, POLL_INTERVAL_MS);
}

async function poll(expectedGeneration: number): Promise<void> {
    timer = undefined;
    if (!capture || !activeWindow?.isFocused() || expectedGeneration !== generation) return;
    try {
        const sample = await readSample();
        if (!capture || !activeWindow?.isFocused() || expectedGeneration !== generation) return;
        reportError?.(undefined);
        const files = sample.files.paths.length ? sample.files : null;
        const signature = signatureOf(sample.payloads, files);
        if (baseline) {
            baseline = false;
            lastSignature = signature;
        } else if (signature !== lastSignature) {
            lastSignature = signature;
            if (sample.payloads.length || files) await capture(sample.payloads, files, Date.now());
        }
    } catch (err) {
        console.error("Failed to sample Linux clipboard history:", err);
        reportError?.(errMessage(err, "Linux clipboard sampling failed"));
    }
    if (capture && activeWindow?.isFocused() && expectedGeneration === generation) scheduleRead(expectedGeneration);
}

function focus(window: BrowserWindow): void {
    generation += 1;
    activeWindow = window;
    baseline = true;
    lastSignature = undefined;
    scheduleRead(generation);
}

function blur(window: BrowserWindow): void {
    if (activeWindow !== window) return;
    generation += 1;
    activeWindow = undefined;
    baseline = true;
    lastSignature = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
}

function attachWindow(window: BrowserWindow): void {
    if (windowHandlers.has(window)) return;
    const onFocus = () => focus(window);
    const onBlur = () => blur(window);
    const onClosed = () => {
        blur(window);
        windowHandlers.delete(window);
    };
    windowHandlers.set(window, { focus: onFocus, blur: onBlur, closed: onClosed });
    window.on("focus", onFocus);
    window.on("blur", onBlur);
    window.once("closed", onClosed);
    if (window.isFocused()) focus(window);
}

function detachWindows(): void {
    for (const [window, handlers] of windowHandlers) {
        window.removeListener("focus", handlers.focus);
        window.removeListener("blur", handlers.blur);
        window.removeListener("closed", handlers.closed);
    }
    windowHandlers.clear();
    if (activeWindow) blur(activeWindow);
}

export function startLinuxClipboardHistory(onCapture: Capture, onError: (message: string | undefined) => void): void {
    if (capture) return;
    capture = onCapture;
    reportError = onError;
    onBrowserWindowCreated = (_event, window) => attachWindow(window);
    app.on("browser-window-created", onBrowserWindowCreated);
    for (const window of BrowserWindow.getAllWindows()) attachWindow(window);
}

export function stopLinuxClipboardHistory(): void {
    if (!capture) return;
    capture = undefined;
    reportError = undefined;
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = undefined;
    detachWindows();
    if (onBrowserWindowCreated) app.removeListener("browser-window-created", onBrowserWindowCreated);
    onBrowserWindowCreated = undefined;
}

export function isLinuxClipboardHistoryRunning(): boolean {
    return !!capture;
}
