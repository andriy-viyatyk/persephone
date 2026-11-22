import path from "node:path";
import type { McpClient, Timeouts } from "./client.js";
import type { TestLauncher } from "./launcher.js";
import { errMessage } from "../shared/utils.js";
import { asHandle, createAppProxy, type CallOptions, type HandleMetadata } from "./app-proxy.js";
import { formatStep } from "./step-format.js";
import { openBrowser as openBrowserHelper } from "./browser-helpers.js";
import { resultPreview, stepEventArguments, type TestLog } from "./test-log.js";
import { createExpect, safePreview, type ExpectMatchers } from "./expect.js";

export type { CallOptions } from "./app-proxy.js";

export interface TestContext {
    app: object;
    openBrowser(url: string, options?: { profile?: string; incognito?: boolean; timeout?: number }): Promise<object>;
    /** The same stand-in, but `await` and async returns keep it instead of reading the node. */
    handle(node: unknown, metadata?: HandleMetadata): object;
    call(path?: string, args?: unknown, options?: CallOptions): Promise<unknown>;
    callText(path?: string, args?: unknown, options?: CallOptions): Promise<string>;
    /** Assign `value` to a writable call-tree property; the stand-in cannot express an assignment. */
    set(path: string, value: unknown, options?: { timeout?: number }): Promise<unknown>;
    waitFor(pathOrCallback: string | ((ctx: TestContext) => Promise<unknown>), predicate: (value: unknown) => boolean, options?: CallOptions): Promise<unknown>;
    expect(value: unknown, message?: string): ExpectMatchers;
    script(code: string): Promise<string>; restartApp(): Promise<void>; launchSecondInstance(args?: string[]): Promise<number>;
    /** Resolve a path next to the test file, for fixtures the test ships with. */
    file(relative: string): string;
    /** Note a line in `tests.log` and the console, for context a later reader needs. */
    log(message: string): void;
    /** `stepOf(error)` names the step that threw `error`; `step` moves on while a test's own `finally` runs. */
    _state: { step: string; error?: string; stepOf(error: unknown): string; ownedPages: Set<string> };
}

export function createContext(client: McpClient, launcher: TestLauncher, timeouts: Timeouts, attach: boolean, log?: TestLog, identity?: { file: string; test: string; profileDirectory?: string }): TestContext {
    const failedSteps = new WeakMap<object, string>();
    const state: TestContext["_state"] = {
        step: "starting",
        stepOf: (error) => (error !== null && typeof error === "object" ? failedSteps.get(error) : undefined) ?? state.step,
        /** Pages this test opened through `ctx.openBrowser`; with `--attach` cleanup closes only these. */
        ownedPages: new Set<string>(),
    };
    /** Remember the step an error was first thrown from; an outer rethrow keeps the inner step. */
    const markFailure = (error: unknown) => {
        if (error !== null && typeof error === "object" && !failedSteps.has(error)) failedSteps.set(error, state.step);
    };
    const check = (step: string, assertion: () => void) => {
        state.step = step;
        try { assertion(); } catch (error) { markFailure(error); throw error; }
    };
    let active = client;
    let proxyPath: string | undefined;
    let proxyArgs: unknown;
    /** Above zero while `waitFor` polls: the wait is logged as one step, not one per poll. */
    let quietDepth = 0;
    const logStep = (event: string, operation: "call" | "callText" | "set", apiPath?: string, args?: unknown, details: Record<string, unknown> = {}) => {
        if (!log || quietDepth > 0) return;
        log.write({ event, ...identity, operation, path: apiPath ?? "<overview>", ...(stepEventArguments(operation, apiPath, args) === undefined ? {} : { args: stepEventArguments(operation, apiPath, args) }), ...details });
    };
    const call = async (apiPath?: string, args?: unknown, options: CallOptions = {}, prestarted = false) => {
        state.step = formatStep("call", apiPath, args);
        if (!prestarted) logStep("step-start", "call", apiPath, args);
        try {
            const result = await active.call(apiPath, args, options.timeout ?? timeouts.request, options.maxLength, options.dialog);
            if (args === undefined && apiPath !== undefined && isMethodDescriptor(result, apiPath)) {
                throw new TypeError(`${apiPath} is a method; call ctx.call(${JSON.stringify(apiPath)}, []) with an argument array.`);
            }
            logStep("step-result", "call", apiPath, args, { ok: true, result: resultPreview(result) });
            return result;
        } catch (error) {
            state.error = errMessage(error);
            markFailure(error);
            logStep("step-error", "call", apiPath, args, { ok: false, error: state.error });
            throw error;
        }
    };
    const callText = async (apiPath?: string, args?: unknown, options: { timeout?: number; maxLength?: number; dialog?: boolean } = {}) => {
        state.step = formatStep("callText", apiPath, args);
        logStep("step-start", "callText", apiPath, args);
        try {
            const result = await active.callText(apiPath, args, options.timeout ?? timeouts.request, options.maxLength, options.dialog);
            logStep("step-result", "callText", apiPath, args, { ok: true, result: resultPreview(result) });
            return result;
        } catch (error) {
            state.error = errMessage(error);
            markFailure(error);
            logStep("step-error", "callText", apiPath, args, { ok: false, error: state.error });
            throw error;
        }
    };
    const set = async (apiPath: string, value: unknown, options: { timeout?: number } = {}) => {
        state.step = formatStep("set", apiPath, value);
        logStep("step-start", "set", apiPath, value);
        try {
            const result = await active.set(apiPath, value, options.timeout ?? timeouts.request);
            logStep("step-result", "set", apiPath, value, { ok: true, result: resultPreview(result) });
            return result;
        } catch (error) {
            state.error = errMessage(error);
            markFailure(error);
            logStep("step-error", "set", apiPath, value, { ok: false, error: state.error });
            throw error;
        }
    };
    const proxyCall = (apiPath?: string, args?: unknown, options: CallOptions = {}) => call(apiPath, args, options, true);
    const beforeProxyCall = (apiPath: string, args?: unknown) => {
        proxyPath = apiPath;
        proxyArgs = args;
        state.step = formatStep("call", apiPath, args);
        logStep("step-start", "call", apiPath, args);
    };
    const onProxyError = (error: unknown) => {
        state.error = errMessage(error);
        markFailure(error);
        logStep("step-error", "call", proxyPath, proxyArgs, { ok: false, error: state.error });
    };
    const app = createAppProxy(proxyCall, beforeProxyCall, onProxyError);
    const context: TestContext = {
        app, call, callText, set,
        async openBrowser(url, options = {}) { return openBrowserHelper(context, url, options, timeouts.wait, timeouts.request, (pageId) => state.ownedPages.add(pageId)); },
        handle(node, metadata) { return asHandle(node, proxyCall, beforeProxyCall, onProxyError, metadata); },
        async waitFor(pathOrCallback, predicate, options = {}) {
            const timeout = options.timeout === undefined ? timeouts.wait : Math.max(1, Math.round(options.timeout * (timeouts.scale ?? 1)));
            const deadline = Date.now() + timeout;
            const target = typeof pathOrCallback === "string" ? pathOrCallback : "callback";
            log?.write({ event: "wait-start", ...identity, target, timeout });
            let value: unknown;
            let polls = 0;
            quietDepth++;
            try {
                do {
                    polls++;
                    value = typeof pathOrCallback === "string"
                        ? await call(pathOrCallback, undefined, { maxLength: options.maxLength, dialog: options.dialog }, true)
                        : await pathOrCallback(context);
                    state.step = `wait for ${target}`;
                    if (await predicate(value)) {
                        log?.write({ event: "wait-result", ...identity, target, ok: true, polls, result: resultPreview(value) });
                        return value;
                    }
                    await new Promise((resolve) => setTimeout(resolve, Math.min(timeouts.poll, Math.max(1, deadline - Date.now()))));
                } while (Date.now() < deadline);
            } catch (error) {
                markFailure(error);
                log?.write({ event: "wait-error", ...identity, target, ok: false, polls, error: errMessage(error) });
                throw error;
            } finally { quietDepth--; }
            const message = `Timed out after ${timeout} ms waiting for ${target}; last value: ${JSON.stringify(value)}`;
            state.error = message;
            log?.write({ event: "wait-error", ...identity, target, ok: false, polls, error: message, result: resultPreview(value) });
            const timedOut = new Error(message);
            markFailure(timedOut);
            throw timedOut;
        },
        expect(value, message) { return createExpect(value, message, check); },
        async script(code) {
            const result = await call("script.execute", [code]);
            if (!result || typeof result !== "object") throw new Error("Script did not return completed text.");
            if ("isError" in result && result.isError) throw new Error(`Script failed: ${"text" in result ? String(result.text) : "unknown script error"}`);
            if (("runId" in result && result.runId) || ("pending" in result && result.pending)) throw new Error(`Script is still pending (run ${"runId" in result ? result.runId : "unknown"}).`);
            if (!("text" in result) || typeof result.text !== "string") throw new Error("Script did not return completed text.");
            return result.text;
        },
        async restartApp() { if (attach) throw new Error('restartApp is unavailable with --attach; declare requires: ["launch"].'); active = await launcher.restart(); },
        async launchSecondInstance(args = []) { if (attach) throw new Error('launchSecondInstance is unavailable with --attach; declare requires: ["launch"].'); return launcher.launchSecondInstance(args); },
        file(relative) {
            if (typeof relative !== "string" || !relative) throw new TypeError("ctx.file(relative) requires a relative path string.");
            if (!identity) throw new Error("ctx.file is only available inside a test.");
            return path.resolve(path.dirname(identity.file), relative);
        },
        log(message) {
            const text = typeof message === "string" ? message : safePreview(message);
            log?.write({ event: "log", ...identity, message: text });
            console.log(`[${identity?.test ?? "test"}] ${text}`);
        },
        _state: state,
    };
    return context;
}

function isMethodDescriptor(value: unknown, apiPath: string): value is { kind: "method"; signature: string; summary: string; note: string } {
    return value !== null && typeof value === "object"
        && "kind" in value && value.kind === "method"
        && "signature" in value && typeof value.signature === "string"
        && "summary" in value && typeof value.summary === "string"
        && "note" in value && value.note === `Call it as "${apiPath}()" (or pass "args").`;
}
