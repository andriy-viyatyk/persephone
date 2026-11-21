import { getNavigationScheme, getPageOpenAction } from "../../../shared/browser-navigation-policy";
import { t } from "../../../shared/i18n/t";
import { globalPopupRateLimiter } from "../../../ipc/popup-rate-limiter";
import { pages } from "../../api/pages";
import { ui } from "../../api/ui";
import { openPageSchemeCandidate } from "../../content/page-scheme-handoff";
import { browserUrlChanged, type BrowserUrlEvent } from "../../core/state/events";
import type { BrowserEditor } from "./BrowserEditor";

/**
 * Who asked to open a page-supplied URL: the user, through a context-menu item ("menu"), or the page
 * itself through `target=_blank` / `window.open` ("page"; already filtered and handed off by main).
 */
export type PageLinkOrigin = "menu" | "page";

/**
 * Opens URLs that came from a web page's data — link targets and image sources — on the page's behalf.
 * They follow the page-open policy (`getPageOpenAction`), never the address-bar path, so a page cannot
 * open a local file or a `data:` document as a top-level tab. Trusted sources (address bar, restore,
 * scripts, bookmarks) use `BrowserEditor.navigate()` / `addTab()` directly.
 */
export class BrowserPageLinkOpener {
    constructor(private readonly model: BrowserEditor) {}

    /** Open a page-supplied link in a new internal tab, in the group of the tab it came from. */
    openLink(url: string, sourceTabId: string, origin: PageLinkOrigin): void {
        const action = getPageOpenAction(url);
        if (action === "handoff") {
            if (origin === "menu") void this.handOff(url);
            return;
        }
        if (action === "refuse") {
            if (origin === "menu") ui.notify(t("browser.pageUrlRefused"), "warning");
            return;
        }
        if (origin === "page" && !this.model.webview.popupsAllowed && !globalPopupRateLimiter.check("tabs")) {
            this.model.prompts.countBlockedPopup();
            return;
        }
        const parentTab = this.model.findTab(sourceTabId);
        const newInternalTabId = this.model.addTab(url, parentTab?.groupId);
        const event: BrowserUrlEvent = { url };
        browserUrlChanged.send(event);
        if (event.handled) this.model.tabs.closeTab(newInternalTabId);
    }

    /** Open a page-supplied image in the image viewer. The viewer draws it in the host, so `data:` images
     *  are fine; local sources are not the page's to open. */
    async openImage(srcURL: string): Promise<void> {
        if (getNavigationScheme(srcURL) === "blocked") {
            ui.notify(t("browser.pageUrlRefused"), "warning");
            return;
        }
        // A Tor/proxied page's image is read through its session.
        const sessionHandle = await this.model.network.sessionSource(srcURL);
        if (sessionHandle === null) {
            ui.notify(t("browser.secureRouteImageFailed"), "warning");
            return;
        }
        pages.openImageInNewTab(srcURL, undefined, sessionHandle);
    }

    private async handOff(url: string): Promise<void> {
        if (!(await openPageSchemeCandidate(url))) ui.notify(t("browser.pageUrlRefused"), "warning");
    }
}
