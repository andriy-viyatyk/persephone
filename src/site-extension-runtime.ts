// Site-extension runtime (EPIC-120 PoC, US-1602). Built as a standalone IIFE and evaluated in a
// web page's main world ahead of a site-extension script, which publishes its AiVision model with
// `__persephoneSiteRuntime.expose(root)`. The site does not ship `ai-vision`; this bundle does.
import { AI_VISION_SCHEMA_VERSION, expose } from "ai-vision/remote";
import { createElements, highlightElement } from "ai-vision/dom";
import type { IAiElementDeclaration } from "ai-vision";
import { AI_VISION_HOST_SIGNAL } from "ai-vision";
import { validateSiteActions } from "./shared/site-extension-actions";
import type { SiteActionDefinition } from "./shared/site-extension-actions";

interface SiteRuntime {
    readonly schemaVersion: number;
    readonly expose: typeof expose;
    readonly onDispose: (callback: () => void) => void;
    readonly dispose: () => void;
    readonly setActions: (items: SiteActionDefinition[]) => void;
    readonly fetchText: (url: string) => Promise<string>;
    readonly resolveFetch: (response: { id: number; text?: string; error?: string }) => void;
    readonly invokeAction: (id: string) => Promise<string>;
    readonly createElements: (declarations: readonly IAiElementDeclaration[]) => ReturnType<typeof createElements>;
}

const target = window as unknown as { __persephoneSiteRuntime?: SiteRuntime };
if (!target.__persephoneSiteRuntime) {
    let remote: ReturnType<typeof expose> | undefined;
    const cleanups: Array<() => void> = [];
    let handlers = new Map<string, () => unknown>();
    let nextFetchId = 0;
    const fetches = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
    const publish = (items: unknown): void => {
        const signal = (window as unknown as Record<string, unknown>)[AI_VISION_HOST_SIGNAL];
        if (typeof signal === "function") signal(JSON.stringify({ type: "actions-published", items }));
    };
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
        setActions(items) {
            const validated = validateSiteActions(items, true);
            handlers = validated.handlers;
            publish(validated.items);
        },
        fetchText(url) {
            if (typeof url !== "string" || url.length > 4096) return Promise.reject(new Error("Invalid fetch URL"));
            if (fetches.size >= 4) return Promise.reject(new Error("Too many fetch requests"));
            const signal = (window as unknown as Record<string, unknown>)[AI_VISION_HOST_SIGNAL];
            if (typeof signal !== "function") return Promise.reject(new Error("Fetch is unavailable"));
            const id = ++nextFetchId;
            return new Promise<string>((resolve, reject) => {
                fetches.set(id, { resolve, reject });
                try { signal(JSON.stringify({ type: "fetch-request", id, url })); }
                catch { fetches.delete(id); reject(new Error("Fetch is unavailable")); }
            });
        },
        resolveFetch(response) {
            const pending = fetches.get(response.id);
            if (!pending) return;
            fetches.delete(response.id);
            if (typeof response.text === "string") pending.resolve(response.text);
            else pending.reject(new Error(response.error || "Fetch failed"));
        },
        async invokeAction(id) {
            const handler = handlers.get(id);
            if (!handler) throw new Error("Action is unavailable");
            let value: unknown;
            try { value = await handler(); } catch (error) {
                let message = "Action handler failed";
                try { message = (error instanceof Error ? error.message : String(error)).slice(0, 512); } catch { /* Use fallback. */ }
                throw new Error(message);
            }
            let estimatedBytes = 0;
            const limit = 2 * 1024 * 1024;
            const serialized = JSON.stringify(value, (key, part: unknown) => {
                if (key.length > limit) throw new Error("Action result is too large");
                estimatedBytes += key.length * 6 + 4;
                if (typeof part === "string") {
                    if (part.length > limit) throw new Error("Action result is too large");
                    estimatedBytes += new TextEncoder().encode(JSON.stringify(part)).byteLength;
                } else if (typeof part !== "object") estimatedBytes += 32;
                if (estimatedBytes > limit) throw new Error("Action result is too large");
                return part;
            });
            if (typeof serialized !== "string" || serialized.length > 2 * 1024 * 1024
                || new TextEncoder().encode(serialized).byteLength > 2 * 1024 * 1024) {
                throw new Error("Action result is too large or invalid");
            }
            return serialized;
        },
        dispose() {
            handlers.clear();
            for (const pending of fetches.values()) pending.reject(new Error("Fetch cancelled"));
            fetches.clear();
            const signal = (window as unknown as Record<string, unknown>)[AI_VISION_HOST_SIGNAL];
            if (typeof signal === "function") signal(JSON.stringify({ type: "fetch-cancel" }));
            publish([]);
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
