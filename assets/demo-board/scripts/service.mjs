const handshakeHangKey = "demo-service-handshake-hang";
const providerBytes = new TextEncoder().encode("hello from the demo board service\n");

if (!globalThis.persephone?.service || !globalThis.persephone?.providers || !globalThis.persephone?.storage) {
    console.error("Demo service requires Persephone's module-service APIs.");
    process.exit(1);
}

globalThis.persephone.providers.register("demo/mem", {
    writable: false,
    readBinary() {
        return providerBytes;
    },
    readRange(_config, range) {
        return providerBytes.subarray(range.start, range.end + 1);
    },
    stat() {
        return { exists: true, size: providerBytes.byteLength };
    },
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

function requestValue(message) {
    return message && typeof message === "object" ? message : {};
}

function boundedDelay(value) {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds)) return 0;
    return Math.min(Math.max(Math.trunc(milliseconds), 0), 8_000);
}

async function handleRequest(message) {
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
            setTimeout(() => process.exit(0), 50);
            return { armed: true, oneShot: true };
        default:
            throw Object.assign(new Error(`Unknown demo service operation: ${String(request.op)}`), {
                code: "service-request-failed",
            });
    }
}

persephone.service.onRequest(handleRequest);
persephone.service.onShutdown(async ({ reason }) => {
    console.info(`Demo service shutting down: ${reason}`);
});
