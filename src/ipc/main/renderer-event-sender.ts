import type { WebContents } from "electron";
import type { EventApi } from "../api-types";
import type { EventPayload } from "../event-types";

export function sendRendererEvent<K extends keyof EventApi>(
    target: Pick<WebContents, "send">,
    key: K,
    payload: EventPayload<K>,
): void {
    target.send(key, payload);
}
