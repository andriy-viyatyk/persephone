const { ipcRenderer } = require("electron"); // eslint-disable-line @typescript-eslint/no-var-requires
import { BrowserChannel } from "../../ipc/browser-ipc";
import { callOnRef, getRefSessionId } from "./ref";
import { recheckHitTarget, resolveActionablePoint, runOnLocator } from "./locator";
import { FRAME_OFFSETS_FN } from "./page-scripts";
import { evaluateWithCandidates } from "./selector-execution";
import { errMessage } from "../../shared/utils";
import { isAutomationContextLoss } from "./context-loss";
import { clearForcedHover, forceHover } from "./hover-pseudo-state";
import { armLostClickRecorder, assertClickWasDispatched, PRE_PRESS_RECHECK_ROUNDS, waitForTargetFrame } from "./lost-click";
import type { IAutomationTarget, ISyntheticInputHost } from "./types";
import type { ActionablePoint, ElementLocator, MousePosition, MouseActionOptions, ClickActionOptions, DragOptions } from "./locator";
import { clearForcedHoverForLocator, dispatchMouseEvent, getModifierFlags, validatePoint } from "./pointer-actions";

export { mouseDown, mouseMove, mouseUp, wheel } from "./pointer-actions";


export async function clickElement(
    target: IAutomationTarget & ISyntheticInputHost,
    locator: ElementLocator,
    options: ClickActionOptions = {},
): Promise<void> {
    await clearForcedHoverForLocator(target, locator, options.tabId);
    const revealOptions = options.hoverFirst === false || options.synthetic || target.id === "app"
        ? { hoverFirst: options.hoverFirst }
        : {
            hoverFirst: options.hoverFirst,
            onNotVisible: () => forceHover(target.cdp(options.tabId), locator, options.nth, true),
        };
    let action = await resolveActionablePoint(target, locator, { ...options, ...revealOptions });
    if (options.synthetic) {
        target.focusWebview(options.tabId);
        if ("selector" in locator) {
            await evaluateWithCandidates(action.cdp, locator.selector,
                `(resolve) => { const matches = resolve('query', { visibleOnly: true, nth: ${options.nth ?? 0} }); const el = matches[0]; if (!el) throw new Error('Element not found'); el.click(); }`);
        } else {
            await callOnRef(action.cdp, locator.ref, "function() { this.click(); }");
        }
        return;
    }
    // A real click into the page also moves the embedder's focus to the webview. Without it the
    // host keeps focus elsewhere (a new tab's URL bar), and text typed after this click went there.
    target.focusWebview(options.tabId);
    const modifierFlags = getModifierFlags(options.modifiers);
    const button = options.button ?? "left";
    const clickCount = options.clickCount ?? 1;
    if (!Number.isInteger(clickCount) || clickCount < 1) throw new Error("clickCount must be a positive integer.");
    const buttonFlag = button === "left" ? 1 : button === "right" ? 2 : 4;
    if (!options.force) {
        let settled = false;
        const initialDescription = action.description;
        let lastDescription = action.description;
        for (let round = 0; round < PRE_PRESS_RECHECK_ROUNDS; round++) {
            await dispatchMouseEvent(action.cdp, action.sessionId, {
                type: "mouseMoved", x: action.x, y: action.y, modifiers: modifierFlags,
            });
            await waitForTargetFrame(action.cdp, action.sessionId);
            const checked = await recheckHitTarget(action, options.nth);
            // Only a replaced target is re-resolved. Something that now covers the same element (a
            // hover tooltip) keeps today's behaviour: the press goes to the point as before.
            if (checked.matchesResolvedTarget) { settled = true; break; }
            lastDescription = checked.description;
            if (round + 1 < PRE_PRESS_RECHECK_ROUNDS) {
                action = await resolveActionablePoint(target, locator, { ...options, ...revealOptions });
            }
        }
        if (!settled) throw new Error(`Element kept changing before the click: ${initialDescription} → ${lastDescription}.`);
    } else {
        await dispatchMouseEvent(action.cdp, action.sessionId, {
            type: "mouseMoved", x: action.x, y: action.y, modifiers: modifierFlags,
        });
    }
    const shouldCheckClick = options.checkClick !== false && button === "left" && target.id !== "app";
    const recorder = shouldCheckClick ? await armLostClickRecorder(action.cdp, action.sessionId) : undefined;
    try {
    for (let count = 1; count <= clickCount; count++) {
        const menuTabId = button === "right" && options.nativeMenu !== true
            ? target.automationContextMenu?.(options.tabId, "arm")
            : undefined;
        try {
            await dispatchMouseEvent(action.cdp, action.sessionId, {
                type: "mousePressed", x: action.x, y: action.y, button, buttons: buttonFlag,
                modifiers: modifierFlags, clickCount: count,
            });
            try {
                await dispatchMouseEvent(action.cdp, action.sessionId, {
                    type: "mouseReleased", x: action.x, y: action.y, button,
                    modifiers: modifierFlags, clickCount: count,
                });
            } catch (error: unknown) {
                // The press reached the page and its handler closed the target (a popup that closes
                // itself): the click was delivered, and there is nothing left to press again.
                if (!isAutomationContextLoss(error)) throw error;
                return;
            }
        } finally {
            if (menuTabId) target.automationContextMenu?.(menuTabId, "release");
        }
    }
        if (recorder) {
            const evidence = await recorder.readAfterSettle();
            assertClickWasDispatched(evidence, clickCount);
        }
    } finally {
        await recorder?.cleanup();
    }
}

/** Dispatch the existing synthetic hover events on a selector or accessibility ref. */
export async function hoverElement(
    target: IAutomationTarget & ISyntheticInputHost,
    locator: ElementLocator,
    options: MouseActionOptions = {},
): Promise<void> {
    await clearForcedHoverForLocator(target, locator, options.tabId);
    const action = await resolveActionablePoint(target, locator, options);
    if (options.synthetic) {
        target.focusWebview(options.tabId);
        const syntheticHover = "function() { this.dispatchEvent(new MouseEvent('mouseenter', {bubbles:false, composed:true})); this.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, composed:true})); }";
        if ("selector" in locator) {
            await evaluateWithCandidates(action.cdp, locator.selector,
                `(resolve) => { const matches = resolve('query', { visibleOnly: true, nth: ${options.nth ?? 0} }); const el = matches[0]; if (!el) throw new Error('Element not found'); el.dispatchEvent(new MouseEvent('mouseenter', {bubbles:false, composed:true})); el.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, composed:true})); }`);
        } else {
            await callOnRef(action.cdp, locator.ref, syntheticHover);
        }
        return;
    }
    await dispatchMouseEvent(action.cdp, action.sessionId, {
        type: "mouseMoved", x: action.x, y: action.y, modifiers: getModifierFlags(options.modifiers),
    });
    // The native move already applied :hover; forcing only keeps it against a later real-pointer
    // move, so a failure here must not fail a hover that happened.
    if (target.id !== "app") await forceHover(action.cdp, locator, options.nth).catch((): undefined => undefined);
}

async function checkState(target: IAutomationTarget & ISyntheticInputHost, locator: ElementLocator, options: MouseActionOptions, desired: boolean): Promise<void> {
    const current = await runOnLocator<{ checked: boolean; type: string }>(target.cdp(options.tabId), locator, options.nth, `
        return { checked: this.checked, type: (this.type || '').toLowerCase() };
    `, true);
    if (current.type !== "checkbox" && current.type !== "radio") throw new Error("check and uncheck require a checkbox or radio input.");
    if (!desired && current.type === "radio") throw new Error("A radio button cannot be unchecked.");
    if (current.checked === desired) return;
    try {
        await clickElement(target, locator, { ...options, checkClick: false });
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
                ${FRAME_OFFSETS_FN}
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, frameOffsets };
            `,
            true, // the input itself is the hidden element; its label is what gets clicked
        );
        const point = input.mapPoint(labelPoint, labelPoint.frameOffsets);
        await dispatchMouseEvent(input.cdp, input.sessionId, { type: "mouseMoved", ...point });
        await dispatchMouseEvent(input.cdp, input.sessionId, { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
        await dispatchMouseEvent(input.cdp, input.sessionId, { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    }
    const after = await runOnLocator<boolean>(target.cdp(options.tabId), locator, options.nth, `return this.checked === ${desired};`, true);
    if (!after) throw new Error("click did not change the checked state");
}

export async function checkElement(target: IAutomationTarget & ISyntheticInputHost, locator: ElementLocator, options: MouseActionOptions = {}): Promise<void> {
    await checkState(target, locator, options, true);
}

export async function uncheckElement(target: IAutomationTarget & ISyntheticInputHost, locator: ElementLocator, options: MouseActionOptions = {}): Promise<void> {
    await checkState(target, locator, options, false);
}

/** Drag between two actionable elements, restoring intercepted Chromium HTML5 drag behavior. */
export async function dragElements(
    target: IAutomationTarget, source: ElementLocator, destination: ElementLocator | { by: MousePosition }, options: DragOptions = {},
): Promise<void> {
    validateDragOptions(options);
    await clearForcedHoverForLocator(target, source, options.tabId);
    const from = await resolveActionablePoint(target, source, options);
    let to: Pick<ActionablePoint, "x" | "y" | "cdp" | "sessionId">;
    if (isDragOffset(destination)) {
        if (!destination.by || typeof destination.by !== "object" || Array.isArray(destination.by)
            || Object.keys(destination.by).length !== 2
            || !Object.prototype.hasOwnProperty.call(destination.by, "x")
            || !Object.prototype.hasOwnProperty.call(destination.by, "y")) {
            throw new Error("A drag offset must contain exactly finite x and y coordinates.");
        }
        const { x, y } = validatePoint(destination.by, "drag offset", false);
        to = { ...from, x: from.x + x, y: from.y + y };
    } else {
        if (options.targetPosition) validatePoint(options.targetPosition, "targetPosition", false);
        const anchor = await resolveActionablePoint(target, destination, { ...options, position: undefined });
        to = {
            ...anchor,
            x: anchor.x + (options.targetPosition?.x ?? anchor.width / 2) - anchor.width / 2,
            y: anchor.y + (options.targetPosition?.y ?? anchor.height / 2) - anchor.height / 2,
        };
    }
    await dispatchDragPoints(target, from, to, options);
}

function isDragOffset(destination: ElementLocator | { by: MousePosition }): destination is { by: MousePosition } {
    if (!destination || typeof destination !== "object" || !("by" in destination)) return false;
    const keys = Object.keys(destination);
    if (keys.length !== 1 || keys[0] !== "by") throw new Error("A drag offset destination must have exactly the form { by: { x, y } }.");
    return true;
}

function validateDragOptions(options: DragOptions): void {
    if (options.position !== undefined) validatePoint(options.position, "position");
    if (options.targetPosition !== undefined) validatePoint(options.targetPosition, "targetPosition", false);
    if (options.steps !== undefined && (!Number.isInteger(options.steps) || options.steps < 1 || options.steps > 1000)) {
        throw new Error("steps must be a positive integer no greater than 1000.");
    }
    if (options.holdMs !== undefined && (!Number.isFinite(options.holdMs) || options.holdMs < 0 || options.holdMs > 10000)) {
        throw new Error("holdMs must be a finite number from 0 to 10000.");
    }
}

/** Dispatch a trusted click at viewport CSS pixels without locator actionability. */
export async function clickAtCoordinates(
    target: IAutomationTarget & ISyntheticInputHost,
    position: MousePosition,
    options: { tabId?: string; button?: "left" | "right" | "middle"; clickCount?: number; nativeMenu?: boolean } = {},
    behavior: { focusHost?: boolean } = {},
): Promise<void> {
    validatePoint(position, "clickAt coordinates");
    if (behavior.focusHost !== false) target.focusWebview(options.tabId);
    const input = target.inputCdp(options.tabId);
    await clearForcedHover(input.cdp, input.sessionId);
    const point = input.mapPoint(position, []);
    const button = options.button ?? "left";
    const clickCount = options.clickCount ?? 1;
    if (!Number.isInteger(clickCount) || clickCount < 1) throw new Error("clickCount must be a positive integer.");
    await dispatchMouseEvent(input.cdp, input.sessionId, { type: "mouseMoved", ...point });
    for (let count = 1; count <= clickCount; count++) {
        const menuTabId = button === "right" && options.nativeMenu !== true
            ? target.automationContextMenu?.(options.tabId, "arm")
            : undefined;
        try {
            await dispatchMouseEvent(input.cdp, input.sessionId, { type: "mousePressed", ...point, button, buttons: button === "left" ? 1 : button === "right" ? 2 : 4, clickCount: count });
            await dispatchMouseEvent(input.cdp, input.sessionId, { type: "mouseReleased", ...point, button, buttons: 0, clickCount: count });
        } finally {
            if (menuTabId) target.automationContextMenu?.(menuTabId, "release");
        }
    }
}

export async function dragCoordinates(
    target: IAutomationTarget & ISyntheticInputHost,
    fromPosition: MousePosition,
    toPosition: MousePosition,
    options: DragOptions = {},
    behavior: { validateCoordinates?: boolean; focusHost?: boolean } = {},
): Promise<void> {
    if (behavior.validateCoordinates !== false) {
        validatePoint(fromPosition, "drag start coordinates");
        validatePoint(toPosition, "drag end coordinates");
    }
    validateDragOptions(options);
    if (behavior.focusHost !== false) target.focusWebview(options.tabId);
    const input = target.inputCdp(options.tabId);
    await clearForcedHover(input.cdp, input.sessionId);
    const from = { ...input.mapPoint(fromPosition, []), cdp: input.cdp, sessionId: input.sessionId };
    const to = { ...input.mapPoint(toPosition, []), cdp: input.cdp, sessionId: input.sessionId };
    await dispatchDragPoints(target, from, to, options);
}

/**
 * Chromium does not intercept an HTML5 drag that starts in the app window itself, the way it does
 * for a browser page. The drag becomes a native OS drag, whose modal loop blocks the main process
 * (and with it MCP) until a real mouse button is released, which synthetic input never sends. In
 * the app window, cancel any `dragstart` the synthetic drag causes and report it, rather than
 * freezing the app. A pointer-driven drag (a splitter, a slider) fires no `dragstart` and is not
 * affected. The guard runs in this renderer because `window.screen` always targets the window
 * that runs it.
 */
function guardAppWindowDragStart(target: IAutomationTarget): { readonly blocked: boolean; dispose(): void } | undefined {
    if (target.id !== "app") return undefined;
    const guard = {
        blocked: false,
        dispose: () => window.removeEventListener("dragstart", onDragStart, true),
    };
    const onDragStart = (event: DragEvent) => {
        if (!event.isTrusted) return;
        event.preventDefault();
        guard.blocked = true;
    };
    window.addEventListener("dragstart", onDragStart, true);
    return guard;
}

async function dispatchDragPoints(
    target: IAutomationTarget,
    from: Pick<ActionablePoint, "x" | "y" | "cdp" | "sessionId">,
    to: Pick<ActionablePoint, "x" | "y" | "cdp" | "sessionId">,
    options: DragOptions,
): Promise<void> {
    if (from.sessionId !== to.sessionId) throw new Error("drag source and target must be in the same frame");
    const cdp = from.cdp;
    const sessionId = from.sessionId;
    const key = cdp.registrationKey;
    let token: string | undefined;
    let pressed = false;
    let intercepted = false;
    const modifierFlags = getModifierFlags(options.modifiers);
    const steps = options.steps ?? 4;
    const holdMs = options.holdMs ?? 0;
    const appDragGuard = guardAppWindowDragStart(target);
    try {
        await cdp.send("Input.setInterceptDrags", { enabled: true }, sessionId);
        intercepted = true;
        token = await ipcRenderer.invoke(BrowserChannel.armDragIntercept, key, sessionId);
        await dispatchMouseEvent(cdp, sessionId, { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1, modifiers: modifierFlags });
        pressed = true;
        if (holdMs > 0) await new Promise(resolve => setTimeout(resolve, holdMs));
        for (let step = 1; step <= steps; step++) {
            const progress = step / steps;
            await dispatchMouseEvent(cdp, sessionId, {
                type: "mouseMoved", x: from.x + (to.x - from.x) * progress,
                y: from.y + (to.y - from.y) * progress, button: "left", buttons: 1, modifiers: modifierFlags,
            });
        }
        const data = await ipcRenderer.invoke(BrowserChannel.takeDragIntercept, token, 150);
        token = undefined;
        if (data) {
            for (const type of ["dragEnter", "dragOver", "drop"] as const) {
                await cdp.send("Input.dispatchDragEvent", { type, x: to.x, y: to.y, data }, sessionId);
            }
        }
        await dispatchMouseEvent(cdp, sessionId, { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, modifiers: modifierFlags });
        pressed = false;
        if (appDragGuard?.blocked) {
            throw new Error("drag cannot perform HTML5 drag-and-drop in the app window: the source element is draggable. Use the panel's own commands (context menu, object-model methods) instead.");
        }
    } finally {
        appDragGuard?.dispose();
        if (token) await ipcRenderer.invoke(BrowserChannel.takeDragIntercept, token, 0).catch((): null => null);
        if (intercepted) await cdp.send("Input.setInterceptDrags", { enabled: false }, sessionId).catch((): undefined => undefined);
        if (pressed) await dispatchMouseEvent(cdp, sessionId, {
            type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, modifiers: modifierFlags,
        }).catch((): undefined => undefined);
    }
}
