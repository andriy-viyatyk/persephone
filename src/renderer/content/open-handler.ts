import { app } from "../api/app";
import { pages } from "../api/pages";
import { createPageOpenRequest } from "../api/pages/open-request";

/**
 * Register Layer 3 handler on openContent.
 *
 * Passes the pipe to the page model via openFile(filePath, pipe).
 * The page owns the pipe and uses it for all content I/O.
 *
 * Call during app bootstrap, before scripts load. App bootstrap owns this
 * process-lifetime handler; it is not a view/model resource.
 */
export function registerOpenHandler(): void {
    app.events.openContent.subscribe(async (data) => {
        const filePath = data.pipe.logicalPath;
        const pageId = data.pageId;
        const request = createPageOpenRequest(data, filePath);

        if (pageId) {
            // Navigate existing page to the new file — pass pipe through
            // On success the page owns the pipe; on error we must dispose it
            try {
                const navigated = await pages.lifecycle.navigatePageTo(pageId, filePath, {
                    ...request,
                    pipe: data.pipe,
                });
                if (!navigated || data.folderPath !== undefined) data.pipe.dispose();
            } catch (err) {
                data.pipe.dispose();
                throw err;
            }
        } else {
            // Open file in new or existing tab — pass pipe through
            // On success the page owns the pipe; on error we must dispose it
            try {
                const page = await pages.lifecycle.openFile(filePath, data.pipe, request);
                if (page && (data.waitForPageReady || data.sourceId === "app-api")) {
                    await page.restore.ready;
                }
            } catch (err) {
                data.pipe.dispose();
                throw err;
            }
        }

        data.handled = true;
    });
}
