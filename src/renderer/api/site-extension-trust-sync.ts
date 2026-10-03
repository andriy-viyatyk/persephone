import { EventEndpoint } from "../../ipc/api-types";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { siteExtensionTrust } from "./site-extension-trust";

let initialized = false;
export function initSiteExtensionTrustSync(): void {
    if (initialized) return;
    initialized = true;
    rendererEvents[EventEndpoint.eSiteExtensionTrustChanged].subscribe((snapshot) => {
        siteExtensionTrust.applyAuthoritativeSnapshot(snapshot);
    });
}
