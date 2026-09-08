import {
    numberRule,
    validateCallArguments,
    type IAiMember,
    type IAiVisionDescriptor,
    type IAiEvent,
    type EventLog,
} from "ai-vision";

const RECENT_ARGUMENTS = [
    numberRule("limit", "events.recent(50)", { required: false }),
] as const;

const SINCE_ARGUMENTS = [
    numberRule("seq", "events.since(1)", { minimum: 0 }),
] as const;

const WAIT_ARGUMENTS = [
    numberRule("timeoutMs", "events.wait(50000)", { required: false, minimum: 1 }),
] as const;

const EVENTS_MEMBERS: readonly IAiMember[] = [
    { name: "recent", kind: "method", signature: "recent(limit = 50)", summary: "Read the newest retained events, newest first." },
    { name: "since", kind: "method", signature: "since(seq)", summary: "Read retained events newer than seq (up to the 200 retained entries; use call maxLength to bound the returned text)." },
    { name: "count", kind: "property", summary: "How many events are currently retained in this window's event log." },
    { name: "wait", kind: "method", signature: "wait(timeoutMs?)", summary: "Wait for an event newer than this call's cursor; if pending is true, call events.wait() again." },
];

const EVENTS_HELP = "Call `events.recent()` to read the newest events or `events.since(seq)` for a precise range. `since(seq)` has no additional limit and can return all 200 retained entries; use the call's `maxLength` when the returned text must be bounded. Call `events.wait()` to wait for a change. If it returns `pending: true`, call `events.wait()` again. `recent()` is newest first, `since(seq)` uses sequence numbers, `count` is the retained ring size, and `wait()` is bounded to 50,000 ms by default or 110,000 ms for an explicit timeout.";

interface EventsWaitResult {
    pending: boolean;
    waitedMs: number;
    event?: IAiEvent;
    timeoutMs?: number;
    clampedFrom?: number;
}

function timeoutMetadata(requestedTimeoutMs: number | undefined): Record<string, number> {
    return requestedTimeoutMs !== undefined && requestedTimeoutMs > 110_000
        ? { timeoutMs: 110_000, clampedFrom: requestedTimeoutMs }
        : {};
}

export class EventsNode {
    constructor(
        private readonly eventLog: EventLog,
        private readonly getCursor: () => number,
    ) {}

    recent(...args: unknown[]): readonly IAiEvent[] {
        const [limit] = validateCallArguments("events.recent", args, RECENT_ARGUMENTS, { maxArgs: 1 });
        return this.eventLog.recent(limit);
    }

    since(...args: unknown[]): readonly IAiEvent[] {
        const [seq] = validateCallArguments("events.since", args, SINCE_ARGUMENTS, { maxArgs: 1 });
        return this.eventLog.since(seq);
    }

    get count(): number {
        return this.eventLog.count;
    }

    wait(...args: unknown[]): Promise<EventsWaitResult> {
        const [requestedTimeoutMs] = validateCallArguments(
            "events.wait",
            args,
            WAIT_ARGUMENTS,
            { maxArgs: 1 },
        );
        const effectiveTimeoutMs = Math.min(requestedTimeoutMs ?? 50_000, 110_000);
        const metadata = timeoutMetadata(requestedTimeoutMs);
        const startedAt = Date.now();

        // A renderer restart resets this module's sequence space; an old main-side cursor can then
        // be ahead of lastSeq and would otherwise make the restarted session permanently deaf.
        const cursor = this.getCursor();
        const effectiveCursor = cursor > this.eventLog.lastSeq ? 0 : cursor;
        const immediate = this.eventLog.unseen(effectiveCursor).entries[0];
        if (immediate) {
            return Promise.resolve({ pending: false, waitedMs: 0, event: immediate, ...metadata });
        }

        return new Promise<EventsWaitResult>((resolve) => {
            let settled = false;
            const cleanupState: {
                timer?: ReturnType<typeof setTimeout>;
                unsubscribe?: () => void;
            } = {};

            const finish = (result: EventsWaitResult): void => {
                if (settled) return;
                settled = true;
                if (cleanupState.timer !== undefined) clearTimeout(cleanupState.timer);
                cleanupState.unsubscribe?.();
                resolve(result);
            };

            const onEvent = (entry: IAiEvent): void => {
                if (entry.seq <= effectiveCursor) return;
                finish({
                    pending: false,
                    waitedMs: Math.max(0, Date.now() - startedAt),
                    event: entry,
                    ...metadata,
                });
            };

            cleanupState.unsubscribe = this.eventLog.subscribe(onEvent);
            cleanupState.timer = setTimeout(() => {
                finish({
                    pending: true,
                    waitedMs: Math.max(0, Date.now() - startedAt),
                    ...metadata,
                });
            }, effectiveTimeoutMs);

            const afterSubscribe = this.eventLog.unseen(effectiveCursor).entries[0];
            if (afterSubscribe) {
                finish({
                    pending: false,
                    waitedMs: Math.max(0, Date.now() - startedAt),
                    event: afterSubscribe,
                    ...metadata,
                });
                return;
            }
        });
    }

    get aiVision(): IAiVisionDescriptor {
        return EVENTS_DESCRIPTOR;
    }
}

const EVENTS_DESCRIPTOR: IAiVisionDescriptor = {
    kind: "Events",
    summary: "Recent changes in this renderer window; read them or wait for the next one.",
    members: EVENTS_MEMBERS,
    help: EVENTS_HELP,
};

export function describeEvents(_instance: unknown): IAiVisionDescriptor {
    return EVENTS_DESCRIPTOR;
}
