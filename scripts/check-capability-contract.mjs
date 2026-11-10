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
