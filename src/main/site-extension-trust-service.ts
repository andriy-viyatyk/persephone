import { isValidSiteExtensionId, isExactSiteExtensionHost } from "../shared/site-extension-validation";
import { validateSiteExtensionFetchHosts } from "../shared/site-extension-hosts";
import path from "node:path";
import type { SiteExtensionTrustSnapshot } from "../ipc/api-types";
import { EventEndpoint } from "../ipc/api-types";
import { openWindows } from "./open-windows";
import { SerialQueue } from "../shared/serial-queue";
import { JsonFileStore } from "./json-file-store";

interface SiteExtensionTrustFile { version: 1; folder?: string; extensions: SiteExtensionTrustSnapshot }

/** Folder identity for comparison: Windows paths are case-insensitive. */
function folderKey(folder: string): string {
    const resolved = path.resolve(folder);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function parseTrustFile(parsed: unknown): SiteExtensionTrustFile {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid site extension trust file.");
    const root = parsed as { version?: unknown; folder?: unknown; extensions?: unknown };
    if (root.version !== 1 || !root.extensions || typeof root.extensions !== "object" || Array.isArray(root.extensions)
        || (root.folder !== undefined && (typeof root.folder !== "string" || !path.isAbsolute(root.folder)))) {
        throw new Error("Invalid site extension trust file.");
    }
    const snapshot: SiteExtensionTrustSnapshot = {};
    for (const [id, raw] of Object.entries(root.extensions)) {
        if (!isValidSiteExtensionId(id) || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid site extension trust record.");
        const record = raw as { hosts?: unknown; fetchHosts?: unknown; enabled?: unknown };
        if (!Array.isArray(record.hosts) || record.hosts.length === 0 || !record.hosts.every(isExactSiteExtensionHost)
            || typeof record.enabled !== "boolean") throw new Error("Invalid site extension trust record.");
        const fetchHosts = validateSiteExtensionFetchHosts(record.fetchHosts === undefined ? [] : record.fetchHosts);
        if (!fetchHosts) throw new Error("Invalid site extension trust record.");
        snapshot[id] = { hosts: [...new Set(record.hosts)].sort(), fetchHosts: fetchHosts.sort(), enabled: record.enabled };
    }
    return { version: 1, folder: root.folder as string | undefined, extensions: snapshot };
}

const trustStore = new JsonFileStore<SiteExtensionTrustFile>("trustedSiteExtensions.json", {
    validate: parseTrustFile,
    defaultValue: () => ({ version: 1, extensions: {} }),
});

class SiteExtensionTrustService {
    private snapshot: SiteExtensionTrustSnapshot = {};
    private readonly listeners = new Set<() => void>();
    onChange(listener: () => void): void { this.listeners.add(listener); }
    /** The site extensions folder the grants were made in. Grants never carry over to another folder. */
    private folder: string | undefined;
    private initialization: Promise<void> | undefined;
    private readonly queue = new SerialQueue();

    init(): Promise<void> {
        this.initialization ??= this.queue.run(async () => {
            const { value } = await trustStore.load();
            this.folder = value.folder;
            this.snapshot = value.extensions;
        });
        return this.initialization;
    }

    async getSnapshot(): Promise<SiteExtensionTrustSnapshot> { await this.init(); return this.copy(); }
    /**
     * Records the folder the renderer reads extensions from. A different folder drops every grant,
     * so an extension there is trusted again. A file written before folders were recorded
     *  adopts the first folder it is bound to.
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
    async trust(id: string, hosts: string[], fetchHosts: string[], folder: string): Promise<SiteExtensionTrustSnapshot> {
        await this.init();
        return this.mutate((next) => {
            this.validateInput(id, hosts);
            const validatedFetchHosts = validateSiteExtensionFetchHosts(fetchHosts);
            if (!validatedFetchHosts) throw new Error("Invalid site extension fetch host list.");
            if (this.folder === undefined || typeof folder !== "string" || folderKey(folder) !== folderKey(this.folder)) {
                throw new Error("The site extensions folder changed. Reload the page and trust the extension again.");
            }
            next[id] = { hosts: [...new Set(hosts)].sort(), fetchHosts: validatedFetchHosts.sort(), enabled: true };
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
        return this.queue.run(async () => {
            const next = this.copy();
            if (change(next) === false) return this.copy();
            // Read the folder inside the queue: a bind queued earlier may have changed it.
            const nextFolder = folder ?? this.folder;
            await trustStore.save({ version: 1, folder: nextFolder, extensions: next });
            this.snapshot = next;
            this.folder = nextFolder;
            for (const listener of this.listeners) listener();
            const snapshot = this.copy();
            openWindows.send(EventEndpoint.eSiteExtensionTrustChanged, snapshot);
            return snapshot;
        });
    }

    private validateInput(id: string, hosts: string[]): void {
        if (typeof id !== "string" || !isValidSiteExtensionId(id)) throw new Error("Invalid site extension id.");
        if (!Array.isArray(hosts) || hosts.length === 0 || !hosts.every(isExactSiteExtensionHost)) throw new Error("Invalid site extension host list.");
    }
    private copy(): SiteExtensionTrustSnapshot {
        return Object.fromEntries(Object.entries(this.snapshot).map(([id, grant]) => [id, { hosts: [...grant.hosts], fetchHosts: [...grant.fetchHosts], enabled: grant.enabled }]));
    }
}

export const siteExtensionTrustService = new SiteExtensionTrustService();
