import type { TestContext } from "./context.js";
import { validateTestTimeout } from "./test-descriptor-validation.js";

export interface TestOptions { requires?: string[]; timeout?: number; }
export interface TestDescriptor { name: string; run: (context: TestContext) => Promise<void>; requires?: string[]; mode?: "skip" | "only" | "fails"; reason?: string; timeout?: number; }
export interface TestFunction {
    (name: string, run: TestDescriptor["run"], options?: TestOptions): TestDescriptor;
    skip(name: string, run: TestDescriptor["run"], options?: TestOptions): TestDescriptor;
    only(name: string, run: TestDescriptor["run"], options?: TestOptions): TestDescriptor;
    fails(name: string, run: TestDescriptor["run"], options: TestOptions & { reason: string }): TestDescriptor;
}
function create(name: string, run: TestDescriptor["run"], options: TestOptions = {}, mode?: TestDescriptor["mode"], reason?: string): TestDescriptor {
    if (typeof name !== "string" || !name.trim() || typeof run !== "function") throw new TypeError("test(name, async ctx => {}) requires a name and function.");
    const requires = options.requires ?? [];
    if (!Array.isArray(requires) || requires.some((tag) => typeof tag !== "string" || !tag.trim()) || new Set(requires).size !== requires.length) throw new TypeError(`Test '${name}' requires must contain unique non-empty tag strings.`);
    if (options.timeout !== undefined) validateTestTimeout(options.timeout, `Test '${name}' timeout`);
    return { name, run, requires, ...(options.timeout === undefined ? {} : { timeout: options.timeout }), ...(mode ? { mode } : {}), ...(reason ? { reason } : {}) };
}
export const test: TestFunction = Object.assign(
    (name: string, run: TestDescriptor["run"], options?: TestOptions) => create(name, run, options),
    {
        skip: (name: string, run: TestDescriptor["run"], options?: TestOptions) => create(name, run, options, "skip"),
        only: (name: string, run: TestDescriptor["run"], options?: TestOptions) => create(name, run, options, "only"),
        fails: (name: string, run: TestDescriptor["run"], options: TestOptions & { reason: string }) => {
            if (!options || typeof options.reason !== "string" || !options.reason.trim()) throw new TypeError(`test.fails('${name}') requires a non-empty reason.`);
            return create(name, run, options, "fails", options.reason.trim());
        },
    },
);
