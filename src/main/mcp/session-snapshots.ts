export interface McpSessionSnapshot {
    ordinal: number;
    idPrefix: string;
    lastActivity: number;
    idleMs: number;
}

export function getSessionSnapshots(
    sessions: ReadonlyMap<string, { lastActivity: number }>,
    now = Date.now(),
): McpSessionSnapshot[] {
    return [...sessions.entries()].map(([id, session], index) => ({
        ordinal: index + 1,
        idPrefix: id.slice(0, 8),
        lastActivity: session.lastActivity,
        idleMs: Math.max(0, now - session.lastActivity),
    }));
}
