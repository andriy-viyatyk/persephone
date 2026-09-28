import { ui } from "../api/ui";
import type { IContentPipe } from "../api/types/io.pipe";
import { isProviderResolutionError } from "./registry";
import { errMessage } from "../../shared/utils";

/** Watch a pipe for late provider registration, ignoring ordinary file events. */
export function watchSourceRecovery(
    pipe: IContentPipe | null | undefined,
    onAvailable: () => void,
): () => void {
    if (!pipe?.watch) return () => {};
    return pipe.watch((event) => {
        if (event === "available") onAvailable();
    });
}

/** Report typed provider failures, optionally deduplicating against owner state. */
export function reportProviderError(
    error: unknown,
    previousMessage?: string,
): string | undefined {
    if (!isProviderResolutionError(error)) return previousMessage;
    const message = errMessage(error, "The content provider is unavailable.");
    if (message !== previousMessage) ui.notify(message, "error");
    return message;
}
