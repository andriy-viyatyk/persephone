import { applicationProfileName } from "./application-profile";
import path from "node:path";
import fs from "node:fs";
import { app, BrowserWindow, dialog, DownloadItem, Session, shell, WebContents } from "electron";
import { DownloadEntry } from "../ipc/api-param-types";
import type { BrowserUrlMaskClaim } from "../ipc/api-param-types";
import type { BoardNotifyMsg } from "../ipc/board-bridge/port-protocol";
import type { EventApi } from "../ipc/api-types";
import type { EventPayload } from "../ipc/event-types";
import { sendRendererEvent } from "../ipc/main/renderer-event-sender";
import { matchesBrowserUrlMask } from "../shared/browser-url-masks";
import { openWindows } from "./open-windows";
import { preparePath } from "./utils";
import { JsonFileStore } from "./json-file-store";
import { rememberDirFromPick, resolveDefaultPath } from "./dialog-folder-memory";
import { withNativeDialog } from "./native-dialog-tracker";
import { browserGuests } from "./browser/BrowserGuestRegistry";
import { registerSessionSource } from "./session-src-protocol";
import { browserNetworkService } from "./browser-network-service";
import { torService } from "./tor-service";
import { errMessage } from "../shared/utils";
import { testInstanceDownloadPath } from "./test-mode/downloads";
import { t } from "../shared/i18n/t";
import { downloadRequestLimiter } from "./browser/download-request-limiter";
import { SavePathQueue } from "./download-path-queue";
import { cleanupDownloadCaptures, downloadCapture } from "./download-capture";

const MAX_PERSISTED = 5;
const PROGRESS_THROTTLE_MS = 500;
const TEMP_DOWNLOAD_FOLDER = "persephone-downloads";
/** A download still waiting for its Save dialog pauses once its temp file reaches this size. */
const UNCHOSEN_TEMP_LIMIT_BYTES = 32 * 1024 * 1024;

interface DownloadRecord {
    entry: DownloadEntry;
    item?: DownloadItem;
    tempPath: string;
    targetPath?: string;
    transferDone: boolean;
    finishing: boolean;
    /** Paused at the temp limit until a save path is chosen. */
    heldForPath?: boolean;
    referrerUrl?: string;
    hostUrl?: string;
    /** Renderer hosting the private (incognito or Tor) page that owns this download; its events go only there. */
    privateHost?: WebContents;
}

function validateRecentDownloads(raw: unknown): DownloadEntry[] | null {
    if (!Array.isArray(raw)) return null;
    const statuses = new Set<DownloadEntry["status"]>(["downloading", "awaitingPath", "completed", "failed", "cancelled"]);
    return raw.filter((entry): entry is DownloadEntry => Boolean(entry && typeof entry === "object"
        && typeof entry.id === "string" && typeof entry.filename === "string" && typeof entry.url === "string"
        && Number.isFinite(entry.totalBytes) && Number.isFinite(entry.receivedBytes) && Number.isFinite(entry.startTime)
        && statuses.has(entry.status)));
}

const recentStore = new JsonFileStore<DownloadEntry[]>("recentDownloads.json", {
    validate: validateRecentDownloads,
    defaultValue: () => [],
    onSaveError: "warn",
});
/** The app renderer hosting a webview guest. */
function browserHostOf(webContents: WebContents): WebContents | undefined {
    return (webContents as WebContents & { hostWebContents?: WebContents }).hostWebContents;
}

function sendToRenderer<K extends keyof EventApi>(contents: WebContents | undefined, endpoint: K, data: EventPayload<K>): void {
    try {
        if (contents && !contents.isDestroyed()) {
            sendRendererEvent(contents, endpoint, data);
        }
    } catch {
        // The host renderer may be destroyed before the webview is disposed.
    }
}

function sendToBrowserHost<K extends keyof EventApi>(webContents: WebContents, endpoint: K, data: EventPayload<K>): void {
    sendToRenderer(browserHostOf(webContents), endpoint, data);
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
 * files and the "blocked" flag on archives. Electron does not write it.
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
    private readonly savePaths = new SavePathQueue();

    init(): void {
        this.loadPersisted();
        void this.cleanupTemporaryDownloads();
        void cleanupDownloadCaptures();
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

    /** Normal downloads, plus the private downloads of pages hosted by `viewer`. Without a viewer (agents,
     *  recentDownloads.json) private downloads are never included. */
    getDownloads(viewer?: WebContents): DownloadEntry[] {
        return Array.from(this.downloads.values())
            .filter(d => d.entry.privateOwnerId === undefined || (viewer !== undefined && d.privateHost === viewer))
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

    /** Remove finished entries of one scope: normal downloads, or one private page's. */
    clearCompleted(privateOwnerId?: string): void {
        for (const [id, dl] of this.downloads) {
            if (dl.entry.privateOwnerId !== privateOwnerId) continue;
            if (dl.entry.status !== "downloading" && dl.entry.status !== "awaitingPath") {
                this.downloads.delete(id);
                this.notify(dl, "eDownloadRemoved", { id });
            }
        }
        this.persist();
    }

    /** Send a download's event to every window, or only to the window hosting its private page. */
    private notify<K extends keyof EventApi>(record: DownloadRecord, endpoint: K, data: EventPayload<K>): void {
        if (record.entry.privateOwnerId === undefined) openWindows.send(endpoint, data);
        else sendToRenderer(record.privateHost, endpoint, data);
    }

    /** A download from a browser page on an in-memory session (incognito or Tor) belongs to that page. */
    private privateOwner(webContents: WebContents): { ownerId: string; host: WebContents | undefined } | undefined {
        if (webContents.session.isPersistent()) return undefined;
        const guest = browserGuests.getByWebContents(webContents);
        return guest ? { ownerId: guest.tabId, host: browserHostOf(webContents) } : undefined;
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
        const guest = browserGuests.getByWebContents(webContents);
        if (!guest) {
            return this.handleOrdinaryDownload(item, webContents);
        }
        if (!downloadRequestLimiter.allow(webContents, guest.activation)) {
            item.cancel();
            if (downloadRequestLimiter.shouldNotify(webContents)) {
                sendToBrowserHost(webContents, "eBoardNotify", { message: t("main.downloadsBlocked"), type: "warning" } satisfies BoardNotifyMsg);
            }
            return;
        }

        const url = item.getURL();
        const claim = this.findBrowserUrlClaim(url);
        if (claim) {
            item.cancel();
            const torPartition = torService.findActivePartitionForSession(webContents.session);
            const routed = Boolean(torPartition) || browserNetworkService.isProxiedSession(webContents.session);
            // A proxied profile is persistent but must not hand the board a direct fetch.
            const sessionHandle = torPartition
                || !webContents.session.isPersistent()
                || routed
                ? registerSessionSource(webContents.session, url, torPartition, routed)
                : undefined;
            sendToBrowserHost(webContents, "eOpenClaimedBrowserDownload", {
                url,
                boardRoot: claim.boardRoot,
                ...(sessionHandle ? { sessionHandle } : {}),
            });
            sendToBrowserHost(webContents, "eBoardNotify", {
                message: `${claim.boardName} claimed this download and opened its source URL.`,
                type: "info",
            } satisfies BoardNotifyMsg);
            return;
        }

        if (downloadCapture.capture(item, webContents)) return;

        return this.handleOrdinaryDownload(item, webContents);
    }

    private findBrowserUrlClaim(url: string): BrowserUrlMaskClaim | undefined {
        for (const claim of this.browserUrlMaskClaims) {
            if (claim.masks.some((mask) => matchesBrowserUrlMask(url, mask))) return claim;
        }
        return undefined;
    }

    private handleOrdinaryDownload(item: DownloadItem, webContents: WebContents): void {
        // One Save dialog at a time per page; a page that already has a full queue loses the download.
        if (!this.savePaths.hasRoom(webContents.id)) { item.cancel(); return; }
        const id = this.generateId();
        const recordSource = !torService.findActivePartitionForSession(webContents.session);
        const referrerUrl = recordSource && !webContents.isDestroyed() ? webContents.getURL() : "";
        const parentWindow = this.getParentWindow(webContents);
        const defaultPath = resolveDefaultPath({ kind: "save", defaultPath: item.getFilename(), location: "downloads" });
        const tempDirectory = path.join(app.getPath("temp"), TEMP_DOWNLOAD_FOLDER + (applicationProfileName() ? `-${applicationProfileName()}` : ""));
        const tempPath = path.join(tempDirectory, id + ".part");
        if (!preparePath(tempDirectory)) { item.cancel(); return; }
        item.setSavePath(tempPath);
        const privateOwner = this.privateOwner(webContents);
        const entry: DownloadEntry = {
            id, filename: item.getFilename(), url: item.getURL(), totalBytes: item.getTotalBytes(),
            receivedBytes: 0, status: "downloading", startTime: Date.now(),
            ...(privateOwner ? { privateOwnerId: privateOwner.ownerId } : {}),
        };
        const record: DownloadRecord = {
            entry, item, tempPath, transferDone: false, finishing: false, referrerUrl, privateHost: privateOwner?.host,
        };
        this.downloads.set(id, record);
        this.notify(record, "eDownloadStarted", { ...entry });
        this.trackDownload(item, record, recordSource, referrerUrl);
        this.savePaths.enqueue(webContents.id, () => this.chooseDownloadPath(parentWindow, record, defaultPath));
    }

    private async chooseDownloadPath(parentWindow: BrowserWindow | undefined, record: DownloadRecord, defaultPath: string | undefined): Promise<void> {
        const removeUnselectedDownload = async (): Promise<void> => {
            if (!record.transferDone) record.item?.cancel();
            try { await fs.promises.unlink(record.tempPath); } catch { /* The transfer may not have created its temp file yet. */ }
            this.downloads.delete(record.entry.id);
            this.notify(record, "eDownloadRemoved", { id: record.entry.id });
        };
        // A test instance cannot answer the native Save dialog; it saves into the profile's test folder.
        const testPath = testInstanceDownloadPath(record.entry.filename);
        if (record.entry.status === "cancelled" || record.entry.status === "failed") return; // ended while queued
        if (testPath) {
            record.targetPath = testPath;
            this.releaseHeldTransfer(record);
            if (record.transferDone) await this.finishDownloadMove(record, record.hostUrl ?? record.entry.url, record.referrerUrl ?? "");
            return;
        }
        try {
            const result = await withNativeDialog(parentWindow, "file", () => dialog.showSaveDialog(parentWindow, { defaultPath }));
            if (result.canceled || !result.filePath) { await removeUnselectedDownload(); return; }
            // A private session leaves no trace on disk, not even the folder it saved to.
            if (record.entry.privateOwnerId === undefined) rememberDirFromPick("save", result.filePath);
            record.targetPath = result.filePath;
            this.releaseHeldTransfer(record);
            if (record.transferDone) await this.finishDownloadMove(record, record.hostUrl ?? record.entry.url, record.referrerUrl ?? "");
        } catch (error) {
            console.warn("[downloads] Save dialog failed: " + errMessage(error));
            await removeUnselectedDownload();
        }
    }

    /** Resume a transfer paused at the temp limit, now that it has somewhere to go. */
    private releaseHeldTransfer(record: DownloadRecord): void {
        if (!record.heldForPath) return;
        record.heldForPath = false;
        if (record.item?.isPaused()) record.item.resume();
    }

    private trackDownload(item: DownloadItem, record: DownloadRecord, recordSource: boolean, referrerUrl: string): void {
        let lastProgressSent = 0;
        item.on("updated", (_event, state) => {
            if (state !== "progressing") return;
            record.entry.receivedBytes = item.getReceivedBytes();
            record.entry.totalBytes = item.getTotalBytes();
            if (!record.targetPath && !record.heldForPath && record.entry.receivedBytes >= UNCHOSEN_TEMP_LIMIT_BYTES) {
                record.heldForPath = true;
                item.pause();
            }
            const now = Date.now();
            if (now - lastProgressSent >= PROGRESS_THROTTLE_MS) {
                lastProgressSent = now;
                this.notify(record, "eDownloadProgress", {
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
                this.notify(record, "eDownloadAwaitingPath", {
                    id: record.entry.id, receivedBytes: record.entry.receivedBytes, totalBytes: record.entry.totalBytes,
                });
            } else if (state === "completed") {
                record.transferDone = true;
                void this.finishDownloadMove(record, record.hostUrl ?? "", referrerUrl);
            } else if (state === "cancelled") {
                record.entry.status = "cancelled";
                this.notify(record, "eDownloadFailed", { id: record.entry.id, error: "Cancelled" });
                void fs.promises.unlink(record.tempPath).catch((): void => undefined);
            } else {
                record.entry.status = "failed";
                record.entry.error = "Download interrupted";
                this.notify(record, "eDownloadFailed", { id: record.entry.id, error: record.entry.error });
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
            this.notify(record, "eDownloadCompleted", {
                id: record.entry.id, savePath, receivedBytes: record.entry.receivedBytes, totalBytes: record.entry.totalBytes,
            });
            this.persist();
        } catch (error) {
            record.entry.status = "failed";
            record.entry.error = "Failed to save download: " + errMessage(error);
            this.notify(record, "eDownloadFailed", { id: record.entry.id, error: record.entry.error });
            try { await fs.promises.unlink(record.tempPath); } catch { /* Best-effort cleanup. */ }
        }
    }

    private async cleanupTemporaryDownloads(): Promise<void> {
        const tempDirectory = path.join(app.getPath("temp"), TEMP_DOWNLOAD_FOLDER + (applicationProfileName() ? `-${applicationProfileName()}` : ""));
        try {
            const entries = await fs.promises.readdir(tempDirectory, { withFileTypes: true });
            await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith(".part"))
                .map(entry => fs.promises.unlink(path.join(tempDirectory, entry.name)).catch((): void => undefined)));
        } catch { /* The directory may not exist until the first download. */ }
    }

    private loadPersisted(): void {
        for (const entry of recentStore.loadSync().value) {
            this.downloads.set(entry.id, {
                entry,
                tempPath: "",
                transferDone: true,
                finishing: false,
            });
        }
    }

    /** Writes the last completed normal downloads; the viewer-less list never holds private ones. */
    private persist(): void {
        const completed = this.getDownloads().filter((download) => download.status === "completed").slice(0, MAX_PERSISTED);
        void recentStore.save(completed);
    }
}

export const downloadService = new DownloadService();
