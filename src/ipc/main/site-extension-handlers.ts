import { fetchSiteExtensionText, cancelSiteExtensionFetches } from "../../main/site-extension-fetch-service";
import { Endpoint } from "../api-types";
import { siteExtensionTrustService } from "../../main/site-extension-trust-service";
import { bindEndpoint } from "./endpoint-registry";

export type SiteExtensionEndpoint =
    | Endpoint.fetchSiteExtensionText
    | Endpoint.cancelSiteExtensionFetches
    | Endpoint.getSiteExtensionTrust
    | Endpoint.bindSiteExtensionFolder
    | Endpoint.trustSiteExtension
    | Endpoint.revokeSiteExtensionTrust
    | Endpoint.setSiteExtensionEnabled;

export function initSiteExtensionHandlers(): void {
    bindEndpoint(Endpoint.fetchSiteExtensionText, (event, tab, id, url) => fetchSiteExtensionText(event.sender.id, tab, id, url));
    bindEndpoint(Endpoint.cancelSiteExtensionFetches, async (event, tab) => cancelSiteExtensionFetches(event.sender.id, tab));
    bindEndpoint(Endpoint.getSiteExtensionTrust, () => siteExtensionTrustService.getSnapshot());
    bindEndpoint(Endpoint.bindSiteExtensionFolder, (_event, folder: string) => siteExtensionTrustService.bindFolder(folder));
    bindEndpoint(Endpoint.trustSiteExtension, (_event, id: string, hosts: string[], fetchHosts: string[], folder: string) => siteExtensionTrustService.trust(id, hosts, fetchHosts, folder));
    bindEndpoint(Endpoint.revokeSiteExtensionTrust, (_event, id: string) => siteExtensionTrustService.revoke(id));
    bindEndpoint(Endpoint.setSiteExtensionEnabled, (_event, id: string, enabled: boolean) => siteExtensionTrustService.setEnabled(id, enabled));
}
