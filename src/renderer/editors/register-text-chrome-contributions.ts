import { registerTextChromeContribution } from "./base/text-chrome-contributions";
import { HtmlResourcesButtonView } from "./html/HtmlResourcesButtonView";

export function registerTextChromeContributions(): void {
    registerTextChromeContribution({
        id: "html-resources",
        slot: "right-leading",
        createView: (host) => new HtmlResourcesButtonView({ host }),
    });
}
