import type { EventApi } from "./api-types";
import type { EventObject } from "./contracts/event-object";

export type EventPayload<K extends keyof EventApi> = EventApi[K] extends EventObject<infer T> ? T : never;
