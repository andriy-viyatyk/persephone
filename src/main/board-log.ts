import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { BoardLogLevel } from "../ipc/api-types";
import { getAssetPath } from "./utils";

const MAX_BOARD_LOG_BYTES = 256 * 1024;
const MAX_BOARD_LOG_LINE_BYTES = 8 * 1024;
const BOARD_LOG_TAIL_BYTES = 128 * 1024;

interface BoardLogQueue {
    pending: Promise<void>;
    cachedSize?: number;
}

const queues = new Map<string, BoardLogQueue>();

function normalizePath(filePath: string): string {
    const resolved = path.resolve(filePath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function bundledBoardId(root: string): string | undefined {
    const boardsRoot = path.resolve(getAssetPath("boards"));
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(boardsRoot, resolvedRoot);
    const comparableRelative = process.platform === "win32" ? relative.toLowerCase() : relative;
    if (!comparableRelative || comparableRelative === ".."
        || comparableRelative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
        || path.dirname(relative) !== ".") {
        return undefined;
    }
    return path.basename(fs.realpathSync(resolvedRoot));
}

export function boardLogPath(root: string): string {
    const resolvedRoot = path.resolve(root);
    const boardId = bundledBoardId(resolvedRoot);
    if (boardId) return path.join(app.getPath("userData"), "board-logs", boardId, "ui.log");
    return path.join(resolvedRoot, "ui.log");
}

function queueFor(filePath: string): BoardLogQueue {
    const key = normalizePath(filePath);
    let queue = queues.get(key);
    if (!queue) {
        queue = { pending: Promise.resolve() };
        queues.set(key, queue);
    }
    return queue;
}

function enqueue<T>(queue: BoardLogQueue, operation: () => Promise<T>): Promise<T> {
    const result = queue.pending.then(operation);
    queue.pending = result.then((): void => {}, (): void => {});
    return result;
}

async function initializeSize(queue: BoardLogQueue, filePath: string): Promise<void> {
    if (queue.cachedSize !== undefined) return;
    try {
        queue.cachedSize = (await fs.promises.stat(filePath)).size;
    } catch (error) {
        if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            queue.cachedSize = 0;
            return;
        }
        throw error;
    }
}

function cappedUtf8Line(line: string): string {
    const encoded = Buffer.from(line, "utf8");
    if (encoded.length <= MAX_BOARD_LOG_LINE_BYTES) return line;
    let capped = encoded.subarray(0, MAX_BOARD_LOG_LINE_BYTES).toString("utf8");
    while (Buffer.byteLength(capped, "utf8") > MAX_BOARD_LOG_LINE_BYTES) capped = capped.slice(0, -1);
    return capped;
}

async function appendLine(queue: BoardLogQueue, filePath: string, level: BoardLogLevel, message: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await initializeSize(queue, filePath);

    const formattedLine = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    const formattedBytes = Buffer.byteLength(formattedLine, "utf8");
    if ((queue.cachedSize ?? 0) + formattedBytes > MAX_BOARD_LOG_BYTES) {
        const previous = await fs.promises.readFile(filePath);
        const offset = Math.max(0, previous.length - BOARD_LOG_TAIL_BYTES);
        const newline = previous.indexOf(0x0a, offset);
        const tail = newline < 0 ? Buffer.alloc(0) : previous.subarray(newline + 1);
        await fs.promises.writeFile(filePath, tail);
        queue.cachedSize = (await fs.promises.stat(filePath)).size;
    }

    await fs.promises.appendFile(filePath, formattedLine, "utf8");
    queue.cachedSize = (queue.cachedSize ?? 0) + formattedBytes;
}

export async function append(root: string, level: BoardLogLevel, message: string): Promise<void> {
    const filePath = boardLogPath(root);
    const queue = queueFor(filePath);
    const lines = message.split(/\r?\n/).filter((line) => line.length > 0).map(cappedUtf8Line);
    return enqueue(queue, async () => {
        for (const line of lines) await appendLine(queue, filePath, level, line);
    });
}

export function getBoardLogPath(root: string): Promise<string> {
    const filePath = boardLogPath(root);
    const queue = queueFor(filePath);
    return enqueue(queue, async () => {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        try {
            await fs.promises.writeFile(filePath, "", { flag: "wx" });
        } catch (error) {
            if (!(error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
                throw error;
            }
        }
        return filePath;
    });
}
