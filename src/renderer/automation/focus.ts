import { callOnRef, getRefSessionId } from "./ref";
import { resolveActionablePoint, runOnLocator, type ActionablePoint, type ElementLocator, type MouseActionOptions } from "./locator";
import type { IAutomationTarget, ISyntheticInputHost } from "./types";

/** Focus a visible, stable element without sending pointer input. */
export async function focusElement(
    target: IAutomationTarget & ISyntheticInputHost,
    locator: ElementLocator,
    options: MouseActionOptions = {},
): Promise<Pick<ActionablePoint, "cdp" | "sessionId">> {
    const action = await resolveActionablePoint(target, locator, { ...options, hitTest: false });
    await target.focusWebview(options.tabId);
    const baseCdp = target.cdp(options.tabId);
    const sessionId = "ref" in locator ? getRefSessionId(baseCdp, locator.ref) : undefined;
    const body = `
        if (typeof this.focus !== 'function') return false;
        try { this.focus({ preventScroll: true }); } catch { return false; }
        let active = this.ownerDocument.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        return active === this;
    `;
    const focused = "ref" in locator
        ? await callOnRef(baseCdp, locator.ref, `function() { ${body} }`, true)
        : await runOnLocator<boolean>(baseCdp, locator, options.nth, body);
    if (!focused) throw new Error("The target element could not receive DOM focus.");
    return { cdp: action.cdp, sessionId: sessionId ?? action.sessionId };
}
