import { pathToFileURL } from "node:url";

const parentPort = process.parentPort;
const [serviceEntry, deadlineText, capText] = process.argv.slice(-3);
const deadlineMs = Number(deadlineText);
const requestCap = Number(capText);

if (!parentPort || !serviceEntry || !Number.isFinite(deadlineMs) || deadlineMs <= 0
    || !Number.isInteger(requestCap) || requestCap <= 0) {
    console.error("Persephone module service host received invalid startup arguments.");
    process.exit(1);
}

const pending = new Map();
let requestNumber = 0;

function storageRequest(operation, args) {
    if (pending.size >= requestCap) return Promise.reject(new Error("service-busy"));
    const requestId = `storage-${process.pid}-${Date.now()}-${++requestNumber}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error("service-timeout"));
        }, deadlineMs);
        pending.set(requestId, { resolve, reject, timer });
        try {
            parentPort.postMessage({ kind: "storage-request", requestId, operation, args });
        } catch {
            clearTimeout(timer);
            pending.delete(requestId);
            reject(new Error("service-exited"));
        }
    });
}

parentPort.on("message", (event) => {
    const message = event?.data;
    if (!message || message.kind !== "storage-response" || typeof message.requestId !== "string") return;
    const request = pending.get(message.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.requestId);
    if ("error" in message) {
        request.reject(new Error(typeof message.error === "string" ? message.error : "service-error"));
    } else {
        request.resolve(message.result);
    }
});

const persephone = globalThis.persephone ?? {};
persephone.storage = {
    get: (key) => storageRequest("get", [key]),
    set: (key, value) => storageRequest("set", [key, value]),
    delete: (key) => storageRequest("delete", [key]),
    keys: () => storageRequest("keys", []),
};
globalThis.persephone = persephone;

try {
    await import(pathToFileURL(serviceEntry).href);
} catch (error) {
    console.error(`Failed to load module service entry ${serviceEntry}:`, error);
    process.exit(1);
}
