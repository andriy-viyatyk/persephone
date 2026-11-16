import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createTimeouts, KEEP_OPEN_PATH, MCP_URL, REPORT_ROOT } from "./lib/config.mjs";
import { McpClient } from "./lib/client.mjs";
import { saveScreenshot } from "./lib/report.mjs";

const execFile = promisify(execFileCallback);
const USAGE = "Usage: npm run test:ui:call -- <path> '[...]' [--text] [--dialog] [--max-length N] | --close";

function parseArguments(tokens) {
    if (tokens.includes("--close")) {
        if (tokens.length !== 1) throw new Error("--close cannot be combined with call arguments.");
        return { close: true };
    }
    let callPath;
    let args;
    let text = false;
    let dialog = false;
    let maxLength;
    const seen = new Set();
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === "--text" || token === "--dialog" || token === "--max-length") {
            if (seen.has(token)) throw new Error(`Duplicate option: ${token}`);
            seen.add(token);
            if (token === "--text") text = true;
            else if (token === "--dialog") dialog = true;
            else {
                const value = tokens[++index];
                if (!value || value.startsWith("--")) throw new Error("--max-length requires a positive integer N.");
                if (!/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
                    throw new Error("--max-length must be a positive safe integer.");
                }
                maxLength = Number(value);
            }
            continue;
        }
        if (token.startsWith("--")) throw new Error(`Unknown option: ${token}`);
        if (token.startsWith("[")) {
            if (args !== undefined) throw new Error("Only one JSON argument array may be supplied.");
            try { args = JSON.parse(token); }
            catch (error) { throw new Error(`Could not parse argument array: ${error.message}`); }
            if (!Array.isArray(args)) throw new Error("Call arguments must be a JSON array.");
            continue;
        }
        if (callPath !== undefined) throw new Error(`Unexpected argument: ${token}`);
        callPath = token;
    }
    if (!callPath) throw new Error("A call path is required.");
    return { close: false, callPath, args, text, dialog, maxLength };
}

function formatValue(value) {
    if (typeof value === "string") return value;
    const json = JSON.stringify(value, null, 2);
    return json === undefined ? String(value) : json;
}

function portAcceptsConnections(port) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`Timed out checking test port ${port}.`));
        }, 500);
        socket.once("connect", () => {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
        });
        socket.once("error", (error) => {
            clearTimeout(timer);
            if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") resolve(false);
            else reject(error);
        });
    });
}

async function waitForPortClosed(timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (!await portAcceptsConnections(17865)) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return !await portAcceptsConnections(17865);
}

async function readKeepOpenRecord() {
    let record;
    try { record = JSON.parse(await readFile(KEEP_OPEN_PATH, "utf8")); }
    catch { return null; }
    if (!Number.isSafeInteger(record?.pid) || record.pid <= 0
        || record.url !== MCP_URL
        || typeof record.profileDir !== "string" || !path.isAbsolute(record.profileDir)
        || typeof record.startedAt !== "string" || Number.isNaN(Date.parse(record.startedAt))) return null;
    return record;
}

function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}

async function commandLineForPid(pid) {
    if (process.platform !== "win32") throw new Error("CIM process inspection is available only on Windows.");
    const query = `Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | Select-Object -ExpandProperty CommandLine | ConvertTo-Json -Compress`;
    const { stdout } = await execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], {
        encoding: "utf8", windowsHide: true, timeout: 5000,
    });
    const commandLine = JSON.parse(stdout.trim());
    if (typeof commandLine !== "string" || !commandLine) throw new Error(`CIM returned no command line for PID ${pid}.`);
    return commandLine;
}

function manualCloseInstructions(reason) {
    console.error(`Could not safely close the integration-test instance: ${reason}`);
    console.error("Close the isolated test window with File > Exit, then resolve any remaining listener on 127.0.0.1:17865. Do not close the user's ordinary Persephone instance.");
}

async function closeTestInstance(timeouts) {
    const client = new McpClient(MCP_URL, timeouts);
    try {
        try {
            await client.connect({ deadline: Date.now() + timeouts.shutdown });
            await client.call("window.close", [], { timeout: timeouts.shutdown });
        } catch {
            // A missing MCP endpoint or a close that drops its connection is followed by port verification.
        } finally {
            await client.close();
        }

        let closed = await waitForPortClosed(timeouts.shutdown);
        if (!closed) {
            const record = await readKeepOpenRecord();
            if (!record) {
                manualCloseInstructions("keep-open.json is missing or invalid, so no process can be verified.");
                process.exitCode = 1;
                return;
            }
            if (!processIsAlive(record.pid)) {
                manualCloseInstructions(`recorded PID ${record.pid} is not alive while the test port remains open.`);
                process.exitCode = 1;
                return;
            }
            let commandLine;
            try { commandLine = await commandLineForPid(record.pid); }
            catch (error) {
                manualCloseInstructions(`could not inspect recorded PID ${record.pid}: ${error.message}`);
                process.exitCode = 1;
                return;
            }
            if (!commandLine.toLowerCase().includes(record.profileDir.toLowerCase())) {
                manualCloseInstructions(`PID ${record.pid}'s command line does not contain the recorded profile directory.`);
                process.exitCode = 1;
                return;
            }
            try {
                await execFile("taskkill.exe", ["/PID", String(record.pid), "/T", "/F"], {
                    encoding: "utf8", windowsHide: true, timeout: timeouts.shutdown,
                });
            } catch (error) {
                manualCloseInstructions(`taskkill failed for the verified test PID: ${error.message}`);
                process.exitCode = 1;
                return;
            }
            closed = await waitForPortClosed(timeouts.shutdown);
        }

        if (!closed) {
            manualCloseInstructions("test port 17865 is still accepting connections after shutdown.");
            process.exitCode = 1;
            return;
        }
        await unlink(KEEP_OPEN_PATH).catch((error) => {
            if (error.code !== "ENOENT") throw error;
        });
        console.log("Integration-test instance is closed; keep-open record removed.");
    } finally {
        await client.close();
    }
}

async function runCall(options, timeouts) {
    const screenshot = options.callPath === "window.screen.screenshot";
    if (screenshot && (options.text || options.dialog || options.maxLength !== undefined)) {
        throw new Error("window.screen.screenshot does not accept --text, --dialog, or --max-length.");
    }
    if (screenshot && options.args?.length) throw new Error("window.screen.screenshot does not accept arguments.");
    const client = new McpClient(MCP_URL, timeouts);
    try {
        await client.connect({ deadline: Date.now() + timeouts.startup });
        if (screenshot) {
            const image = await client.screenshot();
            const directory = path.join(REPORT_ROOT, "screenshots");
            const filename = await saveScreenshot(image, directory);
            console.log(path.relative(REPORT_ROOT, filename).replaceAll("\\", "/"));
            return;
        }
        const callOptions = {};
        if (options.maxLength !== undefined) callOptions.maxLength = options.maxLength;
        if (options.dialog) callOptions.dialog = true;
        const result = options.text
            ? await client.callText(options.callPath, options.args, callOptions)
            : await client.call(options.callPath, options.args, callOptions);
        console.log(formatValue(result));
    } finally {
        await client.close();
    }
}

async function main() {
    let options;
    try { options = parseArguments(process.argv.slice(2)); }
    catch (error) {
        console.error(`${error.message}\n${USAGE}`);
        process.exitCode = 2;
        return;
    }
    const timeouts = createTimeouts();
    try {
        if (options.close) await closeTestInstance(timeouts);
        else await runCall(options, timeouts);
    } catch (error) {
        console.error(error?.stack ?? error?.message ?? String(error));
        process.exitCode = 1;
    }
}

await main();
