import fs from "node:fs";
import path from "node:path";
import { type MessagePortMain, type UtilityProcess, utilityProcess } from "electron";
import type { ServiceMainMessage, ServiceParentMessage, ServiceHostConfig, ServiceStopReason, StartResult, TrustedBoardSnapshotEntry } from "../../ipc/module-service-channels";
import {
    SERVICE_HANDSHAKE_TIMEOUT_MS,
    SERVICE_SHUTDOWN_TIMEOUT_MS,
} from "../../ipc/module-service-channels";
import { errMessage } from "../../shared/utils";
import { getActiveLocale } from "../../shared/i18n/active-locale";
import { ServiceError, type ServiceRecord, killUtilityProcessSync } from "./record";
import { getNodeHostEntryPath, isPathInside } from "../utils";
import * as boardLog from "../board-log";

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type BoardSettingsMessage = Extract<ServiceMainMessage, { kind: "board-settings-get" | "board-settings-subscribe" | "board-settings-unsubscribe" }>;
type CapabilityClientMessage = Extract<ServiceMainMessage, { kind: "capability-client-discover" | "capability-client-resolve" | "capability-client-invoke" | "capability-client-cancel" }>;

export interface ModuleServiceProcessContext {
    isTrusted(boardRoot: string): boolean;
    capabilities(record: ServiceRecord): TrustedBoardSnapshotEntry["capabilities"];
    mcpEndpoint(record: ServiceRecord, process: ModuleServiceProcess, message: Extract<ServiceMainMessage, { kind: "mcp-endpoint-request" }>): void;
    boardSettings(record: ServiceRecord, process: ModuleServiceProcess, message: BoardSettingsMessage): void;
    capabilityClient(record: ServiceRecord, process: ModuleServiceProcess, message: CapabilityClientMessage): void;
    capabilityResult(record: ServiceRecord, process: ModuleServiceProcess, message: Extract<ServiceMainMessage, { kind: "capability-result" }>): void;
    channelEnded(record: ServiceRecord, channelId: string): void;
    response(record: ServiceRecord, message: Extract<ServiceMainMessage, { kind: "response" }>): void;
    rendererAttached(record: ServiceRecord, generation: number, leaseNonce: string): void;
    ready(process: ModuleServiceProcess): StartResult;
    unexpectedExit(process: ModuleServiceProcess, code: number): void;
}

interface Handshake {
    ready: boolean;
    probeSent: boolean;
    settled: boolean;
    timer?: ReturnType<typeof setTimeout>;
    resolve(value: StartResult): void;
    reject(error: ServiceError): void;
}

export class ModuleServiceProcess {
    private readonly child: UtilityProcess;
    private handshake: Handshake | undefined;

    constructor(
        private readonly record: ServiceRecord,
        readonly generation: number,
        private readonly context: ModuleServiceProcessContext,
        private readonly entryPath: string,
    ) {
        this.child = utilityProcess.fork(getNodeHostEntryPath("module-service-host.mjs", "module-service-host"), [entryPath], {
            cwd: record.boardRoot,
            env: this.buildServiceEnvironment(record.boardRoot),
            stdio: "pipe",
            serviceName: `Persephone board service: ${record.boardRoot}`,
        });
    }

    static async resolveEntry(record: ServiceRecord): Promise<string> {
        const entry = record.serviceEntry;
        if (!entry || entry.includes("\0") || path.isAbsolute(entry) || path.win32.isAbsolute(entry) || /^[A-Za-z]:/.test(entry)) {
            throw new ServiceError("invalid-entry");
        }
        const segments = entry.split(/[\\/]+/);
        if (segments.some((segment) => segment === ".." || segment === "." || segment.length === 0)) throw new ServiceError("invalid-entry");
        const absoluteEntry = path.resolve(record.boardRoot, entry);
        if (!isPathInside(record.boardRoot, absoluteEntry, { allowSame: false })) throw new ServiceError("invalid-entry");
        try {
            const stats = await fs.promises.stat(absoluteEntry);
            if (!stats.isFile()) throw new ServiceError("invalid-entry");
        } catch (error: unknown) {
            if (error instanceof ServiceError) throw error;
            throw new ServiceError("invalid-entry", errMessage(error));
        }
        return absoluteEntry;
    }

    get pid(): number | undefined { return this.child.pid; }

    postMessage(message: ServiceParentMessage, ports?: MessagePortMain[]): void {
        this.child.postMessage(message, ports);
    }

    onExit(listener: () => void): () => void {
        this.child.once("exit", listener);
        return () => this.child.removeListener("exit", listener);
    }

    start(): Promise<StartResult> {
        return new Promise<StartResult>((resolve, reject) => {
            const handshake: Handshake = { ready: false, probeSent: false, settled: false, resolve, reject };
            this.handshake = handshake;
            handshake.timer = setTimeout(() => {
                this.fail(new ServiceError(handshake.ready ? "port-not-listening" : "handshake-timeout"));
            }, SERVICE_HANDSHAKE_TIMEOUT_MS);
            this.child.stdout?.on("data", (chunk: unknown) => this.appendOutput("stdout", chunk));
            this.child.stderr?.on("data", (chunk: unknown) => this.appendOutput("stderr", chunk));
            this.child.on("message", (rawMessage: unknown) => this.dispatch(rawMessage));
            this.child.on("exit", (code: number) => this.handleChildExit(code));
            try {
                this.postMessage({ kind: "init", nonce: this.generation, config: this.hostConfig() });
            } catch (error: unknown) {
                this.fail(new ServiceError("spawn-error", errMessage(error)));
            }
        });
    }

    cancelStart(error: ServiceError): void {
        this.fail(error, false);
    }

    killSync(): void {
        killUtilityProcessSync(this.child);
    }

    async stop(reason: ServiceStopReason): Promise<void> {
        try {
            this.postMessage({ kind: "shutdown", nonce: this.generation, reason });
        } catch {
            // The process may have already exited.
        }
        const exited = new Promise<boolean>((resolve) => {
            if (this.child.pid === undefined) {
                resolve(true);
                return;
            }
            this.child.once("exit", () => resolve(true));
        });
        await Promise.race([exited, delay(SERVICE_SHUTDOWN_TIMEOUT_MS)]);
        if (this.child.pid !== undefined) this.killSync();
    }

    private dispatch(rawMessage: unknown): void {
        if (this.record.current !== this) return;
        const message = rawMessage as ServiceMainMessage;
        switch (message.kind) {
            case "ready":
                this.onReady(message.nonce);
                return;
            case "probe-ack":
                this.onProbeAck(message.nonce);
                return;
            case "renderer-attached":
                this.context.rendererAttached(this.record, message.generation, message.leaseNonce);
                return;
            case "response":
                if (this.record.requests.has(message.requestId)) this.context.response(this.record, message);
                return;
            case "capability-client-discover":
            case "capability-client-resolve":
            case "capability-client-invoke":
            case "capability-client-cancel":
                this.context.capabilityClient(this.record, this, message);
                return;
            case "capability-result":
                this.context.capabilityResult(this.record, this, message);
                return;
            case "storage-request":
                this.record.storageAdapter?.handle(message);
                return;
            case "mcp-endpoint-request":
                this.context.mcpEndpoint(this.record, this, message);
                return;
            case "board-settings-get":
            case "board-settings-subscribe":
            case "board-settings-unsubscribe":
                this.context.boardSettings(this.record, this, message);
                return;
            case "channel-ended":
                this.context.channelEnded(this.record, message.channelId);
                return;
            default:
                return;
        }
    }

    private onReady(nonce: number): void {
        const handshake = this.handshake;
        if (!handshake || handshake.settled || nonce !== this.generation || handshake.probeSent) return;
        handshake.ready = true;
        handshake.probeSent = true;
        try {
            this.postMessage({ kind: "probe", nonce: this.generation });
        } catch (error: unknown) {
            this.fail(new ServiceError("port-not-listening", errMessage(error)));
        }
    }

    private onProbeAck(nonce: number): void {
        const handshake = this.handshake;
        if (!handshake || handshake.settled || nonce !== this.generation || !handshake.ready) return;
        if (!this.context.isTrusted(this.record.boardRoot)) {
            this.fail(new ServiceError("untrusted"));
            return;
        }
        handshake.settled = true;
        if (handshake.timer) clearTimeout(handshake.timer);
        this.handshake = undefined;
        handshake.resolve(this.context.ready(this));
    }

    private handleChildExit(code: number): void {
        if (this.record.current !== this) return;
        const handshake = this.handshake;
        if (handshake && !handshake.settled) {
            this.fail(new ServiceError("process-exit-before-ready", `process-exit-before-ready:${code}`), false);
        } else if (this.record.state === "running") {
            this.context.unexpectedExit(this, code);
        }
    }

    private fail(error: ServiceError, kill = true): void {
        const handshake = this.handshake;
        if (!handshake || handshake.settled) return;
        handshake.settled = true;
        if (handshake.timer) clearTimeout(handshake.timer);
        this.handshake = undefined;
        if (kill) this.killSync();
        handshake.reject(error);
    }

    private appendOutput(level: "stdout" | "stderr", chunk: unknown): void {
        const text = Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : chunk instanceof Uint8Array
                ? Buffer.from(chunk).toString("utf8")
                : String(chunk);
        for (const line of text.split(/\r?\n/).filter((entry) => entry.length > 0)) {
            void boardLog.append(this.record.boardRoot, level, line).catch(() => {});
        }
    }

    private buildServiceEnvironment(boardRoot: string): NodeJS.ProcessEnv {
        const allowed = [
            "Path", "PATH", "SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP", "USERPROFILE",
            "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ProgramData", "ALLUSERSPROFILE", "ProgramFiles",
            "ProgramW6432", "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramW6432",
            "CommonProgramFiles(x86)", "HOMEDRIVE", "HOMEPATH", "USERNAME", "ComSpec", "PATHEXT", "OS",
            "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "LANG", "LC_ALL", "TZ",
        ];
        const environment: NodeJS.ProcessEnv = {};
        for (const key of allowed) {
            const value = process.env[key];
            if (value !== undefined) environment[key] = value;
        }
        environment.PERSEPHONE_SERVICE = "1";
        environment.PERSEPHONE_BOARD_ROOT = boardRoot;
        environment.PERSEPHONE_LOCALE = getActiveLocale();
        return environment;
    }

    private hostConfig(): ServiceHostConfig {
        return {
            capabilityCalls: (this.context.capabilities(this.record) ?? []).flatMap((declaration) =>
                Object.entries(declaration.methods ?? {}).filter(([, method]) => method.kind === "call")
                    .map(([method]) => ({ id: declaration.id, version: declaration.version ?? 1, method }))),
        };
    }
}
