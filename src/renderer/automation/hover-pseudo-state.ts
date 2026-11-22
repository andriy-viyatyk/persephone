import type { CdpSession } from "./CdpSession";
import { getRefSessionId, resolveRef } from "./ref";
import { evaluateCandidateObject } from "./selector-execution";
import { errMessage } from "../../shared/utils";
import type { ElementLocator } from "./locator";

const forcedHoverSessions = new Set<string>();

/** Apply CSS :hover to a locator and its composed ancestors in one CDP session. */
export async function forceHover(
    cdp: CdpSession,
    locator: ElementLocator,
    nth?: number,
    includeHidden = false,
): Promise<void> {
    const sessionId = "ref" in locator ? getRefSessionId(cdp, locator.ref) : undefined;
    const key = sessionKey(cdp, sessionId);
    let targetObjectId: string | undefined;
    let ancestorsObjectId: string | undefined;
    const elementObjectIds: string[] = [];
    let cssEnabled = false;
    try {
        await cdp.send("DOM.enable", {}, sessionId);
        await cdp.send("CSS.enable", {}, sessionId);
        cssEnabled = true;
        targetObjectId = "ref" in locator
            ? await resolveRef(cdp, locator.ref)
            : await evaluateCandidateObject(cdp, locator.selector, `(resolve) => {
                const matches = resolve('action', { force: ${includeHidden}, nth: ${nth ?? "undefined"} });
                if (matches.length > 1 && ${nth === undefined}) throw new Error('Ambiguous selector: ' + ${JSON.stringify(locator.selector)});
                const element = matches[${nth ?? 0}];
                if (!element) throw new Error('Element not found: ' + ${JSON.stringify(locator.selector)});
                return element;
            }`);

        // A selector engine may itself call DOM.getDocument (for example, role=); acquire the
        // frontend document only after the candidate object exists and before requesting node IDs.
        await cdp.send("DOM.getDocument", { depth: 0 }, sessionId);
        const ancestors = await cdp.send("Runtime.callFunctionOn", {
            objectId: targetObjectId,
            functionDeclaration: `function() {
                const elements = [];
                let element = this.nodeType === 1 ? this : this.parentElement;
                while (element) {
                    elements.push(element);
                    if (element.parentElement) element = element.parentElement;
                    else {
                        const root = element.getRootNode();
                        element = root instanceof ShadowRoot ? root.host : null;
                    }
                }
                return elements;
            }`,
            returnByValue: false,
            awaitPromise: true,
        }, sessionId);
        if (ancestors.exceptionDetails) throw new Error("Could not resolve composed hover ancestors.");
        ancestorsObjectId = ancestors.result?.objectId;
        if (!ancestorsObjectId) throw new Error("Could not resolve composed hover ancestors.");
        const properties = await cdp.send("Runtime.getProperties", { objectId: ancestorsObjectId, ownProperties: true }, sessionId);
        for (const property of (properties.result ?? []) as Array<{ name?: string; value?: { objectId?: string } }>) {
            if (property.name && /^\d+$/.test(property.name) && property.value?.objectId) {
                elementObjectIds.push(property.value.objectId);
            }
        }
        for (const objectId of elementObjectIds) {
            const { nodeId } = await cdp.send("DOM.requestNode", { objectId }, sessionId);
            if (typeof nodeId !== "number") throw new Error("Could not resolve a hover ancestor node.");
            await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] }, sessionId);
        }
        forcedHoverSessions.add(key);
    } catch (error: unknown) {
        if (cssEnabled) await cdp.send("CSS.disable", {}, sessionId).catch((): undefined => undefined);
        throw error;
    } finally {
        const objectIds = [...new Set([...elementObjectIds, ...(ancestorsObjectId ? [ancestorsObjectId] : []), ...(targetObjectId ? [targetObjectId] : [])])];
        await Promise.allSettled(objectIds.map(objectId => cdp.send("Runtime.releaseObject", { objectId }, sessionId)));
    }
}

/** Clear forced pseudo states owned by this module for a CDP session. */
export async function clearForcedHover(cdp: CdpSession, sessionId?: string): Promise<void> {
    const key = sessionKey(cdp, sessionId);
    if (!forcedHoverSessions.has(key)) return;
    try {
        await cdp.send("CSS.disable", {}, sessionId);
    } catch (error: unknown) {
        // Detach and an already disabled CSS domain both mean the forced state is gone.
        if (!/detach|not enabled|not attached|closed/i.test(errMessage(error))) throw error;
    } finally {
        forcedHoverSessions.delete(key);
    }
}

function sessionKey(cdp: CdpSession, sessionId?: string): string {
    return `${cdp.registrationKey}|${sessionId ?? ""}`;
}
