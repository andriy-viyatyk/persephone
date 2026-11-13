import { app } from "../api/app";
import { resolveEditorIdForFile } from "../api/boards/custom-editor-registry";
import { isArchivePath } from "../core/utils/file-path";
import { createPipeFromDescriptor } from "./registry";
import { dispatchRegisteredSchemeResolve } from "./scheme-registry";
import { runOpenStep } from "./open-actions/dispatch";
import { handoff } from "./link-handoff";
import {
    resolveUrlToPipeDescriptor,
    isHttpUrl,
    toFileUrl,
    effectivePathOf,
    virtualPipeDescriptor,
} from "./link-utils";

/** Register the Layer 2 file fallback and the registry-backed scheme dispatcher. */
export function registerResolvers(): void {
    // File resolver — fallback for plain files, archives, and virtual paths.
    app.events.openLink.subscribe(async (data) => runOpenStep(data, async () => {
        if (isHttpUrl(data.url)) return;

        // Explicit browser intent for a local path → open it in a browser instead of an editor.
        if (data.target === "browser" || data.browserMode) {
            data.url = toFileUrl(data.url);
            data.action = { kind: "browser" };
            return;
        }

        // Directories open as an empty page with the Explorer panel, not as a content pipe.
        if (!data.url.includes("://") && !isArchivePath(data.url)) {
            const stat = await app.fs.stat(data.url);
            if (stat.isDirectory) {
                data.action = { kind: "folder-page", path: data.url };
                return;
            }
        }

        const pipeDescriptor = resolveUrlToPipeDescriptor(data.url);
        if (!pipeDescriptor) {
            // Virtual paths do not resolve to a real source but still need Layer 3 to create the
            // requested editor. The registry hooks use the same placeholder descriptor.
            if (data.url.includes("://")) {
                data.target ||= "monaco";
                data.pipeDescriptor = virtualPipeDescriptor(data.url);
                data.pipe = createPipeFromDescriptor(data.pipeDescriptor);
                await handoff(data, () => app.events.openContent.sendAsync(data));
            }
            return;
        }

        data.target = data.target
            || resolveEditorIdForFile(data.url, effectivePathOf(data.url))
            || "monaco";
        data.pipeDescriptor = pipeDescriptor;
        data.pipe = createPipeFromDescriptor(pipeDescriptor);
        await handoff(data, () => app.events.openContent.sendAsync(data));
    }));

    // Registered schemes run before the file fallback and delegate to Layer 3 in open mode.
    app.events.openLink.subscribe(async (data) => runOpenStep(data, async () => {
        await dispatchRegisteredSchemeResolve(data, () => app.events.openContent.sendAsync(data));
    }));
}
