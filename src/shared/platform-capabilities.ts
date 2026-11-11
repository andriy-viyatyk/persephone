import { PLATFORM_AUDIO_CAPABILITY_ID, PLATFORM_CAPABILITY_IDS } from "./capability-constants";
import type { CapabilityMethod } from "./capability-contract";
/** Built-in capability metadata in editor registration order. */
export const PLATFORM_CAPABILITIES = [
    { editorId: "monaco", id: PLATFORM_CAPABILITY_IDS.textOpen, version: 1, priority: 50 },
    { editorId: "grid-json", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "grid", version: 1, priority: 50 },
    { editorId: "log-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "log", version: 1, priority: 50 },
    { editorId: "md-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "markdown", version: 1, priority: 50 },
    { editorId: "svg-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "svg", version: 1, priority: 50 },
    { editorId: "html-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "html", version: 1, priority: 50 },
    { editorId: "mermaid-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "mermaid", version: 1, priority: 50 },
] as const;

/** The main-process component that runs a capability's `call` and `channel` methods. */
export type CapabilityBackendKind = "board-service" | "audio";

export interface PlatformBackendCapability {
    id: string;
    version: number;
    priority: number;
    handlerKey: string;
    title: string;
    backend: CapabilityBackendKind;
    methods: Record<string, CapabilityMethod>;
}

/** Moved verbatim from `capability-registry.ts`. */
export const PLATFORM_AUDIO_METHODS: Record<string, CapabilityMethod> = {
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

/** Platform capabilities served by a main-process backend rather than the renderer or a board. */
export const PLATFORM_BACKEND_CAPABILITIES: readonly PlatformBackendCapability[] = [
    { id: PLATFORM_AUDIO_CAPABILITY_ID, version: 1, priority: 50, handlerKey: "audio",
        // eslint-disable-next-line vanilla-view/no-hardcoded-ui-strings -- Protocol metadata requires the stable platform provider title.
        title: "Audio", backend: "audio", methods: PLATFORM_AUDIO_METHODS },
];
