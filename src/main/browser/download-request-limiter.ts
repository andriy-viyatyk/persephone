import type { WebContents } from "electron";
import type { UserActivation } from "./user-activation";

interface PageDownloads {
    usedFreeDownload: boolean;
    notified: boolean;
}

/**
 * Decides whether a browser page may start a download (Chrome's "automatic downloads" rule).
 *
 * A document may start one download on its own; every further one needs a fresh user gesture in the
 * page, consumed by that download. The allowance resets when the tab commits a new document. A blocked
 * attempt is reported to the user once per document.
 */
export class DownloadRequestLimiter {
    private readonly pages = new WeakMap<WebContents, PageDownloads>();

    allow(contents: WebContents, activation: UserActivation): boolean {
        const page = this.page(contents);
        if (!activation.consume() && page.usedFreeDownload) return false;
        page.usedFreeDownload = true;
        return true;
    }

    /** True for the first blocked download of the current document. */
    shouldNotify(contents: WebContents): boolean {
        const page = this.page(contents);
        if (page.notified) return false;
        page.notified = true;
        return true;
    }

    private page(contents: WebContents): PageDownloads {
        let page = this.pages.get(contents);
        if (!page) {
            const state: PageDownloads = { usedFreeDownload: false, notified: false };
            page = state;
            this.pages.set(contents, state);
            contents.on("did-navigate", () => {
                state.usedFreeDownload = false;
                state.notified = false;
            });
        }
        return page;
    }
}

export const downloadRequestLimiter = new DownloadRequestLimiter();
