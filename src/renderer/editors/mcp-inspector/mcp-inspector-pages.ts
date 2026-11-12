import { editorRegistry } from "../base/editorRegistry";
import { McpInspectorEditorModel } from "./McpInspectorEditorModel";
import type { PagesModel } from "../../api/pages/PagesModel";

export async function showMcpInspectorPage(
    model: PagesModel,
    options?: { url?: string; name?: string; autoConnect?: boolean },
): Promise<void> {
    const editor = await editorRegistry.createEditor("mcp-view");
    if (!(editor instanceof McpInspectorEditorModel)) {
        throw new Error("MCP inspector editor was not created");
    }
    if (options?.url || options?.name) {
        editor.state.update((state) => {
            if (options.url) state.url = options.url;
            if (options.name) state.connectionName = options.name;
        });
    }
    model.addPage(editor);
    // Auto-connect (HTTP transport is the default state) — fire-and-forget so
    // the page opens immediately and shows the "connecting" state itself.
    if (options?.autoConnect && options.url) void editor.connect();
}
