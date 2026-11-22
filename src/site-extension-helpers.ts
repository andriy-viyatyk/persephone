import { isVisibleElement, setNativeInputValue } from "./shared/automation-page-primitives";

const MAX_REF_ENTRIES = 10_000;
const REF_PADDING = "x".repeat(32);
const REF_PREFIX = "persephone-ref:";

export interface SiteExtensionHelpers {
    readonly publicApi: {
        ref(element: Element): { ref: string };
        visible(element: Element): boolean;
        accessibleName(element: Element): string;
        setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void;
        waitFor<T>(predicate: () => T | Promise<T>, options?: { timeout?: number; interval?: number }): Promise<Awaited<T>>;
        afterReturn(callback: () => void): void;
    };
    readonly lookupElement: (marker: string) => Element;
    readonly ownsRemote: (candidate: unknown) => boolean;
    readonly bindRemote: (remote: unknown) => void;
    readonly beginInvocation: () => number;
    readonly finishInvocation: (id: number, succeeded: boolean) => void;
    readonly dispose: () => void;
}

interface Invocation {
    readonly callbacks: Array<() => void>;
}

/** Owns page-model helpers and the temporary marker registry used by the host conversion path. */
export function createSiteExtensionHelpers(): SiteExtensionHelpers {
    const elements = new Map<number, WeakRef<Element>>();
    const invocations = new Map<number, Invocation>();
    const waits = new Set<() => void>();
    let nextRef = 0;
    let nextInvocation = 0;
    let exposedRemote: unknown;
    let disposed = false;

    const publicApi = {
        ref(element: Element): { ref: string } {
            if (!(element instanceof Element)) throw new TypeError("ref() requires an Element.");
            if (element.ownerDocument !== document) throw new Error("ref() only accepts elements from the main document.");
            if (!element.isConnected) throw new Error("ref() requires an element connected to the main document.");
            if (elements.size >= MAX_REF_ENTRIES) throw new Error(`The page model ref registry is full (maximum ${MAX_REF_ENTRIES}).`);
            if (!Number.isSafeInteger(nextRef) || nextRef >= Number.MAX_SAFE_INTEGER) throw new Error("The page model ref registry counter is exhausted.");
            const id = ++nextRef;
            elements.set(id, new WeakRef(element));
            return { ref: `${REF_PREFIX}${id}:${REF_PADDING}` };
        },
        visible(element: Element): boolean {
            if (!(element instanceof Element)) throw new TypeError("visible() requires an Element.");
            return isVisibleElement(element);
        },
        accessibleName(element: Element): string {
            if (!(element instanceof Element)) throw new TypeError("accessibleName() requires an Element.");
            return accessibleName(element);
        },
        setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
            if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
                throw new TypeError("setValue() supports only HTMLInputElement and HTMLTextAreaElement controls.");
            }
            if (typeof value !== "string") throw new TypeError("setValue() requires a string value.");
            setNativeInputValue(element, value);
        },
        waitFor<T>(predicate: () => T | Promise<T>, options: { timeout?: number; interval?: number } = {}): Promise<Awaited<T>> {
            if (typeof predicate !== "function") return Promise.reject(new TypeError("waitFor() requires a predicate function."));
            const timeout = options.timeout ?? 5000;
            const interval = options.interval ?? 100;
            if (!Number.isFinite(timeout) || timeout < 0) return Promise.reject(new RangeError("waitFor() timeout must be finite and nonnegative."));
            if (!Number.isFinite(interval) || interval <= 0) return Promise.reject(new RangeError("waitFor() interval must be finite and positive."));
            if (disposed) return Promise.reject(new Error("The site-extension runtime has been disposed."));
            return new Promise<Awaited<T>>((resolve, reject) => {
                let settled = false;
                const timers: { poll?: ReturnType<typeof setTimeout>; timeout?: ReturnType<typeof setTimeout> } = {};
                let cancel = (): void => undefined;
                const finish = (action: () => void): void => {
                    if (settled) return;
                    settled = true;
                    if (timers.poll !== undefined) clearTimeout(timers.poll);
                    if (timers.timeout !== undefined) clearTimeout(timers.timeout);
                    waits.delete(cancel);
                    action();
                };
                cancel = (): void => finish(() => reject(new Error("The site-extension runtime has been disposed.")));
                waits.add(cancel);
                const started = Date.now();
                const poll = async (): Promise<void> => {
                    try {
                        const result = await predicate();
                        if (settled) return;
                        if (result) {
                            finish(() => resolve(result as Awaited<T>));
                            return;
                        }
                    } catch (error) {
                        finish(() => reject(error));
                        return;
                    }
                    const elapsed = Date.now() - started;
                    if (elapsed >= timeout) {
                        finish(() => reject(new Error(`waitFor() timed out after ${timeout} ms.`)));
                        return;
                    }
                    timers.poll = setTimeout(() => { void poll(); }, interval);
                };
                timers.timeout = setTimeout(() => {
                    finish(() => reject(new Error(`waitFor() timed out after ${timeout} ms.`)));
                }, timeout);
                void poll();
            });
        },
        afterReturn(callback: () => void): void {
            if (typeof callback !== "function") throw new TypeError("afterReturn() requires a callback function.");
            if (invocations.size === 0) throw new Error("afterReturn can only be called during a model method call");
            if (invocations.size !== 1) throw new Error("afterReturn cannot be used while concurrent model method calls are in flight.");
            const invocation = invocations.values().next().value as Invocation | undefined;
            invocation?.callbacks.push(callback);
        },
    };

    return {
        publicApi,
        lookupElement(marker) {
            const match = /^persephone-ref:(\d+):x{32}$/.exec(marker);
            if (!match || match[0] !== marker) throw new Error("Invalid or expired page model ref marker.");
            const id = Number(match[1]);
            const reference = elements.get(id);
            elements.delete(id);
            const element = reference?.deref();
            if (!element) throw new Error("The page model ref marker is unknown, expired, or its element was collected.");
            return element;
        },
        ownsRemote(candidate) { return candidate === exposedRemote && candidate !== undefined; },
        bindRemote(remote) {
            if (exposedRemote !== undefined && exposedRemote !== remote) {
                elements.clear();
                invocations.clear();
            }
            exposedRemote = remote;
        },
        beginInvocation() {
            const id = ++nextInvocation;
            invocations.set(id, { callbacks: [] });
            return id;
        },
        finishInvocation(id, succeeded) {
            const invocation = invocations.get(id);
            if (!invocation) return;
            invocations.delete(id);
            if (succeeded && !disposed && invocation.callbacks.length) {
                setTimeout(() => {
                    for (const callback of invocation.callbacks) {
                        try { callback(); }
                        catch (error) { console.error("[site-extension] afterReturn callback failed", error); }
                    }
                }, 0);
            }
        },
        dispose() {
            disposed = true;
            elements.clear();
            exposedRemote = undefined;
            invocations.clear();
            for (const cancel of waits) cancel();
            waits.clear();
        },
    };
}

function accessibleName(element: Element): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
        const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() ?? "")
            .filter(Boolean).join(" ").trim();
        if (text) return text;
    }
    const ariaLabel = element.getAttribute("aria-label")?.trim();
    if (ariaLabel) return ariaLabel;

    const labelled = element as Element & { labels?: NodeListOf<HTMLLabelElement> | null; alt?: string };
    const labels = labelled.labels ? [...labelled.labels].map(label => label.textContent?.trim() ?? "").filter(Boolean).join(" ") : "";
    if (labels) return labels;
    if (typeof labelled.alt === "string" && labelled.alt.trim()) return labelled.alt.trim();
    if (element instanceof HTMLTableElement && element.caption?.textContent?.trim()) return element.caption.textContent.trim();
    if (element instanceof HTMLFieldSetElement && element.querySelector(":scope > legend")?.textContent?.trim()) {
        return element.querySelector(":scope > legend")?.textContent?.trim() ?? "";
    }

    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role")?.split(/\s+/)[0]
        ?? (tag === "button" || tag === "summary" ? "button"
            : tag === "a" && element.hasAttribute("href") ? "link"
                : /^h[1-6]$/.test(tag) ? "heading"
                    : tag === "option" ? "option"
                        : tag === "td" ? "cell" : tag === "th" ? "columnheader" : undefined);
    const allowsContent = ["button", "link", "heading", "option", "tab", "treeitem", "menuitem", "checkbox", "radio", "cell", "columnheader"];
    if (allowsContent.includes(role ?? "") || tag === "label") {
        const text = element.textContent?.trim();
        if (text) return text;
    }
    return element.getAttribute("title")?.trim() ?? "";
}
