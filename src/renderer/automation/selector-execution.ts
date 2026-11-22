import { cdpExceptionMessage, type CdpSession } from "./CdpSession";
import { resolveCandidatesSource, selectorPreflightSource } from "./page-scripts";
import { parseRef, resolveRef } from "./ref";

interface AXProperty {
    name: string;
    value?: { value?: unknown };
}

interface AXQueryNode {
    backendDOMNodeId?: number;
    ignored?: boolean;
    role?: { value?: unknown };
    name?: { value?: unknown };
    properties?: AXProperty[];
}

interface AXFact {
    role: string;
    name: string;
    ignored: boolean;
    properties: Array<{ name: string; value: unknown }>;
}

interface SelectorHostFacts {
    roles: string[];
    refs: string[];
}

const CDP_CONCURRENCY = 8;

/** Evaluate a repository-authored body with the page's shared selector resolver. */
export async function evaluateWithCandidates<T>(cdp: CdpSession, selector: string, body: string): Promise<T> {
    const result = await executeWithCandidates(cdp, selector, body, true);
    return result.value as T;
}

/** Evaluate a repository-authored body that returns one element and keep its remote object ID. */
export async function evaluateCandidateObject(cdp: CdpSession, selector: string, body: string): Promise<string> {
    const result = await executeWithCandidates(cdp, selector, body, false);
    const objectId = result.objectId;
    if (!objectId) throw new Error("Selector evaluation did not return an element.");
    return objectId;
}

/** Evaluate a repository-authored body that returns a remote collection of candidate elements. */
export async function evaluateCandidateCollection(cdp: CdpSession, selector: string, body: string): Promise<string> {
    const result = await executeWithCandidates(cdp, selector, body, false);
    if (!result.objectId) throw new Error("Selector evaluation did not return a candidate collection.");
    return result.objectId;
}

async function executeWithCandidates(
    cdp: CdpSession,
    selector: string,
    body: string,
    returnByValue: boolean,
): Promise<{ value?: unknown; objectId?: string }> {
    const fallbackExpression = makeEvaluationExpression(selector, body);
    if (!selector.includes("role=") && !selector.includes("ref=")) {
        return evaluateNormally(cdp, fallbackExpression, returnByValue);
    }

    const preflight = selectorPreflightSource().replace("__SELECTOR__", JSON.stringify(selector));
    const hostFacts = await cdp.evaluate(preflight) as SelectorHostFacts;
    if (!hostFacts.roles.length && !hostFacts.refs.length) return evaluateNormally(cdp, fallbackExpression, returnByValue);

    let documentObjectId: string | undefined;
    const elementObjectIds: string[] = [];
    const refObjectIds: string[] = [];
    try {
        await cdp.send("DOM.getDocument", { depth: 0 });
        const documentResult = await cdp.send("Runtime.evaluate", {
            expression: "document",
            returnByValue: false,
            awaitPromise: true,
        });
        if (documentResult.exceptionDetails) {
            throw new Error(cdpExceptionMessage(documentResult.exceptionDetails, "Could not acquire document object."));
        }
        documentObjectId = documentResult.result?.objectId;
        if (!documentObjectId) throw new Error("Could not acquire document object.");

        const uniqueRoles = [...new Set(hostFacts.roles)];
        const roleResults = await mapBounded(uniqueRoles, CDP_CONCURRENCY, role => cdp.send("Accessibility.queryAXTree", {
            objectId: documentObjectId,
            role,
        }));
        const nodesByBackendId = new Map<number, AXQueryNode>();
        for (const result of roleResults) {
            for (const node of (result.nodes || []) as AXQueryNode[]) {
                if (node.backendDOMNodeId !== undefined && !nodesByBackendId.has(node.backendDOMNodeId)) {
                    nodesByBackendId.set(node.backendDOMNodeId, node);
                }
            }
        }
        const nodes = [...nodesByBackendId.entries()];
        const resolved = await mapBounded(nodes, CDP_CONCURRENCY, async ([backendDOMNodeId, node]) => {
            const result = await cdp.send("DOM.resolveNode", { backendNodeId: backendDOMNodeId });
            const objectId = result.object?.objectId;
            if (!objectId) throw new Error("Could not resolve an accessibility node to a DOM object.");
            elementObjectIds.push(objectId);
            return {
                objectId,
                fact: {
                    role: String(node.role?.value ?? ""),
                    name: String(node.name?.value ?? ""),
                    ignored: node.ignored === true,
                    properties: (node.properties || []).map(property => ({
                        name: property.name,
                        value: property.value?.value,
                    })),
                } satisfies AXFact,
            };
        });
        const inputObjectIds = resolved.map(item => item.objectId);
        const facts = resolved.map(item => item.fact);
        const refs: Record<string, string> = Object.create(null);
        for (const ref of [...new Set(hostFacts.refs)]) {
            const parsed = parseRef(ref);
            if (parsed.frameIndex !== null) throw new Error(`Ref "${ref}" cannot be used as a selector scope: ref= supports main-frame refs only.`);
            const objectId = await resolveRef(cdp, ref);
            refObjectIds.push(objectId);
            refs[ref] = objectId;
        }
        const call = await cdp.send("Runtime.callFunctionOn", {
            objectId: documentObjectId,
            functionDeclaration: makeResolverFunction(selector, body, inputObjectIds.length, [...new Set(hostFacts.refs)]),
            arguments: [
                ...inputObjectIds.map(objectId => ({ objectId })),
                { value: facts },
                ...Object.values(refs).map(objectId => ({ objectId })),
            ],
            awaitPromise: true,
            returnByValue,
        });
        if (call.exceptionDetails) {
            throw new Error(cdpExceptionMessage(call.exceptionDetails, "Evaluation failed"));
        }
        return { value: call.result?.value, objectId: call.result?.objectId };
    } finally {
        const releases: Promise<unknown>[] = [];
        if (documentObjectId) releases.push(cdp.send("Runtime.releaseObject", { objectId: documentObjectId }));
        await Promise.allSettled(releases);
        await settleReleases(cdp, elementObjectIds);
        await settleReleases(cdp, refObjectIds);
    }
}

async function evaluateNormally(
    cdp: CdpSession,
    expression: string,
    returnByValue: boolean,
): Promise<{ value?: unknown; objectId?: string }> {
    if (returnByValue) return { value: await cdp.evaluate(expression) };
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: false, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(cdpExceptionMessage(result.exceptionDetails, "Evaluation failed"));
    return { value: result.result?.value, objectId: result.result?.objectId };
}

function makeEvaluationExpression(selector: string, body: string): string {
    return `(() => {
        ${resolveCandidatesSource()}
        const selector = ${JSON.stringify(selector)};
        const resolve = (mode, options = {}) => resolveCandidates(selector, mode, options);
        return (${body})(resolve);
    })()`;
}

function makeResolverFunction(selector: string, body: string, elementCount: number, refNames: string[]): string {
    return `function(...args) {
        ${resolveCandidatesSource()}
        const selector = ${JSON.stringify(selector)};
        const elements = args.slice(0, ${elementCount});
        const facts = args[${elementCount}].map((fact, index) => ({ ...fact, element: elements[index] }))
            .filter(fact => fact.element instanceof Element && fact.element.isConnected && fact.element.ownerDocument === document);
        const refObjects = args.slice(${elementCount + 1});
        const refs = Object.create(null);
        ${JSON.stringify(refNames)}.forEach((name, index) => {
            const object = refObjects[index];
            const element = object?.nodeType === 1 ? object : object?.parentElement;
            if (!element || !element.isConnected) throw new Error('Ref "' + name + '" is stale — the element is no longer in the DOM. Re-take the snapshot.');
            if (element.ownerDocument !== document) throw new Error('Ref "' + name + '" belongs to a different document than the selected main frame.');
            refs[name] = element;
        });
        const resolve = (mode, options = {}) => resolveCandidates(selector, mode, { ...options, refs }, facts);
        return (${body})(resolve);
    }`;
}

async function settleReleases(cdp: CdpSession, objectIds: string[]): Promise<void> {
    await mapBounded(objectIds, CDP_CONCURRENCY, async objectId => {
        await cdp.send("Runtime.releaseObject", { objectId });
    }).then((): void => undefined, (): void => undefined);
}

async function mapBounded<T, R>(values: T[], concurrency: number, operation: (value: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(values.length);
    const failures: unknown[] = [];
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (true) {
            const index = next++;
            if (index >= values.length) return;
            try { results[index] = await operation(values[index]); }
            catch (error: unknown) { failures.push(error); }
        }
    });
    await Promise.allSettled(workers);
    if (failures.length) throw failures[0];
    return results;
}
