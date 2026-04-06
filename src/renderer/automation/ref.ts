/**
 * Centralized ref resolution for browser automation.
 *
 * Refs from accessibility snapshots:
 * - Main frame: [ref=e123] where 123 is backendDOMNodeId
 * - Iframe #1:  [ref=f1-e456] where 1 is frame index, 456 is backendDOMNodeId
 *
 * Frame-scoped refs use sessionId (from Target.attachToTarget) to resolve
 * in the correct iframe context via CDP DOM.resolveNode + Runtime.callFunctionOn.
 */
import type { CdpSession } from "./CdpSession";

// ── Frame Session Map ───────────────────────────────────────────────

/**
 * Map from frame index to CDP sessionId.
 * Populated by snapshot.ts buildSnapshot() during each snapshot generation.
 * Used by resolveRef() and callOnRef() to target the correct iframe session.
 */
let frameSessionMap = new Map<number, string>();

/** Update the frame session map. Called by buildSnapshot() after attaching to iframes. */
export function setFrameSessions(map: Map<number, string>): void {
    frameSessionMap = map;
}

// ── Ref Parsing ─────────────────────────────────────────────────────

/** Parsed ref with optional frame scope. */
export interface ParsedRef {
    /** Frame index (null = main frame, 1+ = iframe). */
    frameIndex: number | null;
    /** CDP backendDOMNodeId within the frame. */
    backendNodeId: number;
}

/**
 * Parse a ref string to frame index + backendNodeId.
 * - "e123" → { frameIndex: null, backendNodeId: 123 }
 * - "f1-e456" → { frameIndex: 1, backendNodeId: 456 }
 */
export function parseRef(ref: string): ParsedRef {
    if (ref.includes("-")) {
        const [framePart, nodePart] = ref.split("-");
        const frameIndex = parseInt(framePart.replace(/^f/, ""), 10);
        const backendNodeId = parseInt(nodePart.replace(/^e/, ""), 10);
        if (isNaN(frameIndex) || isNaN(backendNodeId)) {
            throw new Error(`Invalid ref "${ref}". Expected format: f1-e123`);
        }
        return { frameIndex, backendNodeId };
    }
    const backendNodeId = parseInt(ref.replace(/^e/, ""), 10);
    if (isNaN(backendNodeId)) {
        throw new Error(`Invalid ref "${ref}". Expected format: e123`);
    }
    return { frameIndex: null, backendNodeId };
}

// ── Ref Resolution ──────────────────────────────────────────────────

/**
 * Resolve a ref to a CDP remote object ID.
 * For frame-scoped refs, uses the sessionId from frameSessionMap.
 * Throws with a helpful message if the ref is stale.
 */
export async function resolveRef(cdp: CdpSession, ref: string): Promise<string> {
    const { frameIndex, backendNodeId } = parseRef(ref);
    const sessionId = frameIndex !== null ? frameSessionMap.get(frameIndex) : undefined;

    try {
        const { object } = await cdp.send("DOM.resolveNode", { backendNodeId }, sessionId);
        if (!object?.objectId) {
            throw new Error(
                `Could not resolve ref "${ref}". The element may have been removed. Re-take the snapshot.`,
            );
        }
        return object.objectId;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("No node with given id")) {
            throw new Error(
                `Ref "${ref}" is stale — the element is no longer in the DOM. Re-take the snapshot.`,
            );
        }
        throw err;
    }
}

/**
 * Resolve a ref and call a function on the resolved DOM element.
 * The function receives `this` bound to the element.
 * For frame-scoped refs, the function executes in the iframe's JS context.
 */
export async function callOnRef(
    cdp: CdpSession,
    ref: string,
    fn: string,
    returnByValue = false,
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { frameIndex } = parseRef(ref);
    const sessionId = frameIndex !== null ? frameSessionMap.get(frameIndex) : undefined;
    const objectId = await resolveRef(cdp, ref);

    const result = await cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: fn,
        returnByValue,
        awaitPromise: true,
    }, sessionId);

    if (result.exceptionDetails) {
        const errMsg = result.exceptionDetails.exception?.description
            || result.exceptionDetails.text
            || "callOnRef failed";
        throw new Error(errMsg);
    }
    return returnByValue ? result.result?.value : result;
}
