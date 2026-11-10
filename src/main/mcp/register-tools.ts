import { McpServerInstance } from "./sdk";
import { IMcpToolDef, ToolArgs } from "./types";

/**
 * The generic pass-through: strip `windowIndex` (it selects the target window, it is not
 * a tool parameter), forward everything else to the renderer under the tool's method,
 * and map the response. This is the whole implementation of ~30 of the tools.
 */
/** Register a group of data-defined tools on a server instance. */
export function registerTools(server: McpServerInstance, defs: IMcpToolDef[]): void {
    for (const def of defs) {
        const run = def.handler;
        // The SDK infers the callback's argument type from the schema shape; a
        // data-defined tool only knows `ToolArgs`, hence the cast at the boundary.
        // A tool registered without a schema is called with (extra) only — no args.
        if (def.schema) {
            server.tool(def.name, def.description, def.schema, ((args: ToolArgs) => run(args)) as never);
        } else {
            server.tool(def.name, def.description, (() => run({})) as never);
        }
    }
}
