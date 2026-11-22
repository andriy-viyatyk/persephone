import { callOnRef, getRefSessionId, resolveRef } from "./ref";
import type { CdpSession } from "./CdpSession";
import { cdpExceptionMessage } from "./CdpSession";
import { createInputSession } from "./input-session";
import type { ElementLocator } from "./locator";
import { FRAME_OFFSETS_FN, VISIBLE_FN } from "./page-scripts";
import { evaluateCandidateCollection, evaluateWithCandidates } from "./selector-execution";
import type { IAutomationTarget } from "./types";

export type LocatorReadOptions = { nth?: number; tabId?: string };
export type LocatorQueryField = "role" | "name" | "text" | "visible" | "enabled" | "checked" | "tag" | "ref" | "value" | "attributes";
export interface LocatorQueryOptions extends LocatorReadOptions { fields?: LocatorQueryField[] }
export interface LocatorBoundingBox { x: number; y: number; width: number; height: number }
export interface LocatorQueryResult { matches: Array<Record<string, unknown>>; truncated: boolean }

const QUERY_FIELDS: readonly LocatorQueryField[] = ["role", "name", "text", "visible", "enabled", "checked", "tag", "ref", "value", "attributes"];
const DEFAULT_QUERY_FIELDS: readonly LocatorQueryField[] = ["role", "name", "text", "visible", "enabled", "checked", "tag", "ref"];
const MAX_QUERY_MATCHES = 200;
const STATE_FN = `const disabledByAria = el => { for (let node = el; node; node = node.parentElement) if (node.getAttribute('aria-disabled') === 'true') return true; return false; };
const enabledState = el => {
    if (disabledByAria(el)) return false;
    if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el instanceof HTMLOptionElement || el instanceof HTMLOptGroupElement || el instanceof HTMLFieldSetElement) return !el.matches(':disabled');
    return true;
};
const checkedState = el => {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked;
    const role = el.getAttribute('role');
    if (!['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'].includes(role)) throw new Error('Element is not a supported checkbox or radio control.');
    const value = el.getAttribute('aria-checked');
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'mixed') throw new Error('Element has mixed checked state, which is not supported.');
    throw new Error('Element has no valid aria-checked state.');
};`;

function validateNth(nth: number | undefined): void {
    if (nth !== undefined && (!Number.isSafeInteger(nth) || nth < 0)) throw new Error("{ nth } must be a non-negative safe integer.");
}

function selectMatches(nth: number | undefined): string {
    return nth === undefined ? "matches" : `matches[${nth}] ? [matches[${nth}]] : []`;
}

function scalarFunction(operation: "isVisible" | "isEnabled" | "isChecked" | "innerText" | "boundingBox", nth?: number): string {
    const selected = selectMatches(nth);
    const visibility = VISIBLE_FN;
    let result: string;
    if (operation === "isVisible") result = `${visibility} return visible(el);`;
    else if (operation === "isEnabled") result = `${STATE_FN} return enabledState(el);`;
    else if (operation === "isChecked") result = `${STATE_FN} return checkedState(el);`;
    else if (operation === "innerText") result = `if (!(el instanceof HTMLElement)) throw new Error('innerText is only supported for HTML elements.'); return el.innerText;`;
    else result = `${visibility} ${FRAME_OFFSETS_FN} const rect = el.getBoundingClientRect(); if (!visible(el) || !rect.width || !rect.height) return null; return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, frameOffsets };`;
    return `(resolve) => { const matches = resolve('query'); const selected = ${selected}; if (!selected.length) { ${operation === "isVisible" ? "return false;" : operation === "boundingBox" ? "return null;" : `throw new Error('Strict locator matched 0 elements for ${operation}; use { nth } or nth=.');`} } if (selected.length !== 1) throw new Error('Strict locator matched ' + selected.length + ' elements for ${operation}; use { nth } or nth=.'); const el = selected[0]; ${result} }`;
}

async function scalar<T>(target: IAutomationTarget, locator: ElementLocator, operation: "isVisible" | "isEnabled" | "isChecked" | "innerText" | "boundingBox", options: LocatorReadOptions = {}): Promise<T> {
    validateNth(options.nth);
    if ("selector" in locator) return evaluateWithCandidates<T>(target.cdp(options.tabId), locator.selector, scalarFunction(operation, options.nth));
    const sessionId = getRefSessionId(target.cdp(options.tabId), locator.ref);
    if (options.nth !== undefined && options.nth > 0) {
        // Resolve first so stale refs continue to produce the normal stale-ref error.
        const objectId = await resolveRef(target.cdp(options.tabId), locator.ref);
        await target.cdp(options.tabId).send("Runtime.releaseObject", { objectId }, sessionId).catch((): undefined => undefined);
        if (operation === "isVisible") return false as T;
        if (operation === "boundingBox") return null as T;
        throw new Error(`Strict locator matched 0 elements for ${operation}; use { nth } or nth=.`);
    }
    const scalarSource = scalarFunction(operation);
    const body = scalarSource.slice("(resolve) => {".length, -1);
    const result = await callOnRef(target.cdp(options.tabId), locator.ref,
        `function() { const resolve = () => [this]; ${body} }`, true);
    if (operation === "boundingBox" && result) {
        if (sessionId) throw new Error("boundingBox cannot translate OOPIF refs to the main viewport.");
        const frameOffsets = (result as LocatorBoundingBox & { frameOffsets: Array<{ x: number; y: number }> }).frameOffsets;
        const point = createInputSession(target.cdp(options.tabId)).mapPoint(result as LocatorBoundingBox, frameOffsets);
        return { x: point.x, y: point.y, width: result.width, height: result.height } as T;
    }
    return result;
}

export function locatorCount(target: IAutomationTarget, locator: ElementLocator, options?: LocatorReadOptions): Promise<number> {
    validateNth(options?.nth);
    if ("selector" in locator) return evaluateWithCandidates(target.cdp(options?.tabId), locator.selector,
        `(resolve) => { const matches = resolve('query'); return ${options?.nth === undefined ? "matches.length" : `Number(Boolean(matches[${options.nth}]))`}; }`);
    return (async () => {
        const cdp = target.cdp(options?.tabId);
        const sessionId = getRefSessionId(cdp, locator.ref);
        const objectId = await resolveRef(cdp, locator.ref);
        try { return options?.nth === undefined || options.nth === 0 ? 1 : 0; }
        finally { await cdp.send("Runtime.releaseObject", { objectId }, sessionId).catch((): undefined => undefined); }
    })();
}

export async function locatorAllInnerTexts(target: IAutomationTarget, locator: ElementLocator, options?: LocatorReadOptions): Promise<string[]> {
    validateNth(options?.nth);
    if ("selector" in locator) return evaluateWithCandidates(target.cdp(options?.tabId), locator.selector,
        `(resolve) => { const matches = resolve('query'); return ${options?.nth === undefined ? "matches" : `matches[${options.nth}] ? [matches[${options.nth}]] : []`}.map(el => el instanceof HTMLElement ? el.innerText : ''); }`);
    if (options?.nth !== undefined && options.nth > 0) {
        const cdp = target.cdp(options.tabId);
        const sessionId = getRefSessionId(cdp, locator.ref);
        const objectId = await resolveRef(cdp, locator.ref);
        await cdp.send("Runtime.releaseObject", { objectId }, sessionId).catch((): undefined => undefined);
        return [];
    }
    return [await callOnRef(target.cdp(options?.tabId), locator.ref, "function() { return this.innerText ?? ''; }", true) as string];
}

export const locatorIsVisible = (target: IAutomationTarget, locator: ElementLocator, options?: LocatorReadOptions) => scalar<boolean>(target, locator, "isVisible", options);
export const locatorIsEnabled = (target: IAutomationTarget, locator: ElementLocator, options?: LocatorReadOptions) => scalar<boolean>(target, locator, "isEnabled", options);
export const locatorIsChecked = (target: IAutomationTarget, locator: ElementLocator, options?: LocatorReadOptions) => scalar<boolean>(target, locator, "isChecked", options);
export const locatorInnerText = (target: IAutomationTarget, locator: ElementLocator, options?: LocatorReadOptions) => scalar<string>(target, locator, "innerText", options);

export async function locatorBoundingBox(target: IAutomationTarget, locator: ElementLocator, options?: LocatorReadOptions): Promise<LocatorBoundingBox | null> {
    if ("ref" in locator && getRefSessionId(target.cdp(options?.tabId), locator.ref)) throw new Error("boundingBox cannot translate OOPIF refs to the main viewport.");
    const result = await scalar<LocatorBoundingBox | null>(target, locator, "boundingBox", options);
    if (result && "selector" in locator) {
        const offsets = (result as LocatorBoundingBox & { frameOffsets?: Array<{ x: number; y: number }> }).frameOffsets ?? [];
        const point = createInputSession(target.cdp(options?.tabId)).mapPoint(result, offsets);
        return { x: point.x, y: point.y, width: result.width, height: result.height };
    }
    return result;
}

export function validateLocatorQueryFields(fields: unknown): LocatorQueryField[] {
    if (fields === undefined) return [...DEFAULT_QUERY_FIELDS];
    if (!Array.isArray(fields)) throw new Error(`fields must be an array of unique names: ${QUERY_FIELDS.join(", ")}.`);
    const seen = new Set<string>();
    for (const field of fields as unknown[]) {
        if (typeof field !== "string" || !(QUERY_FIELDS as readonly string[]).includes(field)) throw new Error(`Unknown query field ${JSON.stringify(field)}. Supported fields: ${QUERY_FIELDS.join(", ")}.`);
        if (seen.has(field)) throw new Error(`Duplicate query field ${JSON.stringify(field)}.`);
        seen.add(field);
    }
    return fields as LocatorQueryField[];
}

interface RemoteProperty { name?: string; value?: { value?: unknown; objectId?: string }; objectId?: string }
async function getProperties(cdp: CdpSession, objectId: string, sessionId?: string): Promise<RemoteProperty[]> {
    const response = await cdp.send("Runtime.getProperties", { objectId, ownProperties: true }, sessionId);
    return response.result ?? [];
}

export async function locatorQuery(target: IAutomationTarget, locator: ElementLocator, options: LocatorQueryOptions = {}): Promise<LocatorQueryResult> {
    validateNth(options.nth);
    const fields = validateLocatorQueryFields(options.fields);
    const cdp = target.cdp(options.tabId);
    const sessionId = "ref" in locator ? getRefSessionId(cdp, locator.ref) : undefined;
    let collectionId: string | undefined;
    let elementIds: string[] = [];
    const ownedObjectIds: string[] = [];
    try {
        let total: number;
        if ("selector" in locator) {
            collectionId = await evaluateCandidateCollection(cdp, locator.selector, `(resolve) => {
                let matches = resolve('query');
                ${options.nth === undefined ? "" : `matches = matches[${options.nth}] ? [matches[${options.nth}]] : [];`}
                matches = matches.slice().sort((a, b) => a === b ? 0 : (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
                return { total: matches.length, elements: matches.slice(0, ${MAX_QUERY_MATCHES}) };
            }`);
            ownedObjectIds.push(collectionId);
            const properties = await getProperties(cdp, collectionId);
            const elementsId = properties.find(property => property.name === "elements")?.value?.objectId;
            total = Number(properties.find(property => property.name === "total")?.value?.value ?? 0);
            if (elementsId) {
                ownedObjectIds.push(elementsId);
                const elements = await getProperties(cdp, elementsId);
                elementIds = elements.filter(property => /^\d+$/.test(property.name ?? "")).sort((a, b) => Number(a.name) - Number(b.name))
                    .map(property => property.value?.objectId).filter((id): id is string => Boolean(id));
            ownedObjectIds.push(...elementIds);
            }
        } else {
            const resolvedObjectId = await resolveRef(cdp, locator.ref);
            ownedObjectIds.push(resolvedObjectId);
            total = options.nth === undefined || options.nth === 0 ? 1 : 0;
            if (total) {
                const normalized = await cdp.send("Runtime.callFunctionOn", {
                    objectId: resolvedObjectId,
                    functionDeclaration: "function() { return this.nodeType === 1 ? this : this.parentElement; }",
                    returnByValue: false,
                }, sessionId);
                if (normalized.exceptionDetails) throw new Error(cdpExceptionMessage(normalized.exceptionDetails, "Could not resolve ref element."));
                const elementId = normalized.result?.objectId;
                if (!elementId) throw new Error("The ref does not resolve to an element.");
                ownedObjectIds.push(elementId);
                elementIds = [elementId];
            }
        }

        const data = elementIds.length ? await cdp.send("Runtime.callFunctionOn", {
            objectId: "" + ("selector" in locator ? await (async () => {
                if (!collectionId) throw new Error("Could not retain the locator candidate collection.");
                const props = await getProperties(cdp, collectionId);
                return props.find(property => property.name === "elements")?.value?.objectId ?? "";
            })() : elementIds[0]),
            functionDeclaration: `function(fields) {
                const elements = Array.isArray(this) ? this : [this];
                ${VISIBLE_FN}
                ${STATE_FN}
                return elements.map(el => {
                    if (!el?.isConnected) throw new Error('A locator match detached during capture.');
                    const row={};
                    for(const field of fields) {
                        if(field==='text') row.text=(el instanceof HTMLElement ? el.innerText.trim() : '').slice(0,1000);
                        else if(field==='visible') row.visible=visible(el);
                        else if(field==='enabled') row.enabled=enabledState(el);
                        else if(field==='checked') {
                            try { row.checked=checkedState(el); }
                            catch { row.checked=null; }
                        }
                        else if(field==='tag') row.tag=el.localName.toLowerCase();
                        else if(field==='value') row.value=('value' in el && typeof el.value==='string') ? el.value : null;
                        else if(field==='attributes') {
                            const attrs=Object.create(null);
                            for(const attr of Array.from(el.attributes).slice(0,50)) attrs[attr.name]=attr.value.slice(0,1000);
                            row.attributes=attrs;
                        }
                    }
                    return row;
                });
            }`,
            arguments: [{ value: fields }], awaitPromise: true, returnByValue: true,
        }, sessionId) : { result: { value: [] } };
        if (data.exceptionDetails) throw new Error(cdpExceptionMessage(data.exceptionDetails, "Could not read locator matches."));
        const matches = (data.result?.value ?? []) as Array<Record<string, unknown>>;
        const needsRefs = fields.includes("ref") || fields.includes("role") || fields.includes("name");
        const backendIds: number[] = [];
        if (needsRefs) {
            for (const objectId of elementIds) {
                const described = await cdp.send("DOM.describeNode", { objectId }, sessionId);
                const backendNodeId = described.node?.backendNodeId;
                if (!Number.isSafeInteger(backendNodeId) || backendNodeId <= 0) throw new Error("Could not create a stable element ref for a locator match.");
                backendIds.push(backendNodeId);
            }
        }
        let axByBackendId = new Map<number, { role: string | null; name: string | null }>();
        if (fields.includes("role") || fields.includes("name")) {
            const tree = await cdp.send("Accessibility.getFullAXTree", {}, sessionId);
            axByBackendId = new Map((tree.nodes ?? []).filter((node: { backendDOMNodeId?: number; ignored?: boolean }) => node.backendDOMNodeId && !node.ignored)
                .map((node: { backendDOMNodeId: number; role?: { value?: unknown }; name?: { value?: unknown } }) => [node.backendDOMNodeId, {
                    role: node.role?.value == null ? null : String(node.role.value), name: node.name?.value == null ? null : String(node.name.value),
                }]));
        }
        matches.forEach((row, index) => {
            const backendId = backendIds[index];
            if (fields.includes("ref")) row.ref = "ref" in locator ? locator.ref : backendId ? `e${backendId}` : null;
            if (fields.includes("role") || fields.includes("name")) {
                const ax = backendId ? axByBackendId.get(backendId) : undefined;
                if (fields.includes("role")) row.role = ax?.role ?? null;
                if (fields.includes("name")) row.name = ax?.name ?? null;
            }
        });
        // Rows come back by value, and Chromium sorts object keys when copying them out of the
        // page; rebuild each row in the requested field order.
        const ordered = matches.map(row => Object.fromEntries(fields.map(field => [field, row[field]])));
        return { matches: ordered, truncated: total > MAX_QUERY_MATCHES };
    } finally {
        for (let index = 0; index < ownedObjectIds.length; index += 8) {
            await Promise.allSettled(ownedObjectIds.slice(index, index + 8).map(objectId => cdp.send("Runtime.releaseObject", { objectId }, sessionId)));
        }
    }
}
