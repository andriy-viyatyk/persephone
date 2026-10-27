import type { TranslationActivationMessage, TranslationFrameScope, TranslationResultMessage, TranslationUnit } from "../ipc/browser-translation-messages";

const { ipcRenderer } = require("electron");

// Keep frame work, scheduling distance, write cadence, and detection payloads bounded here.
const MAX_QUEUED_UNITS_PER_FRAME = 500;
const MAX_BATCH_ITEMS = 32;
const MAX_BATCH_CODE_POINTS = 64000;
const WRITE_BATCH_INTERVAL_MS = 25;
const NEAR_VIEWPORT_DISTANCE_PX = 1000;
const NEAR_VIEWPORT_ROOT_MARGIN = `${NEAR_VIEWPORT_DISTANCE_PX}px 0px`;
const MIN_DETECTION_SAMPLE_CHARS = 1000;
const MAX_DETECTION_SAMPLE_CHARS = 4096;
// The Translate board rejects a single HTML item over 8,192 UTF-16 code units; larger units are split into their children.
const MAX_HTML_UNIT_CODE_UNITS = 8000;

const BLOCK_SELECTOR = "address,article,blockquote,dd,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,li,main,nav,ol,p,pre,section,table,td,th,ul";
const SKIPPED_TAGS = new Set(["CODE", "KBD", "SAMP", "VAR", "MATH", "SCRIPT", "STYLE", "TEMPLATE", "TEXTAREA", "IFRAME", "NOSCRIPT", "EMBED", "OBJECT"]);
const ATTRIBUTE_NAMES = ["title", "alt", "aria-label", "aria-description"];
const ownOutput = new WeakMap<Element, Map<string, string>>();

interface UnitTarget { element: Element; attribute?: string; format: "html" | "text"; }
type TranslationResult = TranslationResultMessage["results"][number];
const TRANSLATION_ID_ATTRIBUTE = "data-persephone-translation-id";
// An HTML unit's restore record: every element's original child list and every text node's original value,
// so a translation that reordered inline elements can be put back exactly.
interface UnitLayout { children: Array<{ element: Element; nodes: ChildNode[] }>; texts: Array<{ node: Text; value: string }>; }
interface RestoreRecord { target: UnitTarget; original: string; written: string; layout?: UnitLayout; }

export function installPageTranslationAgent(): void {
    const documentToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const scope: TranslationFrameScope = { document: documentToken };
    const ids = new WeakMap<Element, string>();
    const revisions = new Map<string, number>();
    const targets = new Map<string, UnitTarget>();
    const restoreRecords = new Map<string, RestoreRecord>();
    const queued = new Map<string, TranslationUnit>();
    const pending = new Map<string, TranslationUnit>();
    const latestSource = new Map<string, string>();
    const shadowRoots = new Set<ShadowRoot>();
    const writeQueue: TranslationResult[] = [];
    const deferred = new Set<string>();
    const overflow: string[] = [];
    const keysByElement = new Map<Element, Set<string>>();
    let nextId = 0;
    let active = false;
    let sourceLanguage = "";
    let rootLanguage = "";
    let observer: MutationObserver | undefined;
    let visibility: IntersectionObserver | undefined;
    let emitTimer: ReturnType<typeof setTimeout> | undefined;
    let writeTimer: ReturnType<typeof setTimeout> | undefined;
    let writing = false;
    const isTopFrame = Boolean(process.isMainFrame);
    let pageHideHandler: (() => void) | undefined;

    const cachedOutput = (element: Element, key: string): string | undefined => ownOutput.get(element)?.get(key);
    const cacheOutput = (element: Element, key: string, value: string): void => {
        let values = ownOutput.get(element);
        if (!values) { values = new Map(); ownOutput.set(element, values); }
        values.set(key, value);
    };
    const stableId = (element: Element): string => {
        let id = ids.get(element);
        if (!id) { id = `u${++nextId}`; ids.set(element, id); }
        return id;
    };
    const primaryLanguage = (value: string): string => value.trim().split("-")[0].toLowerCase();
    // Whether this element itself (not its ancestors) excludes its subtree from translation.
    const isExcluded = (element: Element): boolean => {
        if (SKIPPED_TAGS.has(element.tagName) || element.hasAttribute("contenteditable") || element.getAttribute("translate")?.toLowerCase() === "no" || element.classList.contains("notranslate")) return true;
        if (element === document.documentElement) return false;
        const ownLanguage = element.getAttribute("lang");
        const expected = rootLanguage || primaryLanguage(sourceLanguage);
        return Boolean(ownLanguage && expected && primaryLanguage(ownLanguage) !== expected);
    };
    const isSkipped = (element: Element): boolean => {
        for (let current: Element | null = element; current; current = current.parentElement) if (isExcluded(current)) return true;
        return false;
    };
    const visibleTextSample = (): string => {
        const parts: string[] = [];
        let length = 0;
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
            acceptNode(node): number {
                const parent = node.parentElement;
                if (!parent || isSkipped(parent) || !node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
                const style = getComputedStyle(parent);
                return style.display === "none" || style.visibility === "hidden" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            },
        });
        let node: Node | null;
        while ((node = walker.nextNode()) && length < MAX_DETECTION_SAMPLE_CHARS) {
            const value = node.nodeValue || "";
            const remaining = MAX_DETECTION_SAMPLE_CHARS - length;
            parts.push(value.slice(0, remaining));
            length += Math.min(value.length, remaining);
        }
        return parts.join("").slice(0, MAX_DETECTION_SAMPLE_CHARS);
    };
    const sourceValue = (target: UnitTarget): string => {
        if (target.attribute) return target.element.getAttribute(target.attribute) || "";
        if (target.format === "text") return target.element.textContent || "";
        const originalElements = [target.element, ...Array.from(target.element.querySelectorAll("*"))];
        const clone = target.element.cloneNode(true) as Element;
        const clonedElements = [clone, ...Array.from(clone.querySelectorAll("*"))];
        for (let index = 1; index < clonedElements.length; index++) {
            const original = originalElements[index];
            const cloned = clonedElements[index];
            if (!original || !cloned) continue;
            // The model sees only our ids: page attributes (data blobs, titles in the source language) waste the
            // batch budget and disturb alignment. Excluded elements go as empty placeholders and are kept as-is.
            for (const name of cloned.getAttributeNames()) cloned.removeAttribute(name);
            cloned.setAttribute(TRANSLATION_ID_ATTRIBUTE, stableId(original));
            if (isExcluded(original)) cloned.replaceChildren();
        }
        return clone.innerHTML;
    };
    const cleanRequestText = (value: string): string => value.replace(/\u00ad/g, "").replace(/^(\s*)([\s\S]*?)(\s*)$/, (_match, leading: string, body: string, trailing: string) => `${leading}${body}${trailing}`);
    const preserveWhitespace = (original: string, translated: string): string => {
        const leading = original.match(/^\s*/)?.[0] || "";
        const trailing = original.match(/\s*$/)?.[0] || "";
        return `${leading}${translated.trim()}${trailing}`;
    };
    const priorityFor = (element: Element): TranslationUnit["priority"] => {
        const rect = element.getBoundingClientRect();
        // Hidden content (display:none, collapsed menus) has an empty box at the origin; it waits until it is shown.
        if (!rect.width && !rect.height) return "background";
        if (rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth) return "visible";
        if (rect.bottom >= -NEAR_VIEWPORT_DISTANCE_PX && rect.top <= window.innerHeight + NEAR_VIEWPORT_DISTANCE_PX) return "near";
        return "background";
    };
    const cancelKey = (key: string): void => { queued.delete(key); pending.delete(key); };
    const enqueue = (target: UnitTarget): void => {
        if (!active || isSkipped(target.element)) return;
        const key = `${target.attribute || target.format}:${stableId(target.element)}`;
        const original = sourceValue(target);
        const cacheKey = target.attribute || (target.format === "html" ? "innerHTML" : "textContent");
        if (cachedOutput(target.element, cacheKey) === original) return;
        const clean = cleanRequestText(original);
        if (target.format === "html" && !target.attribute && clean.length > MAX_HTML_UNIT_CODE_UNITS) {
            for (const child of Array.from(target.element.children)) enqueue({ element: child, format: child.children.length ? "html" : "text" });
            return;
        }
        const body = clean.trim();
        if (!body || body.length < 2) { cancelKey(key); return; }
        const previous = latestSource.get(key);
        const revision = (revisions.get(key) || 0) + (previous === original ? 0 : 1);
        revisions.set(key, Math.max(revision, 1));
        latestSource.set(key, original);
        targets.set(key, target);
        const unit: TranslationUnit = { key, revision: revisions.get(key)!, format: target.format, text: clean, priority: priorityFor(target.element) };
        let keys = keysByElement.get(target.element);
        if (!keys) { keys = new Set(); keysByElement.set(target.element, keys); }
        keys.add(key);
        visibility?.observe(target.element);
        // Units far from the viewport wait until the IntersectionObserver reports them near; nothing is dropped.
        if (unit.priority === "background") { deferred.add(key); queued.delete(key); pending.delete(key); return; }
        deferred.delete(key);
        queued.set(key, unit);
        pending.set(key, unit);
        if (queued.size > MAX_QUEUED_UNITS_PER_FRAME) {
            const rank = { visible: 0, near: 1, background: 2 };
            const farthest = [...queued.values()].sort((a, b) => rank[b.priority] - rank[a.priority]);
            // Over the cap, the farthest wait in a FIFO that refills the queue as it drains.
            for (const parked of farthest.slice(0, queued.size - MAX_QUEUED_UNITS_PER_FRAME)) { queued.delete(parked.key); pending.delete(parked.key); overflow.push(parked.key); }
        }
        if (!emitTimer) emitTimer = setTimeout(flushQueue, 0);
    };
    function flushQueue(): void {
        emitTimer = undefined;
        if (!active || !queued.size) return;
        const priority = { visible: 0, near: 1, background: 2 };
        const candidates = [...queued.values()].sort((a, b) => priority[a.priority] - priority[b.priority]);
        const items: TranslationUnit[] = [];
        let codePoints = 0;
        for (const item of candidates) {
            const itemCodePoints = Array.from(item.text).length;
            if (itemCodePoints > MAX_BATCH_CODE_POINTS) { queued.delete(item.key); pending.delete(item.key); continue; }
            if (items.length >= MAX_BATCH_ITEMS || codePoints + itemCodePoints > MAX_BATCH_CODE_POINTS) continue;
            items.push(item);
            codePoints += itemCodePoints;
        }
        if (!items.length) return;
        for (const item of items) queued.delete(item.key);
        while (overflow.length && queued.size < MAX_QUEUED_UNITS_PER_FRAME) {
            const target = targets.get(overflow.shift()!);
            if (target) enqueue(target);
        }
        ipcRenderer.sendToHost("translation-units", { scope, items });
        if (queued.size) emitTimer = setTimeout(flushQueue, 0);
    }
    const isBlock = (element: Element): boolean => element.matches(BLOCK_SELECTOR);
    const discoverElement = (element: Element): void => {
        if (isSkipped(element)) return;
        if (element.shadowRoot) discoverRoot(element.shadowRoot);
        if (isBlock(element)) {
            if (!element.querySelector(BLOCK_SELECTOR)) enqueue({ element, format: element.children.length ? "html" : "text" });
            // A block that contains blocks is subdivided: its inline child elements become units of their own.
            // Bare text directly inside such a block is not translated yet.
            else for (const child of Array.from(element.children)) {
                if (!isBlock(child) && !child.querySelector(BLOCK_SELECTOR)) enqueue({ element: child, format: child.children.length ? "html" : "text" });
            }
        }
        for (const name of ATTRIBUTE_NAMES) if (element.hasAttribute(name)) enqueue({ element, attribute: name, format: "text" });
        if (element instanceof HTMLInputElement) {
            if (element.hasAttribute("placeholder")) enqueue({ element, attribute: "placeholder", format: "text" });
            if (["button", "submit", "reset"].includes(element.type) && element.hasAttribute("value")) enqueue({ element, attribute: "value", format: "text" });
        }
    };
    const discoverRoot = (root: ParentNode): void => {
        root.querySelectorAll("*").forEach((element) => {
            discoverElement(element);
            if (element.shadowRoot) discoverRoot(element.shadowRoot);
        });
    };
    const observeRoot = (root: ParentNode): void => {
        if (!observer) return;
        if (root instanceof ShadowRoot) {
            shadowRoots.add(root);
        }
        observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    };
    const writeText = (element: Element, text: string): void => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) nodes.push(node as Text);
        if (!nodes.length) { element.insertBefore(document.createTextNode(text), element.firstChild); return; }
        nodes[0].nodeValue = text;
        for (const extra of nodes.slice(1)) extra.nodeValue = "";
    };
    // Compared by text for HTML units: attribute units inside them change innerHTML but not the text.
    const writtenValue = (target: UnitTarget): string | null => target.attribute ? target.element.getAttribute(target.attribute) : target.element.textContent;
    const captureLayout = (root: Element): UnitLayout => {
        const elements = [root, ...Array.from(root.querySelectorAll("*"))];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const texts: UnitLayout["texts"] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) texts.push({ node: node as Text, value: node.nodeValue || "" });
        return { children: elements.map((element) => ({ element, nodes: [...element.childNodes] })), texts };
    };
    // Rebuild each live element's children in the model's order, reusing the original element nodes (matched by
    // the clone-only ids) and the original text nodes, so page listeners and framework references survive.
    // Model elements are never inserted: one without a matching original contributes only its text.
    const mergeTranslatedHtml = (root: Element, translated: string): void => {
        const idMap = new Map<string, Element>();
        root.querySelectorAll("*").forEach((element) => idMap.set(stableId(element), element));
        const used = new Set<Element>();
        const template = document.createElement("template");
        template.innerHTML = translated;
        const mergeChildren = (live: Element, modelParent: ParentNode): void => {
            const spareTexts = [...live.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE) as Text[];
            const takeText = (value: string): Text => {
                const text = spareTexts.shift() || document.createTextNode("");
                text.nodeValue = value;
                return text;
            };
            const next: ChildNode[] = [];
            for (const child of [...modelParent.childNodes]) {
                if (child.nodeType === Node.TEXT_NODE) next.push(takeText(child.nodeValue || ""));
                else if (child instanceof Element) {
                    const id = child.getAttribute(TRANSLATION_ID_ATTRIBUTE);
                    const original = id ? idMap.get(id) : undefined;
                    if (original && !used.has(original) && !original.contains(live)) {
                        used.add(original);
                        if (!isExcluded(original)) mergeChildren(original, child);
                        next.push(original);
                    } else if (child.textContent) next.push(takeText(child.textContent));
                }
            }
            live.replaceChildren(...next);
        };
        mergeChildren(root, template.content);
    };
    const restoreLayout = (layout: UnitLayout): void => {
        for (const { element, nodes } of layout.children) element.replaceChildren(...nodes);
        for (const { node, value } of layout.texts) node.nodeValue = value;
    };
    const restore = (): void => {
        observer?.disconnect();
        writing = true;
        writeQueue.length = 0;
        if (writeTimer) { clearTimeout(writeTimer); writeTimer = undefined; }
        for (const record of restoreRecords.values()) {
            const { target, original, written } = record;
            if (writtenValue(target) !== written) continue;
            if (target.attribute) target.element.setAttribute(target.attribute, original);
            else if (record.layout) restoreLayout(record.layout);
            else writeText(target.element, original);
        }
        writing = false;
        restoreRecords.clear(); queued.clear(); pending.clear(); targets.clear(); latestSource.clear(); deferred.clear(); overflow.length = 0; keysByElement.clear();
        visibility?.disconnect(); visibility = undefined;
        observer = undefined;
        if (pageHideHandler) window.removeEventListener("pagehide", pageHideHandler);
        pageHideHandler = undefined;
    };
    const start = (message: TranslationActivationMessage): void => {
        active = true;
        sourceLanguage = message.from;
        rootLanguage = primaryLanguage(document.documentElement.getAttribute("lang") || "");
        visibility = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const element = entry.target as Element;
                const priority = priorityFor(element);
                for (const key of keysByElement.get(element) || []) {
                    const target = targets.get(key);
                    if (deferred.has(key)) { if (target && priority !== "background") enqueue(target); continue; }
                    const unit = queued.get(key);
                    if (unit) unit.priority = priority;
                }
            }
            if (queued.size) flushQueue();
        }, { rootMargin: NEAR_VIEWPORT_ROOT_MARGIN });
        observer = new MutationObserver((records) => {
            if (writing) return;
            for (const record of records) {
                const node = record.target;
                const observedElement = node instanceof Element ? node : node.parentElement;
                if (observedElement) {
                    const cacheKey = record.type === "childList" ? "innerHTML" : "textContent";
                    const cachedText = cachedOutput(observedElement, cacheKey);
                    const currentValue = cacheKey === "innerHTML" ? observedElement.innerHTML : observedElement.textContent || "";
                    if (cachedText !== undefined && cachedText === currentValue) continue;
                }
                if (record.type === "attributes" && record.target instanceof Element) {
                    const attr = record.attributeName;
                    if (!attr || ![...ATTRIBUTE_NAMES, "placeholder", "value"].includes(attr)) continue;
                    const key = `${attr}:${stableId(record.target)}`;
                    cancelKey(key); restoreRecords.delete(key);
                    if (attr !== "placeholder" && attr !== "value" && !ATTRIBUTE_NAMES.includes(attr)) continue;
                    if (attr === "placeholder" && !(record.target instanceof HTMLInputElement)) continue;
                    if (attr === "value" && (!(record.target instanceof HTMLInputElement) || !["button", "submit", "reset"].includes(record.target.type))) continue;
                    enqueue({ element: record.target, attribute: attr, format: "text" });
                } else {
                    if (record.type === "childList") {
                        for (const removed of record.removedNodes) {
                            const removedElement = removed instanceof Element ? removed : removed.parentElement;
                            if (!removedElement) continue;
                            for (const [key, target] of targets) if (target.element === removedElement || removedElement.contains(target.element)) {
                                cancelKey(key); restoreRecords.delete(key); targets.delete(key); latestSource.delete(key);
                            }
                        }
                    }
                    const element = node instanceof Element ? node : node.parentElement;
                    if (element) {
                        const block = element.closest(BLOCK_SELECTOR) || element;
                        for (const [key, target] of targets) if (target.element === block || block.contains(target.element)) { cancelKey(key); restoreRecords.delete(key); }
                        discoverElement(block);
                        block.querySelectorAll("*").forEach(discoverElement);
                    }
                }
            }
        });
        observeRoot(document.documentElement);
        discoverRoot(document);
        if (isTopFrame) {
            const sample = visibleTextSample();
            if (sample.length >= MIN_DETECTION_SAMPLE_CHARS) ipcRenderer.sendToHost("translation-detection-sample", { scope, lang: document.documentElement.getAttribute("lang") || "", text: sample.slice(0, MAX_DETECTION_SAMPLE_CHARS) });
        }
        pageHideHandler = () => { active = false; restore(); if (emitTimer) clearTimeout(emitTimer); if (writeTimer) clearTimeout(writeTimer); };
        window.addEventListener("pagehide", pageHideHandler, { once: true });
    };
    ipcRenderer.on("browser:translation-activate", (_event: unknown, message: TranslationActivationMessage) => {
        if (!message || typeof message.active !== "boolean" || typeof message.from !== "string" || typeof message.to !== "string") return;
        if (!message.active) { active = false; restore(); return; }
        if (active) restore();
        start(message);
    });
    const applyResult = (result: TranslationResult): void => {
        const unit = pending.get(result.key);
        const target = targets.get(result.key);
        if (!unit || !target || unit.revision !== result.revision) return;
        // A result without text is a completed failed item; release it without touching page content.
        if (typeof result.text !== "string") { pending.delete(result.key); return; }
        const original = target.attribute ? target.element.getAttribute(target.attribute) || "" : target.element.textContent || "";
        let layout: UnitLayout | undefined;
        if (target.attribute) target.element.setAttribute(target.attribute, preserveWhitespace(original, result.text));
        else if (target.format === "html") {
            layout = captureLayout(target.element);
            mergeTranslatedHtml(target.element, result.text);
        } else writeText(target.element, preserveWhitespace(original, result.text));
        const written = writtenValue(target) || "";
        restoreRecords.set(result.key, { target, original, written, layout });
        pending.delete(result.key);
        cacheOutput(target.element, target.attribute || (target.format === "html" ? "innerHTML" : "textContent"), target.attribute ? written : target.format === "html" ? target.element.innerHTML : written);
    };
    // Results are written in slices of WRITE_BATCH_INTERVAL_MS; whatever does not fit waits for the next slice.
    // Our own mutations are discarded with takeRecords(), so the observer stays connected for the page's changes.
    function flushWrites(): void {
        writeTimer = undefined;
        if (!active) { writeQueue.length = 0; return; }
        writing = true;
        const deadline = Date.now() + WRITE_BATCH_INTERVAL_MS;
        while (writeQueue.length && Date.now() <= deadline) applyResult(writeQueue.shift()!);
        observer?.takeRecords();
        writing = false;
        if (writeQueue.length) writeTimer = setTimeout(flushWrites, WRITE_BATCH_INTERVAL_MS);
    }
    ipcRenderer.on("browser:translation-result", (_event: unknown, message: TranslationResultMessage) => {
        if (!active || message?.scope?.document !== documentToken) return;
        writeQueue.push(...(message.results || []));
        if (!writeTimer) writeTimer = setTimeout(flushWrites, 0);
    });
    ipcRenderer.sendToHost("translation-ready", { scope });
}
