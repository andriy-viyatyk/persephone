import net from "node:net";
import os from "node:os";
import { ipcMain } from "electron";
import { openWindows } from "./open-windows";
import { MCP_EXECUTE, MCP_RESULT } from "../shared/constants";

const MCP_PIPE_NAME = `js-notepad-mcp-${os.userInfo().username}`;
const MCP_PIPE_PATH = `\\\\.\\pipe\\${MCP_PIPE_NAME}`;
const REQUEST_TIMEOUT_MS = 30_000;

// ── JSON-RPC 2.0 Types ─────────────────────────────────────────────

interface JsonRpcRequest {
    jsonrpc: "2.0";
    method: string;
    params?: any;
    id: string | number;
}

interface JsonRpcResponse {
    jsonrpc: "2.0";
    result?: any;
    error?: { code: number; message: string; data?: any };
    id: string | number | null;
}

// ── State ───────────────────────────────────────────────────────────

let server: net.Server | undefined;
let ipcInitialized = false;
let requestIdGen = 0;
const pendingRequests = new Map<string, (response: { result?: any; error?: any }) => void>();
const activeClients = new Set<net.Socket>();

// ── IPC Bridge (main ↔ renderer) ───────────────────────────────────

function initMcpIpc(): void {
    if (ipcInitialized) return;
    ipcInitialized = true;

    ipcMain.on(MCP_RESULT, (_event, requestId: string, response: any) => {
        const resolve = pendingRequests.get(requestId);
        if (resolve) {
            pendingRequests.delete(requestId);
            resolve(response);
        }
    });
}

function sendToRenderer(method: string, params: any): Promise<{ result?: any; error?: any }> {
    const mainWindow = openWindows.mainWindow;
    if (!mainWindow) {
        return Promise.resolve({
            error: { code: -32603, message: "No renderer window available" },
        });
    }

    const requestId = `mcp_${++requestIdGen}_${Date.now()}`;

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            resolve({ error: { code: -32603, message: "Request timeout" } });
        }, REQUEST_TIMEOUT_MS);

        pendingRequests.set(requestId, (response) => {
            clearTimeout(timeout);
            resolve(response);
        });

        mainWindow.window.webContents.send(MCP_EXECUTE, requestId, method, params);
    });
}

// ── Connection Handling ─────────────────────────────────────────────

function handleConnection(socket: net.Socket): void {
    let buffer = "";
    activeClients.add(socket);

    socket.on("data", (data) => {
        buffer += data.toString("utf-8");

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            const line = buffer.substring(0, newlineIndex).trim();
            buffer = buffer.substring(newlineIndex + 1);

            if (!line) continue;
            handleJsonRpcMessage(line, socket);
        }
    });

    socket.on("error", () => {
        activeClients.delete(socket);
    });

    socket.on("close", () => {
        activeClients.delete(socket);
    });
}

async function handleJsonRpcMessage(message: string, socket: net.Socket): Promise<void> {
    let parsed: JsonRpcRequest;
    try {
        parsed = JSON.parse(message);
    } catch {
        sendJsonRpc(socket, {
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
        });
        return;
    }

    if (!parsed.jsonrpc || parsed.jsonrpc !== "2.0" || !parsed.method) {
        sendJsonRpc(socket, {
            jsonrpc: "2.0",
            error: { code: -32600, message: "Invalid Request" },
            id: parsed.id ?? null,
        });
        return;
    }

    // Route to renderer and await result
    const response = await sendToRenderer(parsed.method, parsed.params);

    if (response.error) {
        sendJsonRpc(socket, {
            jsonrpc: "2.0",
            error: response.error,
            id: parsed.id,
        });
    } else {
        sendJsonRpc(socket, {
            jsonrpc: "2.0",
            result: response.result,
            id: parsed.id,
        });
    }
}

function sendJsonRpc(socket: net.Socket, response: JsonRpcResponse): void {
    if (!socket.destroyed) {
        socket.write(JSON.stringify(response) + "\n");
    }
}

// ── Server Lifecycle ────────────────────────────────────────────────

export function startMcpPipeServer(): void {
    if (server) return;

    initMcpIpc();

    server = net.createServer(handleConnection);

    server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
            server = undefined;
            net.connect(MCP_PIPE_PATH)
                .on("error", () => retryMcpPipeServer())
                .on("connect", function () {
                    // Another instance is listening — don't interfere
                    this.end();
                });
        } else {
            console.error("MCP pipe server error:", err);
        }
    });

    server.listen(MCP_PIPE_PATH);
    console.log(`MCP pipe server started: ${MCP_PIPE_NAME}`);
}

function retryMcpPipeServer(): void {
    server = net.createServer(handleConnection);
    server.on("error", (err) => {
        console.error("MCP pipe server retry failed:", err);
    });
    server.listen(MCP_PIPE_PATH);
}

export function stopMcpPipeServer(): void {
    if (!server) return;

    // Close all active client connections
    for (const socket of activeClients) {
        socket.destroy();
    }
    activeClients.clear();

    // Cancel pending requests
    for (const [id, resolve] of pendingRequests) {
        resolve({ error: { code: -32603, message: "Server shutting down" } });
    }
    pendingRequests.clear();

    server.close();
    server = undefined;
    console.log("MCP pipe server stopped");
}

export function isMcpPipeServerRunning(): boolean {
    return !!server;
}

export function getMcpPipeName(): string {
    return MCP_PIPE_NAME;
}

export function getMcpClientCount(): number {
    return activeClients.size;
}
