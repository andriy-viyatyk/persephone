import { callOnRef, getRefSessionId } from "./ref";
import { errMessage } from "../../shared/utils";
import type { IAutomationTarget, IInputSession } from "./types";
import { FRAME_OFFSETS_FN, VISIBLE_FN } from "./page-scripts";
import { evaluateWithCandidates } from "./selector-execution";


export interface RefLocator {
    ref: string;
}

export interface SelectorLocator {
    selector: string;
}

interface LocatorRegex { regex: string; flags?: string }
interface LocatorModifiers {
    name?: string | LocatorRegex;
    exact?: boolean;
    within?: string | RefLocator | LocatorObject;
    hasText?: string;
    visible?: boolean;
    nth?: number;
}
export type LocatorObject = LocatorModifiers & (
    | { role: string; label?: never; placeholder?: never; testId?: never; title?: never; alt?: never; text?: never; selector?: never }
    | { label: string; role?: never; placeholder?: never; testId?: never; title?: never; alt?: never; text?: never; selector?: never }
    | { placeholder: string; role?: never; label?: never; testId?: never; title?: never; alt?: never; text?: never; selector?: never }
    | { testId: string; role?: never; label?: never; placeholder?: never; title?: never; alt?: never; text?: never; selector?: never }
    | { title: string; role?: never; label?: never; placeholder?: never; testId?: never; alt?: never; text?: never; selector?: never }
    | { alt: string; role?: never; label?: never; placeholder?: never; testId?: never; title?: never; text?: never; selector?: never }
    | { text: string; role?: never; label?: never; placeholder?: never; testId?: never; title?: never; alt?: never; selector?: never }
    | { selector: string; role?: never; label?: never; placeholder?: never; testId?: never; title?: never; alt?: never; text?: never }
);
export type LocatorInput = string | RefLocator | LocatorObject;

export type ElementLocator = RefLocator | SelectorLocator;

export interface MousePosition { x: number; y: number }
export type MouseModifier = "Alt" | "Control" | "Meta" | "Shift";
export interface MouseActionOptions {
    tabId?: string;
    position?: MousePosition;
    modifiers?: MouseModifier[];
    force?: boolean;
    synthetic?: boolean;
    nth?: number;
    timeout?: number;
}
export interface ClickActionOptions extends MouseActionOptions {
    button?: "left" | "right" | "middle";
    clickCount?: number;
    nativeMenu?: boolean;
}
export interface DragOptions {
    tabId?: string; position?: MousePosition; targetPosition?: MousePosition; modifiers?: MouseModifier[];
    force?: boolean; nth?: number; timeout?: number; steps?: number; holdMs?: number;
}

export interface ActionablePoint {
    x: number;
    y: number;
    width: number;
    height: number;
    description: string;
    locator: ElementLocator;
    cdp: IInputSession["cdp"];
    sessionId?: string;
}

const DEFAULT_ACTION_TIMEOUT = 5000;
const MAX_ACTION_TIMEOUT = 28000;
const RETRY_INTERVAL = 100;

function actionabilityFunction(): string {
    // hitTest=false (programmatic operations such as select) keeps the other checks but skips
    // the receives-pointer-events test: nothing is dispatched at a point.
    return `async function(resolve, selector, nth, force, position, hitTest = true) {
        const describe = el => {
            if (!el) return 'unknown element';
            const id = el.id ? '#' + el.id : '';
            const classes = typeof el.className === 'string' && el.className.trim()
                ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
            const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim().slice(0, 60);
            return '<' + el.localName + id + classes + '>' + (label ? ' ' + JSON.stringify(label) : '');
        };
        const displayed = el => { const style = getComputedStyle(el); return style.visibility !== 'hidden' && style.display !== 'none'; };
        let el = this;
        if (resolve !== null) {
            if (!force) {
                const allMatches = resolve('query');
                if (allMatches.length > 0 && !allMatches.some(displayed)) throw new Error('ACTIONABILITY_TRANSIENT: Element is not visible.');
            }
            const matches = resolve('action', { force });
            if (matches.length > 1 && nth == null)
                throw new Error('ACTIONABILITY_FATAL: Ambiguous selector ' + JSON.stringify(selector) + ': ' + matches.length + ' visible matches (' + matches.slice(0, 5).map((m, i) => i + ': ' + describe(m)).join('; ') + (matches.length > 5 ? '; …' : '') + '). Use a ref, narrow the selector, or pass { nth } (zero-based among visible matches).');
            if (nth != null && (!Number.isInteger(nth) || nth < 0))
                throw new Error('ACTIONABILITY_FATAL: { nth } must be a non-negative integer.');
            el = matches[nth ?? 0];
        }
        if (!el) throw new Error('ACTIONABILITY_TRANSIENT: Element not found.');
        if (!force) {
            if (!el.isConnected) throw new Error('ACTIONABILITY_TRANSIENT: Element is detached.');
            if (!displayed(el)) throw new Error('ACTIONABILITY_TRANSIENT: Element is not visible.');
            const beforeScroll = el.getBoundingClientRect();
            if (beforeScroll.top < 0 || beforeScroll.left < 0 || beforeScroll.bottom > innerHeight || beforeScroll.right > innerWidth) {
                el.scrollIntoView({ block: 'center', inline: 'center' });
            } else {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) throw new Error('ACTIONABILITY_TRANSIENT: Element has zero size.');
            const waitFrame = () => Promise.race([
                new Promise(resolve => requestAnimationFrame(resolve)),
                new Promise(resolve => setTimeout(resolve, 50)),
            ]);
            /* Stable means the same box for two consecutive frames: a CSS transition (the sidebar panel
               stack animates flex) can still sit at its start value one frame after the state change. */
            const sameBox = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
            const first = el.getBoundingClientRect();
            await waitFrame();
            if (!el.isConnected) throw new Error('ACTIONABILITY_TRANSIENT: Element is detached.');
            const second = el.getBoundingClientRect();
            await waitFrame();
            if (!el.isConnected) throw new Error('ACTIONABILITY_TRANSIENT: Element is detached.');
            const third = el.getBoundingClientRect();
            if (!sameBox(first, second) || !sameBox(second, third))
                throw new Error('ACTIONABILITY_TRANSIENT: Element is unstable.');
            if (el.disabled || el.getAttribute('aria-disabled') === 'true')
                throw new Error('ACTIONABILITY_TRANSIENT: Element is disabled.');
        }
        const bounds = el.getBoundingClientRect();
        const localX = position?.x ?? bounds.width / 2;
        const localY = position?.y ?? bounds.height / 2;
        if (!Number.isFinite(localX) || !Number.isFinite(localY) || localX < 0 || localY < 0 || localX > bounds.width || localY > bounds.height)
            throw new Error('ACTIONABILITY_FATAL: position must be inside the element border box.');
        if (!force && hitTest) {
            const x = localX + bounds.left, y = localY + bounds.top;
            let hit = document.elementFromPoint(x, y);
            /* A Persephone tooltip left open by the previous action is not an obstruction. Make it
               click-through and leave it so, or the trusted click itself would land on it; it
               closes on its own once the pointer leaves its trigger. */
            const tooltip = hit?.closest('[data-type="tooltip"]');
            if (tooltip) {
                tooltip.style.pointerEvents = 'none';
                hit = document.elementFromPoint(x, y);
            }
            while (hit?.shadowRoot?.elementFromPoint) {
                const inner = hit.shadowRoot.elementFromPoint(x, y);
                if (!inner || inner === hit) break;
                hit = inner;
            }
            let reaches = hit === el || el.contains(hit);
            let root = el.getRootNode();
            while (!reaches && root instanceof ShadowRoot) {
                reaches = root.host === hit || root.host.contains(hit);
                root = root.host.getRootNode();
            }
            if (!reaches) {
                /* Hit an ancestor: a scrolling ancestor clips the element although it is inside the
                   window (the window-only check above did not scroll). Scroll it into view; the retry
                   re-checks. */
                if (hit && hit.contains(el)) el.scrollIntoView({ block: 'center', inline: 'center' });
                let ancestor = el.parentNode;
                while (ancestor) {
                    const container = ancestor instanceof ShadowRoot ? ancestor.host : ancestor;
                    if (container instanceof Element) {
                        const style = getComputedStyle(container);
                        const rect = container.getBoundingClientRect();
                        const left = rect.left + container.clientLeft;
                        const top = rect.top + container.clientTop;
                        const right = left + container.clientWidth;
                        const bottom = top + container.clientHeight;
                        const clipsX = style.overflowX !== 'visible' && (x < left || x > right);
                        const clipsY = style.overflowY !== 'visible' && (y < top || y > bottom);
                        if (clipsX || clipsY) {
                            throw new Error('ACTIONABILITY_TRANSIENT: Element is clipped by ' + describe(container) + '.');
                        }
                    }
                    ancestor = container instanceof Element ? container.parentNode : null;
                }
                throw new Error('ACTIONABILITY_TRANSIENT: Element does not receive pointer events; covered by ' + describe(hit) + '.');
            }
        }
        const x = bounds.left + localX, y = bounds.top + localY;
        ${FRAME_OFFSETS_FN}
        return { x, y, frameOffsets, width: bounds.width, height: bounds.height, description: describe(el) };
    }`;
}

/** Resolve a locator and wait for the selected element to be actionable. */
export async function resolveActionablePoint(
    target: IAutomationTarget,
    locator: ElementLocator,
    options: MouseActionOptions & { hitTest?: boolean } = {},
): Promise<ActionablePoint> {
    const baseCdp = target.cdp(options.tabId);
    const sessionId = "ref" in locator ? getRefSessionId(baseCdp, locator.ref) : undefined;
    const input = target.inputCdp(options.tabId, sessionId);
    const timeout = Math.min(Math.max(0, options.timeout ?? DEFAULT_ACTION_TIMEOUT), MAX_ACTION_TIMEOUT);
    const deadline = Date.now() + timeout;
    let lastReason: string;
    while (true) {
        try {
            const result = "ref" in locator
                ? await callOnRef(baseCdp, locator.ref, `function() { return (${actionabilityFunction()}).call(this, null, null, null, ${Boolean(options.force)}, ${JSON.stringify(options.position ?? null)}, ${options.hitTest !== false}); }`, true)
                : await evaluateWithCandidates(input.cdp, locator.selector,
                    `(resolve) => (${actionabilityFunction()}).call(null, resolve, ${JSON.stringify(locator.selector)}, ${options.nth ?? "null"}, ${Boolean(options.force)}, ${JSON.stringify(options.position ?? null)}, ${options.hitTest !== false})`);
            const point = input.mapPoint({ x: result.x, y: result.y }, result.frameOffsets);
            return { ...result, ...point, locator, cdp: input.cdp, sessionId: input.sessionId };
        } catch (error: unknown) {
            const message = errMessage(error, "Mouse action failed.");
            if (message.includes("ACTIONABILITY_FATAL:")) throw new Error(message.replace("ACTIONABILITY_FATAL: ", ""), { cause: error });
            if (message.includes("ACTIONABILITY_TRANSIENT:")) {
                lastReason = message.replace("ACTIONABILITY_TRANSIENT: ", "");
            } else if ("ref" in locator && /stale|removed|detached|No node with given id/i.test(message)) {
                lastReason = "Element is detached.";
            } else {
                throw error;
            }
            if (Date.now() >= deadline) throw new Error(`Timed out after ${timeout} ms: ${lastReason}`, { cause: error });
            await new Promise(resolve => setTimeout(resolve, Math.min(RETRY_INTERVAL, deadline - Date.now())));
        }
    }
}

/** Resolve the explicit facade locator forms. Plain strings are always selectors. */
export function resolveElementLocator(value: string): SelectorLocator;
export function resolveElementLocator(value: unknown): ElementLocator;
export function resolveElementLocator(value: unknown): ElementLocator {
    if (typeof value === "string") return { selector: value };
    if (value && typeof value === "object"
        && typeof (value as { ref?: unknown }).ref === "string") {
        return { ref: (value as { ref: string }).ref };
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return { selector: compileLocatorObject(value as Record<string, unknown>, new Set()) };
    }
    throw new Error("Expected a selector string, { ref: string }, or a supported object locator.");
}

const LOCATOR_KEYS = ["role", "label", "placeholder", "testId", "title", "alt", "text", "selector"] as const;
const LOCATOR_MODIFIERS = ["name", "exact", "within", "hasText", "visible", "nth"] as const;
const LOCATOR_SUPPORTED = [...LOCATOR_KEYS, ...LOCATOR_MODIFIERS].join(", ");

function compileLocatorObject(value: Record<string, unknown>, ancestors: Set<object>): string {
    if (ancestors.has(value)) throw new Error("Object locator within contains a cycle.");
    ancestors.add(value);
    try {
        const keys = Object.keys(value);
        const unknown = keys.filter(key => !(LOCATOR_KEYS as readonly string[]).includes(key)
            && !(LOCATOR_MODIFIERS as readonly string[]).includes(key));
        if (unknown.length) throw new Error(`Unknown locator key "${unknown[0]}". Supported keys: ${LOCATOR_SUPPORTED}.`);
        const whatKeys = keys.filter(key => (LOCATOR_KEYS as readonly string[]).includes(key));
        if (whatKeys.length !== 1) throw new Error(`Object locator requires exactly one of: ${LOCATOR_KEYS.join(", ")}.`);
        const engine = whatKeys[0];
        const raw = value[engine];
        if (typeof raw !== "string" || !raw.length) throw new Error(`Locator ${engine} must be a non-empty string.`);
        if (value.name !== undefined && engine !== "role") throw new Error("Locator name is only supported with role.");
        if (value.exact !== undefined && typeof value.exact !== "boolean") throw new Error("Locator exact must be a boolean.");
        if (value.exact !== undefined && (engine === "selector" || engine === "testId" || (engine === "role" && value.name === undefined))) {
            throw new Error("Locator exact requires a role name or a label, placeholder, title, alt, or text value.");
        }
        if (engine === "role" && !/^[\w-]+$/.test(raw)) throw new Error("Locator role must match ^[\\w-]+$.");
        let ownStep: string;
        if (engine === "role") {
            let name = "";
            if (value.name !== undefined) {
                let encoded: string;
                if (typeof value.name === "string") encoded = JSON.stringify(value.name);
                else if (value.name && typeof value.name === "object" && !Array.isArray(value.name)) {
                    const regex = value.name as Record<string, unknown>;
                    if (Object.keys(regex).some(key => key !== "regex" && key !== "flags") || typeof regex.regex !== "string") {
                        throw new Error("Role name regex must be { regex: string, flags?: string }.");
                    }
                    if (value.exact !== undefined) throw new Error("Locator exact cannot be combined with a regex role name.");
                    const flags = regex.flags === undefined ? "" : regex.flags;
                    if (typeof flags !== "string" || /[^dgimsuvy]/.test(flags) || new Set(flags).size !== flags.length) {
                        throw new Error("Role name regex flags are invalid.");
                    }
                    try { new RegExp(regex.regex, flags); } catch { throw new Error("Role name regex is invalid."); }
                    encoded = `/${escapeRegexDelimiters(regex.regex)}/${flags}`;
                } else throw new Error("Role name must be a string or { regex, flags? }.");
                name = `[name=${encoded}${value.exact === true ? "s" : ""}]`;
            }
            ownStep = `role=${raw}${name}`;
        } else if (engine === "selector") {
            if (value.exact !== undefined) throw new Error("Locator exact is not supported with selector.");
            ownStep = raw;
        } else {
            if (value.name !== undefined) throw new Error("Locator name is only supported with role.");
            const exact = value.exact === true;
            ownStep = engine === "testId" ? `testid=${JSON.stringify(raw)}`
                : engine === "text" ? `text=${JSON.stringify(raw)}${exact ? "" : "i"}`
                    : `${engine.toLowerCase()}=${JSON.stringify(raw)}${exact ? "s" : ""}`;
        }
        if (value.hasText !== undefined && typeof value.hasText !== "string") throw new Error("Locator hasText must be a string.");
        if (value.visible !== undefined && typeof value.visible !== "boolean") throw new Error("Locator visible must be a boolean.");
        if (value.nth !== undefined && (typeof value.nth !== "number" || !Number.isSafeInteger(value.nth))) throw new Error("Locator nth must be a safe signed integer.");
        let selector = "";
        if (value.within !== undefined) {
            if (typeof value.within === "string") {
                if (!value.within.trim()) throw new Error("Locator within cannot be an empty string.");
                selector = value.within;
            } else if (value.within && typeof value.within === "object" && !Array.isArray(value.within)) {
                const within = value.within as Record<string, unknown>;
                if (typeof within.ref === "string") selector = `ref=${within.ref}`;
                else selector = compileLocatorObject(within, ancestors);
            } else throw new Error("Locator within must be a selector string or locator object.");
        }
        selector = selector ? `${selector} >> ${ownStep}` : ownStep;
        if (value.hasText !== undefined || value.visible === true) {
            const filters = value.hasText !== undefined ? `:has-text(${JSON.stringify(value.hasText)})` : "";
            selector += ` >> :scope${filters}${value.visible === true ? ":visible" : ""}`;
        }
        if (value.nth !== undefined) selector += ` >> nth=${value.nth}`;
        return selector;
    } finally {
        ancestors.delete(value);
    }
}

function escapeRegexDelimiters(value: string): string {
    let result = "", escaped = false, inClass = false;
    for (const char of value) {
        if (char === "/" && !escaped && !inClass) result += "\\";
        result += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "[") inClass = true;
        else if (char === "]") inClass = false;
    }
    return result;
}
function locatorFunction(locator: ElementLocator, nth: number | undefined, body: string, allowHidden = false): string {
    if ("ref" in locator) return `function() { ${body} }`;
    return `(resolve) => {
        const allMatches = resolve('query');
        ${VISIBLE_FN}
        const visibleMatches = allMatches.filter(visible);
        if (visibleMatches.length > 1 && ${nth == null}) throw new Error('Ambiguous selector: ' + ${JSON.stringify(locator.selector)});
        const matches = visibleMatches.length || !${allowHidden} ? visibleMatches : (allMatches.length === 1 ? allMatches : []);
        const el = matches[${nth ?? 0}];
        if (!el) throw new Error('Element not found or not visible: ' + ${JSON.stringify(locator.selector)});
        return (function() { ${body} }).call(el);
    }`;
}

export async function runOnLocator<T>(
    cdp: ActionablePoint["cdp"], locator: ElementLocator, nth: number | undefined, body: string, allowHidden = false,
): Promise<T> {
    return "ref" in locator
        ? callOnRef(cdp, locator.ref, `function() { ${body} }`, true) as Promise<T>
        : evaluateWithCandidates<T>(cdp, locator.selector, locatorFunction(locator, nth, body, allowHidden));
}

