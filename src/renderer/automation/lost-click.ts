import { codedError } from "../../shared/coded-error";
import type { CdpSession } from "./CdpSession";

// One frame for settle/re-hit-test and post-release evidence; 50 ms caps a throttled frame.
// Three pre-press moves bound re-resolution when hover handlers keep replacing the target.
export const PRE_PRESS_RECHECK_ROUNDS = 3;
export const FRAME_FALLBACK_MS = 50;

export interface ClickEventRecord {
    type: string;
    button: number;
    detail: number;
    description: string;
    identity: number;
}

export interface LostClickEvidence {
    complete: boolean;
    events: ClickEventRecord[];
}

export interface LostClickRecorder {
    readAfterSettle(): Promise<LostClickEvidence>;
    cleanup(): Promise<void>;
}

export async function waitForTargetFrame(cdp: CdpSession, sessionId?: string): Promise<void> {
    await evaluateInFrame(cdp, `new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; resolve(true); };
        requestAnimationFrame(finish);
        setTimeout(finish, ${FRAME_FALLBACK_MS});
    })`, sessionId);
}

/** Arms a one-shot page-local recorder in the same frame that receives trusted input. */
export async function armLostClickRecorder(cdp: CdpSession, sessionId?: string): Promise<LostClickRecorder> {
    const key = `__persephoneLostClick_${Math.random().toString(36).slice(2)}`;
    const source = `(() => {
        const key = Symbol.for(${JSON.stringify(key)});
        const records = [];
        const nodeIds = new WeakMap();
        let nextId = 1;
        const describe = el => {
            if (!el || el.nodeType !== 1) return 'unknown element';
            const id = el.id ? '#' + el.id : '';
            const classes = typeof el.className === 'string' && el.className.trim()
                ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
            const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim().slice(0, 60);
            return '<' + el.localName + id + classes + '>' + (label ? ' ' + JSON.stringify(label) : '');
        };
        const listener = event => {
            const target = event.target;
            if (!nodeIds.has(target)) nodeIds.set(target, nextId++);
            records.push({ type: event.type, button: event.button, detail: event.detail,
                description: describe(target), identity: nodeIds.get(target) });
        };
        const types = ['pointerdown', 'mousedown', 'mouseup', 'click'];
        for (const type of types) window.addEventListener(type, listener, true);
        const dispose = () => { for (const type of types) window.removeEventListener(type, listener, true); };
        window[key] = { records, dispose };
        return true;
    })()`;
    try {
        await evaluateInFrame(cdp, source, sessionId);
    } catch {
        return { readAfterSettle: async () => ({ complete: false, events: [] }), cleanup: async () => undefined };
    }
    let finished = false;
    const cleanup = async (): Promise<void> => {
        if (finished) return;
        finished = true;
        await evaluateInFrame(cdp, `(() => { const key = Symbol.for(${JSON.stringify(key)}); const recorder = window[key]; if (recorder) recorder.dispose(); delete window[key]; })()`, sessionId).catch((): undefined => undefined);
    };
    return {
        async readAfterSettle(): Promise<LostClickEvidence> {
            if (finished) return { complete: false, events: [] };
            await waitForTargetFrame(cdp, sessionId).catch((): undefined => undefined);
            try {
                const value = await evaluateInFrame(cdp, `(() => {
                    const key = Symbol.for(${JSON.stringify(key)}); const recorder = window[key];
                    if (!recorder) return null;
                    recorder.dispose(); delete window[key];
                    return recorder.records;
                })()`, sessionId);
                finished = true;
                return Array.isArray(value) ? { complete: true, events: value as ClickEventRecord[] } : { complete: false, events: [] };
            } catch {
                return { complete: false, events: [] };
            }
        },
        cleanup,
    };
}

export function assertClickWasDispatched(evidence: LostClickEvidence, clickCount: number): void {
    const hasClick = evidence.events.some(event => event.type === "click");
    const requiresClick = clickCount === 1 || clickCount >= 2;
    if (!evidence.complete || !requiresClick || hasClick) return;
    const down = evidence.events.find(event => event.type === "pointerdown");
    const up = evidence.events.find(event => event.type === "mouseup");
    // Certain evidence only: without both a recorded press and release the recorder may simply
    // not have seen the input (another frame or window), so the click stays as it was.
    if (!down || !up) return;
    const changed = down.identity !== up.identity;
    const targetChange = changed
        ? `The element under the pointer changed between press and release (${down.description} → ${up.description}), so no click was dispatched.`
        : "The press and release reached the page but no click was dispatched.";
    throw codedError("click-not-dispatched", `${targetChange} If the page acts on mousedown, pass { checkClick: false }.`);
}

async function evaluateInFrame(cdp: CdpSession, expression: string, sessionId?: string): Promise<unknown> {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Page evaluation failed.");
    return result.result?.value;
}
