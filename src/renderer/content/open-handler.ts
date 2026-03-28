import { app } from "../api/app";
import { pagesModel } from "../api/pages";

/**
 * Register Layer 3 handler on openContent.
 *
 * Passes the pipe to the page model via openFile(filePath, pipe).
 * The page owns the pipe and uses it for all content I/O.
 *
 * Call during app bootstrap, before scripts load.
 */
export function registerOpenHandler(): void {
    app.events.openContent.subscribe(async (event) => {
        const filePath = event.pipe.provider.sourceUrl;
        const metadata = event.metadata as Record<string, unknown> | undefined;
        const pageId = metadata?.pageId as string | undefined;

        if (pageId) {
            // Navigate existing page to the new file
            // navigatePageTo creates its own page model — always dispose this pipe
            try {
                await pagesModel.lifecycle.navigatePageTo(pageId, filePath, {
                    revealLine: metadata?.revealLine as number | undefined,
                    highlightText: metadata?.highlightText as string | undefined,
                });
            } finally {
                event.pipe.dispose();
            }
        } else {
            // Open file in new or existing tab — pass pipe through
            // On success the page owns the pipe; on error we must dispose it
            try {
                await pagesModel.lifecycle.openFile(filePath, event.pipe);
            } catch (err) {
                event.pipe.dispose();
                throw err;
            }
        }

        event.handled = true;
    });
}
