import net from "node:net";
import os from "node:os";
import { openWindows } from "./open-windows";
import { parseLaunchArguments } from "./utils";

const PIPE_NAME = `persephone-${os.userInfo().username}`;
const PIPE_PATH = `\\\\.\\pipe\\${PIPE_NAME}`;

let server: net.Server | undefined;

function handleMessage(message: string): void {
    const trimmed = message.trim();

    if (trimmed.startsWith("OPEN ")) {
        const argument = trimmed.substring(5).trim();
        if (!argument) {
            return;
        }

        dispatchInputs(parseLaunchArguments([argument], process.cwd()));
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
    openWindows.bringToFront();
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
        // Client disconnected — ignore
    });
}

export function startPipeServer(): void {
    if (server) {
        return;
    }

    server = net.createServer(handleConnection);

    server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
            // Stale pipe from a crashed instance — remove and retry once
            server = undefined;
            net.connect(PIPE_PATH)
                .on("error", () => {
                    // Nobody listening — safe to reclaim
                    retryPipeServer();
                })
                .on("connect", function () {
                    // Another instance is actually listening — don't interfere
                    this.end();
                });
        } else {
            console.error("Pipe server error:", err);
        }
    });

    server.listen(PIPE_PATH);
}

function retryPipeServer(): void {
    server = net.createServer(handleConnection);
    server.on("error", (err) => {
        console.error("Pipe server retry failed:", err);
    });
    server.listen(PIPE_PATH);
}

export function stopPipeServer(): void {
    if (server) {
        server.close();
        server = undefined;
    }
}
