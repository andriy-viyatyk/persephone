import type { TestContext } from "./context.js";

export interface TestDescriptor { name: string; run: (context: TestContext) => Promise<void>; requires?: string[]; }
export function test(name: string, run: TestDescriptor["run"], options: { requires?: string[] } = {}): TestDescriptor {
    if (typeof name !== "string" || !name.trim() || typeof run !== "function") throw new TypeError("test(name, async ctx => {}) requires a name and function.");
    const requires = options.requires ?? [];
    if (!Array.isArray(requires) || requires.some((tag) => typeof tag !== "string" || !tag.trim()) || new Set(requires).size !== requires.length) throw new TypeError(`Test '${name}' requires must contain unique non-empty tag strings.`);
    return { name, run, requires };
}
