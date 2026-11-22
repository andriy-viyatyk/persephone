import type { TestContext } from "./context.js";

export interface TestDescriptor { name: string; run: (context: TestContext) => Promise<void>; requires?: string[]; mode?: "skip" | "only" | "fails"; reason?: string; }
export interface TestFunction {
    (name: string, run: TestDescriptor["run"], options?: { requires?: string[] }): TestDescriptor;
    skip(name: string, run: TestDescriptor["run"], options?: { requires?: string[] }): TestDescriptor;
    only(name: string, run: TestDescriptor["run"], options?: { requires?: string[] }): TestDescriptor;
    fails(name: string, run: TestDescriptor["run"], options: { requires?: string[]; reason: string }): TestDescriptor;
}
function create(name: string, run: TestDescriptor["run"], options: { requires?: string[] } = {}, mode?: TestDescriptor["mode"], reason?: string): TestDescriptor {
    if (typeof name !== "string" || !name.trim() || typeof run !== "function") throw new TypeError("test(name, async ctx => {}) requires a name and function.");
    const requires = options.requires ?? [];
    if (!Array.isArray(requires) || requires.some((tag) => typeof tag !== "string" || !tag.trim()) || new Set(requires).size !== requires.length) throw new TypeError(`Test '${name}' requires must contain unique non-empty tag strings.`);
    return { name, run, requires, ...(mode ? { mode } : {}), ...(reason ? { reason } : {}) };
}
export const test: TestFunction = Object.assign(
    (name: string, run: TestDescriptor["run"], options?: { requires?: string[] }) => create(name, run, options),
    {
        skip: (name: string, run: TestDescriptor["run"], options?: { requires?: string[] }) => create(name, run, options, "skip"),
        only: (name: string, run: TestDescriptor["run"], options?: { requires?: string[] }) => create(name, run, options, "only"),
        fails: (name: string, run: TestDescriptor["run"], options: { requires?: string[]; reason: string }) => {
            if (!options || typeof options.reason !== "string" || !options.reason.trim()) throw new TypeError(`test.fails('${name}') requires a non-empty reason.`);
            return create(name, run, options, "fails", options.reason.trim());
        },
    },
);
