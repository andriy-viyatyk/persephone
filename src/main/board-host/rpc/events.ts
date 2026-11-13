import fs from "node:fs";
import path from "node:path";
import type { BoardNotifyMsg, BoardRunnerOutMsg, BoardToMain, BoardToMainEvents } from "../../../ipc/board-bridge/port-protocol";
import { RunnerChannel, RunnerKillMsg, RunnerStartMsg, RunnerStdinMsg } from "../../../ipc/runner-channels";
import { frameEvent } from "../../../ipc/board-bridge/frame-protocol";
import { sendRendererEvent } from "../../../ipc/main/renderer-event-sender";
import { BoardGrant } from "../../../shared/board/board-grant";
import { boardTrustService } from "../../board-trust-service";
import { endJobStdin, killJob, startJobTo, startNodeJobTo, writeJobStdin, type JobSink } from "../../command-runner";
import { errMessage } from "../../../shared/utils";
import * as boardLog from "../../board-log";
import { ownerWindow } from "./context";
import type { BoardBridgeConnection } from "../BoardBridgeConnection";

type BoardRunnerHandler = (entry: BoardBridgeConnection, boardId: string, msg: unknown) => Promise<void>;

function portSink(entry: BoardBridgeConnection, boardId: string): JobSink {
    return {
        id: boardId,
        send(channel: RunnerChannel, payload: unknown) {
            try {
                entry.port.postMessage(frameEvent(channel, payload));
            } catch {
                // port closed — ignore
            }
        },
    };
}

function isBoardRunnerPayload(name: BoardRunnerOutMsg["name"], payload: unknown): payload is BoardRunnerOutMsg["payload"] {
    if (!payload || typeof payload !== "object" || typeof (payload as { jobId?: unknown }).jobId !== "string") return false;
    const message = payload as { command?: unknown; data?: unknown; signal?: unknown };
    if (name === RunnerChannel.start) return typeof message.command === "string";
    if (name === RunnerChannel.stdin) return typeof message.data === "string" || message.data instanceof Uint8Array;
    return name !== RunnerChannel.kill || message.signal === undefined || typeof message.signal === "string";
}

function runNotify(entry: BoardBridgeConnection, notification: BoardToMainEvents["notify"]): void {
    if (!notification.message) return;
    const win = ownerWindow(entry.hostWebContents);
    const { message, type, persistent } = notification;
    if (win) sendRendererEvent(win.webContents, "eBoardNotify", { message, type, persistent } satisfies BoardNotifyMsg);
    if (type === "error" || type === "warning") {
        void boardLog.append(entry.root, type, message).catch(() => {});
    }
}

export function createBoardEventDispatcher(): { dispatchEvent(connection: BoardBridgeConnection, data: BoardToMain): void } {
    const boardRunnerHandlers: Record<BoardRunnerOutMsg["name"], BoardRunnerHandler> = {
        async [RunnerChannel.start](entry, boardId, raw) {
            const canExecute = await boardTrustService.allows(entry.root, "execute");
            if (!entry.isCurrent()) return;
            if (!canExecute) {
                portSink(entry, boardId).send(RunnerChannel.error, {
                    jobId: (raw as RunnerStartMsg).jobId,
                    message: BoardGrant.deny("execute").message,
                });
                return;
            }
            const msg = raw as RunnerStartMsg;
            const opts = { ...(entry.root ? { cwd: entry.root } : {}), ...msg.opts };
            if (msg.node) {
                const script = path.isAbsolute(msg.command) ? msg.command : path.resolve(entry.root, msg.command);
                if (!fs.existsSync(script)) {
                    portSink(entry, boardId).send(RunnerChannel.error, { jobId: msg.jobId, message: `Node script not found: ${script}` });
                    return;
                }
                startNodeJobTo(portSink(entry, boardId), { ...msg, command: script, opts });
                return;
            }
            startJobTo(portSink(entry, boardId), { ...msg, opts });
        },
        async [RunnerChannel.stdin](entry, _boardId, raw) {
            const canExecute = await boardTrustService.allows(entry.root, "execute");
            if (!entry.isCurrent() || !canExecute) return;
            const msg = raw as RunnerStdinMsg;
            writeJobStdin(msg.jobId, msg.data);
        },
        async [RunnerChannel.endStdin](entry, _boardId, raw) {
            const canExecute = await boardTrustService.allows(entry.root, "execute");
            if (!entry.isCurrent() || !canExecute) return;
            endJobStdin((raw as { jobId: string }).jobId);
        },
        async [RunnerChannel.kill](entry, _boardId, raw) {
            const canExecute = await boardTrustService.allows(entry.root, "execute");
            if (!entry.isCurrent() || !canExecute) return;
            const msg = raw as RunnerKillMsg;
            killJob(msg.jobId, msg.signal);
        },
    };

    return {
        dispatchEvent(entry, raw) {
            const data = raw as BoardToMain;
            const boardId = entry.boardId;
            if (data.__persephone === "evt" && data.name === "connected") {
                entry.connected = true;
                if (entry.watchdog) {
                    clearTimeout(entry.watchdog);
                    entry.watchdog = undefined;
                }
                return;
            }
            if (data.__persephone !== "evt") return;
            if (Object.prototype.hasOwnProperty.call(boardRunnerHandlers, data.name)) {
                const name = data.name as BoardRunnerOutMsg["name"];
                const message = data.payload;
                if (!isBoardRunnerPayload(name, message)) return;
                void boardRunnerHandlers[name](entry, boardId, message).catch((error: unknown) => {
                    portSink(entry, boardId).send(RunnerChannel.error, {
                        jobId: (message as { jobId?: string }).jobId ?? "",
                        message: errMessage(error),
                    });
                });
                return;
            }
            if (data.name === "notify") {
                const notification = data.payload as BoardNotifyMsg;
                if (!notification || typeof notification.message !== "string"
                    || (notification.type !== undefined && !["info", "success", "warning", "error"].includes(notification.type))
                    || (notification.persistent !== undefined && typeof notification.persistent !== "boolean")) return;
                runNotify(entry, notification);
            }
        },
    };
}
