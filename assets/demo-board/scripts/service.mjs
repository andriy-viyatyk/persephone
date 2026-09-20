const parentPort = process.parentPort;
const handshakeHangKey = "demo-service-handshake-hang";
const providerBytes = new TextEncoder().encode("hello from the demo board service\n");

if (!parentPort) {
    console.error("Demo service requires Persephone's module-service host.");
    process.exit(1);
}

globalThis.persephone.providers.register("demo/mem", {
    writable: false,
    readBinary() {
        return providerBytes;
    },
    stat() {
        return { exists: true, size: providerBytes.byteLength };
    },
});

const queuedMessages = [];
let acceptingMessages = false;

parentPort.on("message", (event) => {
    const message = event?.data;
    if (!acceptingMessages) {
        queuedMessages.push(message);
        return;
    }
    handleMessage(message);
});

const storage = globalThis.persephone?.storage;
if (!storage) {
    console.error("Demo service did not receive the Persephone storage adapter.");
    process.exit(1);
}

let handshakeHang = false;
try {
    handshakeHang = (await storage.get(handshakeHangKey)) === true;
    if (handshakeHang) await storage.delete(handshakeHangKey);
} catch (error) {
    console.error("Demo service could not read its handshake mode:", error);
    process.exit(1);
}

if (handshakeHang) {
    console.error("Demo service armed a one-shot handshake hang; ready will not be posted.");
    await new Promise(() => {});
}

acceptingMessages = true;
for (const message of queuedMessages) handleMessage(message);

function postResponse(requestId, result) {
    parentPort.postMessage({ kind: "response", requestId, result });
}

function requestValue(message) {
    return message && typeof message === "object" ? message : {};
}

function boundedDelay(value) {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds)) return 0;
    return Math.min(Math.max(Math.trunc(milliseconds), 0), 8_000);
}

async function handleRequest(message, requestId) {
    const request = requestValue(message);
    switch (request.op) {
        case "echo":
            return {
                input: request.value,
                pid: process.pid,
                cwd: process.cwd(),
                persephoneService: process.env.PERSEPHONE_SERVICE,
                persephoneBoardRoot: process.env.PERSEPHONE_BOARD_ROOT,
            };
        case "storage-get":
            return { key: request.key, value: await storage.get(request.key) };
        case "storage-set":
            await storage.set(request.key, request.value);
            return { key: request.key, value: request.value };
        case "storage-delete":
            return { key: request.key, deleted: await storage.delete(request.key) };
        case "storage-keys":
            return { keys: await storage.keys() };
        case "delay":
            await new Promise((resolve) => setTimeout(resolve, boundedDelay(request.ms)));
            return { delayedMs: boundedDelay(request.ms) };
        case "crash":
            console.error("Demo service crash requested by the fixture.");
            process.exitCode = 1;
            process.exit(1);
            return undefined;
        case "arm-handshake-hang":
            await storage.set(handshakeHangKey, true);
            postResponse(requestId, { armed: true, oneShot: true });
            await new Promise((resolve) => setImmediate(resolve));
            process.exit(0);
            return undefined;
        default:
            throw new Error(`unknown-operation:${String(request.op)}`);
    }
}

function handleMessage(message) {
    if (!message || typeof message.kind !== "string") return;

    if (message.kind === "init") {
        parentPort.postMessage({ kind: "ready", nonce: message.nonce });
        return;
    }
    if (message.kind === "probe") {
        parentPort.postMessage({ kind: "probe-ack", nonce: message.nonce });
        return;
    }
    if (message.kind === "shutdown") {
        process.exit(0);
        return;
    }
    if (message.kind !== "request" || typeof message.requestId !== "string") return;

    void handleRequest(message.message, message.requestId).then(
        (result) => postResponse(message.requestId, result),
        (error) => {
            console.error("Demo service request failed:", error);
            parentPort.postMessage({
                kind: "response",
                requestId: message.requestId,
                error: "service-request-failed",
            });
        },
    );
}
