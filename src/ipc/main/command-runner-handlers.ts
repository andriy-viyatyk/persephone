import { RunnerChannel, type RunnerJobMsg, type RunnerKillMsg, type RunnerStartMsg, type RunnerStdinMsg } from "../runner-channels";
import * as commandRunner from "../../main/command-runner";
import { guardedIpcOn } from "../../main/ipc-sender-guard";

export function initCommandRunnerHandlers(): void {
    guardedIpcOn(RunnerChannel.start, (event, message: RunnerStartMsg) => commandRunner.start(event, message));
    guardedIpcOn(RunnerChannel.stdin, (_event, message: RunnerStdinMsg) => commandRunner.writeStdin(message));
    guardedIpcOn(RunnerChannel.endStdin, (_event, message: RunnerJobMsg) => commandRunner.endStdin(message));
    guardedIpcOn(RunnerChannel.kill, (_event, message: RunnerKillMsg) => commandRunner.kill(message));
}
