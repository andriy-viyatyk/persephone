import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DownloadItem, WebContents } from "electron";
import type { BrowserDownloadResult, BrowserDownloadWaitOptions } from "../ipc/browser-ipc";
import { PendingRequests } from "../shared/pending-requests";
import { applicationProfileName } from "./application-profile";

const CAPTURE_MAX_BYTES = 32 * 1024 * 1024;
const CAPTURE_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CAPTURE_TEMP_FOLDER = "persephone-test-downloads";
const DEFAULT_DOWNLOAD_WAIT_TIMEOUT_MS = 10_000;
const MAX_DOWNLOAD_WAIT_TIMEOUT_MS = 595_000;

interface CaptureWaiter { webContents: WebContents; partPath?: string; item?: DownloadItem; claimed?: boolean; completed?: boolean; }

function safeProfileKey(): string {
    const profile = applicationProfileName();
    return profile && /^[a-z0-9-]{1,32}$/.test(profile) ? profile : "default";
}

function captureRoot(): string {
    return path.join(os.tmpdir(), CAPTURE_TEMP_FOLDER, safeProfileKey());
}

function ensureCaptureRoot(): void {
    const sharedRoot = path.dirname(captureRoot());
    for (const directory of [sharedRoot, captureRoot()]) {
        try { fsSync.mkdirSync(directory); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        if (!fsSync.lstatSync(directory).isDirectory()) throw new Error("Browser download capture folder is not a regular directory.");
    }
}

function validateTimeout(options?: BrowserDownloadWaitOptions): number {
    if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options))) throw new TypeError("waitForDownload options must be an object.");
    if (options?.timeout === undefined) return DEFAULT_DOWNLOAD_WAIT_TIMEOUT_MS;
    if (typeof options.timeout !== "number" || !Number.isFinite(options.timeout) || options.timeout <= 0) throw new TypeError("waitForDownload timeout must be a positive finite number.");
    return Math.min(MAX_DOWNLOAD_WAIT_TIMEOUT_MS, Math.max(1, Math.round(options.timeout)));
}

function safeFilename(value: string): string {
    const basename = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
    let filename = [...basename].map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 || '<>:"|?*'.includes(character) ? "_" : character;
    }).join("").replace(/[. ]+$/g, "");
    if (!filename || filename === "." || filename === "..") filename = "download";
    if (isReservedWindowsFilename(filename)) filename = `_${filename}`;
    return filename.slice(0, 180) || "download";
}

class DownloadCapture {
    private readonly requests = new PendingRequests<BrowserDownloadResult, CaptureWaiter>({
        timeoutError: () => new Error("Timed out waiting for a browser download."),
    });
    private readonly byContents = new Map<WebContents, number>();
    private nextId = 0;

    wait(webContents: WebContents, options?: BrowserDownloadWaitOptions): Promise<BrowserDownloadResult> {
        const timeout = validateTimeout(options);
        if (webContents.isDestroyed()) throw new Error("Browser page is closed.");
        if (this.byContents.has(webContents)) throw new Error("A download waiter is already active for this browser page.");
        const id = ++this.nextId;
        const waiter: CaptureWaiter = { webContents };
        const pending = this.requests.create(timeout, undefined, { id, meta: waiter });
        this.byContents.set(webContents, id);
        const onNavigate = () => this.fail(webContents, new Error("Download wait cancelled because the browser page navigated."));
        const onDestroyed = () => this.fail(webContents, new Error("Download wait cancelled because the browser page closed."));
        webContents.once("did-navigate", onNavigate);
        webContents.once("destroyed", onDestroyed);
        const cleanup = () => {
            webContents.removeListener("did-navigate", onNavigate);
            webContents.removeListener("destroyed", onDestroyed);
            if (this.byContents.get(webContents) === id) this.byContents.delete(webContents);
            if (!waiter.partPath) return;
            const removePartial = () => {
                if (waiter.partPath) void fs.unlink(waiter.partPath).catch((): void => undefined);
            };
            if (waiter.item && !waiter.completed) waiter.item.once("done", removePartial);
            else removePartial();
        };
        void pending.promise.then(cleanup, cleanup);
        return pending.promise;
    }

    capture(item: DownloadItem, webContents: WebContents): boolean {
        const id = this.byContents.get(webContents);
        if (id === undefined || !this.requests.has(id)) return false;
        const waiter = this.waiter(id);
        if (!waiter || waiter.claimed) return false;
        waiter.claimed = true;
        waiter.item = item;
        const knownSize = item.getTotalBytes();
        if (knownSize > CAPTURE_MAX_BYTES) {
            this.fail(webContents, new Error("Browser download exceeds the 32 MiB capture limit."));
            return true;
        }
        const directory = captureRoot();
        const partPath = path.join(directory, `${randomUUID()}.part`);
        waiter.partPath = partPath;
        try {
            ensureCaptureRoot();
            if (!this.requests.has(id) || webContents.isDestroyed()) { item.cancel(); return true; }
        } catch {
            this.fail(webContents, new Error("Could not prepare the browser download capture."));
            return true;
        }
        item.on("updated", () => {
            if (item.getReceivedBytes() > CAPTURE_MAX_BYTES) {
                this.fail(webContents, new Error("Browser download exceeds the 32 MiB capture limit."));
            }
        });
        item.once("done", (_event, state) => {
            waiter.completed = true;
            if (state !== "completed") {
                this.fail(webContents, new Error(state === "cancelled" ? "Browser download was cancelled." : "Browser download failed."));
                return;
            }
            void this.finish(item, waiter, id);
        });
        try { item.setSavePath(partPath); }
        catch {
            this.fail(webContents, new Error("Could not prepare the browser download capture."));
            return true;
        }
        return true;
    }

    async cleanupAtStartup(): Promise<void> {
        const directory = captureRoot();
        try {
            const sharedStat = await fs.lstat(path.dirname(directory));
            if (!sharedStat.isDirectory()) return;
            const rootStat = await fs.lstat(directory);
            if (!rootStat.isDirectory()) return;
            const entries = await fs.readdir(directory, { withFileTypes: true });
            const now = Date.now();
            await Promise.all(entries.map(async (entry) => {
                if (!entry.isFile()) return;
                const filePath = path.join(directory, entry.name);
                try {
                    const stat = await fs.lstat(filePath);
                    if (!stat.isFile()) return;
                    if (entry.name.endsWith(".part") || now - stat.mtimeMs > CAPTURE_ORPHAN_MAX_AGE_MS) await fs.unlink(filePath);
                } catch { /* A concurrent cleanup or antivirus scan may remove the file first. */ }
            }));
        } catch { /* The profile capture root may not exist yet. */ }
    }

    private waiter(id: number): CaptureWaiter | undefined {
        let found: CaptureWaiter | undefined;
        this.requests.some((meta) => {
            if (this.byContents.get(meta.webContents) !== id) return false;
            found = meta;
            return true;
        });
        return found;
    }

    private fail(webContents: WebContents, error: Error): void {
        const id = this.byContents.get(webContents);
        if (id !== undefined) {
            const waiter = this.waiter(id);
            if (this.requests.fail(id, error)) waiter?.item?.cancel();
        }
    }

    private async finish(item: DownloadItem, waiter: CaptureWaiter, id: number): Promise<void> {
        const partPath = waiter.partPath;
        if (!partPath || !this.requests.has(id)) return;
        try {
            const stat = await fs.stat(partPath);
            if (stat.size > CAPTURE_MAX_BYTES) throw new Error("Browser download exceeds the 32 MiB capture limit.");
            const filename = safeFilename(item.getFilename());
            const extension = path.extname(filename);
            const stem = extension ? filename.slice(0, -extension.length) : filename;
            let finalPath = path.join(captureRoot(), filename);
            for (let index = 1; ; index++) {
                try {
                    await fs.link(partPath, finalPath);
                    try { await fs.unlink(partPath); }
                    catch (error) {
                        await fs.unlink(finalPath).catch((): void => undefined);
                        throw error;
                    }
                    break;
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
                    finalPath = path.join(captureRoot(), `${stem} (${index})${extension}`);
                }
            }
            waiter.partPath = undefined;
            this.requests.settle(id, { suggestedFilename: item.getFilename(), path: finalPath, size: stat.size });
        } catch (error) {
            const message = error instanceof Error && error.message === "Browser download exceeds the 32 MiB capture limit."
                ? error.message
                : "Browser download could not be finalized.";
            this.requests.fail(id, new Error(message));
        }
    }
}

function isReservedWindowsFilename(filename: string): boolean {
    const firstPart = filename.split(".", 1)[0].replace(/[. ]+$/g, "");
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(firstPart);
}

export const downloadCapture = new DownloadCapture();
export const cleanupDownloadCaptures = (): Promise<void> => downloadCapture.cleanupAtStartup();
