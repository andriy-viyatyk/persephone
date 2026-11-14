/**
 * Formats the local MCP endpoint URL.
 * The endpoint uses IPv4 loopback because some Windows clients resolve localhost to ::1 first,
 * then stall instead of failing over to the IPv4-only listener.
 */
export function mcpEndpointUrl(port: number): string {
    return `http://127.0.0.1:${port}/mcp`;
}
