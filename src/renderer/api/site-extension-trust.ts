import type { SiteExtensionTrustSnapshot } from "../../ipc/api-types";
import { api } from "../../ipc/renderer/api";
import { TGlobalState } from "../core/state/state";

function normalized(hosts: string[]): string[] { return [...new Set(hosts)].sort(); }
export function sameSiteExtensionHostSet(left: string[], right: string[]): boolean {
    return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

class SiteExtensionTrust {
    private readonly state = new TGlobalState<SiteExtensionTrustSnapshot>({});
    private loadPromise: Promise<void> | undefined;
    private revision = 0;
    private boundFolder: string | undefined;

    load(): Promise<void> {
        if (!this.loadPromise) {
            const revision = this.revision;
            this.loadPromise = api.getSiteExtensionTrust().then((snapshot) => {
                if (revision === this.revision) this.applyAuthoritativeSnapshot(snapshot);
            }).catch((error: unknown) => { this.loadPromise = undefined; throw error; });
        }
        return this.loadPromise;
    }
    get snapshot(): SiteExtensionTrustSnapshot { return this.state.get(); }
    get(id: string) { return this.state.get()[id]; }
    subscribe(callback: (snapshot: SiteExtensionTrustSnapshot) => void): () => void {
        return this.state.subscribe(() => callback(this.state.get()));
    }
    applyAuthoritativeSnapshot(snapshot: SiteExtensionTrustSnapshot): void {
        this.revision++;
        const copy = Object.fromEntries(Object.entries(snapshot).map(([id, grant]) => [id, { hosts: [...grant.hosts], enabled: grant.enabled }]));
        this.state.set(copy);
    }
    /** Tell main which folder extensions are read from; main drops every grant when it changes. */
    async bindFolder(folder: string): Promise<void> {
        this.applyAuthoritativeSnapshot(await api.bindSiteExtensionFolder(folder));
        this.boundFolder = folder;
    }
    async trust(id: string, hosts: string[]): Promise<void> {
        if (!this.boundFolder) throw new Error("The site extensions folder is not known yet.");
        this.applyAuthoritativeSnapshot(await api.trustSiteExtension(id, hosts, this.boundFolder));
    }
    async revoke(id: string): Promise<void> { this.applyAuthoritativeSnapshot(await api.revokeSiteExtensionTrust(id)); }
    async setEnabled(id: string, enabled: boolean): Promise<void> { this.applyAuthoritativeSnapshot(await api.setSiteExtensionEnabled(id, enabled)); }
}

export const siteExtensionTrust = new SiteExtensionTrust();
