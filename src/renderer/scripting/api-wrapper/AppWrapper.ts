import { app } from "../../api/app";
import { PageCollectionWrapper } from "./PageCollectionWrapper";

/**
 * Safe wrapper around App for script access.
 * Implements the IApp interface from api/types/app.d.ts.
 *
 * - Most sub-interfaces (settings, fs, ui, etc.) pass through directly —
 *   they are already safe (.d.ts hides internals like .use()).
 * - Only `pages` is wrapped (to return PageWrapper instances).
 */
export class AppWrapper {
    private readonly _pages: PageCollectionWrapper;

    constructor(releaseList: Array<() => void>) {
        this._pages = new PageCollectionWrapper(app.pages, releaseList);
    }

    get version() {
        return app.version;
    }

    get settings() {
        return app.settings;
    }

    get editors() {
        return app.editors;
    }

    get recent() {
        return app.recent;
    }

    get fs() {
        return app.fs;
    }

    get window() {
        return app.window;
    }

    get shell() {
        return app.shell;
    }

    get ui() {
        return app.ui;
    }

    get downloads() {
        return app.downloads;
    }

    get menuFolders() {
        return app.menuFolders;
    }

    get pages(): PageCollectionWrapper {
        return this._pages;
    }
}
