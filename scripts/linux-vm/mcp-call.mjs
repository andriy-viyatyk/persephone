// Minimal MCP client for a Persephone reached through `vm.ps1 tunnel` (or any local port).
// node mcp-call.mjs <path> [argsJson | @file.js | =file.json]
//   argsJson   JSON array passed as the call's args
//   @file.js   the file's text as the single argument (for script.execute)
//   =file.json the file's object merged into the call arguments (for example { "value": ... })
// MCP_URL overrides the endpoint (default http://127.0.0.1:7875/mcp, the VM tunnel; the server checks
// that the Host header's port is its own, so the tunnel keeps the port number).
import { readFileSync } from "node:fs";

const url = process.env.MCP_URL ?? "http://127.0.0.1:7875/mcp";
let session;

async function rpc(method, params, id) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...(session ? { "mcp-session-id": session } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, ...(id ? { id } : {}) }),
    });
    session = response.headers.get("mcp-session-id") ?? session;
    const text = await response.text();
    if (!id) return null;
    const line = text.split("\n").find((entry) => entry.startsWith("data:"));
    return JSON.parse(line ? line.slice(5) : text);
}

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "linux-vm", version: "1" } }, 1);
await rpc("notifications/initialized", {});
const [path, rawArgs] = process.argv.slice(2);
let extra = {};
if (rawArgs?.startsWith("@")) extra = { args: [readFileSync(rawArgs.slice(1), "utf8")] };
else if (rawArgs?.startsWith("=")) extra = JSON.parse(readFileSync(rawArgs.slice(1), "utf8"));
else if (rawArgs) extra = { args: JSON.parse(rawArgs) };
const result = await rpc("tools/call", { name: "call", arguments: { ...(path ? { path } : {}), ...extra } }, 2);
for (const content of result.result?.content ?? []) console.log(content.type === "text" ? content.text : `[${content.type}]`);
if (result.error) console.log("ERROR", JSON.stringify(result.error));
