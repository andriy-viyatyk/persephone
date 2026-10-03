import { fpJoin, fpRelative, fpResolve, fpSep } from "../core/utils/file-path";
import { fs } from "./fs";

const EXTENSION_ID_PATTERN = /^[a-z0-9-]+$/;
const MANIFEST_NAME = "manifest.json";

interface SiteExtensionManifest {
    name: string;
    version: string;
    description: string;
    hosts: string[];
    scriptPath: string;
}

interface CachedManifest {
    mtime: number;
    manifest?: SiteExtensionManifest;
    reason?: string;
}

export interface SiteExtensionRecord {
    id: string;
    name: string;
    version: string;
    description: string;
    hosts: string[];
    scriptPath: string;
}

export type SiteExtensionListing =
    | { id: string; status: "invalid"; reason: string }
    | (SiteExtensionRecord & { status: "valid" })
    | (SiteExtensionRecord & { status: "conflict"; conflictingHosts: string[] });

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isExactHostname(value: string): boolean {
    if (!value || value !== value.toLowerCase()) return false;
    try {
        const parsed = new URL(`https://${value}`);
        return parsed.hostname === value
            && parsed.port === ""
            && parsed.username === ""
            && parsed.password === ""
            && parsed.pathname === "/"
            && parsed.search === ""
            && parsed.hash === "";
    } catch {
        return false;
    }
}

function isAbsolutePath(value: string): boolean {
    return /^(?:[a-z]:[\\/]|[\\/]{1,2})/i.test(value);
}

function validateManifest(raw: unknown, extensionDir: string): SiteExtensionManifest | string {
    if (!isObject(raw)) return "manifest must be an object";
    if (!nonEmptyString(raw.name)) return "name must be a non-empty string";
    if (!nonEmptyString(raw.version)) return "version must be a non-empty string";
    if (!nonEmptyString(raw.description)) return "description must be a non-empty string";
    if (!Array.isArray(raw.hosts) || raw.hosts.length === 0) return "hosts must be a non-empty array";
    if (!raw.hosts.every((host): host is string => typeof host === "string" && isExactHostname(host))) {
        return "hosts must contain exact lower-case hostnames";
    }

    const script = raw.script === undefined ? "extension.js" : raw.script;
    if (!nonEmptyString(script)) return "script must be a non-empty relative path";
    if (isAbsolutePath(script)) return "script path must be relative";
    const scriptPath = fpResolve(extensionDir, script);
    const relativePath = fpRelative(extensionDir, scriptPath);
    if (relativePath === ".." || relativePath.startsWith(`..${fpSep}`) || isAbsolutePath(relativePath)) {
        return "script path must stay inside the extension folder";
    }

    return {
        name: raw.name,
        version: raw.version,
        description: raw.description,
        hosts: [...new Set(raw.hosts)],
        scriptPath,
    };
}

class SiteExtensionStore {
    private readonly manifestCache = new Map<string, CachedManifest>();
    private rootPromise: Promise<string> | undefined;

    private getRoot(): Promise<string> {
        this.rootPromise ??= fs.dataFileName("site-extensions");
        return this.rootPromise;
    }

    private async refresh(): Promise<{ listings: SiteExtensionListing[]; hostMap: Map<string, SiteExtensionRecord> }> {
        const root = await this.getRoot();
        const entries = await fs.listDirWithTypes(root);
        const directories = entries.filter((entry) => entry.isDirectory);
        const currentIds = new Set(directories.map(({ name }) => name));
        for (const id of this.manifestCache.keys()) {
            if (!currentIds.has(id)) this.manifestCache.delete(id);
        }

        const records: SiteExtensionRecord[] = [];
        const listings: SiteExtensionListing[] = [];
        for (const { name: id } of directories) {
            if (!EXTENSION_ID_PATTERN.test(id)) {
                listings.push({ id, status: "invalid", reason: "extension id must use lower-case letters, digits, or hyphens" });
                continue;
            }

            const extensionDir = fpJoin(root, id);
            const manifestPath = fpJoin(extensionDir, MANIFEST_NAME);
            let stat;
            try {
                stat = await fs.stat(manifestPath);
            } catch {
                listings.push({ id, status: "invalid", reason: "manifest could not be checked" });
                this.manifestCache.delete(id);
                continue;
            }
            if (!stat.exists) {
                listings.push({ id, status: "invalid", reason: "manifest not found" });
                this.manifestCache.delete(id);
                continue;
            }
            if (stat.isDirectory) {
                listings.push({ id, status: "invalid", reason: "manifest is not a file" });
                this.manifestCache.delete(id);
                continue;
            }

            let cached = this.manifestCache.get(id);
            if (!cached || cached.mtime !== stat.mtime) {
                try {
                    const source = await fs.read(manifestPath);
                    let parsed: unknown;
                    try {
                        parsed = JSON.parse(source) as unknown;
                    } catch {
                        cached = { mtime: stat.mtime, reason: "manifest is not valid JSON" };
                        this.manifestCache.set(id, cached);
                        listings.push({ id, status: "invalid", reason: cached.reason });
                        continue;
                    }
                    const result = validateManifest(parsed, extensionDir);
                    cached = typeof result === "string"
                        ? { mtime: stat.mtime, reason: result }
                        : { mtime: stat.mtime, manifest: result };
                    this.manifestCache.set(id, cached);
                } catch {
                    cached = { mtime: stat.mtime, reason: "manifest could not be read" };
                    this.manifestCache.set(id, cached);
                }
            }

            if (!cached.manifest) {
                listings.push({ id, status: "invalid", reason: cached.reason ?? "manifest is invalid" });
                continue;
            }

            let scriptStat;
            try {
                scriptStat = await fs.stat(cached.manifest.scriptPath);
            } catch {
                listings.push({ id, status: "invalid", reason: "script could not be checked" });
                continue;
            }
            if (!scriptStat.exists) {
                listings.push({ id, status: "invalid", reason: "script not found" });
                continue;
            }
            if (scriptStat.isDirectory) {
                listings.push({ id, status: "invalid", reason: "script is not a file" });
                continue;
            }

            records.push({ id, ...cached.manifest });
        }

        const owners = new Map<string, SiteExtensionRecord[]>();
        for (const record of records) {
            for (const host of record.hosts) {
                const hostOwners = owners.get(host) ?? [];
                hostOwners.push(record);
                owners.set(host, hostOwners);
            }
        }
        const conflicts = new Map<string, Set<string>>();
        const hostMap = new Map<string, SiteExtensionRecord>();
        for (const [host, hostOwners] of owners) {
            if (hostOwners.length > 1) {
                for (const record of hostOwners) {
                    const hosts = conflicts.get(record.id) ?? new Set<string>();
                    hosts.add(host);
                    conflicts.set(record.id, hosts);
                }
            } else {
                hostMap.set(host, hostOwners[0]);
            }
        }

        for (const record of records) {
            const conflictingHosts = conflicts.get(record.id);
            listings.push(conflictingHosts
                ? { ...record, status: "conflict", conflictingHosts: [...conflictingHosts].sort() }
                : { ...record, status: "valid" });
        }
        return { listings, hostMap };
    }

    /** Find a valid extension by exact HTTPS hostname, omitting conflicted hosts. */
    async findForHost(host: string): Promise<SiteExtensionRecord | undefined> {
        return (await this.refresh()).hostMap.get(host);
    }

    /** List every immediate extension directory and its current validation status. */
    async list(): Promise<SiteExtensionListing[]> {
        return (await this.refresh()).listings;
    }
}

export const siteExtensionStore = new SiteExtensionStore();
