import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { isWindows } from "../shared/platform";
import { applicationProfileName } from "./application-profile";
import { openWindows } from "./open-windows";
import { parseLaunchArguments } from "./utils";

export function getPipePath(profile = applicationProfileName()): string | undefined {
    if (isWindows) return `\\\\.\\pipe\\persephone-${os.userInfo().username}${profile ? `-${profile}` : ""}`;
    const runtimeDirectory = process.env.XDG_RUNTIME_DIR;
    if (!runtimeDirectory) return undefined;
    return path.join(runtimeDirectory, `persephone${profile ? `-${profile}` : ""}.sock`);
}

let server: net.Server | undefined;
let ownedSocket: { server: net.Server; path: string; device: number; inode: number } | undefined;
let missingRuntimeDirectoryLogged = false;

function handleMessage(message: string): void {
    const trimmed = message.trim();

    if (trimmed.startsWith("OPEN ")) {
        const argument = trimmed.substring(5).trim();
        if (!argument) return;
        dispatchInputs(parseLaunchArguments([argument], process.cwd()));
    } else if (trimmed.startsWith("BOARD ")) {
        const root = trimmed.substring(6).trim();
        if (root) dispatchInputs([{ kind: "board", path: root }]);
    } else if (trimmed === "SHOW") {
        openWindows.bringToFront();
    } else if (trimmed.startsWith("DIFF ")) {
        // DIFF <absolute-path1>\t<absolute-path2>; tabs preserve spaces in paths.
        const args = trimmed.substring(5).split("\t");
        const firstPath = args[0]?.trim();
        const secondPath = args[1]?.trim();

        if (firstPath && secondPath) {
            dispatchInputs(parseLaunchArguments(["diff", firstPath, secondPath], process.cwd()));
        }
    }
}

function dispatchInputs(inputs: ReturnType<typeof parseLaunchArguments>): void {
    if (inputs.length === 0) return;
    if (inputs.some((input) => input.kind !== "board")) openWindows.bringToFront();
    inputs.forEach((input) => openWindows.handleLaunchInput(input));
}

function handleConnection(socket: net.Socket): void {
    let buffer = "";

    socket.on("data", (data) => {
        buffer += data.toString("utf-8");

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            const line = buffer.substring(0, newlineIndex);
            buffer = buffer.substring(newlineIndex + 1);

            if (line.trim() === "END") {
                socket.end();
                return;
            }

            handleMessage(line);
        }
    });

    socket.on("error", () => {
        // Client disconnected.
    });
}

async function socketIdentity(socketPath: string): Promise<{ device: number; inode: number } | undefined> {
    try {
        const details = await fs.lstat(socketPath);
        if (!details.isSocket()) return undefined;
        return { device: details.dev, inode: details.ino };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

async function removeSocketIfUnchanged(
    socketPath: string,
    identity: { device: number; inode: number },
): Promise<void> {
    const current = await socketIdentity(socketPath);
    if (!current || current.device !== identity.device || current.inode !== identity.inode) return;
    try {
        await fs.unlink(socketPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

function closeOwnedSocket(pipeServer: net.Server): void {
    const socket = ownedSocket;
    if (!socket || socket.server !== pipeServer) return;
    ownedSocket = undefined;
    void removeSocketIfUnchanged(socket.path, socket).catch((error: unknown) => {
        console.error("Pipe socket cleanup failed:", error);
    });
}

function rememberOwnedSocket(pipeServer: net.Server, socketPath: string): void {
    if (isWindows) return;
    void socketIdentity(socketPath).then((identity) => {
        if (identity && server === pipeServer) ownedSocket = { server: pipeServer, path: socketPath, ...identity };
    }).catch((error: unknown) => {
        console.error("Could not inspect pipe socket:", error);
    });
}

function listen(pipeServer: net.Server, pipePath: string): void {
    server = pipeServer;
    pipeServer.once("listening", () => rememberOwnedSocket(pipeServer, pipePath));
    pipeServer.on("close", () => closeOwnedSocket(pipeServer));
    pipeServer.listen(pipePath);
}

function probePipe(pipePath: string): Promise<"connected" | "unavailable" | "unsafe"> {
    const probe = net.createConnection(pipePath);
    return new Promise((resolve) => {
        probe.once("connect", () => { probe.end(); resolve("connected"); });
        probe.once("error", (error: NodeJS.ErrnoException) => {
            resolve(error.code === "ENOENT" || error.code === "ECONNREFUSED" ? "unavailable" : "unsafe");
        });
    });
}

async function removeStaleSocket(pipePath: string): Promise<boolean> {
    const beforeProbe = await socketIdentity(pipePath);
    if (!beforeProbe) return true;

    const result = await probePipe(pipePath);
    if (result === "connected") return false;
    if (result === "unsafe") throw new Error("Could not safely probe profile pipe.");

    const afterProbe = await socketIdentity(pipePath);
    if (!afterProbe) return true;
    if (afterProbe.device !== beforeProbe.device || afterProbe.inode !== beforeProbe.inode) return false;
    await removeSocketIfUnchanged(pipePath, beforeProbe);
    return true;
}

async function recoverAddressInUse(pipePath: string, failedServer: net.Server): Promise<void> {
    if (server === failedServer) server = undefined;
    try {
        // Windows: a named pipe leaves no file; reclaim only when nobody answers (any probe error).
        if (isWindows ? (await probePipe(pipePath)) === "connected" : !(await removeStaleSocket(pipePath))) return;
        const replacement = net.createServer(handleConnection);
        replacement.on("error", (error) => console.error("Pipe server retry failed:", error));
        listen(replacement, pipePath);
    } catch (error) {
        console.error("Pipe server recovery failed:", error);
    }
}

export function startPipeServer(): void {
    if (server) return;
    const pipePath = getPipePath();
    if (!pipePath) {
        if (!missingRuntimeDirectoryLogged) {
            console.error("Pipe server unavailable: XDG_RUNTIME_DIR is not set.");
            missingRuntimeDirectoryLogged = true;
        }
        return;
    }

    const nextServer = net.createServer(handleConnection);
    nextServer.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
            void recoverAddressInUse(pipePath, nextServer);
        } else {
            console.error("Pipe server error:", error);
        }
    });
    listen(nextServer, pipePath);
}

export function stopPipeServer(): void {
    const current = server;
    if (!current) return;
    server = undefined;
    current.close();
}
