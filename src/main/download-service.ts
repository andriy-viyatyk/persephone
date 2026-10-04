import path from "node:path";
import fs from "node:fs";
import { app, BrowserWindow, dialog, DownloadItem, Session, shell, WebContents } from "electron";
import { DownloadEntry } from "../ipc/api-param-types";
import type { BrowserUrlMaskClaim } from "../ipc/api-param-types";
import { EventEndpoint } from "../ipc/api-types";
import { matchesBrowserUrlMask } from "../shared/browser-url-masks";
import { openWindows } from "./open-windows";
import { getDataFolder, preparePath } from "./utils";
import { rememberDirFromPick, resolveDefaultPath } from "./dialog-folder-memory";
import { withNativeDialog } from "./native-dialog-tracker";
import { isRegisteredBrowserWebContents } from "./browser-service";
import { registerSessionSource } from "./session-src-protocol";
import { browserNetworkService } from "./browser-network-service";
import { torService } from "./tor-service";
import { errMessage } from "../shared/utils";

const PERSIST_FILE = "recentDownloads.json";
const MAX_PERSISTED = 5;
const PROGRESS_THROTTLE_MS = 500;
const TEMP_DOWNLOAD_FOLDER = "persephone-downloads";

interface DownloadRecord {
    entry: DownloadEntry;
    item?: DownloadItem;
    tempPath: string;
    targetPath?: string;
    transferDone: boolean;
    finishing: boolean;
    referrerUrl?: string;
    hostUrl?: string;
}
function sendToBrowserHost(webContents: WebContents, endpoint: EventEndpoint, data: unknown): void {
    const hostContents = (webContents as WebContents & { hostWebContents?: WebContents }).hostWebContents;
    try {
        if (hostContents && !hostContents.isDestroyed()) {
            hostContents.send(endpoint, data);
        }
    } catch {
        // The host renderer may be destroyed before the webview is disposed.
    }
}

/** The http(s) URL to record, without credentials; undefined for anything else
 *  (data:, blob:, about:), which Chrome records as about:internet. */
function motwUrl(raw: string): string | undefined {
    try {
        const url = new URL(raw);
        if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
        url.username = "";
        url.password = "";
        return url.href;
    } catch {
        return undefined;
    }
}

/**
 * Mark a completed browser download as coming from the internet (Mark-of-the-Web), as Chrome
 * and Firefox do: Windows then shows SmartScreen for executables, Protected View for Office
 * files and the "blocked" flag on archives. Electron does not write it (US-1592).
 * ZoneId=3 is always written: Persephone does not map URLs to the user's IE zones, so
 * intranet sources are treated as internet too (the stricter side). A filesystem without
 * alternate data streams (FAT32, exFAT, some network shares) cannot store the mark; the
 * download itself still succeeds.
 */
async function writeMarkOfTheWeb(savePath: string, url: string, referrerUrl: string): Promise<void> {
    if (process.platform !== "win32") return;
    const lines = ["[ZoneTransfer]", "ZoneId=3"];
    const referrer = motwUrl(referrerUrl);
    if (referrer) lines.push(`ReferrerUrl=${referrer}`);
    lines.push(`HostUrl=${motwUrl(url) ?? "about:internet"}`);
    try {
        await fs.promises.writeFile(`${savePath}:Zone.Identifier`, lines.join("\r\n") + "\r\n", "utf8");
    } catch {
        // No alternate data streams on this volume — nothing else to do.
    }
}

class DownloadService {
    private downloads = new Map<string, DownloadRecord>();
    private hookedSessions = new WeakSet<Session>();
    private idCounter = 0;
    private browserUrlMaskClaims: BrowserUrlMaskClaim[] = [];

    init(): void {
        this.loadPersisted();
        void this.cleanupTemporaryDownloads();
        app.on("session-created", (ses) => {
            this.hookSession(ses);
        });
    }

    hookSession(ses: Session): void {
        if (this.hookedSessions.has(ses)) return;
        this.hookedSessions.add(ses);

        ses.on("will-download", (_event, item, webContents) => {
            this.handleWillDownload(item, webContents);
        });
    }

    setBrowserUrlMaskClaims(claims: BrowserUrlMaskClaim[]): void {
        this.browserUrlMaskClaims = claims.map((claim) => ({
            boardRoot: claim.boardRoot,
            boardName: claim.boardName,
            masks: [...claim.masks],
        }));
    }

    getDownloads(): DownloadEntry[] {
        return Array.from(this.downloads.values())
            .map(d => ({ ...d.entry }))
            .sort((a, b) => b.startTime - a.startTime);
    }

    cancelDownload(id: string): void {
        const dl = this.downloads.get(id);
        if (dl?.item && dl.entry.status === "downloading") {
            dl.item.cancel();
        }
    }

    openDownload(id: string): void {
        const dl = this.downloads.get(id);
        if (dl?.entry.savePath && dl.entry.status === "completed") {
            shell.openPath(dl.entry.savePath);
        }
    }

    showInFolder(id: string): void {
        const dl = this.downloads.get(id);
        if (dl?.entry.status === "completed" && dl.entry.savePath) {
            shell.showItemInFolder(dl.entry.savePath);
        }
    }

    clearCompleted(): void {
        for (const [id, dl] of this.downloads) {
            if (dl.entry.status !== "downloading" && dl.entry.status !== "awaitingPath") {
                this.downloads.delete(id);
            }
        }
        this.persist();
        openWindows.send(EventEndpoint.eDownloadCleared, this.getDownloads());
    }

    private generateId(): string {
        return `dl-${Date.now()}-${++this.idCounter}`;
    }

    private getParentWindow(webContents: WebContents): BrowserWindow | undefined {
        // For webview downloads, get the host window
        // `hostWebContents` exists on Electron's WebContents for webview-hosted
        // pages but isn't in the public TS surface.
        const hostContents = (webContents as WebContents & { hostWebContents?: WebContents }).hostWebContents;
        const contents = hostContents || webContents;
        return BrowserWindow.fromWebContents(contents) ?? undefined;
    }

    private handleWillDownload(item: DownloadItem, webContents: WebContents): void {
        if (!isRegisteredBrowserWebContents(webContents)) {
            return this.handleOrdinaryDownload(item, webContents);
        }

        const url = item.getURL();
        const claim = this.findBrowserUrlClaim(url);
        if (claim) {
            item.cancel();
            const torPartition = torService.findActivePartitionForSession(webContents.session);
            const routed = Boolean(torPartition) || browserNetworkService.isProxiedSession(webContents.session);
            // A proxied profile is persistent but must not hand the board a direct fetch (US-1557).
            const sessionHandle = torPartition
                || !webContents.session.isPersistent()
                || routed
                ? registerSessionSource(webContents.session, url, torPartition, routed)
                : undefined;
            sendToBrowserHost(webContents, EventEndpoint.eOpenClaimedBrowserDownload, {
                url,
                boardRoot: claim.boardRoot,
                ...(sessionHandle ? { sessionHandle } : {}),
            });
            sendToBrowserHost(webContents, EventEndpoint.eBoardNotify, {
                message: `${claim.boardName} claimed this download and opened its source URL.`,
                type: "info",
            });
            return;
        }

        return this.handleOrdinaryDownload(item, webContents);
    }

    private findBrowserUrlClaim(url: string): BrowserUrlMaskClaim | undefined {
        for (const claim of this.browserUrlMaskClaims) {
            if (claim.masks.some((mask) => matchesBrowserUrlMask(url, mask))) return claim;
        }
        return undefined;
    }

    private handleOrdinaryDownload(item: DownloadItem, webContents: WebContents): void {
        const id = this.generateId();
        const recordSource = !torService.findActivePartitionForSession(webContents.session);
        const referrerUrl = recordSource && !webContents.isDestroyed() ? webContents.getURL() : "";
        const parentWindow = this.getParentWindow(webContents);
        const defaultPath = resolveDefaultPath({ kind: "save", defaultPath: item.getFilename(), location: "downloads" });
        const tempDirectory = path.join(app.getPath("temp"), TEMP_DOWNLOAD_FOLDER);
        const tempPath = path.join(tempDirectory, id + ".part");
        if (!preparePath(tempDirectory)) { item.cancel(); return; }
        item.setSavePath(tempPath);
        const entry: DownloadEntry = {
            id, filename: item.getFilename(), url: item.getURL(), totalBytes: item.getTotalBytes(),
            receivedBytes: 0, status: "downloading", startTime: Date.now(),
        };
        const record: DownloadRecord = { entry, item, tempPath, transferDone: false, finishing: false, referrerUrl };
        this.downloads.set(id, record);
        openWindows.send(EventEndpoint.eDownloadStarted, { ...entry });
        this.trackDownload(item, record, recordSource, referrerUrl);
        void this.chooseDownloadPath(parentWindow, record, defaultPath);
    }

    private async chooseDownloadPath(parentWindow: BrowserWindow | undefined, record: DownloadRecord, defaultPath: string | undefined): Promise<void> {
        const removeUnselectedDownload = async (): Promise<void> => {
            if (!record.transferDone) record.item?.cancel();
            try { await fs.promises.unlink(record.tempPath); } catch { /* The transfer may not have created its temp file yet. */ }
            this.downloads.delete(record.entry.id);
            openWindows.send(EventEndpoint.eDownloadRemoved, { id: record.entry.id });
        };
        try {
            const result = await withNativeDialog(parentWindow, "file", () => dialog.showSaveDialog(parentWindow, { defaultPath }));
            if (result.canceled || !result.filePath) { await removeUnselectedDownload(); return; }
            rememberDirFromPick("save", result.filePath);
            record.targetPath = result.filePath;
            if (record.transferDone) await this.finishDownloadMove(record, record.hostUrl ?? record.entry.url, record.referrerUrl ?? "");
        } catch (error) {
            console.warn("[downloads] Save dialog failed: " + errMessage(error));
            await removeUnselectedDownload();
        }
    }

    private trackDownload(item: DownloadItem, record: DownloadRecord, recordSource: boolean, referrerUrl: string): void {
        let lastProgressSent = 0;
        item.on("updated", (_event, state) => {
            if (state !== "progressing") return;
            record.entry.receivedBytes = item.getReceivedBytes();
            record.entry.totalBytes = item.getTotalBytes();
            const now = Date.now();
            if (now - lastProgressSent >= PROGRESS_THROTTLE_MS) {
                lastProgressSent = now;
                openWindows.send(EventEndpoint.eDownloadProgress, {
                    id: record.entry.id, receivedBytes: record.entry.receivedBytes, totalBytes: record.entry.totalBytes,
                });
            }
        });
        item.on("done", (_event, state) => {
            record.entry.receivedBytes = item.getReceivedBytes();
            record.entry.totalBytes = item.getTotalBytes();
            if (state === "completed") {
                record.hostUrl = recordSource ? (item.getURLChain().at(-1) ?? item.getURL()) : "";
            }
            if (state === "completed" && !record.targetPath) {
                record.transferDone = true;
                record.entry.status = "awaitingPath";
                openWindows.send(EventEndpoint.eDownloadAwaitingPath, {
                    id: record.entry.id, receivedBytes: record.entry.receivedBytes, totalBytes: record.entry.totalBytes,
                });
            } else if (state === "completed") {
                record.transferDone = true;
                void this.finishDownloadMove(record, record.hostUrl ?? "", referrerUrl);
            } else if (state === "cancelled") {
                record.entry.status = "cancelled";
                openWindows.send(EventEndpoint.eDownloadFailed, { id: record.entry.id, error: "Cancelled" });
                void fs.promises.unlink(record.tempPath).catch((): void => undefined);
            } else {
                record.entry.status = "failed";
                record.entry.error = "Download interrupted";
                openWindows.send(EventEndpoint.eDownloadFailed, { id: record.entry.id, error: record.entry.error });
                void fs.promises.unlink(record.tempPath).catch((): void => undefined);
            }
            record.item = undefined;
            this.persist();
        });
    }

    private async finishDownloadMove(record: DownloadRecord, hostUrl: string, referrerUrl: string): Promise<void> {
        if (record.finishing || !record.targetPath) return;
        record.finishing = true;
        const savePath = record.targetPath;
        try {
            await fs.promises.rm(savePath, { force: true });
            try { await fs.promises.rename(record.tempPath, savePath); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
                await fs.promises.copyFile(record.tempPath, savePath);
                await fs.promises.unlink(record.tempPath);
            }
            await writeMarkOfTheWeb(savePath, hostUrl, referrerUrl);
            record.entry.filename = path.basename(savePath);
            record.entry.savePath = savePath;
            record.entry.status = "completed";
            openWindows.send(EventEndpoint.eDownloadCompleted, { id: record.entry.id, savePath });
            this.persist();
        } catch (error) {
            record.entry.status = "failed";
            record.entry.error = "Failed to save download: " + errMessage(error);
            openWindows.send(EventEndpoint.eDownloadFailed, { id: record.entry.id, error: record.entry.error });
            try { await fs.promises.unlink(record.tempPath); } catch { /* Best-effort cleanup. */ }
        }
    }

    private async cleanupTemporaryDownloads(): Promise<void> {
        const tempDirectory = path.join(app.getPath("temp"), TEMP_DOWNLOAD_FOLDER);
        try {
            const entries = await fs.promises.readdir(tempDirectory, { withFileTypes: true });
            await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith(".part"))
                .map(entry => fs.promises.unlink(path.join(tempDirectory, entry.name)).catch((): void => undefined)));
        } catch { /* The directory may not exist until the first download. */ }
    }

    private loadPersisted(): void {
        try {
            const filePath = path.join(getDataFolder(), PERSIST_FILE);
            if (!fs.existsSync(filePath)) return;

            const data = fs.readFileSync(filePath, { encoding: "utf-8" });
            const entries: DownloadEntry[] = JSON.parse(data);
            for (const entry of entries) {
                this.downloads.set(entry.id, {
                    entry,
                    tempPath: "",
                    transferDone: true,
                    finishing: false,
                });
            }
        } catch {
            // Ignore corrupted data
        }
    }

    private persist(): void {
        try {
            const completed = this.getDownloads()
                .filter(d => d.status === "completed")
                .slice(0, MAX_PERSISTED);

            const dataFolder = getDataFolder();
            if (!preparePath(dataFolder)) return;

            const filePath = path.join(dataFolder, PERSIST_FILE);
            fs.writeFileSync(filePath, JSON.stringify(completed, null, 2), { encoding: "utf-8" });
        } catch {
            // Non-critical
        }
    }
}

export const downloadService = new DownloadService();
