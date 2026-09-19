import { app } from "../api/app";
import { resolveEditorIdForFile } from "../editors/board/custom-editor-registry";
import { isArchivePath, parseArchivePath } from "../core/utils/file-path";
import { createPipeFromDescriptor } from "./registry";
import { dispatchRegisteredSchemeResolve } from "./scheme-registry";
import { openLinkInBrowser } from "./builtin-schemes";
import { resolveUrlToPipeDescriptor, isHttpUrl, toFileUrl } from "./link-utils";

function extractEffectivePath(url: string): string {
    if (isArchivePath(url)) return parseArchivePath(url).innerPath;
    if (isHttpUrl(url)) {
        try {
            const parsed = new URL(url);
            return parsed.pathname.split("/").pop() || "";
        } catch {
            return "";
        }
    }
    return url;
}

/** Register the Layer 2 file fallback and the registry-backed scheme dispatcher. */
export function registerResolvers(): void {
    // File resolver — fallback for plain files, archives, and virtual paths.
    app.events.openLink.subscribe(async (data) => {
        if (isHttpUrl(data.url)) return;

        // Explicit browser intent for a local path → open it in a browser instead of an editor.
        if (data.target === "browser" || data.browserMode) {
            data.url = toFileUrl(data.url);
            await openLinkInBrowser(data);
            data.handled = true;
            return;
        }

        // Directories open as an empty page with the Explorer panel, not as a content pipe.
        if (!data.url.includes("://") && !isArchivePath(data.url)) {
            const stat = await app.fs.stat(data.url);
            if (stat.isDirectory) {
                const { pagesModel } = await import("../api/pages");
                const folderPage = await pagesModel.addEmptyPageWithNavPanel(data.url);
                pagesModel.closeFirstPageIfEmpty();
                data.openedPageId = folderPage.id;
                data.handled = true;
                return;
            }
        }

        const pipeDescriptor = resolveUrlToPipeDescriptor(data.url);
        if (!pipeDescriptor) {
            // Virtual paths do not resolve to a real source but still need Layer 3 to create the
            // requested editor. The registry hooks use the same placeholder descriptor.
            if (data.url.includes("://")) {
                data.target ||= "monaco";
                data.pipeDescriptor = {
                    provider: { type: "file", config: { path: data.url } },
                    transformers: [],
                };
                data.pipe = createPipeFromDescriptor(data.pipeDescriptor);
                data.handled = false;
                await app.events.openContent.sendAsync(data);
                data.handled = true;
            }
            return;
        }

        data.target = data.target
            || resolveEditorIdForFile(data.url, extractEffectivePath(data.url))
            || "monaco";
        data.pipeDescriptor = pipeDescriptor;
        data.pipe = createPipeFromDescriptor(pipeDescriptor);
        data.handled = false;
        await app.events.openContent.sendAsync(data);
        data.handled = true;
    });

    // Registered schemes run before the file fallback and delegate to Layer 3 in open mode.
    app.events.openLink.subscribe(async (data) => {
        await dispatchRegisteredSchemeResolve(data, () => app.events.openContent.sendAsync(data));
    });
}
