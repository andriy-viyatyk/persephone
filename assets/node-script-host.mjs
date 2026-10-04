// Host for a board's persephone.executeNode() script (US-1591). Runs in an Electron
// utilityProcess so the packaged app can lock the RunAsNode fuse. It gives the script the
// semantics of `node script.js`: argv, CommonJS/ESM entry, stdin fed by the main process over
// parentPort, and exit when the event loop has nothing left — none of which a utilityProcess
// provides on its own.
import Module from "node:module";
import { Readable } from "node:stream";

const SCRIPT_MARKER = "--persephone-node-script";
const IDLE_POLL_MS = 50;

const parentPort = process.parentPort;
const markerIndex = process.argv.indexOf(SCRIPT_MARKER);
const script = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined;
if (!parentPort || !script) {
    console.error("Persephone node-script host received invalid startup arguments.");
    process.exit(1);
}

// A utilityProcess has no stdin pipe: its process.stdin is a fixed, already-ended Readable
// that cannot be replaced. Re-initialize that same object as an open stream and feed it from
// the main process.
const stdin = process.stdin;
Readable.call(stdin, { read() {} });
parentPort.on("message", (event) => {
    const message = event?.data;
    if (message?.kind === "stdin") stdin.push(Buffer.from(message.data));
    else if (message?.kind === "end-stdin") stdin.push(null);
});

// A utilityProcess stays alive after its work is done. Exit like Node does: when no handle,
// request, or ref'd timer is left and stdin is not being read.
function stdinHoldsLoop() {
    return !stdin.readableEnded
        && (stdin.readableFlowing === true || stdin.listenerCount("readable") > 0);
}
function hasPendingWork() {
    if (stdinHoldsLoop()) return true;
    if (process.getActiveResourcesInfo().some((type) => type !== "PipeWrap" && type !== "TTYWrap")) return true;
    return process._getActiveHandles().some((handle) => handle !== process.stdout && handle !== process.stderr);
}
let idleTicks = 0;
setInterval(() => {
    if (hasPendingWork()) {
        idleTicks = 0;
        return;
    }
    if (++idleTicks < 2) return;
    process.emit("beforeExit", process.exitCode ?? 0);
    if (!hasPendingWork()) process.exit(process.exitCode ?? 0);
    idleTicks = 0;
}, IDLE_POLL_MS).unref();

process.argv = [process.execPath, script, ...process.argv.slice(markerIndex + 2)];
Module.runMain(script);
