// Site-extension runtime (EPIC-120 PoC, US-1602). Built as a standalone IIFE and evaluated in a
// web page's main world ahead of a site-extension script, which publishes its AiVision model with
// `__persephoneSiteRuntime.expose(root)`. The site does not ship `ai-vision`; this bundle does.
import { AI_VISION_SCHEMA_VERSION, expose } from "ai-vision/remote";
import { createElements, highlightElement } from "ai-vision/dom";
import type { IAiElementDeclaration } from "ai-vision";

interface SiteRuntime {
    readonly schemaVersion: number;
    readonly expose: typeof expose;
    readonly createElements: (declarations: readonly IAiElementDeclaration[]) => ReturnType<typeof createElements>;
}

const target = window as unknown as { __persephoneSiteRuntime?: SiteRuntime };
if (!target.__persephoneSiteRuntime) {
    target.__persephoneSiteRuntime = Object.freeze({
        schemaVersion: AI_VISION_SCHEMA_VERSION,
        expose,
        createElements: (declarations: readonly IAiElementDeclaration[]) =>
            createElements(declarations, highlightElement),
    });
}
