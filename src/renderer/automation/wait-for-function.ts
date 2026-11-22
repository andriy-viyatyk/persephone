import { cdpExceptionMessage } from "./CdpSession";
import { isAutomationContextLoss } from "./context-loss";
import { isJsonValue, type JsonValue } from "./json-value";
import type { IAutomationTarget } from "./types";

export interface WaitForFunctionOptions {
    args?: JsonValue[];
    timeout?: number;
    polling?: "raf" | number;
    tabId?: string;
}

const DEFAULT_TIMEOUT = 10_000;
const MAX_TIMEOUT = 28_000;

function validateOptions(args: JsonValue[], options: WaitForFunctionOptions): { timeout: number; polling: "raf" | number } {
    if (!Array.isArray(args) || !args.every(value => isJsonValue(value))) throw new Error("waitForFunction args must contain only JSON-safe values.");
    const rawTimeout = options.timeout ?? DEFAULT_TIMEOUT;
    if (typeof rawTimeout !== "number" || !Number.isFinite(rawTimeout) || rawTimeout < 0) throw new Error("waitForFunction timeout must be a finite non-negative number.");
    const rawPolling = options.polling ?? "raf";
    if (rawPolling !== "raf" && (typeof rawPolling !== "number" || !Number.isFinite(rawPolling) || rawPolling < 10 || rawPolling > 10_000)) {
        throw new Error("waitForFunction polling must be 'raf' or a finite interval from 10 to 10000 ms.");
    }
    return { timeout: Math.min(rawTimeout, MAX_TIMEOUT), polling: rawPolling };
}

export async function waitForFunction(
    target: IAutomationTarget,
    fn: string | ((...args: never[]) => unknown),
    options: WaitForFunctionOptions = {},
): Promise<JsonValue> {
    if (typeof fn !== "string" && typeof fn !== "function") throw new Error("waitForFunction expects a function or function-source string.");
    const source = typeof fn === "string" ? fn : fn.toString();
    const args = options.args ?? [];
    const { timeout, polling } = validateOptions(args, options);
    const cdp = target.cdp(options.tabId);
    const expression = `(() => {
        const source = ${JSON.stringify(source)};
        let predicate;
        try { predicate = (0, eval)('(' + source + ')'); }
        catch (error) { throw new Error('Could not parse waitForFunction predicate: ' + (error?.message || error)); }
        if (typeof predicate !== 'function') throw new Error('waitForFunction source must evaluate to a function.');
        const args = ${JSON.stringify(args)};
        const deadline = Date.now() + ${timeout};
        const poll = ${typeof polling === "number" ? JSON.stringify(polling) : '"raf"'};
        const wait = () => new Promise(resolve => {
            if (poll === 'raf') {
                let settled = false;
                let frame = 0;
                const timer = setTimeout(() => { if (settled) return; settled = true; cancelAnimationFrame(frame); resolve(); }, 100);
                frame = requestAnimationFrame(() => { if (settled) return; settled = true; clearTimeout(timer); resolve(); });
            } else setTimeout(resolve, poll);
        });
        const jsonValue = value => {
            const seen = new Set();
            const valid = item => {
                if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
                if (typeof item === 'number') return Number.isFinite(item);
                if (typeof item !== 'object' || seen.has(item)) return false;
                const prototype = Object.getPrototypeOf(item);
                if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return false;
                if (Object.getOwnPropertySymbols(item).length) return false;
                seen.add(item);
                const result = Array.isArray(item) ? item.every(valid) : Object.values(item).every(valid);
                seen.delete(item);
                return result;
            };
            if (!valid(value)) throw new Error('waitForFunction result is not JSON-serialisable.');
            return JSON.parse(JSON.stringify(value));
        };
        return (async () => {
            let first = true;
            while (true) {
                if (!first && Date.now() >= deadline) throw new Error('waitForFunction timed out after ${timeout} ms.');
                first = false;
                let result;
                try { result = await predicate(...args); }
                catch (error) { throw new Error('waitForFunction predicate failed: ' + (error?.message || error)); }
                if (Date.now() >= deadline && ${timeout} > 0) throw new Error('waitForFunction timed out after ${timeout} ms.');
                if (result) return jsonValue(result);
                if (Date.now() >= deadline) throw new Error('waitForFunction timed out after ${timeout} ms.');
                await wait();
            }
        })();
    })()`;
    let hostTimer: ReturnType<typeof setTimeout> | undefined;
    const evaluation = cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
        .then(result => {
            if (result.exceptionDetails) throw new Error(cdpExceptionMessage(result.exceptionDetails, "waitForFunction failed."));
            return result.result?.value as JsonValue;
        });
    const deadline = new Promise<never>((_, reject) => {
        hostTimer = setTimeout(() => reject(new Error(`waitForFunction timed out after ${timeout} ms.`)), timeout);
    });
    try {
        return await Promise.race([evaluation, deadline]);
    } catch (error: unknown) {
        if (isAutomationContextLoss(error)) throw new Error("Page navigated while waiting for function.", { cause: error });
        throw error;
    } finally {
        if (hostTimer !== undefined) clearTimeout(hostTimer);
    }
}
