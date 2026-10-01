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
import { withNativeDialogSync } from "./native-dialog-tracker";
import { isRegisteredBrowserWebContents } from "./browser-service";
import { registerSessionSource } from "./session-src-protocol";
import { browserNetworkService } from "./browser-network-service";
import { torService } from "./tor-service";

const PERSIST_FILE = "recentDownloads.json";
const MAX_PERSISTED = 5;
const PROGRESS_THROTTLE_MS = 500;

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
    private downloads = new Map<string, { entry: DownloadEntry; item?: DownloadItem }>();
    private hookedSessions = new WeakSet<Session>();
    private idCounter = 0;
    private browserUrlMaskClaims: BrowserUrlMaskClaim[] = [];

    init(): void {
        this.loadPersisted();
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
        if (dl?.entry.savePath) {
            shell.showItemInFolder(dl.entry.savePath);
        }
    }

    clearCompleted(): void {
        for (const [id, dl] of this.downloads) {
            if (dl.entry.status !== "downloading") {
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
            // A proxied profile is persistent but must not hand the board a direct fetch (US-1557).
            const sessionHandle = torPartition
                || !webContents.session.isPersistent()
                || browserNetworkService.isProxiedSession(webContents.session)
                ? registerSessionSource(webContents.session, url, torPartition)
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
        let lastProgressSent = 0;
        // The downloading page — DownloadItem has no referrer getter. A Tor download keeps the
        // mark but records no source (US-1592).
        const recordSource = !torService.findActivePartitionForSession(webContents.session);
        const referrerUrl = recordSource && !webContents.isDestroyed() ? webContents.getURL() : "";

        // Show our own save dialog to reliably capture the save path.
        // Electron's getSavePath() returns empty for webview session downloads.
        const parentWindow = this.getParentWindow(webContents);
        // Downloads share the app-wide "save" folder memory: the Downloads folder is only the
        // starting point until the user has saved somewhere, after which that folder wins.
        // The dialog stays sync here — see dialog-folder-memory.ts for why that rules out the
        // shared handlers in ipc/main/dialog-handlers.
        const defaultPath = resolveDefaultPath({
            kind: "save",
            defaultPath: item.getFilename(),
            location: "downloads",
        });

        const savePath = withNativeDialogSync(parentWindow, "file", () => dialog.showSaveDialogSync(
            parentWindow,
            { defaultPath },
        ));

        if (!savePath) {
            item.cancel();
            return;
        }

        rememberDirFromPick("save", savePath);
        item.setSavePath(savePath);

        const entry: DownloadEntry = {
            id,
            filename: path.basename(savePath),
            url: item.getURL(),
            savePath,
            totalBytes: item.getTotalBytes(),
            receivedBytes: 0,
            status: "downloading",
            startTime: Date.now(),
        };

        this.downloads.set(id, { entry, item });
        openWindows.send(EventEndpoint.eDownloadStarted, { ...entry });

        item.on("updated", (_event, state) => {
            if (state === "progressing") {
                entry.receivedBytes = item.getReceivedBytes();
                entry.totalBytes = item.getTotalBytes();

                const now = Date.now();
                if (now - lastProgressSent >= PROGRESS_THROTTLE_MS) {
                    lastProgressSent = now;
                    openWindows.send(EventEndpoint.eDownloadProgress, {
                        id,
                        receivedBytes: entry.receivedBytes,
                        totalBytes: entry.totalBytes,
                    });
                }
            }
        });

        item.on("done", (_event, state) => {
            entry.receivedBytes = item.getReceivedBytes();
            entry.totalBytes = item.getTotalBytes();

            if (state === "completed") {
                entry.status = "completed";
                const hostUrl = recordSource ? (item.getURLChain().at(-1) ?? item.getURL()) : "";
                // Mark before announcing, so an immediate "Open" already sees the mark.
                void writeMarkOfTheWeb(savePath, hostUrl, referrerUrl).finally(() => {
                    openWindows.send(EventEndpoint.eDownloadCompleted, { id, savePath: entry.savePath });
                });
            } else if (state === "cancelled") {
                entry.status = "cancelled";
                openWindows.send(EventEndpoint.eDownloadFailed, { id, error: "Cancelled" });
            } else {
                entry.status = "failed";
                entry.error = "Download interrupted";
                openWindows.send(EventEndpoint.eDownloadFailed, { id, error: entry.error });
            }

            // Release DownloadItem reference
            const dl = this.downloads.get(id);
            if (dl) {
                dl.item = undefined;
            }

            this.persist();
        });
    }

    private loadPersisted(): void {
        try {
            const filePath = path.join(getDataFolder(), PERSIST_FILE);
            if (!fs.existsSync(filePath)) return;

            const data = fs.readFileSync(filePath, { encoding: "utf-8" });
            const entries: DownloadEntry[] = JSON.parse(data);
            for (const entry of entries) {
                this.downloads.set(entry.id, { entry });
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
