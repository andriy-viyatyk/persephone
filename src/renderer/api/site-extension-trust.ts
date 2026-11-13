import type { SiteExtensionTrustSnapshot } from "../../ipc/api-types";
import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { MainSnapshotMirror } from "../core/state/MainSnapshotMirror";
import type { SiteExtensionRecord } from "./site-extensions";

function normalized(hosts: string[]): string[] { return [...new Set(hosts)].sort(); }
export function sameSiteExtensionHostSet(left: string[], right: string[]): boolean {
    return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

class SiteExtensionTrust extends MainSnapshotMirror<SiteExtensionTrustSnapshot> {
    private boundFolder: string | undefined;

    constructor() { super({}); }

    protected fetch(): Promise<SiteExtensionTrustSnapshot> { return api.getSiteExtensionTrust(); }
    protected subscribeToMain(): void {
        this.attach(rendererEvents["eSiteExtensionTrustChanged"], (snapshot) => this.apply(snapshot));
    }
    protected override normalize(snapshot: SiteExtensionTrustSnapshot): SiteExtensionTrustSnapshot {
        return Object.fromEntries(Object.entries(snapshot).map(([id, grant]) => [id, {
            hosts: [...grant.hosts],
            fetchHosts: [...grant.fetchHosts],
            enabled: grant.enabled,
        }]));
    }
    get(id: string) { return this.snapshot[id]; }

    isGranted(extension: SiteExtensionRecord): boolean;
    isGranted(extension: Pick<SiteExtensionRecord, "id" | "hosts" | "fetchHosts">): boolean;
    isGranted(extension: Pick<SiteExtensionRecord, "id" | "hosts" | "fetchHosts">): boolean {
        const grant = this.get(extension.id);
        return !!grant?.enabled && sameSiteExtensionHostSet(grant.hosts, extension.hosts)
            && sameSiteExtensionHostSet(grant.fetchHosts, extension.fetchHosts);
    }

    /** Tell main which folder extensions are read from; main drops every grant when it changes. */
    async bindFolder(folder: string): Promise<void> {
        this.apply(await api.bindSiteExtensionFolder(folder));
        this.boundFolder = folder;
    }
    async trust(id: string, hosts: string[], fetchHosts: string[]): Promise<void> {
        if (!this.boundFolder) throw new Error("The site extensions folder is not known yet.");
        this.apply(await api.trustSiteExtension(id, hosts, fetchHosts, this.boundFolder));
    }
    async revoke(id: string): Promise<void> { this.apply(await api.revokeSiteExtensionTrust(id)); }
    async setEnabled(id: string, enabled: boolean): Promise<void> { this.apply(await api.setSiteExtensionEnabled(id, enabled)); }
}

export const siteExtensionTrust = new SiteExtensionTrust();
