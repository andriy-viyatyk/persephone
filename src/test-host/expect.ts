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

type Check = <T>(step: string, assertion: () => T) => T;
const MATCHERS = ["toBe", "toEqual", "toContain", "toBeTruthy", "toBeFalsy", "toBeNull", "toBeUndefined", "toBeDefined", "toBeGreaterThan", "toBeGreaterThanOrEqual", "toBeLessThan", "toBeLessThanOrEqual", "toHaveLength", "toHaveProperty", "toMatch", "toMatchObject", "toContainEqual", "toThrow"] as const;
export type MatcherName = typeof MATCHERS[number];
export const matcherNames: readonly MatcherName[] = MATCHERS;

export interface PreparedMatcher {
    name: MatcherName;
    negated: boolean;
    expected: unknown;
    expectedText: string;
    stepExpected?: unknown;
    validateSample(value: unknown): void;
    evaluate(value: unknown): boolean;
    failure(value: unknown, message?: string): assert.AssertionError;
}

export function createExpect(value: unknown, message: string | undefined, check: Check): ExpectMatchers {
    check("assert expect value", () => assertSafe(value));
    const previewValue = safePreview(value);
    const makeSide = (negated: boolean): ExpectMatchers => {
        const side = { get not() { return makeSide(!negated); } };
        return new Proxy(side as ExpectMatchers, {
            get(target, property, receiver) {
                if (typeof property === "symbol" || property === "then" || Object.hasOwn(target, property)) return property === "then" ? undefined : Reflect.get(target, property, receiver);
                if (typeof property === "string" && (MATCHERS as readonly string[]).includes(property)) {
                    return (...args: unknown[]) => {
                        const prepared = check(`assert ${property} arguments`, () => prepareMatcher(property as MatcherName, args, negated));
                        if (prepared.name === "toThrow") check("assert toThrow arguments", () => prepared.validateSample(value));
                        const step = `assert ${previewValue}${negated ? " not" : ""}.${prepared.name}${prepared.expected === NO_ARGUMENT ? "" : ` ${safePreview(prepared.stepExpected ?? prepared.expected)}`}`;
                        check(step, () => {
                            if (!prepared.evaluate(value)) throw prepared.failure(value, message);
                        });
                    };
                }
                check(`assert unsupported matcher ${String(property)}`, () => { throw new TypeError(`Unknown matcher '${String(property)}'. Supported matchers: ${MATCHERS.join(", ")}.`); });
                return undefined;
            },
        });
    };
    return makeSide(false);
}

/** Validate matcher arguments once, then reuse this exact predicate for every polled value. */
export function prepareMatcher(name: MatcherName, args: unknown[], negated = false): PreparedMatcher {
    const expected = args[0];
    let hasExpected = args.length > 0;
    let stepExpected = expected;
    if (name === "toHaveProperty") {
        const [path, propertyExpected] = args;
        if (typeof path !== "string" || !path) throw new TypeError("toHaveProperty requires a non-empty dotted path.");
        hasExpected = args.length > 1;
        assertSafe(hasExpected ? [path, propertyExpected] : path);
        stepExpected = path;
    } else if (name === "toThrow") {
        if (expected !== undefined && typeof expected !== "string" && !(expected instanceof RegExp) && !(typeof expected === "function" && (expected === Error || expected.prototype instanceof Error))) throw new TypeError("toThrow expects a string, RegExp, or Error constructor.");
        assertSafe(expected);
    } else {
        validateMatcherArgument(name, expected);
        assertSafe(expected);
    }
    const noArgumentMatcher = ["toBeTruthy", "toBeFalsy", "toBeNull", "toBeUndefined", "toBeDefined"].includes(name);
    const shownExpected = name === "toThrow" ? expected ?? NO_ARGUMENT : name === "toHaveProperty" ? (hasExpected ? [args[0], args[1]] : args[0]) : noArgumentMatcher ? NO_ARGUMENT : expected;
    const validateSample = (value: unknown): void => {
        if (name === "toThrow" && typeof value !== "function") throw new TypeError("toThrow requires a function value.");
    };
    const evaluate = (value: unknown): boolean => {
        assertSafe(value);
        validateSample(value);
        let passed: boolean;
        switch (name) {
            case "toBe": passed = Object.is(value, expected); break;
            case "toEqual": passed = deepEqual(value, expected); break;
            case "toContain": passed = typeof value === "string" ? value.includes(String(expected)) : Array.isArray(value) && value.includes(expected); break;
            case "toBeTruthy": passed = Boolean(value); break;
            case "toBeFalsy": passed = !value; break;
            case "toBeNull": passed = value === null; break;
            case "toBeUndefined": passed = value === undefined; break;
            case "toBeDefined": passed = value !== undefined; break;
            case "toBeGreaterThan": passed = typeof value === "number" && value > (expected as number); break;
            case "toBeGreaterThanOrEqual": passed = typeof value === "number" && value >= (expected as number); break;
            case "toBeLessThan": passed = typeof value === "number" && value < (expected as number); break;
            case "toBeLessThanOrEqual": passed = typeof value === "number" && value <= (expected as number); break;
            case "toHaveLength": passed = (typeof value === "string" || Array.isArray(value)) && value.length === expected; break;
            case "toHaveProperty": {
                const current = propertyValue(value, args[0] as string);
                passed = current.exists && (!hasExpected || deepEqual(current.value, args[1])); break;
            }
            case "toMatch": passed = regexTest(value, expected as RegExp); break;
            case "toMatchObject": passed = partialMatch(value, expected as object); break;
            case "toContainEqual": passed = Array.isArray(value) && value.some((item) => deepEqual(item, expected)); break;
            case "toThrow": {
                let thrown: unknown; let didThrow = false;
                try { (value as () => unknown)(); } catch (error) { didThrow = true; thrown = error; }
                if (!didThrow || expected === undefined) passed = didThrow;
                else if (typeof expected === "string") passed = errText(thrown).includes(expected);
                else if (expected instanceof RegExp) passed = regexTest(errText(thrown), expected);
                else passed = thrown instanceof (expected as new (...args: never[]) => Error);
                break;
            }
        }
        return negated ? !passed : passed;
    };
    return {
        name, negated, expected: shownExpected,
        expectedText: `${negated ? "not " : ""}${name}${shownExpected === NO_ARGUMENT ? "" : ` ${safePreview(shownExpected)}`}`,
        stepExpected, validateSample, evaluate,
        failure(value, message) {
            const detail = `Expected ${safePreview(value)} ${negated ? "not " : ""}${name}${shownExpected === NO_ARGUMENT ? "" : ` ${safePreview(shownExpected)}`}.`;
            return new assert.AssertionError({ message: message ? `${message}\n${detail}` : detail, actual: value, expected: shownExpected, operator: name });
        },
    };
}

function validateMatcherArgument(name: MatcherName, expected: unknown): void {
    if (["toBeGreaterThan", "toBeGreaterThanOrEqual", "toBeLessThan", "toBeLessThanOrEqual", "toHaveLength"].includes(name)) numberArgument(expected as number);
    if (name === "toMatch" && !(expected instanceof RegExp)) throw new TypeError("toMatch requires a RegExp.");
    if (name === "toMatchObject" && (expected === null || typeof expected !== "object")) throw new TypeError("toMatchObject requires an object.");
}

function regexTest(value: unknown, expected: RegExp): boolean {
    if (typeof value !== "string") return false;
    const lastIndex = expected.lastIndex;
    expected.lastIndex = 0;
    const result = expected.test(value);
    expected.lastIndex = lastIndex;
    return result;
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
        if (item instanceof RegExp) return String(item);
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
