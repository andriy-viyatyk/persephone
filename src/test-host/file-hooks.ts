import type { TestContext } from "./context.js";
import type { TestDescriptor } from "./test-api.js";
import { errMessage } from "../shared/utils.js";
import { automaticRequirementReason, isAutomaticRequirement } from "../shared/test-requirements.js";
import { isWindows } from "../shared/platform.js";
import type { TestLog } from "./test-log.js";

export type HookName = "beforeAll" | "beforeEach" | "afterEach" | "afterAll";
export type TestFileHooks = Partial<Record<HookName, (context: TestContext) => unknown | Promise<unknown>>>;

const hookNames: HookName[] = ["beforeAll", "beforeEach", "afterEach", "afterAll"];

export function readFileHooks(imported: Record<string, unknown>): TestFileHooks {
    const hooks: TestFileHooks = {};
    for (const name of hookNames) {
        if (!Object.hasOwn(imported, name)) continue;
        const hook = imported[name];
        if (typeof hook !== "function") throw new TypeError(`Test file export ${name} must be a function.`);
        hooks[name] = hook as (context: TestContext) => unknown | Promise<unknown>;
    }
    return hooks;
}

export async function invokeHook(
    name: HookName,
    hook: ((context: TestContext) => unknown | Promise<unknown>) | undefined,
    context: TestContext,
): Promise<{ durationMs: number; error?: unknown; step?: string }> {
    if (!hook) return { durationMs: 0 };
    const started = Date.now();
    context._state.step = name;
    let error: unknown;
    try { await hook(context); }
    catch (caught) { error = caught; }
    const durationMs = Date.now() - started;
    const innerStep = error === undefined ? undefined : context._state.stepOf(error);
    const step = innerStep === undefined ? undefined : innerStep === name ? name : `${name}: ${innerStep}`;
    return { durationMs, ...(error === undefined ? {} : { error }), ...(step ? { step } : {}) };
}

export function logHookStart(log: TestLog, details: { file: string; test: string; attempt?: number }, name: HookName): void {
    log.write({ event: "hook-start", ...details, hook: name });
}

export function logHookResult(log: TestLog, details: { file: string; test: string; attempt?: number }, name: HookName, durationMs: number, error?: unknown, step?: string): void {
    log.write({ event: "hook-result", ...details, hook: name, durationMs, ok: error === undefined, ...(error === undefined ? {} : { error: errMessage(error), ...(step ? { step } : {}) }) });
}

export function runnableReason(descriptor: TestDescriptor, attach: boolean, withTags: string[]): { reason?: string; requirements: string[] } {
    const requirements = descriptor.requires ?? [];
    const automaticReason = automaticRequirementReason(requirements, isWindows);
    const missing = requirements.filter((tag) => tag !== "launch" && tag !== "desktop" && !isAutomaticRequirement(tag) && !withTags.includes(tag));
    const reason = descriptor.mode === "skip" ? "test.skip" : automaticReason ?? (missing.length ? `requires opt-in tags: ${missing.join(", ")}` : attach && requirements.includes("launch") ? "requires an owned app launch" : undefined);
    return { reason, requirements };
}
