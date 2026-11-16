import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, REQUIREMENT_TAGS, validateRequirements } from "./lib/context.mjs";
import { createTimeouts, HTTP_FIXTURE_PORT, KEEP_OPEN_PATH, LOCK_PATH, MCP_URL, PROFILE_ROOT, REPORT_ROOT, RUNNER_ROOT, TEST_ROOT } from "./lib/config.mjs";
import { APP_PORTS, assertPortsFree, assertProductionBuildAllowed, buildProduction, createLauncher, prepareProfile, refreshFixtures, validateExecutable, verifyDevTarget } from "./lib/launcher.mjs";
import { McpClient } from "./lib/client.mjs";
import { startHttpFixtures } from "./lib/http-fixtures.mjs";
import { captureFailure, writeReports } from "./lib/report.mjs";

function parseArguments(args) {
    const options = { target: "dev", app: undefined, area: undefined, test: undefined, keepOpen: false, rerunFailed: false, open: false, attach: false, list: false, with: [], timeoutScale: 1 };
    const seen = new Set();
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        if (!["--area", "--test", "--keep-open", "--rerun-failed", "--timeout-scale", "--prod", "--app", "--open", "--attach", "--with", "--list"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
        if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
        seen.add(flag);
        if (flag === "--prod") { options.target = "prod"; continue; }
        if (flag === "--open" || flag === "--attach" || flag === "--keep-open" || flag === "--rerun-failed" || flag === "--list") {
            const key = { "--open": "open", "--attach": "attach", "--keep-open": "keepOpen", "--rerun-failed": "rerunFailed", "--list": "list" }[flag];
            options[key] = true;
            continue;
        }
        const value = args[++index];
        if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
        if (flag === "--app") { options.target = "exe"; options.app = path.resolve(value); }
        else if (flag === "--area") {
            const areas = value.split(",").map((area) => area.trim());
            if (areas.some((area) => !area)) throw new Error("--area requires one or more non-empty comma-separated path prefixes.");
            if (new Set(areas).size !== areas.length) throw new Error("--area contains duplicate path prefixes.");
            options.area = areas;
        }
        else if (flag === "--test") options.test = value;
        else if (flag === "--timeout-scale") {
            const scale = Number(value);
            if (!Number.isFinite(scale) || scale <= 0) throw new Error("--timeout-scale must be a positive finite number.");
            options.timeoutScale = scale;
        } else {
            if (!value.trim()) throw new Error("--with requires a comma-separated list of tags.");
            const tags = value.split(",").map((tag) => tag.trim());
            if (tags.some((tag) => !tag)) throw new Error("--with contains an empty tag.");
            if (new Set(tags).size !== tags.length) throw new Error("--with contains duplicate tags.");
            const invalid = tags.filter((tag) => !REQUIREMENT_TAGS.includes(tag) || tag === "launch");
            if (invalid.length) throw new Error(`Unknown --with tag: ${invalid.join(", ")}. Allowed tags: ${REQUIREMENT_TAGS.filter((tag) => tag !== "launch").join(", ")}.`);
            options.with = tags;
        }
    }
    if (seen.has("--prod") && seen.has("--app")) throw new Error("--prod and --app are mutually exclusive.");
    if (options.open && options.attach) throw new Error("--open and --attach cannot be combined.");
    if (options.list && ["--open", "--keep-open", "--rerun-failed"].some((flag) => seen.has(flag))) {
        throw new Error("--list cannot be combined with --open, --keep-open or --rerun-failed.");
    }
    if (options.attach) options.target = "attach";
    if (options.open && ["--area", "--test", "--rerun-failed", "--with", "--keep-open"].some((flag) => seen.has(flag))) {
        throw new Error("--open cannot be combined with --area, --test, --rerun-failed, --with or --keep-open.");
    }
    if (options.attach && ["--keep-open", "--prod", "--app"].some((flag) => seen.has(flag))) {
        throw new Error("--attach cannot be combined with --keep-open, --prod or --app.");
    }
    options.selection = { area: options.area, test: options.test, rerunFailed: options.rerunFailed, with: options.with, timeoutScale: options.timeoutScale };
    return options;
}

async function discoverTests() {
    const files = [];
    async function walk(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) await walk(absolute);
            else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(absolute);
        }
    }
    await walk(TEST_ROOT);
    files.sort((a, b) => path.relative(TEST_ROOT, a).localeCompare(path.relative(TEST_ROOT, b)));
    const descriptors = [];
    const ids = new Set();
    for (const file of files) {
        const module = await import(pathToFileURL(file).href);
        const exported = module.default;
        const list = Array.isArray(exported) ? exported : [exported];
        if (!list.length) throw new Error(`Test module ${file} exports an empty list.`);
        const relativeFile = path.relative(RUNNER_ROOT, file).replaceAll("\\", "/");
        for (const descriptor of list) {
            if (!descriptor || typeof descriptor.name !== "string" || !descriptor.name.trim() || typeof descriptor.run !== "function") {
                throw new Error(`Malformed test descriptor in ${relativeFile}; expected { name, run }.`);
            }
            const requirements = validateRequirements(descriptor.requires, `Test '${descriptor.name}' in ${relativeFile}`);
            const id = `${relativeFile}\0${descriptor.name}`;
            if (ids.has(id)) throw new Error(`Duplicate integration test ID: ${relativeFile} — ${descriptor.name}`);
            ids.add(id);
            const segments = relativeFile.split("/");
            if (segments.length < 4 || segments[0] !== "tests") {
                throw new Error(`Test ${relativeFile} must be under tests/<area>/<module>/<feature>.test.mjs.`);
            }
            descriptors.push({ ...descriptor, requires: requirements, file: relativeFile, area: segments.slice(1, -1).join("/") });
        }
    }
    return descriptors;
}

async function selectTests(options, discovered) {
    let selection = discovered;
    selection = filterByArea(options, selection);
    if (options.test !== undefined) selection = selection.filter((test) => test.name.includes(options.test));
    if (options.rerunFailed) {
        const filename = path.join(REPORT_ROOT, "last-failed.json");
        let saved;
        try { saved = JSON.parse(await readFile(filename, "utf8")); }
        catch (error) { throw new Error(`Cannot read --rerun-failed selection at ${filename}: ${error.message}`); }
        if (saved?.version !== 1 || !Array.isArray(saved.failed) || saved.failed.some((id) => typeof id?.file !== "string" || typeof id?.name !== "string")) {
            throw new Error(`Invalid --rerun-failed file: ${filename} must contain version 1 and a failed array of {file,name}.`);
        }
        const failedIds = new Set(saved.failed.map((id) => `${id.file}\0${id.name}`));
        const knownIds = new Set(discovered.map((test) => `${test.file}\0${test.name}`));
        const gone = [...failedIds].filter((id) => !knownIds.has(id));
        if (gone.length) console.warn(`Gone failed test IDs (no longer present): ${gone.map((id) => id.replace("\0", " — ")).join(", ")}`);
        const currentFailed = [...failedIds].filter((id) => knownIds.has(id));
        if (failedIds.size > 0 && currentFailed.length === 0) return [];
        const currentFailedSet = new Set(currentFailed);
        selection = selection.filter((test) => currentFailedSet.has(`${test.file}\0${test.name}`));
    }
    if (!selection.length) throw new Error("No integration tests matched the requested selection.");
    return selection;
}

function areaMatches(testArea, prefix) {
    return testArea === prefix || testArea.startsWith(`${prefix}/`);
}

function filterByArea(options, tests) {
    if (!options.area) return tests;
    const knownModules = [...new Set(tests.map((test) => test.area))].sort();
    const unmatched = options.area.filter((prefix) => !tests.some((test) => areaMatches(test.area, prefix)));
    if (unmatched.length) throw new Error(`--area path prefix matched no tests: ${unmatched.join(", ")}. Known module IDs: ${knownModules.join(", ") || "(none)"}.`);
    return tests.filter((test) => options.area.some((prefix) => areaMatches(test.area, prefix)));
}

function renderTestList(tests, options) {
    const roots = new Map();
    for (const descriptor of tests) {
        let level = roots;
        const segments = descriptor.area.split("/");
        let prefix = "";
        for (const segment of segments) {
            prefix = prefix ? `${prefix}/${segment}` : segment;
            if (!level.has(segment)) level.set(segment, { id: prefix, tests: [], children: new Map() });
            const node = level.get(segment);
            node.tests.push(descriptor);
            level = node.children;
        }
    }
    const skippedCount = (items) => items.filter((descriptor) => classify(descriptor, options)).length;
    console.log("Integration test modules:");
    function print(level, depth = 0) {
        for (const node of [...level.values()].sort((a, b) => a.id.localeCompare(b.id))) {
            console.log(`${"  ".repeat(depth)}${node.id} (${node.tests.length} tests, ${skippedCount(node.tests)} skipped by requirements)`);
            print(node.children, depth + 1);
        }
    }
    print(roots);
    console.log(`Total: ${tests.length} tests, ${skippedCount(tests)} skipped by requirements.`);
}

function classify(descriptor, options) {
    if (options.attach && descriptor.requires.includes("launch")) return "needs a launched app (not available with --attach)";
    const missing = descriptor.requires.filter((tag) => tag !== "launch" && !options.with.includes(tag));
    return missing.length ? `missing opt-in: ${missing.join(", ")}` : null;
}

async function acquireLock() {
    let handle;
    try { handle = await open(LOCK_PATH, "wx"); }
    catch (error) {
        if (error.code === "EEXIST") throw new Error(`Integration runner lock already exists at ${LOCK_PATH}. Confirm no runner is active, then remove the stale lock manually.`);
        throw error;
    }
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
    return async () => { await handle.close(); await unlink(LOCK_PATH).catch(() => {}); };
}

async function writeKeepOpen(record) {
    await mkdir(REPORT_ROOT, { recursive: true });
    const temporary = `${KEEP_OPEN_PATH}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        await rename(temporary, KEEP_OPEN_PATH);
    } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

function pidIsAlive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code === "EPERM"; }
}

async function connectAttach(timeouts) {
    let record;
    try { record = JSON.parse(await readFile(KEEP_OPEN_PATH, "utf8")); }
    catch { throw new Error("No valid retained integration app record; start npm run test:ui -- --open first."); }
    if (typeof record.profileDir !== "string" || !path.isAbsolute(record.profileDir) || path.resolve(record.profileDir) !== path.resolve(PROFILE_ROOT)
        || !Number.isSafeInteger(record.pid) || record.pid <= 0 || !pidIsAlive(record.pid) || record.url !== MCP_URL) {
        throw new Error("The retained integration app record is invalid or does not match this profile; start npm run test:ui -- --open first.");
    }
    const client = new McpClient(MCP_URL, timeouts);
    try { await client.connect({ deadline: Date.now() + timeouts.startup }); }
    catch (error) { await client.close(); throw new Error(`Could not connect to the retained integration app at ${MCP_URL}; start npm run test:ui -- --open first. ${error.message}`); }
    return client;
}

function failureResult(descriptor, message, step) {
    return { ...descriptor, status: "failed", durationMs: 0, failure: { message, step, path: "", response: "" } };
}

async function main() {
    let options;
    try { options = parseArguments(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 2; return; }

    const startedAt = new Date().toISOString();
    let selection = [];
    try {
        if (!options.open) {
            const discovered = await discoverTests();
            if (options.list) {
                const listed = filterByArea(options, discovered);
                renderTestList(listed, options);
                return;
            }
            selection = await selectTests(options, discovered);
        }
    } catch (error) { console.error(error.message); process.exitCode = 1; return; }
    if (options.rerunFailed && selection.length === 0) {
        console.log("No current failed test IDs remain after removing gone IDs; nothing to run.");
        return;
    }

    const skipped = new Map(selection.map((descriptor) => [descriptor, classify(descriptor, options)]).filter(([, reason]) => reason));
    const runnable = selection.filter((descriptor) => !skipped.has(descriptor));
    const results = [];
    const timeouts = createTimeouts(options.timeoutScale);
    let releaseLock;
    let launcher;
    let attachClient;
    let httpServer;
    let profilePath;
    let currentModule;
    let interrupted = false;
    let openRetained = false;
    const buildAbort = new AbortController();
    let unhandledFailure = null;
    const stopOnSignal = () => { interrupted = true; buildAbort.abort(); };
    process.on("SIGINT", stopOnSignal);
    process.on("SIGTERM", stopOnSignal);

    try {
        releaseLock = await acquireLock();
        if (options.attach) {
            attachClient = await connectAttach(timeouts);
            await assertPortsFree([HTTP_FIXTURE_PORT]);
            await refreshFixtures(PROFILE_ROOT);
            profilePath = PROFILE_ROOT;
            httpServer = await startHttpFixtures({ closeTimeout: timeouts.shutdown });
        } else {
            if (options.target === "dev") await verifyDevTarget(timeouts);
            if (options.target === "exe") options.app = await validateExecutable(options.app);
            if (options.target === "prod") await assertProductionBuildAllowed();
            profilePath = await prepareProfile(timeouts);
            if (options.target === "prod") await buildProduction({ signal: buildAbort.signal });
            launcher = createLauncher({ profilePath, timeouts, target: options.target, appPath: options.app });
            if (options.open) {
                await launcher.start();
                if (interrupted) throw new Error("Open run interrupted.");
                await writeKeepOpen({ pid: launcher.child.pid, url: MCP_URL, profileDir: path.resolve(profilePath), startedAt: new Date().toISOString() });
                const target = launcher.detach();
                console.log(`MCP_URL=${target.url}\nIntegration app left open (PID ${target.pid}). Close: npm run test:ui:call -- --close`);
                await launcher.client?.close();
                openRetained = true;
                return;
            }
            httpServer = await startHttpFixtures({ closeTimeout: timeouts.shutdown });
        }

        if (runnable.length) {
            if (options.attach) {
                // The retained process owns the application; only its independent client is used here.
            } else await launcher.start();
        }
        for (const descriptor of selection) {
            const skipReason = skipped.get(descriptor);
            if (skipReason) {
                results.push({ ...descriptor, status: "skipped", durationMs: 0, skipReason });
                continue;
            }
            if (interrupted) {
                results.push(failureResult(descriptor, "Run interrupted by a termination signal.", "interrupted"));
                continue;
            }
            const startTime = Date.now();
            const context = createContext({ client: options.attach ? attachClient : launcher.client, launcher: options.attach ? {} : launcher, fixtureRoot: path.join(profilePath, "work"), timeouts, attach: options.attach });
            try {
                if (!options.attach && currentModule !== undefined && currentModule !== descriptor.area) {
                    // A restart alone keeps the previous module's session (pages, settings); re-seed the
                    // profile so every module starts from the committed seed.
                    await launcher.stop();
                    await prepareProfile(timeouts, { ports: APP_PORTS });
                    await launcher.start();
                    context._setClient(launcher.client);
                }
                currentModule = descriptor.area;
                await descriptor.run(context);
                results.push({ ...descriptor, status: "passed", durationMs: Date.now() - startTime });
            } catch (error) {
                context._state.failure = { message: error?.stack ?? error?.message ?? String(error) };
                const failure = await captureFailure(context, path.join(REPORT_ROOT, "screenshots"), descriptor);
                failure.message = context._state.failure.message;
                results.push({ ...descriptor, status: "failed", durationMs: Date.now() - startTime, failure });
                if (!options.attach && !launcher.healthy()) {
                    try { await launcher.restart(); }
                    catch (restartError) {
                        unhandledFailure = new Error(`Could not restart after ${descriptor.name}: ${restartError.message}`);
                        for (const remaining of selection.slice(selection.indexOf(descriptor) + 1)) {
                            const reason = skipped.get(remaining);
                            results.push(reason ? { ...remaining, status: "skipped", durationMs: 0, skipReason: reason } : failureResult(remaining, `App recovery failed: ${restartError.message}`, "restart owned app"));
                        }
                        break;
                    }
                }
            }
        }
    } catch (error) {
        unhandledFailure = error;
        if (options.open) process.exitCode = 1;
        if (!options.open && results.length === 0) {
            for (const descriptor of selection) {
                const reason = skipped.get(descriptor);
                results.push(reason ? { ...descriptor, status: "skipped", durationMs: 0, skipReason: reason } : failureResult(descriptor, error.message, options.attach ? "attach preflight" : "preflight"));
            }
        }
    } finally {
        try { await httpServer?.close(); }
        catch (error) { unhandledFailure ??= error; console.error(`HTTP fixture cleanup failed: ${error.message}`); }
        await attachClient?.close();
        if (launcher) {
            try {
                const hasFailures = results.some((result) => result.status === "failed") || Boolean(unhandledFailure);
                if (options.keepOpen && hasFailures && !interrupted) {
                    try {
                        if (!launcher.healthy()) await launcher.start();
                        await writeKeepOpen({ pid: launcher.child.pid, url: MCP_URL, profileDir: path.resolve(profilePath), startedAt: new Date().toISOString() });
                        const target = launcher.detach();
                        console.log(`Integration app left open at ${target.url} (PID ${target.pid}). Close: npm run test:ui:call -- --close`);
                        await launcher.client?.close();
                    } catch (error) { unhandledFailure ??= error; await launcher.stop().catch(() => {}); }
                } else if (!openRetained) await launcher.stop();
            } catch (error) { unhandledFailure ??= error; console.error(`App cleanup failed: ${error.message}`); }
        }
        if (!options.open && results.length) {
            try {
                const summary = await writeReports(results, { directory: REPORT_ROOT, target: options.target === "attach" ? "attach" : options.target, selection: options.selection, startedAt });
                if (summary.failed || unhandledFailure) process.exitCode = 1;
            } catch (error) { console.error(`Could not write integration reports: ${error.message}`); process.exitCode = 1; }
        }
        if (unhandledFailure) { console.error(unhandledFailure.message); process.exitCode ??= 1; }
        await releaseLock?.();
        process.off("SIGINT", stopOnSignal);
        process.off("SIGTERM", stopOnSignal);
    }
}

await main();
