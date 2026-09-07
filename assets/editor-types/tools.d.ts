/**
 * The Agent Tools node in the AiVision call tree.
 *
 * This is a call-tree contract, not an `app.tools` property: scripts reach the node through
 * `app.call("tools.<member>")`.
 */
export interface ITools {
    /** Search the currently registered tool definitions. */
    search(query?: string, maxResults?: number): Promise<unknown>;

    /** Execute one registered tool. */
    execute(toolId: string, args?: Record<string, unknown>): Promise<unknown>;

    /** Inspect and refresh the registered toolset collection. */
    readonly toolsets: IToolsets;

    /** Scaffold a toolset and offer registration through the user's confirmation dialog. */
    createToolset(name: string, dir: string): Promise<unknown>;

    /** Remove registration without deleting the toolset folder. */
    unregisterToolset(root: string): Promise<void>;
}

export interface IToolsets {
    /** Refresh the entire registered-tool registry. */
    refresh(): Promise<unknown>;
}
