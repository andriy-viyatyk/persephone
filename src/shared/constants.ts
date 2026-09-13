export const openFilesNameTemplate = 'openFiles{windowIndex}.json';

// MCP IPC channels (main ↔ renderer)
export const MCP_EXECUTE = "mcp-execute";
export const MCP_RESULT = "mcp-result";

/** User-Agent sent by content pipes when the caller supplied none.
 *
 * `nodeFetch` injects no headers by design, so a pipe-driven fetch otherwise goes out with no
 * User-Agent at all — which a number of hosts reject outright (Wikimedia answers 403). Carries no
 * version number on purpose: it identifies the client, and a hardcoded version only goes stale. */
export const CONTENT_USER_AGENT =
    "Persephone (+https://github.com/andriy-viyatyk/persephone)";
