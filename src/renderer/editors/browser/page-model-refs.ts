import { cdpExceptionMessage, type CdpSession } from "../../automation/CdpSession";

const MARKER_PATTERN = /^persephone-ref:(\d{1,16}):x{32}$/;
const MARKER_PREFIX = "persephone-ref:";
const MAX_DISTINCT_REFS = 500;

/** Replace runtime-private model markers with the ordinary refs consumed by automation. */
export async function convertSiteModelRefs(
    cdp: CdpSession,
    result: unknown,
    isCurrentDocument: () => boolean,
): Promise<unknown> {
    if (!isCurrentDocument()) throw new Error("The page navigated while converting model element refs.");
    const refs = new Map<string, string>();

    const visit = async (value: unknown): Promise<unknown> => {
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index++) value[index] = await visit(value[index]);
            return value;
        }
        if (!value || typeof value !== "object") return value;
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record);
        if (keys.includes("ref") && typeof record.ref === "string" && record.ref.startsWith(MARKER_PREFIX)) {
            const marker = record.ref;
            const markerMatch = MARKER_PATTERN.exec(marker);
            if (!markerMatch || markerMatch[0] !== marker) throw new Error("The page model returned an invalid element ref marker.");
            let ref = refs.get(marker);
            if (!ref) {
                if (refs.size >= MAX_DISTINCT_REFS) throw new Error(`A page model reply may contain at most ${MAX_DISTINCT_REFS} distinct element refs.`);
                ref = await resolveMarker(cdp, marker);
                refs.set(marker, ref);
            }
            Object.defineProperty(record, "ref", { value: ref, enumerable: true, configurable: true, writable: true });
            return value;
        }
        for (const key of keys) {
            const next = await visit(record[key]);
            Object.defineProperty(record, key, { value: next, enumerable: true, configurable: true, writable: true });
        }
        return value;
    };

    const converted = await visit(result);
    if (!isCurrentDocument()) throw new Error("The page navigated while converting model element refs.");
    return converted;
}

async function resolveMarker(cdp: CdpSession, marker: string): Promise<string> {
    const expression = `(() => {
    const runtime = window.__persephoneSiteRuntime;
    if (!runtime || typeof runtime.__lookupElement !== "function") throw new Error("The site-extension ref registry is unavailable.");
    return runtime.__lookupElement(${JSON.stringify(marker)});
})()`;
    const evaluated = await cdp.send("Runtime.evaluate", { expression, returnByValue: false, awaitPromise: true });
    if (evaluated.exceptionDetails) throw new Error(cdpExceptionMessage(evaluated.exceptionDetails, "Could not resolve the page model element ref."));
    const remote = evaluated.result ?? {};
    const objectId: string | undefined = remote.objectId;
    if (remote.type !== "object" || remote.subtype !== "node" || !objectId) {
        if (objectId) await releaseObject(cdp, objectId);
        throw new Error("The page model ref did not resolve to an Element.");
    }
    try {
        const described = await cdp.send("DOM.describeNode", { objectId });
        const node = described.node as { nodeType?: unknown; backendNodeId?: unknown } | undefined;
        const backendNodeId = node?.backendNodeId;
        if (node?.nodeType !== 1 || typeof backendNodeId !== "number"
            || !Number.isSafeInteger(backendNodeId) || backendNodeId < 0
            || String(backendNodeId).length > 16) {
            throw new Error("The page model ref resolved to an invalid or out-of-range CDP backend node ID.");
        }
        return `e${backendNodeId}`;
    } finally {
        await releaseObject(cdp, objectId);
    }
}

async function releaseObject(cdp: CdpSession, objectId: string): Promise<void> {
    await cdp.send("Runtime.releaseObject", { objectId }).catch((): undefined => undefined);
}
