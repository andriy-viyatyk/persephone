import { Endpoint } from "../api-types";
import { siteExtensionTrustService } from "../../main/site-extension-trust-service";
import { bindEndpoint } from "./endpoint-registry";

export type SiteExtensionEndpoint =
    | Endpoint.getSiteExtensionTrust
    | Endpoint.trustSiteExtension
    | Endpoint.revokeSiteExtensionTrust
    | Endpoint.setSiteExtensionEnabled;

export function initSiteExtensionHandlers(): void {
    bindEndpoint(Endpoint.getSiteExtensionTrust, () => siteExtensionTrustService.getSnapshot());
    bindEndpoint(Endpoint.trustSiteExtension, (_event, id: string, hosts: string[]) => siteExtensionTrustService.trust(id, hosts));
    bindEndpoint(Endpoint.revokeSiteExtensionTrust, (_event, id: string) => siteExtensionTrustService.revoke(id));
    bindEndpoint(Endpoint.setSiteExtensionEnabled, (_event, id: string, enabled: boolean) => siteExtensionTrustService.setEnabled(id, enabled));
}
