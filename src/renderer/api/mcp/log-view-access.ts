import { LogViewEditor } from "../../editors/log-view";
import { pages } from "../pages";

/**
 * Resolve the fixed MCP Log View if it already exists, WITHOUT creating or focusing it.
 *
 * Reading must never open a page. `helpSearch` walks the descriptor graph through every
 * `node: true` property and declared child — `pages.logView` is both — and its contract says the
 * walk is side-effect free by construction. With a get-or-create getter behind that name, any
 * `helpSearch(...)` call opened and focused the Log View page as a side effect of a search.
 */
export function getMcpLogViewEditor(): LogViewEditor | undefined {
    const page = pages.query.findPage("mcp-ui-log");
    const editor = page?.mainEditor;
    return editor instanceof LogViewEditor ? editor : undefined;
}

/** Get, focus, and return the fixed Log View used by MCP output in this renderer. Writes only. */
export function getOrCreateMcpLogViewEditor(): LogViewEditor {
    const page = pages.standalonePages.requireTextPage("mcp-ui-log");
    const editor = page.mainEditor;
    if (!(editor instanceof LogViewEditor)) {
        throw new Error("MCP log page is not a LogViewEditor");
    }
    return editor;
}
