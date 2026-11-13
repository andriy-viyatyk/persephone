import { callOnRef, getRefSessionId } from "./ref";
import { errMessage } from "../../shared/utils";
import type { IAutomationTarget, IInputSession } from "./types";
import { FRAME_OFFSETS_FN, resolveCandidatesSource, VISIBLE_FN } from "./page-scripts";


export interface RefLocator {
    ref: string;
}

export interface SelectorLocator {
    selector: string;
}

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
}
export interface DragOptions {
    tabId?: string; position?: MousePosition; targetPosition?: MousePosition; modifiers?: MouseModifier[];
    force?: boolean; nth?: number; timeout?: number;
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
    return `async function(selector, nth, force, position, hitTest = true) {
        ${resolveCandidatesSource()}
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
        if (selector !== null) {
            if (!force && !selector.startsWith('text=')) {
                const allMatches = [...document.querySelectorAll(selector)];
                if (allMatches.length > 0 && !allMatches.some(displayed)) throw new Error('ACTIONABILITY_TRANSIENT: Element is not visible.');
            }
            const matches = resolveCandidates(selector, 'action');
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
            }
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) throw new Error('ACTIONABILITY_TRANSIENT: Element has zero size.');
            const waitFrame = () => Promise.race([
                new Promise(resolve => requestAnimationFrame(resolve)),
                new Promise(resolve => setTimeout(resolve, 50)),
            ]);
            const first = el.getBoundingClientRect();
            await waitFrame();
            if (!el.isConnected) throw new Error('ACTIONABILITY_TRANSIENT: Element is detached.');
            const second = el.getBoundingClientRect();
            if (first.x !== second.x || first.y !== second.y || first.width !== second.width || first.height !== second.height)
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
            if (!reaches) throw new Error('ACTIONABILITY_TRANSIENT: Element does not receive pointer events; covered by ' + describe(hit) + '.');
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
    let lastReason = "Element not found or not visible.";
    while (true) {
        try {
            const script = `(${actionabilityFunction()})(`+
                `${"selector" in locator ? JSON.stringify(locator.selector) : "null"},`+
                `${options.nth ?? "null"},${Boolean(options.force)},${JSON.stringify(options.position ?? null)},${options.hitTest !== false})`;
            const result = "ref" in locator
                ? await callOnRef(baseCdp, locator.ref, `function() { return (${actionabilityFunction()}).call(this, null, null, ${Boolean(options.force)}, ${JSON.stringify(options.position ?? null)}, ${options.hitTest !== false}); }`, true)
                : await input.cdp.evaluate(script);
            const point = input.mapPoint({ x: result.x, y: result.y }, result.frameOffsets);
            return { ...result, ...point, locator, cdp: input.cdp, sessionId: input.sessionId };
        } catch (error: unknown) {
            const message = errMessage(error, "Mouse action failed.");
            if (message.includes("ACTIONABILITY_FATAL:")) throw new Error(message.replace("ACTIONABILITY_FATAL: ", ""));
            if (message.includes("ACTIONABILITY_TRANSIENT:")) {
                lastReason = message.replace("ACTIONABILITY_TRANSIENT: ", "");
            } else if ("ref" in locator && /stale|removed|detached|No node with given id/i.test(message)) {
                lastReason = "Element is detached.";
            } else {
                throw error;
            }
            if (Date.now() >= deadline) throw new Error(`Timed out after ${timeout} ms: ${lastReason}`);
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
    throw new Error("Expected a CSS selector string or an object of the form { ref: string }.");
}
function locatorFunction(locator: ElementLocator, nth: number | undefined, body: string, allowHidden = false): string {
    if ("ref" in locator) return `function() { ${body} }`;
    return `(() => {
        const force = false; ${resolveCandidatesSource()}
        const allMatches = (${JSON.stringify(locator.selector)}.startsWith('text=') ? resolveCandidates(${JSON.stringify(locator.selector)}, 'query') : [...document.querySelectorAll(${JSON.stringify(locator.selector)})]);
        ${VISIBLE_FN}
        const visibleMatches = allMatches.filter(visible);
        if (visibleMatches.length > 1 && ${nth == null}) throw new Error('Ambiguous selector: ' + ${JSON.stringify(locator.selector)});
        const matches = visibleMatches.length || !${allowHidden} ? visibleMatches : (allMatches.length === 1 ? allMatches : []);
        const el = matches[${nth ?? 0}];
        if (!el) throw new Error('Element not found or not visible: ' + ${JSON.stringify(locator.selector)});
        return (function() { ${body} }).call(el);
    })()`;
}

export async function runOnLocator<T>(
    cdp: ActionablePoint["cdp"], locator: ElementLocator, nth: number | undefined, body: string, allowHidden = false,
): Promise<T> {
    const script = locatorFunction(locator, nth, body, allowHidden);
    return "ref" in locator
        ? callOnRef(cdp, locator.ref, script, true) as Promise<T>
        : cdp.evaluate(script);
}

