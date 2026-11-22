import path from "node:path";
import type { McpClient, Timeouts } from "./client.js";
import type { TestLauncher } from "./launcher.js";
import { errMessage } from "../shared/utils.js";
import { asHandle, createAppProxy, type CallOptions, type HandleMetadata } from "./app-proxy.js";
import { formatStep } from "./step-format.js";
import { openBrowser as openBrowserHelper, usePage as usePageHelper, type UsePageOptions } from "./browser-helpers.js";
import { resultPreview, stepEventArguments, type TestLog } from "./test-log.js";
import { createExpect, safePreview } from "./expect.js";
import { runHostPoll } from "./poll.js";
import { createContextExpect, type Expect } from "./poll-expect.js";
import type { TestWindowOwner } from "./test-window.js";
import type { TestLifetime } from "./test-timeout.js";

export type { CallOptions } from "./app-proxy.js";

export interface WaitOptions extends CallOptions { message?: string; }

export interface TestContext {
    app: object;
    root: object;
    openBrowser(url: string, options?: { profile?: string; incognito?: boolean; timeout?: number }): Promise<object>;
    usePage(options: UsePageOptions): Promise<object>;
    /** The same stand-in, but `await` and async returns keep it instead of reading the node. */
    handle(node: unknown, metadata?: HandleMetadata): object;
    call(path?: string, args?: unknown, options?: CallOptions): Promise<unknown>;
    callText(path?: string, args?: unknown, options?: CallOptions): Promise<string>;
    /** Assign `value` to a writable call-tree property; the stand-in cannot express an assignment. */
    set(path: string, value: unknown, options?: { timeout?: number }): Promise<unknown>;
    waitFor(pathOrCallback: string | ((ctx: TestContext) => unknown | Promise<unknown>), predicate: (value: unknown) => boolean | Promise<boolean>, options?: WaitOptions): Promise<unknown>;
    expect: Expect;
    script(code: string): Promise<string>; restartApp(): Promise<void>; launchSecondInstance(args?: string[]): Promise<number>;
    /** Resolve a path next to the test file, for fixtures the test ships with. */
    file(relative: string): string;
    /** Note a line in `tests.log` and the console, for context a later reader needs. */
    log(message: string): void;
    /** `stepOf(error)` names the step that threw `error`; `step` moves on while a test's own `finally` runs. */
    _state: { step: string; error?: string; stepOf(error: unknown): string; ownedPages: Set<string>; sessionPages: Set<string>; pagesUnderTest(): ReadonlySet<string> };
}

export function createContext(client: McpClient, launcher: TestLauncher, timeouts: Timeouts, attach: boolean, testWindow: TestWindowOwner, lifetime: TestLifetime, log?: TestLog, identity?: { file: string; test: string; profileDirectory?: string }): TestContext {
    const failedSteps = new WeakMap<object, string>();
    const state: TestContext["_state"] = {
        step: "starting",
        stepOf: (error) => (error !== null && typeof error === "object" ? failedSteps.get(error) : undefined) ?? state.step,
        /** Pages this test opened through `ctx.openBrowser`; with `--attach` cleanup closes only these. */
        ownedPages: new Set<string>(),
        /** Existing browser pages a test adopted with `ctx.usePage`; cleanup never closes these. */
        sessionPages: new Set<string>(),
        pagesUnderTest: () => new Set([...state.ownedPages, ...state.sessionPages]),
    };
    /** Remember the step an error was first thrown from; an outer rethrow keeps the inner step. */
    const markFailure = (error: unknown) => {
        if (error !== null && typeof error === "object" && !failedSteps.has(error)) failedSteps.set(error, state.step);
    };
    const check = <T>(step: string, assertion: () => T): T => {
        lifetime.assertActive();
        state.step = step;
        try { return assertion(); } catch (error) { markFailure(error); throw error; }
    };
    let active = client;
    let proxyPath: string | undefined;
    let proxyArgs: unknown;
    /** Above zero while a host poll runs: nested calls are logged as one wait, not once per sample. */
    let quietDepth = 0;
    /** US-2158 will connect an aborted-context signal here. */
    const checkAborted = lifetime.assertActive;
    const logStep = (event: string, operation: "call" | "callText" | "set", apiPath?: string, args?: unknown, details: Record<string, unknown> = {}) => {
        if (!log || quietDepth > 0) return;
        log.write({ event, ...identity, operation, path: apiPath ?? "<overview>", ...(stepEventArguments(operation, apiPath, args) === undefined ? {} : { args: stepEventArguments(operation, apiPath, args) }), ...details });
    };
    const call = async (apiPath?: string, args?: unknown, options: CallOptions = {}, prestarted = false) => {
        lifetime.assertActive();
        state.step = formatStep("call", apiPath, args);
        if (!prestarted) logStep("step-start", "call", apiPath, args);
        try {
            const result = await testWindow.call(active, apiPath, args, options.timeout ?? timeouts.request, options.maxLength, options.dialog, options.allowNavigation);
            lifetime.assertActive();
            const resolvedPath = testWindow.scope(apiPath);
            if (args === undefined && apiPath !== undefined && isMethodDescriptor(result, resolvedPath ?? apiPath)) {
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
    const callText = async (apiPath?: string, args?: unknown, options: CallOptions = {}) => {
        lifetime.assertActive();
        state.step = formatStep("callText", apiPath, args);
        logStep("step-start", "callText", apiPath, args);
        try {
            const result = await testWindow.callText(active, apiPath, args, options.timeout ?? timeouts.request, options.maxLength, options.dialog, options.allowNavigation);
            lifetime.assertActive();
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
        lifetime.assertActive();
        state.step = formatStep("set", apiPath, value);
        logStep("step-start", "set", apiPath, value);
        try {
            const result = await testWindow.set(active, apiPath, value, options.timeout ?? timeouts.request);
            lifetime.assertActive();
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
        lifetime.assertActive();
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
    const rootCall = async (apiPath?: string, args?: unknown, options: CallOptions = {}) => {
        lifetime.assertActive();
        const result = await active.call(apiPath, args, options.timeout ?? timeouts.request, options.maxLength, options.dialog, options.allowNavigation);
        lifetime.assertActive();
        return result;
    };
    const rootProxyCall = (apiPath?: string, args?: unknown, options: CallOptions = {}) => rootCall(apiPath, args, options);
    const root = createAppProxy(rootProxyCall, beforeProxyCall, onProxyError, true);
    const context: TestContext = {
        app, root, call, callText, set,
        async openBrowser(url, options = {}) { lifetime.assertActive(); return openBrowserHelper(context, url, options, timeouts.wait, timeouts.request, (pageId) => { lifetime.assertActive(); state.ownedPages.add(pageId); }); },
        async usePage(options) {
            lifetime.assertActive();
            const current = launcher.client ?? active;
            const result = await usePageHelper(context, options, testWindow, () => launcher.client ?? current, timeouts.request, state.sessionPages, lifetime.assertActive);
            lifetime.assertActive();
            return result;
        },
        handle(node, metadata) { return asHandle(node, proxyCall, beforeProxyCall, onProxyError, metadata, rootProxyCall); },
        async waitFor(pathOrCallback, predicate, options = {}) {
            const timeout = options.timeout === undefined ? timeouts.wait : Math.max(1, Math.round(options.timeout * (timeouts.scale ?? 1)));
            const target = typeof pathOrCallback === "string" ? pathOrCallback : "callback";
            const result = await runHostPoll({
                target, timeout, interval: timeouts.poll, timeouts, log, identity,
                quiet(change) { quietDepth += change; }, setStep(step) { state.step = step; }, markFailure,
                setError(message) { state.error = message; }, check: checkAborted,
                read: () => typeof pathOrCallback === "string"
                    ? call(pathOrCallback, undefined, { maxLength: options.maxLength, dialog: options.dialog, allowNavigation: options.allowNavigation }, true)
                    : Promise.resolve(pathOrCallback(context)),
                match: (value) => predicate(value),
                step: `wait for ${target}`,
                timeoutError(outcome, _polls, scaledTimeout) {
                    const value = outcome.kind === "value" ? outcome.value : undefined;
                    const base = `Timed out after ${scaledTimeout} ms waiting for ${target}; last value: ${safePreview(value)}`;
                    return new Error(options.message === undefined ? base : `${options.message}\n${base}`);
                },
            });
            if (result.outcome.kind === "error") throw result.outcome.error;
            return result.outcome.value;
        },
        expect: undefined as unknown as Expect,
        async script(code) {
            lifetime.assertActive();
            const result = await call("script.execute", [code]);
            lifetime.assertActive();
            if (!result || typeof result !== "object") throw new Error("Script did not return completed text.");
            if ("isError" in result && result.isError) throw new Error(`Script failed: ${"text" in result ? String(result.text) : "unknown script error"}`);
            if (("runId" in result && result.runId) || ("pending" in result && result.pending)) throw new Error(`Script is still pending (run ${"runId" in result ? result.runId : "unknown"}).`);
            if (!("text" in result) || typeof result.text !== "string") throw new Error("Script did not return completed text.");
            return result.text;
        },
        async restartApp() {
            lifetime.assertActive();
            if (attach) throw new Error('restartApp is unavailable with --attach; declare requires: ["launch"].');
            const restarted = lifetime.trackRestart(launcher.restart());
            const next = await restarted;
            lifetime.assertActive();
            active = next;
        },
        async launchSecondInstance(args = []) {
            lifetime.assertActive();
            if (attach) throw new Error('launchSecondInstance is unavailable with --attach; declare requires: ["launch"].');
            const code = await launcher.launchSecondInstance(args);
            lifetime.assertActive();
            return code;
        },
        file(relative) {
            if (typeof relative !== "string" || !relative) throw new TypeError("ctx.file(relative) requires a relative path string.");
            if (!identity) throw new Error("ctx.file is only available inside a test.");
            return path.resolve(path.dirname(identity.file), relative);
        },
        log(message) {
            lifetime.assertActive();
            const text = typeof message === "string" ? message : safePreview(message);
            log?.write({ event: "log", ...identity, message: text });
            console.log(`[${identity?.test ?? "test"}] ${text}`);
        },
        _state: state,
    };
    context.expect = createContextExpect({
        create: (value, message) => createExpect(value, message, check), context, timeouts, log, identity,
        quiet(change) { quietDepth += change; }, setStep(step) { lifetime.assertActive(); state.step = step; }, markFailure,
        setError(message) { state.error = message; }, check: checkAborted,
    });
    return context;
}

function isMethodDescriptor(value: unknown, apiPath: string): value is { kind: "method"; signature: string; summary: string; note: string } {
    return value !== null && typeof value === "object"
        && "kind" in value && value.kind === "method"
        && "signature" in value && typeof value.signature === "string"
        && "summary" in value && typeof value.summary === "string"
        && "note" in value && value.note === `Call it as "${apiPath}()" (or pass "args").`;
}
