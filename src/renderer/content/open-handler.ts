import { app } from "../api/app";
import { pagesModel } from "../api/pages";
import { buildArchivePath } from "../core/utils/file-path";
import { cleanForStorage } from "../../shared/link-data";
import { parseBoardEditorId } from "../editors/board/custom-editor-registry";
import {
    decodePersephoneBoardLink,
    PERSEPHONE_BOARD_PREFIX,
} from "./persephone-board-link";
import { isBoardSingleInstance, readBoardManifest } from "../editors/board/board-manifest";
import { errMessage } from "../../shared/utils";

function invokeLegacyIntent(boardRoot: string | undefined, intent: import("../../ipc/capability-bus-channels").IntentEnvelope | undefined): void {
    if (!boardRoot || !intent) return;
    void import("../api/capabilities")
        .then(({ invokeLegacyBoardIntent }) => invokeLegacyBoardIntent(boardRoot, intent))
        .catch((error: unknown) => {
            console.warn(`Legacy board intent failed: ${errMessage(error, "The capability request failed.")}`);
        });
}

function resolveBoardRoot(target: string | undefined, filePath: string): string | undefined {
    const boardRoot = target ? parseBoardEditorId(target) : null;
    if (boardRoot !== null) return boardRoot;
    if (target !== "board-view") return undefined;
    return decodePersephoneBoardLink(filePath)?.boardRoot;
}

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
        // Reconstruct full file path from pipe (provider + transformers).
        // For archive pipes: FileProvider("C:/data.zip") + ArchiveTransformer("readme.txt")
        //   → "C:/data.zip!readme.txt"
        let filePath = data.pipe.provider.sourceUrl;
        const zipTransformer = data.pipe.transformers.find((t) => t.type === "archive");
        if (zipTransformer) {
            const entryPath = zipTransformer.config.entryPath as string | undefined;
            if (entryPath) {
                filePath = buildArchivePath(filePath, entryPath);
            }
        }
        const pageId = data.pageId;
        const sourceLink = cleanForStorage(data);
        sourceLink.url = filePath;

        if (pageId) {
            const boardRoot = resolveBoardRoot(data.target, filePath);
            const manifest = boardRoot ? await readBoardManifest(boardRoot) : null;
            const existingPage = isBoardSingleInstance(manifest)
                ? pagesModel.findPageByBoardRoot(boardRoot)
                : undefined;
            if (existingPage) {
                pagesModel.navigation.showPage(existingPage.id);
                if (!sourceLink.url.startsWith(PERSEPHONE_BOARD_PREFIX)) {
                    const editor = existingPage.mainEditorInstance as {
                        enqueueSourceUrl?: (sourceUrl: string, sessionHandle?: string) => void;
                    } | null;
                    editor?.enqueueSourceUrl?.(sourceLink.url, data.sessionHandle);
                }
                data.pipe.dispose();
                data.handled = true;
                invokeLegacyIntent(boardRoot, data.intent);
                return;
            }
        }

        if (pageId) {
            // Navigate existing page to the new file — pass pipe through
            // On success the page owns the pipe; on error we must dispose it
            try {
                const navigated = await pagesModel.lifecycle.navigatePageTo(pageId, filePath, {
                    revealLine: data.revealLine,
                    highlightText: data.highlightText,
                    fragment: data.fragment,
                    title: data.title,
                    sourceLink,
                    pipe: data.pipe,
                    target: data.target,
                    folderPath: data.folderPath,
                    diffFrom: data.diffFrom,
                    diffTo: data.diffTo,
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
                const page = await pagesModel.lifecycle.openFile(filePath, data.pipe, {
                    sourceLink,
                    fragment: data.fragment,
                    target: data.target,
                    folderPath: data.folderPath,
                    diffFrom: data.diffFrom,
                    diffTo: data.diffTo,
                    sessionHandle: data.sessionHandle,
                });
                const title = data.title;
                if (page && title) {
                    page.mainEditor?.state.update((state) => {
                        state.title = title;
                    });
                }
            } catch (err) {
                data.pipe.dispose();
                throw err;
            }
        }

        data.handled = true;
        invokeLegacyIntent(resolveBoardRoot(data.target, filePath), data.intent);
    });
}
