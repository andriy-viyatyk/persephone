import { app } from "../api/app";
import { pagesModel } from "../api/pages";
import { buildArchivePath } from "../core/utils/file-path";
import type { ISourceLink } from "../../shared/types";
import type { OpenContentEvent } from "../api/events/events";

/** Build a sourceLink descriptor from the final OpenContentEvent. */
function buildSourceLink(event: OpenContentEvent, filePath: string): ISourceLink {
    const result: ISourceLink = { url: filePath };

    // Keep non-default target
    if (event.target && event.target !== "monaco") {
        result.target = event.target;
    }

    // Clean metadata — remove ephemeral navigation-time fields
    if (event.metadata) {
        const cleaned: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(event.metadata)) {
            if (key === "pageId" || key === "revealLine" || key === "highlightText") continue;
            if (value !== undefined) cleaned[key] = value;
        }
        if (Object.keys(cleaned).length > 0) {
            result.metadata = cleaned;
        }
    }

    return result;
}

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
        // Reconstruct full file path from pipe (provider + transformers).
        // For archive pipes: FileProvider("C:/data.zip") + ArchiveTransformer("readme.txt")
        //   → "C:/data.zip!readme.txt"
        let filePath = event.pipe.provider.sourceUrl;
        const zipTransformer = event.pipe.transformers.find((t) => t.type === "archive");
        if (zipTransformer) {
            const entryPath = zipTransformer.config.entryPath as string | undefined;
            if (entryPath) {
                filePath = buildArchivePath(filePath, entryPath);
            }
        }
        const metadata = event.metadata;
        const pageId = metadata?.pageId;
        const sourceLink = buildSourceLink(event, filePath);

        if (pageId) {
            // Navigate existing page to the new file — pass pipe through
            // On success the page owns the pipe; on error we must dispose it
            try {
                await pagesModel.lifecycle.navigatePageTo(pageId, filePath, {
                    revealLine: metadata?.revealLine,
                    highlightText: metadata?.highlightText,
                    title: metadata?.title,
                    sourceLink,
                    pipe: event.pipe,
                    target: event.target,
                });
            } catch (err) {
                event.pipe.dispose();
                throw err;
            }
        } else {
            // Open file in new or existing tab — pass pipe through
            // On success the page owns the pipe; on error we must dispose it
            try {
                await pagesModel.lifecycle.openFile(filePath, event.pipe, { sourceLink });
            } catch (err) {
                event.pipe.dispose();
                throw err;
            }
        }

        event.handled = true;
    });
}
