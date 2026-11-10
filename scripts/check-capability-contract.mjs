import { readFileSync } from "node:fs";

const files = [
    ["src/shared/capability-constants.ts", /export const CAPABILITY_ERROR_CODES\s*=\s*\[([^\]]*)\]\s*as const/],
    ["assets/module-service-host.mjs", /const codes\s*=\s*\[([^\]]*)\]/],
    ["src/renderer/api/types/capabilities.d.ts", /export type CapabilityErrorCode\s*=\s*([^;]+);/],
];
const lists = files.map(([file, pattern], index) => {
    const match = readFileSync(file, "utf8").match(pattern);
    if (!match) throw new Error(`Unrecognized capability contract in ${file}`);
    const body = match[1];
    const separator = index === 2 ? "|" : ",";
    const parts = body.split(separator).map((part) => part.trim()).filter(Boolean);
    if (!parts.length || parts.some((part) => !/^"[a-z][a-z-]*"$/.test(part))) {
        throw new Error(`Unrecognized capability literal in ${file}`);
    }
    return parts.map((part) => part.slice(1, -1));
});
for (let i = 1; i < files.length; i++) {
    if (JSON.stringify(lists[i]) !== JSON.stringify(lists[0])) {
        throw new Error(`Capability error codes drift in ${files[i][0]}`);
    }
}
console.log("Capability contract mirrors match.");

// This mirror check catches public-surface and default-code drift, but cannot prove behavior across languages.
const sharedWireError = readFileSync("src/shared/wire-error.ts", "utf8");
const hostSource = readFileSync("assets/module-service-host.mjs", "utf8");
const sharedDefaultCode = sharedWireError.match(/export const WIRE_ERROR_DEFAULT_CODE\s*=\s*"([^"]+)"/)?.[1];
const mirrorStart = hostSource.indexOf("MIRROR of src/shared/pending-requests.ts + src/shared/wire-error.ts");
const mirrorEnd = hostSource.indexOf("end mirror", mirrorStart);
const mirrorBlock = mirrorStart >= 0 && mirrorEnd >= 0 ? hostSource.slice(mirrorStart, mirrorEnd) : undefined;
const hostDefaultCode = mirrorBlock?.match(/const WIRE_ERROR_DEFAULT_CODE\s*=\s*"([^"]+)"/)?.[1];
const sharedClass = readFileSync("src/shared/pending-requests.ts", "utf8").match(/export class PendingRequests[\s\S]*/)?.[0];
const mirrorClass = mirrorBlock?.match(/class PendingRequests[\s\S]*/)?.[0];
const members = (source) => [...source.matchAll(/^    (get )?(\w+)\(/gm)]
    .map((match) => match[2])
    .filter((name) => name !== "constructor");
const sharedMembers = sharedClass ? members(sharedClass) : [];
const hostMembers = mirrorClass ? members(mirrorClass) : [];
const requiredMembers = ["create", "settle", "fail", "failAll", "clear", "size"];
const missingMembers = requiredMembers.filter((name) => !hostMembers.includes(name));
const extraMembers = hostMembers.filter((name) => !sharedMembers.includes(name));
const drift = [];
if (!sharedDefaultCode || !hostDefaultCode || sharedDefaultCode !== hostDefaultCode) drift.push("WIRE_ERROR_DEFAULT_CODE differs");
if (!mirrorBlock || !sharedClass || !mirrorClass) drift.push("PendingRequests mirror markers or class are missing");
if (missingMembers.length) drift.push(`missing members: ${missingMembers.join(", ")}`);
if (extraMembers.length) drift.push(`unknown members: ${extraMembers.join(", ")}`);
if (drift.length) throw new Error(`Pending-request mirror drift in assets/module-service-host.mjs: ${drift.join("; ")}`);
console.log("Pending-request mirror matches.");

// This catches renamed members and changed constants, but cannot prove two implementations behave identically.
const sharedChannel = readFileSync("src/shared/service-channel.ts", "utf8");
const limitsSource = readFileSync("src/shared/capability-limits.ts", "utf8");
const serviceMirrorStart = hostSource.indexOf("MIRROR of src/shared/service-channel.ts");
const serviceMirrorEnd = hostSource.indexOf("end mirror", serviceMirrorStart);
const serviceMirror = serviceMirrorStart >= 0 && serviceMirrorEnd >= 0
    ? hostSource.slice(serviceMirrorStart, serviceMirrorEnd)
    : undefined;
const quotedValues = (source, name) => {
    const declaration = source.match(new RegExp(`(?:const|export const) ${name}\\s*[:=][\\s\\S]*?(?=\\n(?:export )?(?:const|function|interface|type) |$)`));
    return declaration?.[0].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)?.map((value) => value.slice(1, -1));
};
const serviceChannelDrift = [];
if (!serviceMirror) serviceChannelDrift.push("mirror markers are missing");
for (const name of ["SERVICE_CHANNEL_WIRE_KINDS", "SERVICE_CHANNEL_CODES", "SERVICE_CHANNEL_PEER_GONE"]) {
    const sharedValues = quotedValues(sharedChannel, name);
    const hostValues = serviceMirror && quotedValues(serviceMirror, name);
    if (!sharedValues?.length || JSON.stringify(sharedValues) !== JSON.stringify(hostValues)) serviceChannelDrift.push(`${name} differs`);
}
const numericConstant = (source, name) => Number(source.match(new RegExp(`(?:export const) ${name}\\s*=\\s*(\\d+)`))?.[1]);
const hostDelay = Number(serviceMirror?.match(/const SERVICE_CHANNEL_ACK_DELAY_MS\s*=\s*(\d+)/)?.[1]);
const sharedDelay = numericConstant(limitsSource, "SERVICE_CHANNEL_ACK_DELAY_MS");
const ackBatch = numericConstant(limitsSource, "SERVICE_CHANNEL_ACK_BATCH");
const inFlight = numericConstant(limitsSource, "MAX_SERVICE_CHANNEL_IN_FLIGHT");
if (!Number.isFinite(hostDelay) || hostDelay !== sharedDelay) serviceChannelDrift.push("SERVICE_CHANNEL_ACK_DELAY_MS differs");
const sharedInterface = sharedChannel.match(/export interface ServiceChannel\s*\{([\s\S]*?)\n\}/)?.[1];
const hostFactory = serviceMirror?.match(/function createServiceChannel\([\s\S]*?\n    return \{([\s\S]*?)\n    \};/)?.[1];
const interfaceMembers = sharedInterface ? [...sharedInterface.matchAll(/^    (?:readonly )?(\w+)[(:]/gm)].map((match) => match[1]) : [];
const hostChannelMembers = hostFactory ? [...hostFactory.matchAll(/^        (?:get )?(\w+)\(/gm)].map((match) => match[1]) : [];
if (!interfaceMembers.length || JSON.stringify(interfaceMembers) !== JSON.stringify(hostChannelMembers)) serviceChannelDrift.push("ServiceChannel members differ");
if (!Number.isFinite(ackBatch) || !Number.isFinite(inFlight) || ackBatch >= inFlight) serviceChannelDrift.push("SERVICE_CHANNEL_ACK_BATCH must be less than MAX_SERVICE_CHANNEL_IN_FLIGHT");
if (serviceChannelDrift.length) throw new Error(`Service-channel mirror drift in assets/module-service-host.mjs: ${serviceChannelDrift.join("; ")}`);
console.log("Service-channel mirror matches.");
