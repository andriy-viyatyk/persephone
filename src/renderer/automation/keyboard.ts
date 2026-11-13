import { resolveElementLocator, resolveActionablePoint } from "./locator";
import { clickElement } from "./mouse";
import { dispatchKeyDown, dispatchKeyUp, pressKey, pressSyntheticKey } from "./input";
import type { IAutomationTarget, ISyntheticInputHost } from "./types";
import type { ActionablePoint, RefLocator } from "./locator";

export interface KeyboardActionOptions {
    tabId?: string;
    target?: string | RefLocator;
    nth?: number;
    timeout?: number;
    synthetic?: boolean;
}

function requireKeyName(method: string, key: unknown): void {
    if (typeof key !== "string" || !key) {
        throw new Error(`${method}(key, options?) takes the key name first, e.g. ${method}("Enter", { target: { ref: "e12" } }).`);
    }
}

async function keyboardAction(
    target: IAutomationTarget & ISyntheticInputHost, options: KeyboardActionOptions,
): Promise<{ cdp: ActionablePoint["cdp"]; sessionId?: string }> {
    if (!options.target) {
        const input = target.inputCdp(options.tabId);
        return { cdp: input.cdp, sessionId: input.sessionId };
    }
    const locator = resolveElementLocator(options.target);
    const action = await resolveActionablePoint(target, locator, options);
    await clickElement(target, locator, options);
    return action;
}

/** Press a key or compound key on the focused element or an explicitly targeted locator. */
export async function pressKeyOnTarget(target: IAutomationTarget & ISyntheticInputHost, key: string, options: KeyboardActionOptions = {}): Promise<void> {
    requireKeyName("pressKey", key);
    const action = await keyboardAction(target, options);
    await pressKey(action.cdp, key, { sessionId: action.sessionId, synthetic: options.synthetic });
}

export async function keyDownOnTarget(target: IAutomationTarget & ISyntheticInputHost, key: string, options: KeyboardActionOptions = {}): Promise<void> {
    requireKeyName("keyDown", key);
    const action = await keyboardAction(target, options);
    if (options.synthetic) await pressSyntheticKey(action.cdp, key);
    else await dispatchKeyDown(action.cdp, key, action.sessionId);
}

export async function keyUpOnTarget(target: IAutomationTarget & ISyntheticInputHost, key: string, options: KeyboardActionOptions = {}): Promise<void> {
    requireKeyName("keyUp", key);
    const action = await keyboardAction(target, options);
    if (options.synthetic) await pressSyntheticKey(action.cdp, key);
    else await dispatchKeyUp(action.cdp, key, action.sessionId);
}

