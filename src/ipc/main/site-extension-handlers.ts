import { fetchSiteExtensionText, cancelSiteExtensionFetches } from "../../main/site-extension-fetch-service";
import { siteExtensionTrustService } from "../../main/site-extension-trust-service";
import type { SiteExtensionsApi } from "../contracts/site-extensions";
import { bindDomain } from "./endpoint-registry";



export function initSiteExtensionsHandlers(): void {
    bindDomain<SiteExtensionsApi>({
        fetchSiteExtensionText: (event, tab, id, url) => fetchSiteExtensionText(event.sender.id, tab, id, url),
        cancelSiteExtensionFetches: async (event, tab) => cancelSiteExtensionFetches(event.sender.id, tab),
        getSiteExtensionTrust: () => siteExtensionTrustService.getSnapshot(),
        bindSiteExtensionFolder: (_event, folder: string) => siteExtensionTrustService.bindFolder(folder),
        trustSiteExtension: (_event, id: string, hosts: string[], fetchHosts: string[], folder: string) =>
            siteExtensionTrustService.trust(id, hosts, fetchHosts, folder),
        revokeSiteExtensionTrust: (_event, id: string) => siteExtensionTrustService.revoke(id),
        setSiteExtensionEnabled: (_event, id: string, enabled: boolean) =>
            siteExtensionTrustService.setEnabled(id, enabled),
    });
}
