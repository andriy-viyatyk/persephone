import { Endpoint } from "../api-types";
import { siteExtensionTrustService } from "../../main/site-extension-trust-service";
import { bindEndpoint } from "./endpoint-registry";

export type SiteExtensionEndpoint =
    | Endpoint.getSiteExtensionTrust
    | Endpoint.bindSiteExtensionFolder
    | Endpoint.trustSiteExtension
    | Endpoint.revokeSiteExtensionTrust
    | Endpoint.setSiteExtensionEnabled;

export function initSiteExtensionHandlers(): void {
    bindEndpoint(Endpoint.getSiteExtensionTrust, () => siteExtensionTrustService.getSnapshot());
    bindEndpoint(Endpoint.bindSiteExtensionFolder, (_event, folder: string) => siteExtensionTrustService.bindFolder(folder));
    bindEndpoint(Endpoint.trustSiteExtension, (_event, id: string, hosts: string[], folder: string) => siteExtensionTrustService.trust(id, hosts, folder));
    bindEndpoint(Endpoint.revokeSiteExtensionTrust, (_event, id: string) => siteExtensionTrustService.revoke(id));
    bindEndpoint(Endpoint.setSiteExtensionEnabled, (_event, id: string, enabled: boolean) => siteExtensionTrustService.setEnabled(id, enabled));
}
