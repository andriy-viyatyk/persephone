/**
 * Shared MCP Log View page tracking.
 * Used by both mcp-handler (ui_push) and ScriptContext (execute_script with ui access).
 * Extracted to avoid circular dependency between mcp-handler and scripting modules.
 */
export const mcpLogState = {
    pageId: undefined as string | undefined,
};
