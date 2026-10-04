// Site-extension runtime (EPIC-120 PoC, US-1602). Built as a standalone IIFE and evaluated in a
// web page's main world ahead of a site-extension script, which publishes its AiVision model with
// `__persephoneSiteRuntime.expose(root)`. The site does not ship `ai-vision`; this bundle does.
import { AI_VISION_SCHEMA_VERSION, expose } from "ai-vision/remote";
import { createElements, highlightElement } from "ai-vision/dom";
import type { IAiElementDeclaration } from "ai-vision";

interface SiteRuntime {
    readonly schemaVersion: number;
    readonly expose: typeof expose;
    readonly onDispose: (callback: () => void) => void;
    readonly dispose: () => void;
    readonly createElements: (declarations: readonly IAiElementDeclaration[]) => ReturnType<typeof createElements>;
}

const target = window as unknown as { __persephoneSiteRuntime?: SiteRuntime };
if (!target.__persephoneSiteRuntime) {
    let remote: ReturnType<typeof expose> | undefined;
    const cleanups: Array<() => void> = [];
    const runtime: SiteRuntime = {
        schemaVersion: AI_VISION_SCHEMA_VERSION,
        expose(root) {
            remote?.dispose();
            remote = expose(root);
            return remote;
        },
        onDispose(callback) {
            cleanups.push(callback);
        },
        dispose() {
            for (const callback of cleanups.splice(0)) {
                try {
                    callback();
                } catch (error) {
                    console.warn("[site-extension] cleanup failed", error);
                }
            }
            remote?.dispose();
            remote = undefined;
        },
        createElements: (declarations: readonly IAiElementDeclaration[]) =>
            createElements(declarations, highlightElement),
    };
    target.__persephoneSiteRuntime = Object.freeze(runtime);
}
