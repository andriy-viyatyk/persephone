// Host for a board's persephone.executeNode() script. Runs in an Electron
// utilityProcess so the packaged app can lock the RunAsNode fuse. It gives the
// script the semantics of `node script.js`: argv, CommonJS/ESM entry, stdin fed
// by the main process over parentPort, and exit when the event loop is idle.
import Module from "node:module";
import { Readable } from "node:stream";
import { NODE_SCRIPT_END_STDIN_KIND, NODE_SCRIPT_MARKER, NODE_SCRIPT_STDIN_KIND, type NodeScriptHostMessage } from "../ipc/node-script-host-protocol";
import type { MessageEvent as ElectronMessageEvent } from "electron";

const IDLE_POLL_MS = 50;
const parentPort = process.parentPort;
const markerIndex = process.argv.indexOf(NODE_SCRIPT_MARKER);
const script = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined;
if (!parentPort || !script) {
    console.error("Persephone node-script host received invalid startup arguments.");
    process.exit(1);
}

const stdin = process.stdin;
// The utility process exposes an already-ended Readable; preserve that object
// while reinitializing it as the open stream expected by Node scripts.
Readable.call(stdin as unknown as Readable, { read(): void {} });
parentPort.on("message", (event: ElectronMessageEvent): void => {
    const value: unknown = event.data;
    if (!isNodeScriptHostMessage(value)) return;
    if (value.kind === NODE_SCRIPT_STDIN_KIND) stdin.push(Buffer.from(value.data));
    else stdin.push(null);
});

function isNodeScriptHostMessage(value: unknown): value is NodeScriptHostMessage {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const message = value as { kind?: unknown; data?: unknown };
    if (message.kind === NODE_SCRIPT_END_STDIN_KIND) return true;
    return message.kind === NODE_SCRIPT_STDIN_KIND
        && (typeof message.data === "string" || message.data instanceof Uint8Array);
}

function stdinHoldsLoop(): boolean {
    return !stdin.readableEnded
        && (stdin.readableFlowing === true || stdin.listenerCount("readable") > 0);
}

function hasPendingWork(): boolean {
    if (stdinHoldsLoop()) return true;
    if (process.getActiveResourcesInfo().some((type: string): boolean => type !== "PipeWrap" && type !== "TTYWrap")) return true;
    // Electron's embedded Node exposes this private method; keep the type
    // assertion at that runtime boundary instead of weakening the host types.
    const processWithActiveHandles = process as NodeJS.Process & { _getActiveHandles(): unknown[] };
    return processWithActiveHandles._getActiveHandles()
        .some((handle: unknown): boolean => handle !== process.stdout && handle !== process.stderr);
}

function startIdleExitMonitor(): void {
    let idleTicks = 0;
    setInterval((): void => {
        if (hasPendingWork()) {
            idleTicks = 0;
            return;
        }
        if (++idleTicks < 2) return;
        // Preserve Node's beforeExit event behavior where Electron's Process type
        // omits that event overload.
        const emitBeforeExit = process as unknown as { emit(event: "beforeExit", code: string | number): boolean };
        emitBeforeExit.emit("beforeExit", process.exitCode ?? 0);
        if (!hasPendingWork()) process.exit(process.exitCode ?? 0);
        idleTicks = 0;
    }, IDLE_POLL_MS).unref();
}
startIdleExitMonitor();

process.argv = [process.execPath, script, ...process.argv.slice(markerIndex + 2)];
Module.runMain(script);
