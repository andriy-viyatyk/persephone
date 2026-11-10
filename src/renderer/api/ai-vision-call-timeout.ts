import { api } from "../../ipc/renderer/api";
import { appCallTimeoutRangeMessage, isValidAppCallTimeout } from "../../shared/ai-vision-timeout";
import { errMessage } from "../../shared/utils";

const DEFAULT_MS = 30_000;
/** Unset until an agent assigns it, keeping the built-in fallback reachable as timeout level 4. */
let explicitMs: number | undefined;

export const appCallTimeout = {
    /** The effective timeout reported by `boards.callTimeoutMs`. */
    get: (): number => explicitMs ?? DEFAULT_MS,
    /** The value only when an agent set it: timeout level 3's input. */
    explicit: (): number | undefined => explicitMs,
    set(value: number): void {
        if (!isValidAppCallTimeout(value)) throw new TypeError(appCallTimeoutRangeMessage);
        explicitMs = value;
        void api.setBoardCallTimeout(value).catch((error: unknown) => {
            console.error(`Failed to apply boards.callTimeoutMs: ${errMessage(error)}`);
        });
    },
};
