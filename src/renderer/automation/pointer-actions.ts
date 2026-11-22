import { getRefSessionId } from "./ref";
import { resolveActionablePoint, resolveElementLocator } from "./locator";
import {
    MODIFIER_BITS, clearPointerRoute, ensurePointerState, findPointerState, getPointerState, pointerButtonsMask,
} from "./input";
import type { PointerButton } from "./input";
import { isAutomationContextLoss } from "./context-loss";
import { clearForcedHover } from "./hover-pseudo-state";
import type { ActionablePoint, ElementLocator, LocatorInput, MousePosition, MouseModifier, MouseActionOptions, PointerActionOptions, WheelActionOptions } from "./locator";
import type { IAutomationTarget } from "./types";

type PointerTarget = LocatorInput | MousePosition;

export async function clearForcedHoverForLocator(target: IAutomationTarget, locator: ElementLocator, tabId?: string): Promise<void> {
    const cdp = target.cdp(tabId);
    const sessionId = "ref" in locator ? getRefSessionId(cdp, locator.ref) : undefined;
    await clearForcedHover(cdp, sessionId);
}

function isMousePosition(value: PointerTarget): value is MousePosition {
    return Boolean(value && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === 2 && "x" in value && "y" in value);
}

function pointerButton(value: PointerButton | undefined): PointerButton {
    if (value !== undefined && value !== "left" && value !== "middle" && value !== "right") {
        throw new Error('button must be "left", "middle", or "right".');
    }
    return value ?? "left";
}

function validateModifiers(modifiers: MouseModifier[] | undefined): void {
    if (modifiers !== undefined && (!Array.isArray(modifiers) || modifiers.some(modifier => !["Alt", "Control", "Meta", "Shift"].includes(modifier)))) {
        throw new Error('modifiers must contain only "Alt", "Control", "Meta", or "Shift".');
    }
}

async function resolvePointerPoint(
    target: IAutomationTarget,
    value: PointerTarget,
    options: MouseActionOptions,
): Promise<{ x: number; y: number; cdp: ActionablePoint["cdp"]; sessionId?: string }> {
    if (isMousePosition(value)) {
        validatePoint(value, "pointer coordinates");
        const input = target.inputCdp(options.tabId);
        return { ...input.mapPoint(value, []), cdp: input.cdp, sessionId: input.sessionId };
    }
    const locator = resolveElementLocator(value);
    const action = await resolveActionablePoint(target, locator, options);
    return { x: action.x, y: action.y, cdp: action.cdp, sessionId: action.sessionId };
}

/** The one entry point that ends forced :hover state before a public pointer action. */
async function preparePointerAction(target: IAutomationTarget, value: PointerTarget | undefined, options: MouseActionOptions): Promise<void> {
    if (value !== undefined && !isMousePosition(value)) {
        await clearForcedHoverForLocator(target, resolveElementLocator(value), options.tabId);
        return;
    }
    const state = value === undefined ? findPointerState(target.cdp(options.tabId)) : undefined;
    const input = state ? { cdp: state.cdp, sessionId: state.sessionId } : target.inputCdp(options.tabId);
    await clearForcedHover(input.cdp, input.sessionId);
}

function validatePointerSteps(steps = 1): number {
    if (!Number.isInteger(steps) || steps < 1 || steps > 1000) throw new Error("steps must be a positive integer no greater than 1000.");
    return steps;
}

/** Press a trusted pointer button and retain its state until mouseUp or cleanup. */
export async function mouseDown(target: IAutomationTarget, value: PointerTarget, options: PointerActionOptions = {}): Promise<void> {
    pointerButton(options.button);
    validateModifiers(options.modifiers);
    await preparePointerAction(target, value, options);
    const action = await resolvePointerPoint(target, value, options);
    const state = ensurePointerState(action.cdp, action.sessionId);
    const button = pointerButton(options.button);
    const old = state.buttons.get(button);
    if (old && !state.point) throw new Error("Cannot release a previously held mouse button: no pointer position is tracked for this target.");
    if (old && state.point) {
        state.buttons.delete(button);
        try {
            await dispatchMouseEvent(action.cdp, action.sessionId, {
                type: "mouseReleased", x: state.point.x, y: state.point.y, button,
                buttons: pointerButtonsMask(state), clickCount: 1,
            });
            if (old.menuTabId) target.automationContextMenu?.(old.menuTabId, "release");
        } catch (error: unknown) {
            if (isAutomationContextLoss(error)) clearPointerRoute(action.cdp, action.sessionId);
            else {
                state.buttons.set(button, old);
                throw new Error("Could not release the previously held mouse button before mouseDown.", { cause: error });
            }
        }
    }
    const modifiers = getModifierFlags(options.modifiers);
    try {
        await dispatchMouseEvent(action.cdp, action.sessionId, {
            type: "mouseMoved", x: action.x, y: action.y, button: "none",
            buttons: pointerButtonsMask(state), modifiers,
        });
        const menuTabId = button === "right" && options.nativeMenu !== true
            ? target.automationContextMenu?.(options.tabId, "arm") : undefined;
        try {
            await dispatchMouseEvent(action.cdp, action.sessionId, {
                type: "mousePressed", x: action.x, y: action.y, button,
                buttons: pointerButtonsMask(state) | (button === "left" ? 1 : button === "right" ? 2 : 4),
                modifiers, clickCount: 1,
            });
            state.point = { x: action.x, y: action.y };
            state.buttons.set(button, { menuTabId });
        } catch (error: unknown) {
            if (menuTabId) target.automationContextMenu?.(menuTabId, "release");
            throw error;
        }
    } catch (error: unknown) {
        if (isAutomationContextLoss(error)) clearPointerRoute(action.cdp, action.sessionId);
        throw error;
    }
}

/** Move the trusted pointer, retaining the complete held-button bitmask. */
export async function mouseMove(target: IAutomationTarget, value: PointerTarget, options: PointerActionOptions = {}): Promise<void> {
    validateModifiers(options.modifiers);
    await preparePointerAction(target, value, options);
    const action = await resolvePointerPoint(target, value, options);
    const state = getPointerState(action.cdp, action.sessionId);
    const steps = validatePointerSteps(options.steps);
    if (!state?.point && steps > 1) throw new Error("mouseMove steps greater than 1 require a previously tracked pointer position.");
    const from = state?.point ?? { x: action.x, y: action.y };
    const modifiers = getModifierFlags(options.modifiers);
    for (let step = 1; step <= steps; step++) {
        const progress = step / steps;
        await dispatchMouseEvent(action.cdp, action.sessionId, {
            type: "mouseMoved", x: from.x + (action.x - from.x) * progress,
            y: from.y + (action.y - from.y) * progress, button: "none",
            buttons: pointerButtonsMask(state), modifiers,
        });
    }
    ensurePointerState(action.cdp, action.sessionId).point = { x: action.x, y: action.y };
}

/** Release one trusted pointer button, defaulting to the left button. */
export async function mouseUp(target: IAutomationTarget, value?: PointerTarget, options: PointerActionOptions = {}): Promise<void> {
    pointerButton(options.button);
    validateModifiers(options.modifiers);
    await preparePointerAction(target, value, options);
    const base = target.cdp(options.tabId);
    const existing = findPointerState(base);
    if (!existing || !existing.buttons.size) throw new Error("No mouse button is held for this target.");
    const button = pointerButton(options.button);
    if (!existing.buttons.has(button)) throw new Error("No mouse button is held for this target.");
    const action = value === undefined
        ? existing.point ? { x: existing.point.x, y: existing.point.y, cdp: existing.cdp, sessionId: existing.sessionId }
            : undefined
        : await resolvePointerPoint(target, value, options);
    if (!action) throw new Error("Cannot release a held mouse button: no pointer position is tracked for this target.");
    if (action.cdp.registrationKey !== existing.cdp.registrationKey || action.sessionId !== existing.sessionId) {
        throw new Error("No mouse button is held for this target.");
    }
    const entry = existing.buttons.get(button);
    const remaining = pointerButtonsMask(existing) & ~(button === "left" ? 1 : button === "right" ? 2 : 4);
    try {
        if (value !== undefined) await dispatchMouseEvent(action.cdp, action.sessionId, {
            type: "mouseMoved", x: action.x, y: action.y, button: "none", buttons: pointerButtonsMask(existing),
            modifiers: getModifierFlags(options.modifiers),
        });
        await dispatchMouseEvent(action.cdp, action.sessionId, {
            type: "mouseReleased", x: action.x, y: action.y, button, buttons: remaining,
            modifiers: getModifierFlags(options.modifiers), clickCount: 1,
        });
        existing.point = { x: action.x, y: action.y };
        existing.buttons.delete(button);
        if (entry?.menuTabId) target.automationContextMenu?.(entry.menuTabId, "release");
        if (!existing.buttons.size) clearPointerRoute(action.cdp, action.sessionId);
    } catch (error: unknown) {
        if (entry?.menuTabId) target.automationContextMenu?.(entry.menuTabId, "release");
        if (isAutomationContextLoss(error)) clearPointerRoute(action.cdp, action.sessionId);
        throw error;
    }
}

/** Dispatch trusted wheel deltas at a target or the last pointer position. */
export async function wheel(
    target: IAutomationTarget,
    delta: { deltaX: number; deltaY: number },
    value?: PointerTarget,
    options: WheelActionOptions = {},
): Promise<void> {
    if (!delta || !Number.isFinite(delta.deltaX) || !Number.isFinite(delta.deltaY)) throw new Error("wheel deltas must be finite numbers.");
    validateModifiers(options.modifiers);
    await preparePointerAction(target, value, options);
    const base = target.cdp(options.tabId);
    const previous = findPointerState(base);
    let action: { x: number; y: number; cdp: ActionablePoint["cdp"]; sessionId?: string };
    if (value === undefined) {
        if (!previous?.point) throw new Error("No pointer position is tracked for this target.");
        action = { ...previous.point, cdp: previous.cdp, sessionId: previous.sessionId };
    } else action = await resolvePointerPoint(target, value, options);
    await dispatchMouseEvent(action.cdp, action.sessionId, {
        type: "mouseWheel", x: action.x, y: action.y, deltaX: delta.deltaX, deltaY: delta.deltaY,
        modifiers: getModifierFlags(options.modifiers), buttons: pointerButtonsMask(getPointerState(action.cdp, action.sessionId)),
    });
    ensurePointerState(action.cdp, action.sessionId).point = { x: action.x, y: action.y };
}

export function getModifierFlags(modifiers: MouseModifier[] = []): number {
    return modifiers.reduce((flags, modifier) => flags | MODIFIER_BITS[modifier], 0);
}

export async function dispatchMouseEvent(cdp: ActionablePoint["cdp"], sessionId: string | undefined, params: Record<string, unknown>): Promise<void> {
    try { await cdp.send("Input.dispatchMouseEvent", params, sessionId); }
    catch (error: unknown) {
        if (isAutomationContextLoss(error)) clearPointerRoute(cdp, sessionId);
        throw error;
    }
}

export function validatePoint(point: MousePosition, name: string, nonNegative = true): MousePosition {
    if (!point || typeof point !== "object" || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || (nonNegative && (point.x < 0 || point.y < 0))) {
        throw new Error(`${name} must contain finite ${nonNegative ? "non-negative " : ""}x and y coordinates.`);
    }
    return point;
}
