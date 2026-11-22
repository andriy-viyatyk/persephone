/**
 * Programmatic call surfaces receive values in JavaScript, so their default reply limit is
 * unbounded. MCP calls keep ai-vision's agent-facing 20,000 character default.
 */
export const UNBOUNDED_CALL_MAX_LENGTH = Number.MAX_SAFE_INTEGER;
