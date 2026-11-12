import { readFileSync } from "node:fs";

const files = [
    ["src/shared/capability-constants.ts", /export const CAPABILITY_ERROR_CODES\s*=\s*\[([^\]]*)\]\s*as const/, ","],
    ["src/renderer/api/types/capabilities.d.ts", /export type CapabilityErrorCode\s*=\s*([^;]+);/, "|"],
];
const lists = files.map(([file, pattern, separator]) => {
    const match = readFileSync(file, "utf8").match(pattern);
    if (!match) throw new Error(`Unrecognized capability contract in ${file}`);
    const parts = match[1].split(separator).map((part) => part.trim()).filter(Boolean);
    if (!parts.length || parts.some((part) => !/^"[a-z][a-z-]*"$/.test(part))) {
        throw new Error(`Unrecognized capability literal in ${file}`);
    }
    return parts.map((part) => part.slice(1, -1));
});
if (JSON.stringify(lists[1]) !== JSON.stringify(lists[0])) {
    throw new Error(`Capability error codes drift in ${files[1][0]}`);
}

const limitsSource = readFileSync("src/shared/capability-limits.ts", "utf8");
const numericConstant = (name) => {
    const value = limitsSource.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`))?.[1];
    return value === undefined ? Number.NaN : Number(value);
};
const ackBatch = numericConstant("SERVICE_CHANNEL_ACK_BATCH");
const inFlight = numericConstant("MAX_SERVICE_CHANNEL_IN_FLIGHT");
if (!Number.isFinite(ackBatch) || !Number.isFinite(inFlight) || ackBatch >= inFlight) {
    throw new Error("SERVICE_CHANNEL_ACK_BATCH must be numeric and less than MAX_SERVICE_CHANNEL_IN_FLIGHT");
}

console.log("Capability error codes match; service-channel ack batch is below its window.");
