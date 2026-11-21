import { getNavigationScheme, getPageOpenAction } from "../../../shared/browser-navigation-policy";
import { t } from "../../../shared/i18n/t";
import { pages } from "../../api/pages";
import { ui } from "../../api/ui";
import { openPageSchemeCandidate, pageSchemeClaim, pageSchemeDecision, rememberPageSchemeDecision } from "../../content/page-scheme-handoff";
import { browserUrlChanged, type BrowserUrlEvent } from "../../core/state/events";
import type { BrowserEditor } from "./BrowserEditor";
import { originLabel } from "./url-display";

/**
 * Who asked to open a page-supplied URL: the user, through a context-menu item ("menu"), or the page
 * itself through `target=_blank` / `window.open` / its own navigation ("page"; already filtered and
 * gesture-checked in main — `BrowserPopupGate` for tabs, the consumed `UserActivation` for hand-offs).
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
            this.handOff(url, sourceTabId, origin);
            return;
        }
        if (action === "refuse") {
            if (origin === "menu") ui.notify(t("browser.pageUrlRefused"), "warning");
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

    /** A non-Chromium URL from the page: only a board-claimed scheme opens, and only once the user has
     *  allowed this page origin to hand that scheme to the board (asked in the prompt bar). */
    private handOff(url: string, sourceTabId: string, origin: PageLinkOrigin): void {
        const claim = pageSchemeClaim(url);
        if (!claim) {
            if (origin === "menu") ui.notify(t("browser.pageUrlRefused"), "warning");
            return;
        }
        const partition = this.model.partition;
        const pageOrigin = originLabel(this.model.findTab(sourceTabId)?.url ?? "");
        const decision = pageSchemeDecision(partition, pageOrigin, claim.scheme);
        if (decision === "allow") void openPageSchemeCandidate(url);
        if (decision) return;
        this.model.prompts.askBoardScheme(sourceTabId, pageOrigin, { ...claim, url }, (answer) => {
            rememberPageSchemeDecision(partition, pageOrigin, claim.scheme, answer);
            if (answer === "allow") void openPageSchemeCandidate(url);
        });
    }
}
