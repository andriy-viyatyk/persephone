import { RunnerChannel, type IExecuteHandle, type IExecuteOptions, type RunnerInboundChannel, type RunnerInboundMsg } from "../ipc/runner-channels";
import { frameEvent } from "../ipc/board-bridge/frame-protocol";
import type { BoardJobInfo, BoardToMain } from "../ipc/board-bridge/port-protocol";
import { createExecuteHandle } from "../shared/execute-handle";
import type { MainPortChannel } from "./main-port-channel";

export function createExecuteApi(deps: { mainPort: MainPortChannel }) {
    const { mainPort } = deps;
    let idCounter = 0;
    const runnerHandlers = new Map<string, (channel: RunnerInboundChannel, msg: RunnerInboundMsg) => void>();
    mainPort.on(RunnerChannel.stdout, (payload) => runnerHandlers.get(payload.jobId)?.(RunnerChannel.stdout, payload));
    mainPort.on(RunnerChannel.stderr, (payload) => runnerHandlers.get(payload.jobId)?.(RunnerChannel.stderr, payload));
    mainPort.on(RunnerChannel.exit, (payload) => runnerHandlers.get(payload.jobId)?.(RunnerChannel.exit, payload));
    mainPort.on(RunnerChannel.error, (payload) => runnerHandlers.get(payload.jobId)?.(RunnerChannel.error, payload));

    function createHandle(command: string, options?: IExecuteOptions, extra?: { node?: boolean; args?: string[] }): IExecuteHandle {
        const jobId = `b_${++idCounter}_${Date.now()}`;
        return createExecuteHandle({
            jobId,
            label: "persephone.execute",
            send: (channel, msg) => mainPort.post(frameEvent(channel, msg) as BoardToMain),
            subscribe: (deliver) => {
                runnerHandlers.set(jobId, deliver);
                return () => runnerHandlers.delete(jobId);
            },
        }, { command, opts: options, ...extra });
    }

    const api = {
        execute(command: string, options?: IExecuteOptions): IExecuteHandle { return createHandle(command, options); },
        executeNode(script: string, args?: string[], options?: IExecuteOptions): IExecuteHandle {
            const { shell: _shell, ...opts } = options ?? {};
            return createHandle(script, opts, { node: true, args });
        },
        async getJobs(): Promise<Array<BoardJobInfo & { kill(signal?: string): void; write(data: string | Uint8Array): void; endStdin(): void }>> {
            const jobs = await mainPort.rpc("getJobs");
            return (jobs ?? []).map((job) => ({
                ...job,
                kill(signal?: string): void { mainPort.post(frameEvent(RunnerChannel.kill, { jobId: job.jobId, signal }) as BoardToMain); },
                write(data: string | Uint8Array): void { mainPort.post(frameEvent(RunnerChannel.stdin, { jobId: job.jobId, data }) as BoardToMain); },
                endStdin(): void { mainPort.post(frameEvent(RunnerChannel.endStdin, { jobId: job.jobId }) as BoardToMain); },
            }));
        },
    };
    return { api };
}
