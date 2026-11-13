import type { EventObject } from "./event-object";

export interface SiteExtensionsApi {
    fetchSiteExtensionText: (tab: string, id: string, url: string) => Promise<{ text?: string; error?: string }>;
    cancelSiteExtensionFetches: (tab: string) => Promise<void>;
    getSiteExtensionTrust: () => Promise<SiteExtensionTrustSnapshot>;
    bindSiteExtensionFolder: (folder: string) => Promise<SiteExtensionTrustSnapshot>;
    trustSiteExtension: (
        id: string,
        hosts: string[],
        fetchHosts: string[],
        folder: string,
    ) => Promise<SiteExtensionTrustSnapshot>;
    revokeSiteExtensionTrust: (id: string) => Promise<SiteExtensionTrustSnapshot>;
    setSiteExtensionEnabled: (id: string, enabled: boolean) => Promise<SiteExtensionTrustSnapshot>;
}

export interface SiteExtensionsEvents {
    eSiteExtensionTrustChanged: EventObject<SiteExtensionTrustSnapshot>;
}

export interface SiteExtensionTrustGrant { hosts: string[]; fetchHosts: string[]; enabled: boolean }

export type SiteExtensionTrustSnapshot = Record<string, SiteExtensionTrustGrant>;

