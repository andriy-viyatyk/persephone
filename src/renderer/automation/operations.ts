/** Shared typed operations for browser, board, and app-window automation targets. */
const { ipcRenderer } = require("electron"); // eslint-disable-line @typescript-eslint/no-var-requires
import {
    BrowserChannel,
    type NavigationWaitOptions,
    type NavigationWaitResult,
    type NetworkLogEntry,
    type BrowserResponseResult,
    type BrowserResponseWaitOptions,
    type PageConsoleLevel,
    type PageConsoleRecord,
    type PageDialogPolicy,
    type PageDialogRecord,
    type PageErrorRecord,
    type PageEventsSnapshot,
} from "../../ipc/browser-ipc";
import { callOnRef, getRefSessionId, parseRef } from "./ref";
import { buildSnapshot, detectOverlay, type SnapshotOptions as SnapshotBuildOptions } from "./snapshot";
import { dispatchKeyDown, dispatchKeyUp, pressKey, pressSyntheticKey, typeMappedCharacter, typeText } from "./input";
import type { IBrowserTarget, ITargetTab } from "./types";
import { errMessage } from "../../shared/utils";
import { cdpExceptionMessage, type CdpSession } from "./CdpSession";
import { app } from "../api/app";
import { fpResolve, isArchivePath, isAsarPath, isPlainLocalPath } from "../core/utils/file-path";

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

export interface TypeActionOptions extends MouseActionOptions {
    slowly?: boolean;
    submit?: boolean;
}

export interface DragOptions {
    tabId?: string; position?: MousePosition; targetPosition?: MousePosition; modifiers?: MouseModifier[];
    force?: boolean; nth?: number; timeout?: number;
}
export type FillFormField =
    | { name: string; locator: string | RefLocator; action: "type"; value: string; options?: TypeActionOptions }
    | { name: string; locator: string | RefLocator; action: "select"; value: string | string[]; options?: MouseActionOptions }
    | { name: string; locator: string | RefLocator; action: "check" | "uncheck"; options?: MouseActionOptions };
export type ScreenshotFormat = "png" | "jpeg";
export interface ScreenshotOptions {
    tabId?: string; target?: string | RefLocator; fullPage?: boolean; format?: ScreenshotFormat; quality?: number;
    /** Zero-based among visible matches when a `target` selector matches several. */
    nth?: number;
    /** Facade supplied to enforce host-specific capture behavior. */
    host?: "browser" | "board" | "app";
    returnUndefinedIfUnavailable?: boolean;
}
export interface ViewportOptions { tabId?: string; width: number; height: number; deviceScaleFactor?: number }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type EvaluateFunction = (...args: never[]) => unknown;

export interface KeyboardActionOptions {
    tabId?: string;
    target?: string | RefLocator;
    nth?: number;
    timeout?: number;
    synthetic?: boolean;
}

export interface ActionablePoint {
    x: number;
    y: number;
    width: number;
    height: number;
    description: string;
    locator: ElementLocator;
    cdp: ReturnType<IBrowserTarget["inputCdp"]>["cdp"];
    sessionId?: string;
}

const DEFAULT_ACTION_TIMEOUT = 5000;
const MAX_ACTION_TIMEOUT = 28000;
const RETRY_INTERVAL = 100;

function actionabilityFunction(): string {
    // hitTest=false (programmatic operations such as select) keeps the other checks but skips
    // the receives-pointer-events test: nothing is dispatched at a point.
    return `async function(selector, nth, force, position, hitTest = true) {
        const describe = el => {
            if (!el) return 'unknown element';
            const id = el.id ? '#' + el.id : '';
            const classes = typeof el.className === 'string' && el.className.trim()
                ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
            const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim().slice(0, 60);
            return '<' + el.localName + id + classes + '>' + (label ? ' ' + JSON.stringify(label) : '');
        };
        const visible = el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        let el = this;
        if (selector !== null) {
            const matches = [...document.querySelectorAll(selector)].filter(visible);
            if (matches.length > 1 && nth == null)
                throw new Error('ACTIONABILITY_FATAL: Ambiguous selector ' + JSON.stringify(selector) + ': ' + matches.length + ' visible matches (' + matches.slice(0, 5).map((m, i) => i + ': ' + describe(m)).join('; ') + (matches.length > 5 ? '; …' : '') + '). Use a ref, narrow the selector, or pass { nth } (zero-based among visible matches).');
            if (nth != null && (!Number.isInteger(nth) || nth < 0))
                throw new Error('ACTIONABILITY_FATAL: { nth } must be a non-negative integer.');
            el = matches[nth ?? 0];
        }
        if (!el) throw new Error('ACTIONABILITY_TRANSIENT: Element not found or not visible.');
        if (!force) {
            if (!el.isConnected) throw new Error('ACTIONABILITY_TRANSIENT: Element is detached.');
            if (!visible(el)) throw new Error('ACTIONABILITY_TRANSIENT: Element is not visible.');
            const beforeScroll = el.getBoundingClientRect();
            if (beforeScroll.top < 0 || beforeScroll.left < 0 || beforeScroll.bottom > innerHeight || beforeScroll.right > innerWidth) {
                el.scrollIntoView({ block: 'center', inline: 'center' });
            }
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) throw new Error('ACTIONABILITY_TRANSIENT: Element is not visible.');
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
        const frameOffsets = [];
        for (let frame = window.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement) {
            const frameRect = frame.getBoundingClientRect();
            frameOffsets.push({ x: frameRect.left + frame.clientLeft, y: frameRect.top + frame.clientTop });
        }
        return { x, y, frameOffsets, width: bounds.width, height: bounds.height, description: describe(el) };
    }`;
}

/** Resolve a locator and wait for the selected element to be actionable. */
export async function resolveActionablePoint(
    target: IBrowserTarget,
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

export interface SnapshotOptions extends Omit<SnapshotBuildOptions, "prefix" | "host"> {
    overlayHint: boolean;
    host?: "browser" | "app" | "board";
}

/** Build an accessibility snapshot and optionally prepend the existing overlay warning. */
export async function snapshot(
    target: IBrowserTarget,
    tabId: string | undefined,
    options: SnapshotOptions,
): Promise<string> {
    const cdp = target.cdp(tabId);
    const events = await readPageEvents(target, tabId);
    const overlayHint = options.overlayHint ? await detectOverlay(cdp) : null;
    const unreportedDialog = events.dialogs.find(dialog => !dialog.reported && dialog.disposition !== "pending");
    const prefixes = [
        overlayHint ? `# ${overlayHint}` : undefined,
        unreportedDialog ? `# Dialog: ${unreportedDialog.type}(${JSON.stringify(unreportedDialog.message)}) was ${unreportedDialog.disposition}` : undefined,
    ].filter((prefix): prefix is string => prefix !== undefined);
    const result = await buildSnapshot(cdp, {
        root: options.root,
        interactive: options.interactive,
        maxNodes: options.maxNodes,
        maxChars: options.maxChars,
        host: options.host,
        prefix: prefixes.length ? prefixes.join("\n") : undefined,
    });
    if (unreportedDialog) await ipcRenderer.invoke(BrowserChannel.markDialogReported, cdp.registrationKey);
    return result;
}

/** Keep the main-process automation activity lease around the complete public operation. */
export async function withAutomationActivity<T>(
    target: IBrowserTarget,
    tabId: string | undefined,
    operation: () => Promise<T>,
): Promise<T> {
    const key = target.cdp(tabId).registrationKey;
    try {
        await ipcRenderer.invoke(BrowserChannel.automationBegin, key);
    } catch (error: unknown) {
        // The pending-dialog preflight rejects here; hand the agent its message without
        // Electron's "Error invoking remote method '…': Error: " framing.
        throw new Error(errMessage(error).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ""));
    }
    try {
        return await operation();
    } finally {
        await ipcRenderer.invoke(BrowserChannel.automationEnd, key);
    }
}

async function readPageEvents(target: IBrowserTarget, tabId?: string): Promise<PageEventsSnapshot> {
    return ipcRenderer.invoke(BrowserChannel.getPageEvents, target.cdp(tabId).registrationKey);
}

export async function dialogs(target: IBrowserTarget, tabId?: string): Promise<{ policy: PageDialogPolicy; dialogs: Array<Omit<PageDialogRecord, "reported">> }> {
    const events = await readPageEvents(target, tabId);
    return { policy: events.policy, dialogs: events.dialogs.map(({ reported: _reported, ...record }) => record) };
}

export async function setDialogPolicy(target: IBrowserTarget, policy: PageDialogPolicy, tabId?: string): Promise<void> {
    await ipcRenderer.invoke(BrowserChannel.setDialogPolicy, target.cdp(tabId).registrationKey, policy);
}

export async function handlePageDialog(target: IBrowserTarget, accept: boolean, promptText?: string, tabId?: string): Promise<void> {
    await ipcRenderer.invoke(BrowserChannel.handleDialog, target.cdp(tabId).registrationKey, accept, promptText);
}

export async function consoleMessages(
    target: IBrowserTarget,
    options: { tabId?: string; since?: number; level?: PageConsoleLevel } = {},
): Promise<PageConsoleRecord[]> {
    const events = await readPageEvents(target, options.tabId);
    return events.consoleMessages.filter(record =>
        (options.since === undefined || record.timestamp >= options.since)
        && (options.level === undefined || record.type === options.level),
    );
}

export async function pageErrors(target: IBrowserTarget, tabId?: string): Promise<PageErrorRecord[]> {
    return (await readPageEvents(target, tabId)).pageErrors;
}

/** Install the activity lease around every public page operation exposed by a facade. */
const PASSIVE_READ_METHODS = new Set(["dialogs", "consoleMessages", "pageErrors", "networkRequests"]);

export function installAutomationActivity<T extends object>(
    prototype: T,
    methodNames: readonly string[],
    targetFor: (instance: T) => IBrowserTarget,
): void {
    for (const methodName of methodNames) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
        if (!descriptor || typeof descriptor.value !== "function") continue;
        const original = descriptor.value as (this: T, ...args: unknown[]) => unknown;
        Object.defineProperty(prototype, methodName, {
            ...descriptor,
            value: async function (this: T, ...args: unknown[]): Promise<unknown> {
                const first = args[0];
                const policy = first !== null && typeof first === "object" && "policy" in first
                    ? (first as { policy?: unknown }).policy : undefined;
                const isPolicyChange = methodName === "dialogs"
                    && (policy === "accept" || policy === "dismiss" || policy === "manual");
                const tabOption = args.find(value => value !== null && typeof value === "object" && "tabId" in value) as { tabId?: unknown } | undefined;
                const fields = methodName === "fillForm" && Array.isArray(first)
                    ? first as Array<{ options?: { tabId?: unknown } }> : undefined;
                const fieldTabId = fields?.find(field => typeof field.options?.tabId === "string")?.options?.tabId;
                const tabId = typeof tabOption?.tabId === "string" ? tabOption.tabId
                    : typeof fieldTabId === "string" ? fieldTabId : undefined;
                const target = targetFor(this);
                await ensureTargetReady(target, tabId);
                // Reads of main-process buffers never touch the page, so they must not count as
                // activity: that would run the pending-dialog preflight, dismissing a dialog the
                // agent only wanted to look at (or, under `manual`, failing the very read that
                // tells it a dialog is open).
                if (methodName === "handleDialog" || isPolicyChange || PASSIVE_READ_METHODS.has(methodName)) {
                    return await original.apply(this, args);
                }
                return withAutomationActivity(target, tabId, async () => await original.apply(this, args));
            },
        });
    }
}

/** Wait for navigation to start and then for the new document to finish loading. */
/** Arm the main-process CDP waiter before triggering a browser navigation. */
export async function waitForNavigationEvents(
    target: IBrowserTarget,
    trigger: () => void,
    options: NavigationWaitOptions & {
        tabId?: string; kind?: "navigation" | "url"; urlPattern?: string | RegExp;
        /** Count a load already in progress when armed (waitForNavigation only). */
        adoptInProgress?: boolean;
    } = {},
): Promise<NavigationWaitResult> {
    const pattern = options.urlPattern instanceof RegExp
        ? { source: options.urlPattern.source, flags: options.urlPattern.flags }
        : options.urlPattern;
    const cdp = target.cdp(options.tabId);
    const token = await cdp.armNavigationWait({
        waitUntil: options.waitUntil ?? "load",
        timeout: options.timeout ?? 10_000,
        kind: options.kind ?? "navigation",
        adoptInProgress: options.adoptInProgress === true,
        ...(pattern !== undefined ? { urlPattern: pattern } : {}),
    });
    let triggerError: unknown;
    try { trigger(); } catch (error: unknown) { triggerError = error; }
    const result = await cdp.awaitNavigationWait(token);
    if (triggerError !== undefined) throw triggerError;
    return result;
}

export async function waitForResponse(
    target: IBrowserTarget,
    urlOrRegex: string | RegExp,
    options: BrowserResponseWaitOptions & { tabId?: string } = {},
): Promise<BrowserResponseResult> {
    if (!(urlOrRegex instanceof RegExp) && typeof urlOrRegex !== "string") {
        throw new Error("waitForResponse requires a URL string or RegExp.");
    }
    const pattern = urlOrRegex instanceof RegExp
        ? { source: urlOrRegex.source, flags: urlOrRegex.flags }
        : urlOrRegex;
    const cdp = target.cdp(options.tabId);
    const token = await cdp.armResponseWait(pattern, options);
    return cdp.awaitResponseWait(token);
}

/** Navigate and return the committed main-frame URL and HTTP status. */
export function navigateAndWait(
    target: IBrowserTarget,
    url: string,
    options: NavigationWaitOptions = {},
): Promise<NavigationWaitResult> {
    // Navigating to the URL the tab already shows is a no-op in the browser editor (it only loads
    // on a URL change), so the wait would time out. Reload instead, as Playwright's goto does.
    const current = target.activeTab?.url;
    const trigger = current !== undefined && current === url ? () => target.reload() : () => target.navigate(url);
    return waitForNavigationEvents(target, trigger, options);
}

/** Wait for the next or currently loading main-frame navigation. */
export function navigateBackAndWait(
    target: IBrowserTarget,
    action: () => void = () => target.back(),
    options: NavigationWaitOptions = {},
): Promise<NavigationWaitResult> {
    return waitForNavigationEvents(target, action, options);
}

/** Click an element using a selector or a host-local accessibility ref. */
export async function clickElement(
    target: IBrowserTarget,
    locator: ElementLocator,
    options: ClickActionOptions = {},
): Promise<void> {
    const action = await resolveActionablePoint(target, locator, options);
    if (options.synthetic) {
        target.focusWebview(options.tabId);
        if ("selector" in locator) {
            await action.cdp.evaluate(`(() => { const matches = [...document.querySelectorAll(${JSON.stringify(locator.selector)})].filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; }); const el = matches[${options.nth ?? 0}]; if (!el) throw new Error('Element not found'); el.click(); })()`);
        } else {
            await callOnRef(action.cdp, locator.ref, "function() { this.click(); }");
        }
        return;
    }
    const modifierFlags = getModifierFlags(options.modifiers);
    const button = options.button ?? "left";
    const clickCount = options.clickCount ?? 1;
    if (!Number.isInteger(clickCount) || clickCount < 1) throw new Error("clickCount must be a positive integer.");
    const buttonFlag = button === "left" ? 1 : button === "right" ? 2 : 4;
    await action.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: action.x, y: action.y, modifiers: modifierFlags,
    }, action.sessionId);
    for (let count = 1; count <= clickCount; count++) {
        await action.cdp.send("Input.dispatchMouseEvent", {
            type: "mousePressed", x: action.x, y: action.y, button, buttons: buttonFlag,
            modifiers: modifierFlags, clickCount: count,
        }, action.sessionId);
        await action.cdp.send("Input.dispatchMouseEvent", {
            type: "mouseReleased", x: action.x, y: action.y, button,
            modifiers: modifierFlags, clickCount: count,
        }, action.sessionId);
    }
}

/** Focus an element through the same trusted click/actionability path used for mouse actions. */
export async function focusElementByClick(
    target: IBrowserTarget,
    locator: ElementLocator,
    options: ClickActionOptions = {},
): Promise<void> {
    await clickElement(target, locator, options);
}

/** Dispatch the existing synthetic hover events on a selector or accessibility ref. */
export async function hoverElement(
    target: IBrowserTarget,
    locator: ElementLocator,
    options: MouseActionOptions = {},
): Promise<void> {
    const action = await resolveActionablePoint(target, locator, options);
    if (options.synthetic) {
        target.focusWebview(options.tabId);
        const syntheticHover = "function() { this.dispatchEvent(new MouseEvent('mouseenter', {bubbles:false, composed:true})); this.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, composed:true})); }";
        if ("selector" in locator) {
            await action.cdp.evaluate(`(() => { const matches = [...document.querySelectorAll(${JSON.stringify(locator.selector)})].filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; }); const el = matches[${options.nth ?? 0}]; if (!el) throw new Error('Element not found'); el.dispatchEvent(new MouseEvent('mouseenter', {bubbles:false, composed:true})); el.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, composed:true})); })()`);
        } else {
            await callOnRef(action.cdp, locator.ref, syntheticHover);
        }
        return;
    }
    await action.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: action.x, y: action.y, modifiers: getModifierFlags(options.modifiers),
    }, action.sessionId);
}

function getModifierFlags(modifiers: MouseModifier[] = []): number {
    return modifiers.reduce((flags, modifier) => flags | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[modifier]), 0);
}

function locatorFunction(locator: ElementLocator, nth: number | undefined, body: string, allowHidden = false): string {
    if ("ref" in locator) return `function() { ${body} }`;
    return `(() => {
        const allMatches = [...document.querySelectorAll(${JSON.stringify(locator.selector)})];
        const visibleMatches = allMatches.filter(el => {
            const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        });
        if (visibleMatches.length > 1 && ${nth == null}) throw new Error('Ambiguous selector: ' + ${JSON.stringify(locator.selector)});
        const matches = visibleMatches.length || !${allowHidden} ? visibleMatches : (allMatches.length === 1 ? allMatches : []);
        const el = matches[${nth ?? 0}];
        if (!el) throw new Error('Element not found or not visible: ' + ${JSON.stringify(locator.selector)});
        return (function() { ${body} }).call(el);
    })()`;
}

async function runOnLocator<T>(
    cdp: ActionablePoint["cdp"], locator: ElementLocator, nth: number | undefined, body: string, allowHidden = false,
): Promise<T> {
    const script = locatorFunction(locator, nth, body, allowHidden);
    return "ref" in locator
        ? callOnRef(cdp, locator.ref, script, true) as Promise<T>
        : cdp.evaluate(script);
}

async function selectEditableContent(
    cdp: ActionablePoint["cdp"], locator: ElementLocator, nth: number | undefined,
    sessionId: string | undefined, kind: string,
): Promise<void> {
    if (kind === "contenteditable") {
        const ownsSelection = await runOnLocator<boolean>(cdp, locator, nth, `
            const selection = window.getSelection();
            return document.activeElement === this || (!!selection?.anchorNode && this.contains(selection.anchorNode));
        `);
        if (!ownsSelection) throw new Error("The contenteditable element does not own focus or the current selection.");
        await pressKey(cdp, "Control+a", { sessionId });
    } else {
        await cdp.evaluate(`(() => { const el = document.activeElement; if (el && typeof el.select === 'function') { try { el.select(); } catch {} } })()`);
    }
}

interface EditableElementDetails {
    tag: string;
    type: string;
    contentEditable: boolean;
    id: string;
    role: string;
    label: string;
}

async function getEditableElementDetails(action: ActionablePoint, locator: ElementLocator, nth?: number): Promise<EditableElementDetails> {
    return runOnLocator<EditableElementDetails>(action.cdp, locator, nth, `
        const el = this;
        const label = el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.closest('label')?.innerText || '';
        return { tag: el.localName, type: (el.type || '').toLowerCase(), contentEditable: el.isContentEditable || el.getAttribute('contenteditable') === 'true', id: el.id || '', role: el.getAttribute('role') || '', label: label.trim() };
    `);
}

function validateEditableElement(details: EditableElementDetails): void {
    if (details.tag === "input" && details.type === "file") throw new Error("Cannot type into a file input; use setInputFiles.");
    const textTypes = new Set(["text", "search", "email", "url", "tel", "password", "number"]);
    const nativeTypes = new Set(["date", "time", "datetime-local", "month", "week", "color", "range"]);
    const isTextControl = details.tag === "textarea" || (details.tag === "input" && textTypes.has(details.type || "text"));
    const isNativeControl = details.tag === "input" && nativeTypes.has(details.type);
    if (!isTextControl && !isNativeControl && !details.contentEditable) {
        const context = [details.id ? `#${details.id}` : "", details.role ? `role=${details.role}` : "", details.label ? `label=${JSON.stringify(details.label)}` : ""].filter(Boolean).join(", ");
        throw new Error(`Cannot type into non-editable <${details.tag}>${context ? ` (${context})` : ""}.`);
    }
}

async function fillResolvedElement(
    action: ActionablePoint, locator: ElementLocator, text: string, options: TypeActionOptions,
    details: EditableElementDetails,
): Promise<void> {
    const nth = options.nth;
    const nativeTypes = new Set(["date", "time", "datetime-local", "month", "week", "color", "range"]);
    const isNativeControl = details.tag === "input" && nativeTypes.has(details.type);
    validateEditableElement(details);
    if (isNativeControl) {
        const valid = await runOnLocator<boolean>(action.cdp, locator, nth, `
            const type = this.type;
            const probe = document.createElement('input'); probe.type = type; probe.value = ${JSON.stringify(text)};
            if (probe.value !== ${JSON.stringify(text)}) return false;
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            descriptor?.set?.call(this, ${JSON.stringify(text)});
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        `);
        if (!valid) throw new Error(`Invalid value for <input type="${details.type}">.`);
        if (options.submit) await pressKey(action.cdp, "Enter", { sessionId: action.sessionId });
        return;
    }
    const kind = details.contentEditable ? "contenteditable" : "form";
    await selectEditableContent(action.cdp, locator, nth, action.sessionId, kind);
    if (!text) {
        await pressKey(action.cdp, "Delete", { sessionId: action.sessionId });
    } else if (options.slowly) {
        for (const character of text) {
            if (!await typeMappedCharacter(action.cdp, character, action.sessionId)) {
                await action.cdp.send("Input.insertText", { text: character }, action.sessionId);
            }
        }
    } else {
        await action.cdp.send("Input.insertText", { text }, action.sessionId);
    }
    if (options.submit) await pressKey(action.cdp, "Enter", { sessionId: action.sessionId });
}

/** Fill a text-editable element using trusted CDP input by default. */
export async function typeTextInto(
    target: IBrowserTarget,
    locator: ElementLocator,
    text: string,
    options: TypeActionOptions = {},
): Promise<void> {
    if (options.synthetic) {
        await typeText(target, { selector: "selector" in locator ? locator.selector : undefined,
            ref: "ref" in locator ? locator.ref : undefined, text, tabId: options.tabId,
            slowly: options.slowly, submit: options.submit, synthetic: true });
        return;
    }
    const action = await resolveActionablePoint(target, locator, options);
    const details = await getEditableElementDetails(action, locator, options.nth);
    validateEditableElement(details);
    await focusElementByClick(target, locator, options);
    await fillResolvedElement(action, locator, text, options, details);
}

export async function selectOption(
    target: IBrowserTarget,
    locator: ElementLocator,
    value: string | string[],
    options: MouseActionOptions = {},
): Promise<void> {
    // Programmatic (Playwright semantics): visible + enabled + stable, but no pointer hit-test.
    const action = await resolveActionablePoint(target, locator, { ...options, hitTest: false });
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) throw new Error("At least one select value is required.");
    const selected = await runOnLocator<boolean>(action.cdp, locator, options.nth, `
        if (this.localName !== 'select') throw new Error('Expected a <select> element.');
        const options = [...this.options];
        for (const value of ${JSON.stringify(values)}) {
            if (!options.some(option => option.value === value)) throw new Error('No option with value ' + JSON.stringify(value) + '.');
        }
        if (!this.multiple && ${JSON.stringify(values)}.length > 1) throw new Error('Cannot select multiple values on a single-select element.');
        const requested = new Set(${JSON.stringify(values)});
        for (const option of options) option.selected = requested.has(option.value);
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    `);
    if (!selected) throw new Error("Select failed.");
}

/** Agents often pass the locator first (`pressKey({ ref }, "Enter")`); say how to call it. */
function requireKeyName(method: string, key: unknown): void {
    if (typeof key !== "string" || !key) {
        throw new Error(`${method}(key, options?) takes the key name first, e.g. ${method}("Enter", { target: { ref: "e12" } }).`);
    }
}

async function keyboardAction(
    target: IBrowserTarget, options: KeyboardActionOptions,
): Promise<{ cdp: ActionablePoint["cdp"]; sessionId?: string }> {
    if (!options.target) {
        const input = target.inputCdp(options.tabId);
        return { cdp: input.cdp, sessionId: input.sessionId };
    }
    const locator = resolveElementLocator(options.target);
    const action = await resolveActionablePoint(target, locator, options);
    await focusElementByClick(target, locator, options);
    return action;
}

/** Press a key or compound key on the focused element or an explicitly targeted locator. */
export async function pressKeyOnTarget(target: IBrowserTarget, key: string, options: KeyboardActionOptions = {}): Promise<void> {
    requireKeyName("pressKey", key);
    const action = await keyboardAction(target, options);
    await pressKey(action.cdp, key, { sessionId: action.sessionId, synthetic: options.synthetic });
}

export async function keyDownOnTarget(target: IBrowserTarget, key: string, options: KeyboardActionOptions = {}): Promise<void> {
    requireKeyName("keyDown", key);
    const action = await keyboardAction(target, options);
    if (options.synthetic) await pressSyntheticKey(action.cdp, key);
    else await dispatchKeyDown(action.cdp, key, action.sessionId);
}

export async function keyUpOnTarget(target: IBrowserTarget, key: string, options: KeyboardActionOptions = {}): Promise<void> {
    requireKeyName("keyUp", key);
    const action = await keyboardAction(target, options);
    if (options.synthetic) await pressSyntheticKey(action.cdp, key);
    else await dispatchKeyUp(action.cdp, key, action.sessionId);
}

async function checkState(target: IBrowserTarget, locator: ElementLocator, options: MouseActionOptions, desired: boolean): Promise<void> {
    const current = await runOnLocator<{ checked: boolean; type: string }>(target.cdp(options.tabId), locator, options.nth, `
        return { checked: this.checked, type: (this.type || '').toLowerCase() };
    `, true);
    if (current.type !== "checkbox" && current.type !== "radio") throw new Error("check and uncheck require a checkbox or radio input.");
    if (!desired && current.type === "radio") throw new Error("A radio button cannot be unchecked.");
    if (current.checked === desired) return;
    try {
        await clickElement(target, locator, options);
    } catch (error: unknown) {
        const message = errMessage(error, "Checkbox action failed.");
        if (!message.includes("not visible") && !message.includes("does not receive pointer events")) throw error;
        const input = target.inputCdp(options.tabId, "ref" in locator ? getRefSessionId(target.cdp(options.tabId), locator.ref) : undefined);
        const labelPoint = await runOnLocator<{ x: number; y: number; frameOffsets: Array<{x:number;y:number}> }>(
            target.cdp(options.tabId), locator, options.nth, `
                const label = this.labels?.[0] || this.closest('label');
                if (!label) throw new Error('No associated visible label.');
                const rect = label.getBoundingClientRect(); const style = getComputedStyle(label);
                if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') throw new Error('No associated visible label.');
                const frameOffsets = []; for (let frame = window.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement) { const r = frame.getBoundingClientRect(); frameOffsets.push({x:r.left+frame.clientLeft,y:r.top+frame.clientTop}); }
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, frameOffsets };
            `,
            true, // the input itself is the hidden element; its label is what gets clicked
        );
        const point = input.mapPoint(labelPoint, labelPoint.frameOffsets);
        await input.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, input.sessionId);
        await input.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 }, input.sessionId);
        await input.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 }, input.sessionId);
    }
    const after = await runOnLocator<boolean>(target.cdp(options.tabId), locator, options.nth, `return this.checked === ${desired};`, true);
    if (!after) throw new Error("click did not change the checked state");
}

export async function checkElement(target: IBrowserTarget, locator: ElementLocator, options: MouseActionOptions = {}): Promise<void> {
    await checkState(target, locator, options, true);
}

export async function uncheckElement(target: IBrowserTarget, locator: ElementLocator, options: MouseActionOptions = {}): Promise<void> {
    await checkState(target, locator, options, false);
}

/** Drag between two actionable elements, restoring intercepted Chromium HTML5 drag behavior. */
export async function dragElements(
    target: IBrowserTarget, source: ElementLocator, destination: ElementLocator, options: DragOptions = {},
): Promise<void> {
    const from = await resolveActionablePoint(target, source, options);
    const to = await resolveActionablePoint(target, destination, { ...options, position: options.targetPosition });
    if (from.sessionId !== to.sessionId) throw new Error("drag source and target must be in the same frame");
    const cdp = from.cdp;
    const sessionId = from.sessionId;
    const key = cdp.registrationKey;
    let token: string | undefined;
    let pressed = false;
    let intercepted = false;
    const modifierFlags = getModifierFlags(options.modifiers);
    try {
        await cdp.send("Input.setInterceptDrags", { enabled: true }, sessionId);
        intercepted = true;
        token = await ipcRenderer.invoke(BrowserChannel.armDragIntercept, key, sessionId);
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1, modifiers: modifierFlags }, sessionId);
        pressed = true;
        const steps = 4;
        for (let step = 1; step <= steps; step++) {
            const progress = step / steps;
            await cdp.send("Input.dispatchMouseEvent", {
                type: "mouseMoved", x: from.x + (to.x - from.x) * progress,
                y: from.y + (to.y - from.y) * progress, button: "left", buttons: 1, modifiers: modifierFlags,
            }, sessionId);
        }
        const data = await ipcRenderer.invoke(BrowserChannel.takeDragIntercept, token, 150);
        token = undefined;
        if (data) {
            for (const type of ["dragEnter", "dragOver", "drop"] as const) {
                await cdp.send("Input.dispatchDragEvent", { type, x: to.x, y: to.y, data }, sessionId);
            }
        }
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, modifiers: modifierFlags }, sessionId);
        pressed = false;
    } finally {
        if (token) await ipcRenderer.invoke(BrowserChannel.takeDragIntercept, token, 0).catch((): null => null);
        if (intercepted) await cdp.send("Input.setInterceptDrags", { enabled: false }, sessionId).catch((): undefined => undefined);
        if (pressed) await cdp.send("Input.dispatchMouseEvent", {
            type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, modifiers: modifierFlags,
        }, sessionId).catch((): undefined => undefined);
    }
}

/** Fill named fields in order, stopping at and naming the first failure. */
export async function fillForm(target: IBrowserTarget, fields: FillFormField[]): Promise<void> {
    if (!Array.isArray(fields)) throw new Error("fillForm expects an array of fields.");
    for (const field of fields) {
        if (!field || typeof field.name !== "string" || !field.name.trim()) throw new Error("Every fillForm field requires a human-readable name.");
        try {
            const locator = resolveElementLocator(field.locator);
            switch (field.action) {
                case "type":
                    if (typeof field.value !== "string") throw new Error("type action requires a string value.");
                    await typeTextInto(target, locator, field.value, field.options);
                    break;
                case "select":
                    if (typeof field.value !== "string" && (!Array.isArray(field.value) || field.value.some(value => typeof value !== "string"))) {
                        throw new Error("select action requires a string or string array value.");
                    }
                    await selectOption(target, locator, field.value, field.options);
                    break;
                case "check": await checkElement(target, locator, field.options); break;
                case "uncheck": await uncheckElement(target, locator, field.options); break;
                default: throw new Error("action must be type, select, check, or uncheck.");
            }
        } catch (error: unknown) {
            throw new Error(`fillForm field ${JSON.stringify(field.name)}: ${errMessage(error, "Operation failed.")}`);
        }
    }
}

/** Assign validated local paths directly to one file input, including hidden inputs. */
export async function setInputFiles(
    target: IBrowserTarget, locator: ElementLocator, paths: string[], options: { tabId?: string } = {},
): Promise<void> {
    if (!Array.isArray(paths) || paths.length === 0 || paths.some(path => typeof path !== "string" || !path.trim())) {
        throw new Error("setInputFiles expects one or more local file paths.");
    }
    const cdp = target.cdp(options.tabId);
    const sessionId = "ref" in locator ? getRefSessionId(cdp, locator.ref) : undefined;
    // DOM.getDocument first: it enables the DOM agent, which every DOM.* call below needs.
    // CSS-only DOM.querySelectorAll, not DOM.performSearch — the latter is also a plain-text
    // search, so "#f" could match text in a script and break the strictness count.
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 }, sessionId);
    let backendNodeId: number;
    if ("ref" in locator) {
        backendNodeId = parseRef(locator.ref).backendNodeId;
    } else {
        const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: locator.selector }, sessionId);
        const count = (nodeIds as number[] | undefined)?.length ?? 0;
        if (count !== 1) {
            throw new Error(count === 0
                ? `Element not found: ${locator.selector}`
                : `Ambiguous selector "${locator.selector}": ${count} matches. Use a ref or narrow the selector.`);
        }
        const described = await cdp.send("DOM.describeNode", { nodeId: nodeIds[0] }, sessionId);
        backendNodeId = described.node.backendNodeId;
    }
    const node = await cdp.send("DOM.describeNode", { backendNodeId }, sessionId);
    const attributes = node.node?.attributes as string[] | undefined;
    const typeIndex = attributes?.findIndex((value, index) => index % 2 === 0 && value === "type") ?? -1;
    const inputType = typeIndex >= 0 ? attributes?.[typeIndex + 1]?.toLowerCase() : "text";
    if (node.node?.nodeName?.toLowerCase() !== "input" || inputType !== "file") {
        throw new Error("setInputFiles requires an <input type=\"file\"> element.");
    }
    const files: string[] = [];
    for (const suppliedPath of paths) {
        if (!isPlainLocalPath(suppliedPath)) {
            throw new Error(`Upload path must be an ordinary local file: ${suppliedPath}`);
        }
        const filePath = fpResolve(suppliedPath);
        if (isArchivePath(filePath) || isAsarPath(filePath)) {
            throw new Error(`Upload path must be an ordinary local file: ${suppliedPath}`);
        }
        const stat = await app.fs.stat(filePath);
        if (!stat.exists) throw new Error(`Upload file does not exist: ${filePath}`);
        if (stat.isDirectory) throw new Error(`Upload path is a directory: ${filePath}`);
        files.push(filePath);
    }
    await cdp.send("DOM.setFileInputFiles", { files, backendNodeId }, sessionId);
}

export async function clearElement(target: IBrowserTarget, locator: ElementLocator, options: MouseActionOptions = {}): Promise<void> {
    await typeTextInto(target, locator, "", options);
}

/** Evaluate an expression in the selected target tab. */
export async function evaluateInTarget(
    target: IBrowserTarget,
    code: string | EvaluateFunction,
    optionsOrTabId: string | { tabId?: string; args?: JsonValue[] } = {},
): Promise<unknown> {
    const options = typeof optionsOrTabId === "string" ? { tabId: optionsOrTabId } : optionsOrTabId;
    const cdp = target.cdp(options.tabId);
    const args = options.args ?? [];
    if (!Array.isArray(args) || !args.every(value => isJsonValue(value))) throw new Error("evaluate args must contain only JSON-safe values.");
    if (typeof code === "string") return evaluateStringCode(cdp, code, args, options.args !== undefined);
    const declaration = code.toString();
    const global = await cdp.send("Runtime.evaluate", { expression: "globalThis", returnByValue: false }, undefined);
    const objectId = global.result?.objectId;
    if (!objectId) throw new Error("Could not resolve globalThis for evaluate().");
    try {
        const result = await cdp.send("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: declaration,
            arguments: args.map(value => ({ value })),
            awaitPromise: true,
            returnByValue: true,
        }, undefined);
        if (result.exceptionDetails) throw new Error(cdpExceptionMessage(result.exceptionDetails, "Evaluation failed"));
        return result.result?.value;
    } finally {
        await cdp.send("Runtime.releaseObject", { objectId }, undefined).catch((): undefined => undefined);
    }
}

/**
 * Evaluate a code string once and let the page say what it is: a function result is invoked
 * with `args` (Playwright semantics for `"(a, b) => a + b"`), anything else is the answer.
 * Guessing from the text cannot work — an IIFE `(() => {…})()` starts exactly like an arrow.
 */
async function evaluateStringCode(
    cdp: CdpSession, code: string, args: JsonValue[], argsGiven: boolean,
): Promise<unknown> {
    const evaluated = await cdp.send("Runtime.evaluate", { expression: code, returnByValue: false, awaitPromise: true });
    if (evaluated.exceptionDetails) throw new Error(cdpExceptionMessage(evaluated.exceptionDetails, "Evaluation failed"));
    const remote = evaluated.result ?? {};
    const objectId: string | undefined = remote.objectId;
    try {
        if (remote.type === "function" && objectId) {
            const called = await cdp.send("Runtime.callFunctionOn", {
                objectId,
                functionDeclaration: "function(...args) { return this(...args); }",
                arguments: args.map(value => ({ value })),
                awaitPromise: true,
                returnByValue: true,
            });
            if (called.exceptionDetails) throw new Error(cdpExceptionMessage(called.exceptionDetails, "Evaluation failed"));
            return called.result?.value;
        }
        if (argsGiven) throw new Error("evaluate args require the code to evaluate to a function, e.g. \"(a, b) => a + b\".");
        if (!objectId) return remote.value;
        const serialized = await cdp.send("Runtime.callFunctionOn", {
            objectId, functionDeclaration: "function() { return this; }", returnByValue: true,
        });
        return serialized.result?.value;
    } finally {
        if (objectId) await cdp.send("Runtime.releaseObject", { objectId }).catch((): undefined => undefined);
    }
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = Array.isArray(value)
        ? value.every(item => isJsonValue(item, seen))
        : Object.getPrototypeOf(value) === Object.prototype
            && Object.values(value as Record<string, unknown>).every(item => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
}

/** Read an element's text using a selector or a host-local accessibility ref. */
export async function getElementText(
    target: IBrowserTarget,
    locator: ElementLocator,
    tabId?: string,
): Promise<string | null> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `document.querySelector(${JSON.stringify(locator.selector)})?.textContent ?? null`,
        );
    }
    return callOnRef(target.cdp(tabId), locator.ref,
        "function() { return this.textContent ?? null; }", true);
}

/** Read an element's value using a selector or a host-local accessibility ref. */
export async function getElementValue(
    target: IBrowserTarget,
    locator: ElementLocator,
    tabId?: string,
): Promise<string | null> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `document.querySelector(${JSON.stringify(locator.selector)})?.value ?? null`,
        );
    }
    return callOnRef(target.cdp(tabId), locator.ref,
        "function() { return this.value ?? null; }", true);
}

/** Read an element attribute using a selector or a host-local accessibility ref. */
export async function getElementAttribute(
    target: IBrowserTarget,
    locator: ElementLocator,
    attribute: string,
    tabId?: string,
): Promise<string | null> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `document.querySelector(${JSON.stringify(locator.selector)})?.getAttribute(${JSON.stringify(attribute)}) ?? null`,
        );
    }
    return callOnRef(target.cdp(tabId), locator.ref,
        `function() { return this.getAttribute(${JSON.stringify(attribute)}); }`, true);
}

/** Read an element's inner HTML using a selector or a host-local accessibility ref. */
export async function getElementHtml(
    target: IBrowserTarget,
    locator: ElementLocator,
    tabId?: string,
): Promise<string | null> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `document.querySelector(${JSON.stringify(locator.selector)})?.innerHTML ?? null`,
        );
    }
    return callOnRef(target.cdp(tabId), locator.ref,
        "function() { return this.innerHTML ?? null; }", true);
}

/** Check whether a selector or host-local accessibility ref identifies an element. */
export async function elementExists(
    target: IBrowserTarget,
    locator: ElementLocator,
    tabId?: string,
): Promise<boolean> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `!!document.querySelector(${JSON.stringify(locator.selector)})`,
        );
    }
    await callOnRef(target.cdp(tabId), locator.ref, "function() { return true; }", true);
    return true;
}

export type WaitMode =
    | { kind: "selector"; selector: string; state?: "attached" | "detached" | "visible" | "hidden" }
    | { kind: "text"; text: string }
    | { kind: "textGone"; text: string }
    | { kind: "time"; seconds: number };

export interface WaitForOptions {
    mode: WaitMode;
    timeout?: number;
    tabId?: string;
}

/** Wait using one of the browser_wait_for modes, without wrapping the result in an MCP response. */
export async function waitFor(target: IBrowserTarget, options: WaitForOptions): Promise<void> {
    const timeout = Math.max(0, Math.min(options.timeout ?? 10_000, 595_000));
    const { mode } = options;
    if (mode.kind === "time") {
        await new Promise(resolve => setTimeout(resolve, Math.round(mode.seconds * 1000)));
    } else {
        const started = Date.now();
        const cdp = target.cdp(options.tabId);
        while (true) {
            let satisfied = false;
            if (mode.kind === "selector") {
                const state = mode.state ?? "attached";
                const selector = JSON.stringify(mode.selector);
                satisfied = await cdp.evaluate(`(() => {
                    const el = document.querySelector(${selector});
                    const attached = !!el;
                    const rect = el?.getBoundingClientRect();
                    const style = el ? getComputedStyle(el) : null;
                    const visible = !!el && rect.width > 0 && rect.height > 0
                        && style.visibility !== 'hidden' && style.display !== 'none';
                    return ${JSON.stringify(state)} === 'attached' ? attached
                        : ${JSON.stringify(state)} === 'detached' ? !attached
                        : ${JSON.stringify(state)} === 'visible' ? visible : !visible;
                })()`);
            } else {
                const contains = await cdp.evaluate(`!!document.body?.innerText?.includes(${JSON.stringify(mode.text)})`);
                satisfied = mode.kind === "text" ? contains : !contains;
            }
            if (satisfied) return;
            const elapsed = Date.now() - started;
            if (elapsed >= timeout) {
                const condition = mode.kind === "selector"
                    ? `${mode.state ?? "attached"} selector ${JSON.stringify(mode.selector)}`
                    : `${mode.kind === "text" ? "text" : "text to disappear"} ${JSON.stringify(mode.text)}`;
                throw new Error(`Timed out waiting for ${condition} after ${elapsed} ms (timeout ${timeout} ms).`);
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(100, timeout - elapsed)));
        }
    }
}

export async function ensureTargetReady(target: IBrowserTarget, tabId?: string): Promise<void> {
    await target.ensureReady?.(tabId);
}

export function listTabs(target: IBrowserTarget): ReadonlyArray<ITargetTab> {
    return target.tabs;
}

export async function openTab(target: IBrowserTarget, url?: string): Promise<ReadonlyArray<ITargetTab>> {
    target.addTab(url);
    await new Promise(resolve => setTimeout(resolve, 200));
    return target.tabs;
}

export async function closeTab(target: IBrowserTarget, index?: number): Promise<ReadonlyArray<ITargetTab>> {
    if (index != null) {
        const tab = target.tabs[index];
        if (!tab) throw new Error(`No tab at index ${index}`);
        target.closeTab(tab.id);
    } else {
        target.closeTab();
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    return target.tabs;
}

export async function selectTab(target: IBrowserTarget, index: number): Promise<ReadonlyArray<ITargetTab>> {
    const tab = target.tabs[index];
    if (!tab) throw new Error(`No tab at index ${index}`);
    await target.switchTab(tab.id);
    return target.tabs;
}

export interface ScreenshotResult {
    type: "image";
    data: string;
    mimeType: "image/png" | "image/jpeg";
}

export async function takeScreenshot(
    target: IBrowserTarget,
    tabId?: string,
    options: ScreenshotOptions = {},
): Promise<ScreenshotResult | undefined> {
    try {
        const format = options.format ?? "png";
        if (format !== "png" && format !== "jpeg") throw new Error("Screenshot format must be png or jpeg.");
        if (options.quality !== undefined && (format !== "jpeg" || !Number.isInteger(options.quality) || options.quality < 0 || options.quality > 100)) {
            throw new Error("Screenshot quality must be an integer from 0 to 100 and is only valid for jpeg.");
        }
        if (options.target !== undefined && options.fullPage) throw new Error("screenshot target and fullPage are mutually exclusive.");
        if (options.fullPage && options.host !== "browser") throw new Error("fullPage screenshots are not supported on this host");
        const cdp = target.cdp(tabId);
        const params: Record<string, unknown> = { format, ...(options.quality !== undefined ? { quality: options.quality } : {}) };
        if (options.fullPage) {
            const metrics = await cdp.send("Page.getLayoutMetrics");
            const content = metrics.cssContentSize ?? metrics.contentSize;
            if (!content || !(content.width > 0) || !(content.height > 0)) throw new Error("Could not determine the page content size for a fullPage screenshot.");
            params.clip = { x: 0, y: 0, width: content.width, height: content.height, scale: 1 };
            params.captureBeyondViewport = true;
        } else if (options.target !== undefined) {
            const locator = resolveElementLocator(options.target);
            if ("ref" in locator && parseRef(locator.ref).frameIndex !== null) {
                throw new Error("Element screenshots inside a cross-origin iframe are not supported — pass the iframe element's own ref from the parent document");
            }
            const sessionId = "ref" in locator ? getRefSessionId(cdp, locator.ref) : undefined;
            const box = "ref" in locator
                ? await callOnRef(cdp, locator.ref, `function() {
                    const rect = this.getBoundingClientRect();
                    const frameOffsets = [];
                    for (let frame = window.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement) {
                        const r = frame.getBoundingClientRect(); frameOffsets.push({ x: r.left + frame.clientLeft, y: r.top + frame.clientTop });
                    }
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, frameOffsets };
                }`, true)
                : await cdp.evaluate(`(() => {
                    // Same strictness as every other action: count visible matches, { nth } picks one.
                    const nth = ${JSON.stringify(options.nth ?? null)};
                    const matches = [...document.querySelectorAll(${JSON.stringify(locator.selector)})].filter(el => {
                        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
                    });
                    if (!matches.length) throw new Error('Screenshot element not found or not visible.');
                    if (matches.length > 1 && nth === null) throw new Error('Ambiguous screenshot selector: ' + matches.length + ' visible matches. Use a ref, narrow the selector, or pass { nth }.');
                    const chosen = matches[nth ?? 0];
                    if (!chosen) throw new Error('No visible match at { nth: ' + nth + ' }.');
                    const rect = chosen.getBoundingClientRect();
                    if (!(rect.width > 0 && rect.height > 0)) throw new Error('Screenshot element is not visible.');
                    const frameOffsets = [];
                    for (let frame = window.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement) {
                        const r = frame.getBoundingClientRect(); frameOffsets.push({ x: r.left + frame.clientLeft, y: r.top + frame.clientTop });
                    }
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, frameOffsets };
                })()`);
            if (!(box.width > 0 && box.height > 0)) throw new Error("Screenshot element is not visible.");
            const input = target.inputCdp(tabId, sessionId);
            const point = input.mapPoint({ x: box.x, y: box.y }, box.frameOffsets);
            params.clip = { x: point.x, y: point.y, width: box.width, height: box.height, scale: 1 };
        }
        const { data } = await cdp.send("Page.captureScreenshot", params);
        if (!data) return undefined;
        return { type: "image", data, mimeType: format === "jpeg" ? "image/jpeg" : "image/png" };
    } catch (error: unknown) {
        const message = errMessage(error, "Screenshot failed.");
        if (options.returnUndefinedIfUnavailable && /Protocol error|Debugger is not attached|WebContents not found/i.test(message)) return undefined;
        if (options.returnUndefinedIfUnavailable && !/fullPage|Screenshot|screenshot|quality|jpeg|png|cross-origin|mutually exclusive/i.test(message)) return undefined;
        throw error;
    }
}

export async function setViewport(target: IBrowserTarget, options: ViewportOptions): Promise<void> {
    if (!Number.isInteger(options.width) || options.width <= 0 || !Number.isInteger(options.height) || options.height <= 0) {
        throw new Error("Viewport width and height must be positive integers.");
    }
    const scale = options.deviceScaleFactor ?? 1;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("deviceScaleFactor must be a positive finite number.");
    await target.cdp(options.tabId).send("Emulation.setDeviceMetricsOverride", {
        width: options.width, height: options.height, deviceScaleFactor: scale, mobile: false,
    });
}

export async function clearViewport(target: IBrowserTarget, options: { tabId?: string } = {}): Promise<void> {
    await target.cdp(options.tabId).send("Emulation.clearDeviceMetricsOverride");
}

export async function networkRequests(target: IBrowserTarget, tabId?: string, options: { includeBodies?: boolean; maxBodyBytes?: number } = {}): Promise<NetworkLogEntry[]> {
    const tab = tabId ? target.tabs.find(item => item.id === tabId) : target.activeTab;
    if (!tab) throw new Error(tabId ? `No tab with id "${tabId}"` : "No active tab");
    return ipcRenderer.invoke(BrowserChannel.getNetworkLog, target.cdp(tab.id).registrationKey, options);
}

export function closeActiveTab(target: IBrowserTarget): string {
    target.closeTab();
    return "Tab closed";
}
