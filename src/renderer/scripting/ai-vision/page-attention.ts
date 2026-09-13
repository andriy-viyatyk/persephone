/** Pages the agent has addressed by identity (not merely listed). */
const attended = new Set<string>();
let agentNavigating = false;

export function resetPageAttention(): void {
    attended.clear();
}

export function markPageAttended(pageId: string | undefined): void {
    if (pageId) attended.add(pageId);
}

export function isPageAttended(pageId: string | undefined): boolean {
    return pageId !== undefined && attended.has(pageId);
}

/** Drop ids for pages that are no longer open; called before each activation check. */
export function prunePageAttention(liveIds: Iterable<string>): void {
    const live = new Set(liveIds);
    for (const pageId of attended) {
        if (!live.has(pageId)) attended.delete(pageId);
    }
}

/** Run an activation the AGENT initiated; the activation event is suppressed for it. */
export function withAgentNavigation<T>(fn: () => T): T {
    const previous = agentNavigating;
    agentNavigating = true;
    try {
        return fn();
    } finally {
        agentNavigating = previous;
    }
}

export function isAgentNavigating(): boolean {
    return agentNavigating;
}
