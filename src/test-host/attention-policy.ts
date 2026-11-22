export class EnvironmentStopError extends Error {
    readonly code = "ENVIRONMENT_STOP";
    constructor(message = "A dialog or popup menu requires attention in another window.") {
        super(message);
        this.name = "EnvironmentStopError";
    }
}

export interface AttentionClassification { origin: "inside" | "outside" | "unknown"; cause: string; }

/** Classifies only window identities stated by the routed target or attention text. */
export function classifyAttention(text: string, routedTarget: string | undefined, testWindowIndex: number | undefined): AttentionClassification {
    const nativeIndexes = [...text.matchAll(/is open in window (\d+)/gi)].map((match) => Number(match[1]));
    const routedIndex = routedTarget ? /^windows\[(\d+)\](?:\.|$)/.exec(routedTarget)?.[1] : undefined;
    const indexes = [...nativeIndexes, ...(routedIndex === undefined ? [] : [Number(routedIndex)])];
    if (testWindowIndex !== undefined && indexes.some((index) => index !== testWindowIndex)) {
        return { origin: "outside", cause: "A dialog or popup menu requires attention in another window." };
    }
    if (testWindowIndex !== undefined && indexes.includes(testWindowIndex)) {
        if (/popup menu/i.test(text)) return { origin: "inside", cause: "A popup menu is open in the test window." };
        const title = /dialog\s+"([^"]+)"/i.exec(text)?.[1]
            ?? /\(title:\s*([^;)]+)\)/i.exec(text)?.[1];
        return { origin: "inside", cause: title?.trim()
            ? `A dialog is open in the test window: ${title.trim()}`
            : "A dialog is open in the test window" };
    }
    if (testWindowIndex !== undefined && routedIndex === undefined && nativeIndexes.length === 0) {
        return { origin: "inside", cause: text.toLowerCase().includes("popup menu")
            ? "A popup menu is open in the test window."
            : "A dialog is open in the test window" };
    }
    return { origin: "unknown", cause: "Unexpected attention was reported, but its window could not be identified." };
}
