import { callOnRef } from "./ref";
import { cdpExceptionMessage, type CdpSession } from "./CdpSession";
import { resolveCandidatesSource, VISIBLE_FN } from "./page-scripts";
import type { IAutomationTarget } from "./types";
import type { ElementLocator } from "./locator";


export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type EvaluateFunction = (...args: never[]) => unknown;
export async function evaluateInTarget(
    target: IAutomationTarget,
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
    target: IAutomationTarget,
    locator: ElementLocator,
    tabId?: string,
): Promise<string | null> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `(() => { const force = false; ${resolveCandidatesSource()} return resolveCandidates(${JSON.stringify(locator.selector)}, 'query')[0]?.textContent ?? null; })()`,
        );
    }
    return callOnRef(target.cdp(tabId), locator.ref,
        "function() { return this.textContent ?? null; }", true);
}

/** Read an element's value using a selector or a host-local accessibility ref. */
export async function getElementValue(
    target: IAutomationTarget,
    locator: ElementLocator,
    tabId?: string,
): Promise<string | null> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `(() => { const force = false; ${resolveCandidatesSource()} return resolveCandidates(${JSON.stringify(locator.selector)}, 'query')[0]?.value ?? null; })()`,
        );
    }
    return callOnRef(target.cdp(tabId), locator.ref,
        "function() { return this.value ?? null; }", true);
}

/** Read an element attribute using a selector or a host-local accessibility ref. */
export async function getElementAttribute(
    target: IAutomationTarget,
    locator: ElementLocator,
    attribute: string,
    tabId?: string,
): Promise<string | null> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `(() => { const force = false; ${resolveCandidatesSource()} return resolveCandidates(${JSON.stringify(locator.selector)}, 'query')[0]?.getAttribute(${JSON.stringify(attribute)}) ?? null; })()`,
        );
    }
    return callOnRef(target.cdp(tabId), locator.ref,
        `function() { return this.getAttribute(${JSON.stringify(attribute)}); }`, true);
}

/** Read an element's inner HTML using a selector or a host-local accessibility ref. */
export async function getElementHtml(
    target: IAutomationTarget,
    locator: ElementLocator,
    tabId?: string,
): Promise<string | null> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `(() => { const force = false; ${resolveCandidatesSource()} return resolveCandidates(${JSON.stringify(locator.selector)}, 'query')[0]?.innerHTML ?? null; })()`,
        );
    }
    return callOnRef(target.cdp(tabId), locator.ref,
        "function() { return this.innerHTML ?? null; }", true);
}

/** Check whether a selector or host-local accessibility ref identifies an element. */
export async function elementExists(
    target: IAutomationTarget,
    locator: ElementLocator,
    tabId?: string,
): Promise<boolean> {
    if ("selector" in locator) {
        return target.cdp(tabId).evaluate(
            `(() => { const force = false; ${resolveCandidatesSource()} return !!resolveCandidates(${JSON.stringify(locator.selector)}, 'query')[0]; })()`,
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
export async function waitFor(target: IAutomationTarget, options: WaitForOptions): Promise<void> {
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
                    const force = false; ${resolveCandidatesSource()}
                    const el = resolveCandidates(${selector}, 'query')[0];
                    const attached = !!el;
                    ${VISIBLE_FN}
                    const isVisible = !!el && visible(el);
                    return ${JSON.stringify(state)} === 'attached' ? attached
                        : ${JSON.stringify(state)} === 'detached' ? !attached
                        : ${JSON.stringify(state)} === 'visible' ? isVisible : !isVisible;
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

