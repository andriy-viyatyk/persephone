const { ipcRenderer } = require("electron"); // eslint-disable-line @typescript-eslint/no-var-requires
import { BrowserChannel } from "../../ipc/browser-ipc";
import { callOnRef, getRefSessionId } from "./ref";
import { resolveActionablePoint, runOnLocator } from "./locator";
import { FRAME_OFFSETS_FN, resolveCandidatesSource } from "./page-scripts";
import { MODIFIER_BITS } from "./input";
import { errMessage } from "../../shared/utils";
import type { IAutomationTarget, ISyntheticInputHost } from "./types";
import type { ActionablePoint, ElementLocator, MousePosition, MouseModifier, MouseActionOptions, ClickActionOptions, DragOptions } from "./locator";


export async function clickElement(
    target: IAutomationTarget & ISyntheticInputHost,
    locator: ElementLocator,
    options: ClickActionOptions = {},
): Promise<void> {
    const action = await resolveActionablePoint(target, locator, options);
    if (options.synthetic) {
        target.focusWebview(options.tabId);
        if ("selector" in locator) {
            await action.cdp.evaluate(`(() => { const force = false; ${resolveCandidatesSource()} const matches = resolveCandidates(${JSON.stringify(locator.selector)}, 'query', { visibleOnly: true, nth: ${options.nth ?? 0} }); const el = matches[0]; if (!el) throw new Error('Element not found'); el.click(); })()`);
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
    await dispatchMouseEvent(action.cdp, action.sessionId, {
        type: "mouseMoved", x: action.x, y: action.y, modifiers: modifierFlags,
    });
    for (let count = 1; count <= clickCount; count++) {
        await dispatchMouseEvent(action.cdp, action.sessionId, {
            type: "mousePressed", x: action.x, y: action.y, button, buttons: buttonFlag,
            modifiers: modifierFlags, clickCount: count,
        });
        await dispatchMouseEvent(action.cdp, action.sessionId, {
            type: "mouseReleased", x: action.x, y: action.y, button,
            modifiers: modifierFlags, clickCount: count,
        });
    }
}

/** Dispatch the existing synthetic hover events on a selector or accessibility ref. */
export async function hoverElement(
    target: IAutomationTarget & ISyntheticInputHost,
    locator: ElementLocator,
    options: MouseActionOptions = {},
): Promise<void> {
    const action = await resolveActionablePoint(target, locator, options);
    if (options.synthetic) {
        target.focusWebview(options.tabId);
        const syntheticHover = "function() { this.dispatchEvent(new MouseEvent('mouseenter', {bubbles:false, composed:true})); this.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, composed:true})); }";
        if ("selector" in locator) {
            await action.cdp.evaluate(`(() => { const force = false; ${resolveCandidatesSource()} const matches = resolveCandidates(${JSON.stringify(locator.selector)}, 'query', { visibleOnly: true, nth: ${options.nth ?? 0} }); const el = matches[0]; if (!el) throw new Error('Element not found'); el.dispatchEvent(new MouseEvent('mouseenter', {bubbles:false, composed:true})); el.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, composed:true})); })()`);
        } else {
            await callOnRef(action.cdp, locator.ref, syntheticHover);
        }
        return;
    }
    await dispatchMouseEvent(action.cdp, action.sessionId, {
        type: "mouseMoved", x: action.x, y: action.y, modifiers: getModifierFlags(options.modifiers),
    });
}

function getModifierFlags(modifiers: MouseModifier[] = []): number {
    return modifiers.reduce((flags, modifier) => flags | MODIFIER_BITS[modifier], 0);
}
async function dispatchMouseEvent(cdp: ActionablePoint["cdp"], sessionId: string | undefined, params: Record<string, unknown>): Promise<void> {
    await cdp.send("Input.dispatchMouseEvent", params, sessionId);
}
async function checkState(target: IAutomationTarget & ISyntheticInputHost, locator: ElementLocator, options: MouseActionOptions, desired: boolean): Promise<void> {
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
    target: IAutomationTarget, source: ElementLocator, destination: ElementLocator, options: DragOptions = {},
): Promise<void> {
    const from = await resolveActionablePoint(target, source, options);
    const to = await resolveActionablePoint(target, destination, { ...options, position: options.targetPosition });
    await dispatchDragPoints(from, to, options);
}

/** Dispatch a trusted click at viewport CSS pixels without locator actionability. */
export async function clickAtCoordinates(target: IAutomationTarget, position: MousePosition, options: { tabId?: string; button?: "left" | "right" | "middle"; clickCount?: number } = {}): Promise<void> {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 0 || position.y < 0) {
        throw new Error("clickAt coordinates must be non-negative finite viewport CSS pixels.");
    }
    const input = target.inputCdp(options.tabId);
    const point = input.mapPoint(position, []);
    const button = options.button ?? "left";
    const clickCount = options.clickCount ?? 1;
    await dispatchMouseEvent(input.cdp, input.sessionId, { type: "mouseMoved", ...point });
    await dispatchMouseEvent(input.cdp, input.sessionId, { type: "mousePressed", ...point, button, buttons: button === "left" ? 1 : 0, clickCount });
    await dispatchMouseEvent(input.cdp, input.sessionId, { type: "mouseReleased", ...point, button, buttons: 0, clickCount });
}

export async function dragCoordinates(target: IAutomationTarget, fromPosition: MousePosition, toPosition: MousePosition, options: DragOptions = {}): Promise<void> {
    const input = target.inputCdp(options.tabId);
    const from = { ...input.mapPoint(fromPosition, []), cdp: input.cdp, sessionId: input.sessionId };
    const to = { ...input.mapPoint(toPosition, []), cdp: input.cdp, sessionId: input.sessionId };
    await dispatchDragPoints(from, to, options);
}

async function dispatchDragPoints(
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
    try {
        await cdp.send("Input.setInterceptDrags", { enabled: true }, sessionId);
        intercepted = true;
        token = await ipcRenderer.invoke(BrowserChannel.armDragIntercept, key, sessionId);
        await dispatchMouseEvent(cdp, sessionId, { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1, modifiers: modifierFlags });
        pressed = true;
        const steps = 4;
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
    } finally {
        if (token) await ipcRenderer.invoke(BrowserChannel.takeDragIntercept, token, 0).catch((): null => null);
        if (intercepted) await cdp.send("Input.setInterceptDrags", { enabled: false }, sessionId).catch((): undefined => undefined);
        if (pressed) await dispatchMouseEvent(cdp, sessionId, {
            type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, modifiers: modifierFlags,
        }).catch((): undefined => undefined);
    }
}
