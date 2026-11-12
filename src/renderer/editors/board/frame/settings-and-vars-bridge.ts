import type {
    BoardToHostRequests,
    HostToBoardEvents,
    RequestParams,
} from "../../../../ipc/board-bridge/frame-protocol";
import { resolveBoardNamespace } from "../../../api/boards/board-namespace";
import { resolveBoardVarRequest } from "../../../api/board-vars/board-vars-bridge";
import { resolveBoardSettingsRequest, subscribeBoardSettings } from "../../../api/board-settings/board-settings-bridge";
import { settings } from "../../../api/settings";
import type { AppSettingsKey } from "../../../api/settings-schema";
import { BoardFrameSession } from "./BoardFrameSession";
import { BoardFrameEndpoint } from "./BoardFrameEndpoint";

type HostSettingsMessage = { [K in keyof HostToBoardEvents]: {
    name: K;
    payload: HostToBoardEvents[K]
} }[keyof HostToBoardEvents];
type HostSettingsPush = {
    key: AppSettingsKey;
    message: (value: unknown) => HostSettingsMessage | undefined
};
const hostSettingsPushes: readonly HostSettingsPush[] = [{
    key: "voice-typing.auto-stop-silence-ms",
    message: (value) => typeof value === "number"
        ? {
            name: "voiceTyping.autoStopSilenceChanged",
            payload: { milliseconds: value },
        }
        : undefined,
}];

export class SettingsAndVarsBridge {
    private readonly unsubscribeRetire: () => void;
    private settingsUnsubscribe: (() => void) | undefined;
    private hostSettingsUnsubscribe: (() => void) | undefined;
    constructor(
        private readonly boardRoot: string,
        private readonly session: BoardFrameSession,
        private readonly endpoint: BoardFrameEndpoint,
    ) {
        this.unsubscribeRetire = session.onRetire(() => this.dispose());
    }

    async runVar<R>(method: "get" | "set" | "list" | "show", args: unknown[]): Promise<R> {
        const namespace = await resolveBoardNamespace(this.boardRoot);
        const reply = await resolveBoardVarRequest(namespace, method, args);
        if (reply.error !== undefined) throw new Error(reply.error);
        return reply.result as R;
    }

    async getSetting({ id }: RequestParams<BoardToHostRequests, "settings.get">) {
        const reply = await resolveBoardSettingsRequest(this.boardRoot, "get", [id]);
        if (reply.error !== undefined) throw new Error(reply.error);
        if (typeof reply.result === "string" || typeof reply.result === "number"
            || typeof reply.result === "boolean") return reply.result;
        throw new Error("Malformed persephone.settings.get() response.");
    }

    installBoardSettings(): void {
        this.settingsUnsubscribe?.();
        const stamp = this.session.current();
        if (!stamp) return;
        this.settingsUnsubscribe = subscribeBoardSettings(this.boardRoot, (change) => {
            this.endpoint.emit("settings.changed", { id: change.id, value: change.value }, { from: stamp });
        });
    }

    installHostSettingsPush(): void {
        this.hostSettingsUnsubscribe?.();
        const stamp = this.session.current();
        if (!stamp) return;
        const subscriptions = hostSettingsPushes.map((entry) => settings.watch(entry.key, (value) => {
            const message = entry.message(value);
            if (message) this.endpoint.emit(message.name, message.payload, { from: stamp });
        }));
        this.hostSettingsUnsubscribe = () => subscriptions.forEach((dispose) => dispose());
    }

    dispose(): void {
        this.settingsUnsubscribe?.();
        this.settingsUnsubscribe = undefined;
        this.hostSettingsUnsubscribe?.();
        this.hostSettingsUnsubscribe = undefined;
    }
    detach(): void {
        this.unsubscribeRetire();

    }

}
