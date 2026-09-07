import { getServerInfo, readGuideFile, resourceFiles, SERVER_INSTRUCTIONS } from "./manifest";
import { MainGuideSource } from "./ai-vision/guide-source";
import { registerTools } from "./register-tools";
import { McpServerInstance, requireSdk } from "./sdk";
import { callTools } from "./tools/call-tools";
import { createToolContext } from "./tools/params";
import { createGuideIndex } from "../../shared/guides";
import type { GuideTreeNode } from "../../shared/guides";

/**
 * Creates a new McpServer — one per session, as the SDK requires one transport per
 * server. Tools are data (see `tools/`); this assembles the complete group list for
 * each new session.
 *
 * The manifest is `call` alone (US-1353). Every capability Persephone once advertised as a
 * separate tool is a path under it.
 */
export function createMcpServer(): McpServerInstance {
    const { McpServer, z } = requireSdk();
    const server = new McpServer(getServerInfo(), { instructions: SERVER_INSTRUCTIONS });

    const ctx = createToolContext(z);
    registerTools(server, callTools(ctx));
    const guideIndex = createGuideIndex(new MainGuideSource());

    // ── MCP Resources (focused guides) ─────────────────────────────────
    for (const res of resourceFiles) {
        server.registerResource(
            res.name,
            res.uri,
            { description: res.description, mimeType: "text/markdown" },
            async (uri) => ({
                contents: [{
                    uri: uri.href,
                    mimeType: "text/markdown",
                    text: readGuideFile(res.file),
                }],
            }),
        );
    }

    // Full API guide — concatenation of all resource files (for agents that want everything)
    server.registerResource(
        "full-api-guide",
        "persephone://guides/full",
        {
            description: "Complete API guide — all resources combined. Only read this if you need the full reference; prefer the focused guides above for specific tasks.",
            mimeType: "text/markdown",
        },
        async (uri) => ({
            contents: [{
                uri: uri.href,
                mimeType: "text/markdown",
                text: (await getAgentGuidePages(guideIndex)).join("\n\n---\n\n"),
            }],
        }),
    );

    return server;
}

async function getAgentGuidePages(guideIndex: ReturnType<typeof createGuideIndex>): Promise<string[]> {
    const pages = flattenGuidePages(await guideIndex.getTree("agent"));
    const contents = await Promise.all(pages.map(async page => {
        const guide = await guideIndex.getPage(page.path, "agent");
        if (!guide) throw new Error(`Guide page "${page.path}" disappeared while building the full resource.`);
        return guide.content;
    }));
    return contents;
}

function flattenGuidePages(nodes: readonly GuideTreeNode[]): Array<Extract<GuideTreeNode, { readonly kind: "page" }>> {
    const pages: Array<Extract<GuideTreeNode, { readonly kind: "page" }>> = [];
    for (const node of nodes) {
        if (node.kind === "folder") pages.push(...flattenGuidePages(node.children));
        else pages.push(node);
    }
    return pages;
}
