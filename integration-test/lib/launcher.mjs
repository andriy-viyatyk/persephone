import { spawn } from "node:child_process";
import { access, constants, cp, lstat, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import electronPath from "electron";
import { isLinux, isWindows } from "../../src/shared/platform.ts";
import { profileSocketName } from "../../src/shared/profile-socket.ts";
import {
    DEV_MAIN_PATH, DEV_MARKER_PATH, FIXTURE_ROOT, MCP_URL, PROFILE_ROOT, REPOSITORY_ROOT,
    RUNNER_ROOT, SEED_ROOT, TEST_PORTS, HTTP_FIXTURE_PORT, HTTPS_FIXTURE_PORT, PROD_BUILD_BLOCKED_MESSAGE, RESTART_DEV_NOTICE,
} from "./config.mjs";
import { McpClient, raceTimeout } from "./client.mjs";

function isLoopback(hostname) {
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname.toLowerCase());
}

function listenProbe(port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
    });
}

export async function assertPortsFree(ports = TEST_PORTS) {
    for (const port of ports) {
        try {
            await listenProbe(port);
        } catch {
            throw new Error(`Integration test port ${port} is occupied. Close the process using it before running the suite.`);
        }
    }
}

export const APP_PORTS = Object.freeze(TEST_PORTS.filter((port) => port !== HTTP_FIXTURE_PORT && port !== HTTPS_FIXTURE_PORT));

function probePipe(pipePath, timeout) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(pipePath);
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`The uitest profile endpoint probe timed out: ${pipePath}`));
        }, timeout);
        socket.once("connect", () => {
            clearTimeout(timer);
            socket.end();
            reject(new Error(`An existing uitest instance owns the profile. Close it before resetting ${PROFILE_ROOT}.`));
        });
        socket.once("error", (error) => {
            clearTimeout(timer);
            if (error.code === "ENOENT" || error.code === "ECONNREFUSED") resolve();
            else reject(new Error(`Could not safely probe the uitest profile endpoint: ${error.message}`));
        });
    });
}

export async function verifyDevTarget(timeouts) {
    let marker;
    try {
        marker = JSON.parse(await readFile(DEV_MARKER_PATH, "utf8"));
        const url = new URL(marker.url);
        if (!new Set(["http:", "https:"]).has(url.protocol) || !isLoopback(url.hostname)) throw new Error("marker URL must be HTTP(S) loopback");
        if (!Number.isInteger(marker.pid) || marker.pid <= 0) throw new Error("marker PID is invalid");
        if (typeof marker.startedAt !== "string" || Number.isNaN(Date.parse(marker.startedAt)) || new Date(marker.startedAt).toISOString() !== marker.startedAt) {
            throw new Error("marker start time is invalid");
        }
        process.kill(marker.pid, 0);
        const response = await raceTimeout(fetch(url, { signal: AbortSignal.timeout(timeouts.devProbe) }), timeouts.devProbe,
            "dev server probe timed out");
        if (!response.ok) throw new Error(`dev server returned HTTP ${response.status}`);
        const mainBundle = await readFile(DEV_MAIN_PATH, "utf8");
        if (!mainBundle.includes(marker.url)) throw new Error("the dev bundle was replaced (a production build?) — restart npm start");
        return marker;
    } catch (error) {
        if (error.message === "the dev bundle was replaced (a production build?) — restart npm start") throw error;
        throw new Error(`Cannot verify the active dev target (${error.message}). Start npm start first.`);
    }
}

export async function validateExecutable(appPath) {
    const resolved = path.resolve(appPath);
    const executableName = path.basename(resolved);
    if (!isWindows && !isLinux) throw new Error(`Packaged integration runs are not supported on ${process.platform}.`);
    const validName = isWindows
        ? executableName.toLowerCase() === "persephone.exe"
        : executableName === "persephone";
    if (!validName) {
        const expectedName = isWindows ? "persephone.exe" : "persephone";
        throw new Error(`Expected a Persephone executable named ${expectedName}. Check the sibling path: ${path.join(path.dirname(resolved), expectedName)}`);
    }
    try {
        const info = await stat(resolved);
        if (!info.isFile()) throw new Error("not a regular file");
        await access(resolved, isLinux ? constants.X_OK : constants.R_OK);
    } catch (error) {
        const requirement = isLinux ? "execute" : "read";
        const expectedName = isWindows ? "persephone.exe" : "persephone";
        throw new Error(`Cannot ${requirement} Persephone executable at ${resolved}: ${error.message}. Check the sibling path: ${path.join(path.dirname(resolved), expectedName)}`);
    }
    return resolved;
}

export async function packagedTestCommand(appPath, testFolder, productArgs) {
    if (isWindows) {
        const executable = path.join(path.dirname(appPath), "persephone-test.exe");
        await access(executable);
        return { executable, args: [testFolder, ...productArgs] };
    }
    if (isLinux) return { executable: appPath, args: ["--test", testFolder, ...productArgs] };
    throw new Error(`Packaged integration runs are not supported on ${process.platform}.`);
}

function markerHasLivePid(markerText) {
    try {
        const marker = JSON.parse(markerText);
        if (!Number.isSafeInteger(marker?.pid) || marker.pid <= 0) return false;
        try {
            process.kill(marker.pid, 0);
            return true;
        } catch (error) {
            return error.code === "EPERM";
        }
    } catch {
        return false;
    }
}

export async function assertProductionBuildAllowed() {
    let markerText;
    try { markerText = await readFile(DEV_MARKER_PATH, "utf8"); }
    catch { return; }
    if (markerHasLivePid(markerText)) throw new Error(PROD_BUILD_BLOCKED_MESSAGE);
}

export async function buildProduction({ signal } = {}) {
    await assertProductionBuildAllowed();
    const childProcess = spawn(process.execPath, [path.join(REPOSITORY_ROOT, "scripts", "build-prod.mjs")], {
        cwd: REPOSITORY_ROOT,
        stdio: "inherit",
        ...(signal ? { signal } : {}),
    });
    let started = false;
    const onSpawn = () => { started = true; };
    childProcess.once("spawn", onSpawn);
    try {
        await new Promise((resolve, reject) => {
            childProcess.once("spawn", resolve);
            childProcess.once("error", reject);
        });
        const result = await new Promise((resolve, reject) => {
            childProcess.once("error", reject);
            childProcess.once("exit", (code, processSignal) => resolve({ code, signal: processSignal }));
        });
        if (signal?.aborted) throw new Error("Production build interrupted.");
        if (result.code !== 0) throw new Error(`Production build failed with ${result.signal ? `signal ${result.signal}` : `exit code ${result.code}`}.`);
    } catch (error) {
        if (started && childProcess.exitCode === null && childProcess.signalCode === null) childProcess.kill();
        if (started && childProcess.exitCode === null && childProcess.signalCode === null) {
            await new Promise((resolve) => childProcess.once("exit", resolve));
        }
        if (signal?.aborted) throw new Error("Production build interrupted.");
        throw error;
    } finally {
        childProcess.off("spawn", onSpawn);
        if (started) console.log(RESTART_DEV_NOTICE);
    }
}

/** `ports`: what must be free before the reset. A between-modules reset passes the app ports only,
 *  because the runner's own fixture HTTP server is still listening. */
export async function prepareProfile(timeouts, { ports = TEST_PORTS } = {}) {
    const resolved = path.resolve(PROFILE_ROOT);
    if (!resolved.startsWith(`${RUNNER_ROOT}${path.sep}`)) throw new Error("Resolved test profile escaped integration-test.");
    try {
        const info = await lstat(resolved);
        if (info.isSymbolicLink() || info.isJunction?.()) throw new Error("Refusing to reset a symlink or junction at the test profile path.");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    await assertPortsFree(ports);
    if (isWindows) {
        const pipePath = `\\\\.\\pipe\\persephone-${os.userInfo().username}-uitest`;
        await probePipe(pipePath, timeouts.devProbe);
    } else if (isLinux) {
        const runtimeDirectory = process.env.XDG_RUNTIME_DIR;
        if (!runtimeDirectory?.trim()) throw new Error("XDG_RUNTIME_DIR must be set to a non-empty directory before resetting the integration test profile.");
        await probePipe(path.join(runtimeDirectory, profileSocketName("uitest")), timeouts.devProbe);
    }
    await rm(resolved, { recursive: true, force: true });
    await cp(SEED_ROOT, resolved, { recursive: true });
    await mkdir(path.join(resolved, "work"), { recursive: true });
    await refreshFixtures(resolved);
    return resolved;
}

export async function refreshFixtures(profilePath) {
    const workRoot = path.join(profilePath, "work");
    await mkdir(workRoot, { recursive: true });
    await cp(FIXTURE_ROOT, workRoot, { recursive: true, force: true });
}

function waitForExit(child, timeout) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
    return raceTimeout(new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))), timeout,
        `Timed out waiting for owned Electron child ${child.pid} to exit.`);
}

export function createLauncher({ profilePath, timeouts, target = "dev", appPath }) {
    let child = null;
    let client = null;
    let childState = null;

    function targetCommand(args = []) {
        if (target === "exe" && !isWindows && !isLinux) throw new Error(`Packaged integration runs are not supported on ${process.platform}.`);
        const executable = target === "exe" ? appPath : electronPath;
        const profileArgs = ["--profile", "uitest", "--profile-dir", profilePath];
        const appArgs = target === "exe" ? profileArgs : [".", ...profileArgs];
        return { executable, args: [...appArgs, ...args] };
    }

    async function start() {
        if (child) throw new Error("The owned integration-test app is already running.");
        await assertPortsFree(APP_PORTS);
        const mcpClient = new McpClient(MCP_URL, timeouts);
        const { executable, args } = targetCommand();
        const launched = spawn(executable, args, {
            cwd: REPOSITORY_ROOT,
            stdio: "ignore",
            windowsHide: false,
            // Own process group: --keep-open must outlive the runner (and npm). The runner still
            // stops this child itself on a normal exit and on SIGINT/SIGTERM.
            detached: true,
        });
        const state = { exited: null };
        let resolveExit;
        state.exitPromise = new Promise((resolve) => { resolveExit = resolve; });
        let spawnError = null;
        launched.once("error", (error) => { spawnError = error; state.exited = error.message; resolveExit(state.exited); });
        launched.once("exit", (code, signal) => { state.exited = `code ${code ?? "null"}, signal ${signal ?? "none"}`; resolveExit(state.exited); });
        child = launched;
        childState = state;
        try {
            await new Promise((resolve, reject) => {
                if (spawnError) reject(spawnError);
                else launched.once("spawn", resolve);
                launched.once("error", reject);
            });
            client = await mcpClient.connect({ deadline: Date.now() + timeouts.startup, childState: state });
            return client;
        } catch (error) {
            await mcpClient.close();
            if (child && state.exited === null) await stop();
            throw error;
        }
    }

    async function launchSecondInstance(args = []) {
        if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
            throw new TypeError("launchSecondInstance(args) requires an array of strings.");
        }
        if (args.some((argument) => argument === "--profile" || argument === "--profile-dir" || argument.startsWith("--profile=") || argument.startsWith("--profile-dir="))) {
            throw new Error("launchSecondInstance does not allow profile override flags.");
        }
        for (const argument of args) {
            const looksLikePath = path.isAbsolute(argument) || argument.startsWith(".") || argument.includes("/") || argument.includes("\\");
            if (!looksLikePath) continue;
            try { await stat(argument); }
            catch { throw new Error(`Second-instance path does not exist: ${argument}`); }
        }
        const command = targetCommand(args);
        const launched = spawn(command.executable, command.args, { cwd: REPOSITORY_ROOT, stdio: "ignore", windowsHide: true });
        let spawned = false;
        try {
            await new Promise((resolve, reject) => {
                launched.once("spawn", () => { spawned = true; resolve(); });
                launched.once("error", reject);
            });
            const result = await waitForExit(launched, timeouts.secondInstance);
            if (result.signal) throw new Error(`Second instance exited from signal ${result.signal}.`);
            if (!Number.isInteger(result.code)) throw new Error("Second instance did not return an exit code.");
            return result.code;
        } catch (error) {
            if (spawned && launched.exitCode === null && launched.signalCode === null) {
                launched.kill();
                await raceTimeout(waitForExit(launched, timeouts.shutdown), timeouts.shutdown, "Timed out cleaning up the second instance child.").catch(() => {});
            }
            throw error;
        }
    }

    async function stop() {
        if (!child) return;
        const owned = child;
        if (client?.healthy) {
            try {
                await client.call("window.close", [], { timeout: Math.min(timeouts.shutdown, timeouts.request) });
            } catch {
                // Closing through the owned session is best-effort; bounded child cleanup follows.
            }
        }
        try {
            await waitForExit(owned, timeouts.shutdown);
        } catch {
            owned.kill();
            await waitForExit(owned, timeouts.shutdown);
        }
        await client?.close();
        client = null;
        child = null;
        childState = null;
    }

    async function restart() {
        await stop();
        return start();
    }

    function detach() {
        if (child) child.unref();
        return { url: MCP_URL, pid: child?.pid };
    }

    function healthy() {
        return Boolean(child && childState?.exited === null && client?.healthy);
    }

    async function reconnect() {
        if (!child || childState?.exited) throw new Error("The owned app is not running.");
        client = await new McpClient(MCP_URL, timeouts).connect({ deadline: Date.now() + timeouts.startup, childState });
        return client;
    }

    return { start, stop, restart, detach, healthy, reconnect, launchSecondInstance, get client() { return client; }, get child() { return child; } };
}
