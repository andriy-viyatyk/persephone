import type { CapabilityRegistration as LegacyRegistration } from "../ipc/capability-bus-channels";
import type { BoardServiceTrustSnapshot } from "../ipc/module-service-channels";
import type { BoardCapabilityDeclaration, CapabilityMethod } from "../shared/capability-contract";
import { CAPABILITY_DEFAULT_TIMEOUT_MS } from "../shared/capability-limits";
import { PLATFORM_BACKEND_CAPABILITIES, PLATFORM_CAPABILITIES, type CapabilityBackendKind } from "../shared/platform-capabilities";
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
    backend?: CapabilityBackendKind;
    methods: Record<string, CapabilityMethod>;
}

const backendOwnedIds: ReadonlySet<string> = new Set(PLATFORM_BACKEND_CAPABILITIES.map((entry) => entry.id));
/** A board may not declare an id that a platform backend serves. */
const isBoardDeclarable = (id: string): boolean => !backendOwnedIds.has(id);

const platform: CapabilityRegistration[] = [
    ...PLATFORM_CAPABILITIES.map((entry): CapabilityRegistration => ({
        ...entry, provider: "persephone", name: "persephone", handlerKey: entry.editorId,
        origin: "platform" as const, methods: { open: { kind: "open" as const, summary: "Open", args: [{ name: "payload", type: "unknown" }], timeoutMs: CAPABILITY_DEFAULT_TIMEOUT_MS, agent: true } },
    })),
    ...PLATFORM_BACKEND_CAPABILITIES.map((entry): CapabilityRegistration => ({
        ...entry, provider: "persephone", name: "persephone", origin: "platform" as const })),
];

class CapabilityRegistry {
    private boards: CapabilityRegistration[] = [];
    private boardSnapshot: BoardServiceTrustSnapshot = { trustedPaths: [], boards: [] };
    private revision = 0;
    private readonly listeners = new Set<() => void>();

    replace(snapshot: BoardServiceTrustSnapshot): void {
        this.boardSnapshot = snapshot;
        const previous = this.boards;
        this.boards = snapshot.boards.flatMap((board) => (board.capabilities ?? []).filter((declaration) => isBoardDeclarable(declaration.id) && !declaration.id.startsWith("system.")).map((declaration, index) => ({
            ...declaration, version: declaration.version ?? 1, priority: declaration.priority ?? 50,
            provider: boardRootDigest(BoardRoot.from(board.boardRoot)), name: board.boardName ?? "", handlerKey: `${boardRootDigest(BoardRoot.from(board.boardRoot))}:${index}`,
            origin: "board" as const, backend: "board-service" as const, methods: Object.fromEntries(Object.entries(declaration.methods ?? {}).filter(([, method]) =>
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
            ...this.boardSnapshot.boards.flatMap((board) => (board.legacyCapabilities ?? []).filter((declaration) => isBoardDeclarable(declaration.id)).map((declaration) => {
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
