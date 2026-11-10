import { PLATFORM_AUDIO_CAPABILITY_ID } from "../shared/capability-constants";
import type { CapabilityRegistration as LegacyRegistration } from "../ipc/capability-bus-channels";
import type { BoardServiceTrustSnapshot } from "../ipc/module-service-channels";
import type { BoardCapabilityDeclaration, CapabilityMethod } from "../shared/capability-contract";
import { CAPABILITY_DEFAULT_TIMEOUT_MS } from "../shared/capability-limits";
import { PLATFORM_CAPABILITIES } from "../shared/platform-capabilities";
import { BoardRoot } from "../shared/board/board-root";
import { boardRootDigest } from "./board-root-hashes";
import { EventEndpoint } from "../ipc/api-types";
import { openWindows } from "./open-windows";

export interface CapabilityRegistration extends BoardCapabilityDeclaration {
    version: number;
    priority: number;
    provider: string;
    name: string;
    handlerKey: string;
    origin: "platform" | "board";
    methods: Record<string, CapabilityMethod>;
}

const audioMethods: Record<string, CapabilityMethod> = {
    muteApp: { kind: "channel", summary: "Mute app playback while a board listens.", args: [], returns: "MuteLease", timeoutMs: 15000, agent: false },
    devices: { kind: "call", summary: "List available microphone inputs.", args: [],
        returns: "{ deviceId: string; label: string; isDefault: boolean }[]", timeoutMs: 10000, agent: false },
    capture: { kind: "channel", summary: "Board-only streaming: capture shared PCM.",
        args: [{ name: "open", type: '{ source: "microphone" | "computer"; deviceId?: string; echoCancel?: boolean; processing?: "default" | "raw"; cancelComputerAudio?: boolean }' }],
        returns: "CapabilityChannel", timeoutMs: 15000, agent: true },
    play: { kind: "channel", summary: "Board-only streaming: play mono PCM.",
        args: [{ name: "open", type: "{ sampleRate: number }" }],
        returns: "CapabilityChannel", timeoutMs: 15000, agent: true },
};

const platform: CapabilityRegistration[] = [
    ...PLATFORM_CAPABILITIES.map((entry): CapabilityRegistration => ({
        ...entry, provider: "persephone", name: "persephone", handlerKey: entry.editorId,
        origin: "platform" as const, methods: { open: { kind: "open" as const, summary: "Open", args: [{ name: "payload", type: "unknown" }], timeoutMs: CAPABILITY_DEFAULT_TIMEOUT_MS, agent: true } },
    })),
    { id: PLATFORM_AUDIO_CAPABILITY_ID, version: 1, priority: 50, provider: "persephone", name: "persephone",
        // eslint-disable-next-line vanilla-view/no-hardcoded-ui-strings -- Protocol metadata requires the stable platform provider title.
        handlerKey: "audio", origin: "platform", title: "Audio", methods: audioMethods },
];

class CapabilityRegistry {
    private boards: CapabilityRegistration[] = [];
    private boardSnapshot: BoardServiceTrustSnapshot = { trustedPaths: [], boards: [] };
    private revision = 0;
    private readonly listeners = new Set<() => void>();

    replace(snapshot: BoardServiceTrustSnapshot): void {
        this.boardSnapshot = snapshot;
        const previous = this.boards;
        this.boards = snapshot.boards.flatMap((board) => (board.capabilities ?? []).filter((declaration) => declaration.id !== PLATFORM_AUDIO_CAPABILITY_ID && !declaration.id.startsWith("system.")).map((declaration, index) => ({
            ...declaration, version: declaration.version ?? 1, priority: declaration.priority ?? 50,
            provider: boardRootDigest(BoardRoot.from(board.boardRoot)), name: board.boardName ?? "", handlerKey: `${boardRootDigest(BoardRoot.from(board.boardRoot))}:${index}`,
            origin: "board" as const, methods: Object.fromEntries(Object.entries(declaration.methods ?? {}).filter(([, method]) =>
                method.kind === "open" || (!!board.service && board.canStartService))),
        })).filter((entry) => Object.keys(entry.methods).length > 0)).map((entry) => {
            const old = previous.find((item) => item.handlerKey.startsWith(`${entry.handlerKey}:`));
            const comparable = old && { ...old, handlerKey: entry.handlerKey };
            return { ...entry, handlerKey: comparable && JSON.stringify(comparable) === JSON.stringify(entry)
                ? old.handlerKey : `${entry.handlerKey}:${this.revision + 1}` };
        });
        this.revision++;
        for (const listener of this.listeners) listener();
        openWindows.send(EventEndpoint.eCapabilityIndexChanged, this.revision);
    }

    snapshot() {
        const legacyRegistrations: LegacyRegistration[] = [
            ...PLATFORM_CAPABILITIES.map(({ editorId, ...entry }) => ({ ...entry, handlerKey: editorId, origin: "platform" as const })),
            ...this.boardSnapshot.boards.flatMap((board) => (board.legacyCapabilities ?? []).filter((declaration) => declaration.id !== PLATFORM_AUDIO_CAPABILITY_ID).map((declaration) => {
                const { methods: _methods, ...fields } = declaration;
                return { ...fields, version: declaration.version ?? 1, priority: declaration.priority ?? 50,
                    handlerKey: `board-editor:${board.boardRoot}`, origin: "board" as const,
                    boardRoot: board.boardRoot, boardName: board.boardName };
            })),
        ];
        return { revision: this.revision, registrations: [...platform, ...this.boards], legacyRegistrations };
    }
    onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    board(provider: string) { return this.boardSnapshot.boards.find((entry) => boardRootDigest(BoardRoot.from(entry.boardRoot)) === provider); }
}

export const capabilityRegistry = new CapabilityRegistry();
