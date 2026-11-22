import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { McpClient, type Timeouts } from "./client.js";
import { isTestInstanceOption } from "../ipc/test-host-protocol.js";
import { errMessage } from "../shared/utils.js";

const MAX_MAIN_OUTPUT_LINE_CHARS = 8_192;

export interface HostConfiguration {
    executable: string;
    devMain?: string;
    packaged: boolean;
    cwd: string;
    profile?: string;
    profileDirectory: string;
    port: number;
    attach: boolean;
    window?: string;
    testPath: string;
    logFile?: string;
    logDirectory?: string;
    rerunFailed: boolean;
    testSelection?: string;
    testSetup?: string;
    with: string[];
    timeoutScale: number;
    keepOpen: boolean;
    retries?: number;
    testTimeout?: number;
    grep?: string;
}
interface ChildState { process: ChildProcess; exit: Promise<string | number | null>; outputsClosed: Promise<void>; exited?: string | number | null; }
export class TestLauncher {
    child?: ChildState;
    client?: McpClient;
    private mainLogDescriptor?: number;
    constructor(private readonly configuration: HostConfiguration, private readonly timeouts: Timeouts) {}
    private arguments(): string[] {
        const args = this.configuration.packaged ? [] : [this.developmentMain()];
        if (this.configuration.profile) args.push("--profile", this.configuration.profile, "--profile-dir", this.configuration.profileDirectory);
        args.push("--test-instance", `--test-mcp-port=${this.configuration.port}`);
        if (this.configuration.logDirectory) args.push(`--test-log-dir=${this.configuration.logDirectory}`);
        return args;
    }
    private developmentMain(): string {
        if (!this.configuration.devMain) throw new Error("Development main bundle path is missing.");
        return this.configuration.devMain;
    }
    async start(): Promise<McpClient> {
        if (this.configuration.attach) {
            this.client = new McpClient(`http://127.0.0.1:${this.configuration.port}/mcp`, this.timeouts);
            await this.client.connect();
            if (this.configuration.profileDirectory) await this.verifyAttachedProfile(this.client);
            return this.client;
        }
        if (this.configuration.logDirectory && this.mainLogDescriptor === undefined) {
            this.mainLogDescriptor = fs.openSync(path.join(this.configuration.logDirectory, "app-main.log"), "a");
        }
        // Not windowsHide: on Windows it hides the app's first window (SW_HIDE in its startup info),
        // and tests run against a real, visible window.
        // `detached` for --keep-open: on Windows libuv puts non-detached children in a job object that
        // kills them when this host exits, so a retained app would die with the run.
        const childProcess = spawn(this.configuration.executable, this.arguments(), { cwd: this.configuration.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: false, detached: this.configuration.keepOpen });
        const outputsClosed = new Promise<void>((resolve) => {
            let openStreams = 2;
            const streamClosed = (): void => { openStreams -= 1; if (openStreams === 0) resolve(); };
            this.pipeOutput(childProcess.stdout, "stdout", process.stdout, streamClosed);
            this.pipeOutput(childProcess.stderr, "stderr", process.stderr, streamClosed);
        });
        const state: ChildState = { process: childProcess, exit: Promise.resolve(null), outputsClosed };
        state.exit = new Promise<string | number | null>((resolve, reject) => {
            childProcess.once("error", reject);
            childProcess.once("exit", (code, signal) => { state.exited = code ?? signal ?? 1; resolve(state.exited); });
        });
        this.child = state;
        this.client = new McpClient(`http://127.0.0.1:${this.configuration.port}/mcp`, this.timeouts, state);
        await this.client.connect(); return this.client;
    }
    async stop(): Promise<void> {
        const state = this.child; this.child = undefined;
        // Close through the app first so it saves the profile's session state; killing is the fallback.
        if (state && state.exited === undefined && this.client) {
            try { await this.client.call("window.close", [], Math.min(this.timeouts.shutdown, this.timeouts.request)); }
            catch { /* Best-effort; the bounded kill below still runs. */ }
        }
        await this.client?.close(); this.client = undefined;
        if (state && state.exited === undefined) {
            await Promise.race([state.exit, new Promise((resolve) => setTimeout(resolve, this.timeouts.shutdown))]);
            if (state.exited === undefined) {
                state.process.kill();
                await Promise.race([state.exit, new Promise((resolve) => setTimeout(resolve, this.timeouts.shutdown))]);
            }
        }
        await state?.outputsClosed;
    }

    async retain(): Promise<{ pid: number; url: string } | undefined> {
        const state = this.child;
        if (!state || state.exited !== undefined || !state.process.pid) return undefined;
        this.child = undefined;
        await this.client?.close();
        this.client = undefined;
        state.process.stdout?.destroy();
        state.process.stderr?.destroy();
        state.process.unref();
        return { pid: state.process.pid, url: `http://127.0.0.1:${this.configuration.port}/mcp` };
    }

    close(): void {
        if (this.mainLogDescriptor === undefined) return;
        fs.closeSync(this.mainLogDescriptor);
        this.mainLogDescriptor = undefined;
    }

    private pipeOutput(stream: NodeJS.ReadableStream | null, name: "stdout" | "stderr", destination: NodeJS.WriteStream, onClosed: () => void): void {
        if (!stream) { onClosed(); return; }
        const decoder = new StringDecoder("utf8");
        let pending = "";
        const emitLine = (message: string): void => {
            const truncated = message.length > MAX_MAIN_OUTPUT_LINE_CHARS;
            const record = { at: new Date().toISOString(), stream: name, message: truncated ? message.slice(0, MAX_MAIN_OUTPUT_LINE_CHARS) : message, ...(truncated ? { truncated: true } : {}) };
            if (this.mainLogDescriptor !== undefined) fs.writeSync(this.mainLogDescriptor, `${JSON.stringify(record)}\n`, undefined, "utf8");
        };
        stream.on("data", (chunk: Buffer | string) => {
            destination.write(chunk);
            const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
            pending += text;
            let newline = pending.indexOf("\n");
            while (newline !== -1) {
                const line = pending.slice(0, newline).replace(/\r$/, "");
                emitLine(line);
                pending = pending.slice(newline + 1);
                newline = pending.indexOf("\n");
            }
        });
        stream.once("close", () => {
            pending += decoder.end();
            if (pending.length) emitLine(pending);
            onClosed();
        });
    }
    async restart(): Promise<McpClient> { await this.stop(); return this.start(); }
    /** Start a second instance on this run's profile and resolve its exit code. A second instance
     *  normally hands its arguments to the running app and exits 0. */
    async launchSecondInstance(args: string[] = []): Promise<number> {
        if (args.some((argument) => argument === "--profile" || argument.startsWith("--profile=") || argument === "--profile-dir" || argument.startsWith("--profile-dir="))) throw new Error("launchSecondInstance does not allow profile overrides.");
        if (args.some(isTestInstanceOption)) throw new Error("launchSecondInstance does not allow internal test-instance options.");
        const childArgs = this.configuration.packaged ? [] : [this.developmentMain()];
        if (this.configuration.profile) childArgs.push("--profile", this.configuration.profile, "--profile-dir", this.configuration.profileDirectory);
        childArgs.push(...args);
        const child = spawn(this.configuration.executable, childArgs, { cwd: this.configuration.cwd, stdio: "ignore", windowsHide: true });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { child.kill(); reject(new Error(`Second instance did not exit within ${this.timeouts.secondInstance ?? 15000} ms.`)); }, this.timeouts.secondInstance ?? 15000);
            child.once("error", (error) => { clearTimeout(timer); reject(error); });
            child.once("exit", (code, signal) => {
                clearTimeout(timer);
                if (signal) reject(new Error(`Second instance exited from signal ${signal}.`));
                else if (!Number.isInteger(code)) reject(new Error("Second instance did not return an exit code."));
                else resolve(code as number); // Number.isInteger above rules out null.
            });
        });
    }

    private async verifyAttachedProfile(client: McpClient): Promise<void> {
        let canonical: string;
        try { canonical = await fs.promises.realpath(this.configuration.profileDirectory); }
        catch (error) { await client.close(); throw new Error(`Cannot resolve requested profile directory: ${errMessage(error)}`, { cause: error }); }
        try {
            const paths = await client.call("main.runtime.paths");
            const userData = paths && typeof paths === "object" && "userData" in paths && typeof paths.userData === "string" ? paths.userData : undefined;
            const connectedDirectory = userData ? await fs.promises.realpath(userData) : undefined;
            if (!connectedDirectory || connectedDirectory.toLowerCase() !== canonical.toLowerCase()) throw new Error(`Connected app profile identity did not match ${canonical}.`);
        } catch (error) {
            await client.close();
            throw new Error(`Cannot verify attached profile identity: ${errMessage(error)}`, { cause: error });
        }
    }
}
