import assert from "node:assert/strict";
import { errMessage } from "../shared/utils.js";
import { isAppStandIn } from "./app-proxy.js";

export interface ExpectMatchers {
    toBe(expected: unknown): void; toEqual(expected: unknown): void; toContain(expected: unknown): void;
    toBeTruthy(): void; toBeFalsy(): void; toBeNull(): void; toBeUndefined(): void; toBeDefined(): void;
    toBeGreaterThan(expected: number): void; toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void; toBeLessThanOrEqual(expected: number): void;
    toHaveLength(expected: number): void; toHaveProperty(path: string, expected?: unknown): void;
    toMatch(expected: RegExp): void; toMatchObject(expected: object): void; toContainEqual(expected: unknown): void;
    toThrow(expected?: string | RegExp | (new (...args: never[]) => Error)): void;
    not: ExpectMatchers;
}

type Check = (step: string, assertion: () => void) => void;
const MATCHERS = ["toBe", "toEqual", "toContain", "toBeTruthy", "toBeFalsy", "toBeNull", "toBeUndefined", "toBeDefined", "toBeGreaterThan", "toBeGreaterThanOrEqual", "toBeLessThan", "toBeLessThanOrEqual", "toHaveLength", "toHaveProperty", "toMatch", "toMatchObject", "toContainEqual", "toThrow"] as const;

export function createExpect(value: unknown, message: string | undefined, check: Check): ExpectMatchers {
    check("assert expect value", () => assertSafe(value));
    const previewValue = safePreview(value);
    const makeSide = (negated: boolean): ExpectMatchers => {
        const validateArgument = (name: string, assertion: () => void): void => check(`assert ${name} arguments`, assertion);
        const match = (name: typeof MATCHERS[number], expected: unknown, predicate: () => boolean, stepExpected = expected): void => {
            check(`assert ${name} arguments`, () => assertSafe(expected));
            const step = `assert ${previewValue}${negated ? " not" : ""}.${name}${expected === NO_ARGUMENT ? "" : ` ${safePreview(stepExpected)}`}`;
            check(step, () => {
                const passed = predicate();
                const valid = negated ? !passed : passed;
                if (!valid) {
                    const detail = `Expected ${previewValue} ${negated ? "not " : ""}${name}${expected === NO_ARGUMENT ? "" : ` ${safePreview(expected)}`}.`;
                    throw new assert.AssertionError({ message: message ? `${message}\n${detail}` : detail, actual: value, expected, operator: name });
                }
            });
        };
        const side = {
            toBe(expected: unknown) { match("toBe", expected, () => Object.is(value, expected)); },
            toEqual(expected: unknown) { match("toEqual", expected, () => { try { assert.deepStrictEqual(value, expected); return true; } catch { return false; } }); },
            toContain(expected: unknown) { match("toContain", expected, () => typeof value === "string" ? value.includes(String(expected)) : Array.isArray(value) && value.includes(expected)); },
            toBeTruthy() { match("toBeTruthy", NO_ARGUMENT, () => Boolean(value)); },
            toBeFalsy() { match("toBeFalsy", NO_ARGUMENT, () => !value); },
            toBeNull() { match("toBeNull", NO_ARGUMENT, () => value === null); },
            toBeUndefined() { match("toBeUndefined", NO_ARGUMENT, () => value === undefined); },
            toBeDefined() { match("toBeDefined", NO_ARGUMENT, () => value !== undefined); },
            toBeGreaterThan(expected: number) { validateArgument("toBeGreaterThan", () => numberArgument(expected)); match("toBeGreaterThan", expected, () => typeof value === "number" && value > expected); },
            toBeGreaterThanOrEqual(expected: number) { validateArgument("toBeGreaterThanOrEqual", () => numberArgument(expected)); match("toBeGreaterThanOrEqual", expected, () => typeof value === "number" && value >= expected); },
            toBeLessThan(expected: number) { validateArgument("toBeLessThan", () => numberArgument(expected)); match("toBeLessThan", expected, () => typeof value === "number" && value < expected); },
            toBeLessThanOrEqual(expected: number) { validateArgument("toBeLessThanOrEqual", () => numberArgument(expected)); match("toBeLessThanOrEqual", expected, () => typeof value === "number" && value <= expected); },
            toHaveLength(expected: number) { validateArgument("toHaveLength", () => numberArgument(expected)); match("toHaveLength", expected, () => (typeof value === "string" || Array.isArray(value)) && value.length === expected); },
            toHaveProperty(path: string, expected?: unknown) {
                validateArgument("toHaveProperty", () => { if (typeof path !== "string" || !path) throw new TypeError("toHaveProperty requires a non-empty dotted path."); });
                const hasExpected = arguments.length > 1;
                match("toHaveProperty", hasExpected ? [path, expected] : path, () => {
                    const current = propertyValue(value, path);
                    return current.exists && (!hasExpected || deepEqual(current.value, expected));
                }, path);
            },
            toMatch(expected: RegExp) {
                validateArgument("toMatch", () => { if (!(expected instanceof RegExp)) throw new TypeError("toMatch requires a RegExp."); });
                match("toMatch", expected, () => {
                    if (typeof value !== "string") return false;
                    const lastIndex = expected.lastIndex;
                    expected.lastIndex = 0;
                    const result = expected.test(value);
                    expected.lastIndex = lastIndex;
                    return result;
                });
            },
            toMatchObject(expected: object) {
                validateArgument("toMatchObject", () => { if (expected === null || typeof expected !== "object") throw new TypeError("toMatchObject requires an object."); });
                match("toMatchObject", expected, () => partialMatch(value, expected));
            },
            toContainEqual(expected: unknown) { match("toContainEqual", expected, () => Array.isArray(value) && value.some((item) => deepEqual(item, expected))); },
            toThrow(expected?: string | RegExp | (new (...args: never[]) => Error)) {
                validateArgument("toThrow", () => {
                    if (expected !== undefined && typeof expected !== "string" && !(expected instanceof RegExp) && !(typeof expected === "function" && (expected === Error || expected.prototype instanceof Error))) throw new TypeError("toThrow expects a string, RegExp, or Error constructor.");
                    if (typeof value !== "function") throw new TypeError("toThrow requires a function value.");
                });
                const throwFunction = value as () => unknown;
                match("toThrow", expected ?? NO_ARGUMENT, () => {
                    let thrown: unknown; let didThrow = false;
                    try { throwFunction(); } catch (error) { didThrow = true; thrown = error; }
                    if (!didThrow || expected === undefined) return didThrow;
                    if (typeof expected === "string") return errText(thrown).includes(expected);
                    if (expected instanceof RegExp) {
                        const lastIndex = expected.lastIndex;
                        expected.lastIndex = 0;
                        const matches = expected.test(errText(thrown));
                        expected.lastIndex = lastIndex;
                        return matches;
                    }
                    return thrown instanceof expected;
                });
            },
            get not() { return makeSide(!negated); },
        };
        return new Proxy(side as ExpectMatchers, {
            get(target, property, receiver) {
                if (typeof property === "symbol" || property === "then" || Object.hasOwn(target, property)) return property === "then" ? undefined : Reflect.get(target, property, receiver);
                check(`assert unsupported matcher ${String(property)}`, () => { throw new TypeError(`Unknown matcher '${String(property)}'. Supported matchers: ${MATCHERS.join(", ")}.`); });
                return undefined;
            },
        });
    };
    return makeSide(false);
}

const NO_ARGUMENT = Symbol("no-argument");
function numberArgument(value: number): void { if (typeof value !== "number" || Number.isNaN(value)) throw new TypeError("Matcher requires a numeric expected value."); }
function deepEqual(left: unknown, right: unknown): boolean { try { assert.deepStrictEqual(left, right); return true; } catch { return false; } }
/** Jest semantics: objects match a subset of keys, arrays match element by element with equal length, other values by deep equality. */
function partialMatch(actual: unknown, expected: unknown): boolean {
    if (expected === null || typeof expected !== "object") return deepEqual(actual, expected);
    if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => partialMatch(actual[index], item));
    if (actual === null || typeof actual !== "object") return false;
    return Object.keys(expected).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(expected, key);
        if (!descriptor || !("value" in descriptor)) throw new TypeError(`toMatchObject cannot read accessor property '${key}'.`);
        const actualDescriptor = Object.getOwnPropertyDescriptor(actual, key);
        if (!actualDescriptor || !("value" in actualDescriptor)) return false;
        return partialMatch(actualDescriptor.value, descriptor.value);
    });
}
function propertyValue(root: unknown, path: string): { exists: boolean; value?: unknown } {
    let current = root;
    for (const part of path.split(".")) {
        if (current === null || (typeof current !== "object" && typeof current !== "function")) return { exists: false };
        const descriptor = Object.getOwnPropertyDescriptor(current, part);
        if (!descriptor) return { exists: false };
        if (!("value" in descriptor)) throw new TypeError(`toHaveProperty cannot read accessor property '${path}'.`);
        current = descriptor.value;
    }
    return { exists: true, value: current };
}
function assertSafe(root: unknown): void {
    const seen = new Set<object>();
    const visit = (value: unknown, depth: number): void => {
        if (isAppStandIn(value)) throw new TypeError("Cannot assert an app stand-in or handle. Await the value first, or read the property you want to assert.");
        if (!value || typeof value !== "object" || depth > 4 || seen.has(value)) return;
        seen.add(value);
        for (const key of Object.keys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor && "value" in descriptor) visit(descriptor.value, depth + 1);
        }
    };
    visit(root, 0);
}
export function safePreview(value: unknown): string {
    const render = (item: unknown, depth: number, seen: Set<object>): string => {
        if (item === undefined) return "undefined";
        if (typeof item === "string") return JSON.stringify(item);
        if (typeof item === "bigint") return `${item}n`;
        if (typeof item === "function") return "[Function]";
        if (!item || typeof item !== "object") return String(item);
        if (depth >= 4) return "[…]";
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
        const entries: string[] = [];
        for (const key of Object.keys(item).slice(0, 20)) {
            const descriptor = Object.getOwnPropertyDescriptor(item, key);
            entries.push(`${JSON.stringify(key)}: ${descriptor && "value" in descriptor ? render(descriptor.value, depth + 1, seen) : "[Accessor]"}`);
        }
        seen.delete(item);
        return Array.isArray(item) ? `[${entries.join(", ")}]` : `{${entries.join(", ")}}`;
    };
    const text = render(value, 0, new Set());
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
function errText(value: unknown): string { return errMessage(value); }
