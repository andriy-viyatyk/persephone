import type { CapabilityErrorCode } from "../../../../shared/capability-constants";
import type { BoardFrameRetireReason } from "./BoardFrameSession";

export const RETIRE_MESSAGES: Record<BoardFrameRetireReason, {
    save: string;
    aiVision: string;
    capability: readonly [CapabilityErrorCode, string];
}> = {
    dispose: {
        save: "The board frame was replaced.",
        aiVision: "Board frame was replaced.",
        capability: ["handler-closed", "The board frame was replaced."],
    },
    reload: {
        save: "The board frame was reloaded.",
        aiVision: "The board frame was reloaded.",
        capability: ["crashed", "The board frame was reloaded."],
    },
    "grant-change": {
        save: "The board permissions changed while it was saving.",
        aiVision: "Board permissions changed.",
        capability: ["handler-closed", "Board permissions changed."],
    },
    "permission-lost": {
        save: "The board permissions changed while it was saving.",
        aiVision: "Board permissions changed.",
        capability: ["handler-closed", "Board permissions changed."],
    },
    "load-error": {
        save: "The board frame failed to load.",
        aiVision: "The board frame failed to load.",
        capability: ["crashed", "The board frame failed to load."],
    },
};

