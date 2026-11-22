import type { TestDescriptor } from "./test-api.js";

export function validateTestTimeout(timeout: unknown, label = "test timeout"): asserts timeout is number {
    if (typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer.`);
    }
}

export function validateTestDescriptors(value: unknown): asserts value is TestDescriptor[] {
    const exported = Array.isArray(value) ? value : [value];
    if (!exported.length || exported.some((test) => !test || typeof test !== "object" || typeof test.name !== "string" || typeof test.run !== "function")) {
        throw new Error("Expected a default test descriptor or a non-empty array of descriptors.");
    }
    for (const descriptor of exported) {
        const requires = descriptor.requires ?? [];
        if (!Array.isArray(requires) || requires.some((tag) => typeof tag !== "string" || !tag.trim()) || new Set(requires).size !== requires.length) throw new Error(`Test '${descriptor.name}' requires unique non-empty tag strings.`);
        if (descriptor.mode !== undefined && !["skip", "only", "fails"].includes(descriptor.mode)) throw new Error(`Test '${descriptor.name}' has an invalid mode.`);
        if (descriptor.mode === "fails" && (typeof descriptor.reason !== "string" || !descriptor.reason.trim())) throw new Error(`Test '${descriptor.name}' in fails mode requires a non-empty reason.`);
        if (descriptor.timeout !== undefined) validateTestTimeout(descriptor.timeout, `Test '${descriptor.name}' timeout`);
    }
}
