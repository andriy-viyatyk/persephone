import assert from "node:assert/strict";
import path from "node:path";
import { isAbsolute, relative, resolve } from "node:path";
import { HTTP_FIXTURE_URL } from "./config.mjs";

export const REQUIREMENT_TAGS = Object.freeze(["network", "mic", "tor", "git", "mneme", "launch"]);

export function validateRequirements(value, label = "test descriptor") {
    const requirements = value === undefined ? [] : value;
    if (!Array.isArray(requirements) || requirements.some((tag) => typeof tag !== "string" || !REQUIREMENT_TAGS.includes(tag))) {
        throw new TypeError(`${label} requires must be an array containing only: ${REQUIREMENT_TAGS.join(", ")}.`);
    }
    if (new Set(requirements).size !== requirements.length) throw new TypeError(`${label} requires contains duplicate tags.`);
    return [...requirements];
}

export function test(name, run, options = {}) {
    if (typeof name !== "string" || !name.trim() || typeof run !== "function") throw new TypeError("test(name, async ctx => {}) requires a name and function.");
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => key !== "requires")) {
        throw new TypeError("test options must be an object containing only requires.");
    }
    return { name, run, requires: validateRequirements(options.requires, `Test '${name}'`) };
}

export function createContext({ client, launcher, fixtureRoot, timeouts, attach = false }) {
    const state = { step: "starting", lastValue: undefined, lastPath: undefined };
    let activeClient = client;

    function record(description, apiPath) {
        state.step = description;
        state.lastPath = apiPath;
    }

    async function call(pathName, args, options = {}) {
        record(`call ${pathName ?? "<overview>"}`, pathName ?? "<overview>");
        try {
            const value = await activeClient.call(pathName, args, { ...options, timeout: options.timeout ?? timeouts.request });
            state.lastValue = value;
            return value;
        } catch (error) {
            state.lastValue = error.message;
            throw error;
        }
    }

    async function callText(pathName, args, options = {}) {
        record(`callText ${pathName ?? "<overview>"}`, pathName ?? "<overview>");
        try {
            const value = await activeClient.callText(pathName, args, { ...options, timeout: options.timeout ?? timeouts.request });
            state.lastValue = value;
            return value;
        } catch (error) {
            state.lastValue = error.message;
            throw error;
        }
    }

    async function waitFor(pathOrFn, predicate, { timeout } = {}) {
        const effectiveTimeout = timeout === undefined ? timeouts.wait : timeout * (timeouts.scale ?? 1);
        const description = typeof pathOrFn === "string" ? `wait for ${pathOrFn}` : "wait for callback result";
        record(description, typeof pathOrFn === "string" ? pathOrFn : "<callback>");
        const deadline = Date.now() + effectiveTimeout;
        let lastValue;
        while (Date.now() < deadline) {
            lastValue = typeof pathOrFn === "string"
                ? await call(pathOrFn)
                : await pathOrFn(api);
            state.step = description;
            state.lastPath = typeof pathOrFn === "string" ? pathOrFn : "<callback>";
            state.lastValue = lastValue;
            if (await predicate(lastValue)) return lastValue;
            await new Promise((resolveTimer) => setTimeout(resolveTimer, Math.min(timeouts.poll, Math.max(1, deadline - Date.now()))));
        }
        throw new Error(`Timed out after ${effectiveTimeout}ms waiting for ${description}; last value: ${formatValue(lastValue)}`);
    }

    function fixture(relativePath) {
        if (typeof relativePath !== "string" || isAbsolute(relativePath)) throw new Error("Fixture path must be relative.");
        const result = resolve(fixtureRoot, relativePath);
        const child = relative(fixtureRoot, result);
        if (child === ".." || child.startsWith(`..${path.sep}`) || isAbsolute(child)) throw new Error("Fixture path escaped the fixture directory.");
        return result;
    }

    function httpUrl(value) {
        if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) {
            throw new Error("HTTP fixture path must be a local absolute path beginning with one '/'.");
        }
        let decoded;
        try { decoded = decodeURIComponent(value); }
        catch { throw new Error("HTTP fixture path contains malformed encoding."); }
        if (decoded.startsWith("//") || decoded.includes("\\") || decoded.split(/[?#]/, 1)[0].split("/").some((part) => part === "." || part === "..")) {
            throw new Error("HTTP fixture path cannot escape the local fixture server.");
        }
        return new URL(value, `${HTTP_FIXTURE_URL}/`).href;
    }

    async function script(code) {
        const result = await call("script.execute", [code]);
        if (result?.isError) throw new Error(`Script failed: ${result.text ?? "unknown script error"}`);
        if (result?.runId || result?.pending) throw new Error(`Script is still pending (run ${result.runId ?? "unknown"}).`);
        if (typeof result?.text !== "string") throw new Error("Script result did not contain completed text.");
        return result.text;
    }

    async function restartApp() {
        if (attach) throw new Error('restartApp is unavailable with --attach; declare requires: ["launch"] for tests that need an owned app restart.');
        record("restart owned app", "<restart>");
        activeClient = await launcher.restart();
        activeClient = launcher.client ?? activeClient;
        state.lastValue = "reconnected";
    }

    async function launchSecondInstance(args = []) {
        if (attach) throw new Error('launchSecondInstance is unavailable with --attach; declare requires: ["launch"] for tests that launch a second process.');
        record("launch second instance", "<launch-second-instance>");
        state.lastValue = await launcher.launchSecondInstance(args);
        return state.lastValue;
    }

    const api = {
        call,
        callText,
        waitFor,
        fixture,
        httpUrl,
        script,
        restartApp,
        launchSecondInstance,
        expect(value) {
            return {
                toBe(expected) {
                    state.step = `assert ${formatValue(value)} toBe ${formatValue(expected)}`;
                    assert.ok(Object.is(value, expected), `Expected ${formatValue(value)} to be Object.is(${formatValue(expected)}).`);
                },
                toEqual(expected) {
                    state.step = `assert ${formatValue(value)} toEqual ${formatValue(expected)}`;
                    assert.deepStrictEqual(value, expected);
                },
                toContain(expected) {
                    state.step = `assert ${formatValue(value)} toContain ${formatValue(expected)}`;
                    const valid = typeof value === "string" || Array.isArray(value);
                    assert.ok(valid && value.includes(expected), `Expected ${formatValue(value)} to contain ${formatValue(expected)}.`);
                },
                toBeTruthy() {
                    state.step = `assert ${formatValue(value)} toBeTruthy`;
                    assert.ok(value, `Expected ${formatValue(value)} to be truthy.`);
                },
            };
        },
        _state: state,
        _getClient: () => activeClient,
        _setClient: (nextClient) => { activeClient = nextClient; },
    };
    return api;
}

function formatValue(value) {
    try { return JSON.stringify(value); }
    catch { return String(value); }
}
