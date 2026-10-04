import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SiteExtensionTrustSnapshot } from "../ipc/api-types";
import { EventEndpoint } from "../ipc/api-types";
import { openWindows } from "./open-windows";
import { getDataFolder } from "./utils";

const ID_PATTERN = /^[a-z0-9-]+$/;

function validHost(host: unknown): host is string {
    if (typeof host !== "string" || host !== host.toLowerCase()) return false;
    try {
        const url = new URL(`https://${host}`);
        return url.hostname === host && !url.port && url.pathname === "/" && !url.search && !url.hash;
    } catch { return false; }
}

/** Folder identity for comparison: Windows paths are case-insensitive. */
function folderKey(folder: string): string {
    const resolved = path.resolve(folder);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function parseTrustFile(text: string): { folder?: string; snapshot: SiteExtensionTrustSnapshot } {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid site extension trust file.");
    const root = parsed as { version?: unknown; folder?: unknown; extensions?: unknown };
    if (root.version !== 1 || !root.extensions || typeof root.extensions !== "object" || Array.isArray(root.extensions)
        || (root.folder !== undefined && (typeof root.folder !== "string" || !path.isAbsolute(root.folder)))) {
        throw new Error("Invalid site extension trust file.");
    }
    const snapshot: SiteExtensionTrustSnapshot = {};
    for (const [id, raw] of Object.entries(root.extensions)) {
        if (!ID_PATTERN.test(id) || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid site extension trust record.");
        const record = raw as { hosts?: unknown; enabled?: unknown };
        if (!Array.isArray(record.hosts) || record.hosts.length === 0 || !record.hosts.every(validHost)
            || typeof record.enabled !== "boolean") throw new Error("Invalid site extension trust record.");
        snapshot[id] = { hosts: [...new Set(record.hosts)].sort(), enabled: record.enabled };
    }
    return { folder: root.folder as string | undefined, snapshot };
}

class SiteExtensionTrustService {
    private snapshot: SiteExtensionTrustSnapshot = {};
    /** The site extensions folder the grants were made in. Grants never carry over to another folder. */
    private folder: string | undefined;
    private initialization: Promise<void> | undefined;
    private operation = Promise.resolve();

    init(): Promise<void> {
        this.initialization ??= this.serialize(async () => {
            const file = path.join(getDataFolder(), "trustedSiteExtensions.json");
            try { ({ folder: this.folder, snapshot: this.snapshot } = parseTrustFile(await fs.readFile(file, "utf8"))); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Site extension trust file is invalid; starting with no grants.");
                this.snapshot = {};
                this.folder = undefined;
            }
        });
        return this.initialization;
    }

    async getSnapshot(): Promise<SiteExtensionTrustSnapshot> { await this.init(); return this.copy(); }
    /**
     * Records the folder the renderer reads extensions from. A different folder drops every grant,
     * so an extension there is trusted again. A file written before folders were recorded
     * (US-1605) adopts the first folder it is bound to.
     */
    async bindFolder(folder: string): Promise<SiteExtensionTrustSnapshot> {
        await this.init();
        if (typeof folder !== "string" || !path.isAbsolute(folder)) throw new Error("Invalid site extensions folder.");
        return this.mutate((next) => {
            if (this.folder !== undefined && folderKey(this.folder) === folderKey(folder)) return false;
            if (this.folder !== undefined) for (const id of Object.keys(next)) delete next[id];
            return true;
        }, folder);
    }
    async trust(id: string, hosts: string[], folder: string): Promise<SiteExtensionTrustSnapshot> {
        await this.init();
        return this.mutate((next) => {
            this.validateInput(id, hosts);
            if (this.folder === undefined || typeof folder !== "string" || folderKey(folder) !== folderKey(this.folder)) {
                throw new Error("The site extensions folder changed. Reload the page and trust the extension again.");
            }
            next[id] = { hosts: [...new Set(hosts)].sort(), enabled: true };
        });
    }
    async revoke(id: string): Promise<SiteExtensionTrustSnapshot> {
        await this.init();
        return this.mutate((next) => { delete next[id]; });
    }
    async setEnabled(id: string, enabled: boolean): Promise<SiteExtensionTrustSnapshot> {
        await this.init();
        return this.mutate((next) => {
            if (typeof enabled !== "boolean") throw new Error("Enabled must be a boolean.");
            const grant = next[id];
            if (grant) grant.enabled = enabled;
        });
    }

    /** `change` returns false when nothing changed; then nothing is written or broadcast. */
    private async mutate(change: (next: SiteExtensionTrustSnapshot) => boolean | void, folder?: string): Promise<SiteExtensionTrustSnapshot> {
        return this.serialize(async () => {
            const next = this.copy();
            if (change(next) === false) return this.copy();
            // Read the folder inside the queue: a bind queued earlier may have changed it.
            const nextFolder = folder ?? this.folder;
            await this.writeAtomically(next, nextFolder);
            this.snapshot = next;
            this.folder = nextFolder;
            const snapshot = this.copy();
            openWindows.send(EventEndpoint.eSiteExtensionTrustChanged, snapshot);
            return snapshot;
        });
    }

    private validateInput(id: string, hosts: string[]): void {
        if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error("Invalid site extension id.");
        if (!Array.isArray(hosts) || hosts.length === 0 || !hosts.every(validHost)) throw new Error("Invalid site extension host list.");
    }
    private copy(): SiteExtensionTrustSnapshot {
        return Object.fromEntries(Object.entries(this.snapshot).map(([id, grant]) => [id, { hosts: [...grant.hosts], enabled: grant.enabled }]));
    }
    private serialize<T>(task: () => Promise<T>): Promise<T> {
        const result = this.operation.then(task, task);
        this.operation = result.then((): undefined => undefined, (): undefined => undefined);
        return result;
    }
    private async writeAtomically(snapshot: SiteExtensionTrustSnapshot, folder: string | undefined): Promise<void> {
        const directory = getDataFolder();
        await fs.mkdir(directory, { recursive: true });
        const destination = path.join(directory, "trustedSiteExtensions.json");
        const temporary = path.join(directory, `trustedSiteExtensions.${process.pid}.${randomUUID()}.tmp`);
        let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
        try {
            handle = await fs.open(temporary, "wx");
            await handle.writeFile(JSON.stringify({ version: 1, folder, extensions: snapshot }, null, 2), "utf8");
            await handle.close(); handle = undefined;
            await fs.rename(temporary, destination);
        } catch (error) {
            await handle?.close().catch((): undefined => undefined);
            await fs.rm(temporary, { force: true }).catch((): undefined => undefined);
            throw error;
        }
    }
}

export const siteExtensionTrustService = new SiteExtensionTrustService();
