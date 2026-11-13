import { ui } from "../api/ui";
import { isProviderResolutionError } from "./registry";
import { errMessage } from "../../shared/utils";

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
