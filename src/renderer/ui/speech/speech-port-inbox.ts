import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS, VOICE_TYPING_BOARD_PREFIX } from "../../../ipc/module-service-channels";
import { api } from "../../../ipc/renderer/api";

const pendingPorts = new Map<string, { port: MessagePort; timer: ReturnType<typeof setTimeout> }>();
const portWaiters = new Map<string, { resolve: (port: MessagePort) => void; timer: ReturnType<typeof setTimeout> }>();

api.onBoardServiceChannel((boardId, channelId, port) => {
    if (!boardId.startsWith(VOICE_TYPING_BOARD_PREFIX)) return;
    const waiter = portWaiters.get(channelId);
    if (waiter) {
        portWaiters.delete(channelId);
        clearTimeout(waiter.timer);
        waiter.resolve(port);
        return;
    }
    const previous = pendingPorts.get(channelId);
    if (previous) { clearTimeout(previous.timer); previous.port.close(); }
    const timer = setTimeout(() => {
        pendingPorts.delete(channelId);
        port.close();
    }, SERVICE_CHANNEL_OPEN_TIMEOUT_MS);
    pendingPorts.set(channelId, { port, timer });
});

export function claimSpeechPort(channelId: string, timeoutMs: number, timeoutMessage: string): Promise<MessagePort> {
    if (portWaiters.has(channelId)) return Promise.reject(new Error(timeoutMessage));
    const pending = pendingPorts.get(channelId);
    if (pending) {
        pendingPorts.delete(channelId);
        clearTimeout(pending.timer);
        return Promise.resolve(pending.port);
    }
    return new Promise<MessagePort>((resolve, reject) => {
        const timer = setTimeout(() => {
            portWaiters.delete(channelId);
            reject(new Error(timeoutMessage));
        }, timeoutMs);
        portWaiters.set(channelId, { resolve, timer });
    });
}
