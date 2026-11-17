import { app, utilityProcess, type UtilityProcess } from "electron";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { TEST_HOST_CONFIG_MARKER } from "../../ipc/test-host-protocol";
import os from "node:os";
import path from "node:path";
import { parseApplicationProfile } from "../application-profile";
import { getNodeHostEntryPath } from "../utils";
import { chooseMcpPort } from "./ports";
import { probeProfile, readProfileMcp, resolveProfileDirectory } from "./profile";
import type { TestControllerArguments } from "./arguments";
import { errMessage } from "../../shared/utils";

export async function startTestController(profileArgs: ReturnType<typeof parseApplicationProfile>, options: TestControllerArguments): Promise<void> {
    const originalUserData = app.getPath("userData");
    const targetProfile = resolveProfileDirectory(profileArgs, originalUserData);
    let temporaryDirectory: string | undefined;
    let host: UtilityProcess | undefined;
    let exitCode = 1;
    try {
        // Switch to throwaway data synchronously, before the first await: Chromium starts its GPU and
        // network processes at ready, and they must never open a real profile's folder.
        temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "persephone-test-controller-"));
        app.setPath("userData", temporaryDirectory);
        app.setPath("sessionData", temporaryDirectory);
        const running = await probeProfile(profileArgs.name);
        if (running && !options.attach) throw new Error("The requested profile is already running. Use --attach to connect without launching another instance.");
        if (options.attach && !running) throw new Error("Cannot attach: no running instance owns the requested profile pipe.");
        const mcp = options.attach ? await readProfileMcp(targetProfile, profileArgs.name) : { port: await chooseMcpPort(options.mcpPort) };
        await app.whenReady();
        const configuration = {
            testPath: options.testPath,
            cwd: options.cwd,
            profile: profileArgs.name,
            profileDirectory: targetProfile,
            port: mcp.port,
            attach: options.attach,
            logFile: options.logFile,
            logDirectory: options.logDirectory,
            rerunFailed: options.rerunFailed,
            testSelection: options.testSelection,
            testSetup: options.testSetup,
            with: options.with,
            timeoutScale: options.timeoutScale,
            keepOpen: options.keepOpen,
            executable: process.execPath,
            devMain: app.isPackaged ? undefined : path.resolve(__dirname, "main.js"),
            packaged: app.isPackaged,
        };
        host = utilityProcess.fork(getNodeHostEntryPath("test-host.mjs", "test-host"), [TEST_HOST_CONFIG_MARKER, JSON.stringify(configuration)], {
            cwd: options.cwd,
            stdio: "pipe",
            serviceName: "Persephone test runner",
        });
        host.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
        host.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
        exitCode = await new Promise<number>((resolve) => {
            host?.once("exit", (code) => resolve(code ?? 1));
            host?.once("error", () => { console.error("Could not start test host."); resolve(1); });
        });
    } catch (error) {
        console.error(`Test runner failed: ${errMessage(error)}`);
        exitCode = 1;
    } finally {
        if (temporaryDirectory) {
            try { await fs.rm(temporaryDirectory, { recursive: true, force: true }); }
            catch { /* Windows may retain transient files; cleanup does not change the result. */ }
        }
        app.exit(exitCode);
    }
}
