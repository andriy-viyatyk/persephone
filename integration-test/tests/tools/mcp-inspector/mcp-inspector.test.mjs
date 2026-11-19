import { test } from "../../../lib/context.mjs";
import { closePage } from "../../editors/helpers.mjs";

const INSPECTOR_EDITOR_ID = "mcp-view";
const SELF_ENDPOINT = "http://127.0.0.1:17865/mcp";

async function resetFixtureDirectory(ctx, relativePath) {
    try {
        await ctx.app.fs.removeDir(ctx.fixture(relativePath), true);
    } catch {
        // A missing fixture directory is already clean.
    }
}

async function openInspector(ctx, url) {
    const pagesBefore = await ctx.app.pages.all;
    const previousIds = new Set(pagesBefore.map((page) => page.id));
    await ctx.app.pages.showMcpInspectorPage({ url });

    const pagesAfter = await ctx.waitFor(
        (activeContext) => activeContext.app.pages.all,
        (pages) => pages.some((page) => !previousIds.has(page.id) && page.editor === INSPECTOR_EDITOR_ID),
    );
    return pagesAfter.find((page) => !previousIds.has(page.id) && page.editor === INSPECTOR_EDITOR_ID).id;
}

async function closeInspector(ctx, pageId) {
    if (pageId) await closePage(ctx, pageId);
}

async function disconnectIfNeeded(ctx, pageId) {
    if (!pageId) return;
    try {
        const status = await ctx.app.pages[pageId].editor.connectionStatus;
        if (status !== "disconnected") await ctx.app.pages[pageId].editor.disconnect();
    } catch {
        // Preserve the test failure if the inspector is already closing or disconnected.
    }
}

export default [
    test("MCP Inspector opens disconnected with a prefilled endpoint", async (ctx) => {
        await resetFixtureDirectory(ctx, "us-2071/open-disconnected");
        let pageId;
        try {
            pageId = await openInspector(ctx, SELF_ENDPOINT);
            const editor = ctx.app.pages[pageId].editor;
            const help = await editor.$help;
            ctx.expect(help).toContain("MCP Inspector connection and panel state");
            ctx.expect(help).toContain("availablePanels");
            ctx.expect(await editor.connectionStatus).toBe("disconnected");
            ctx.expect(await editor.serverName).toBe("");
            ctx.expect((await editor.availablePanels) ?? null).toBe(null); // undefined crosses the call boundary as null
            ctx.expect(await editor.url).toBe(SELF_ENDPOINT);
            ctx.expect(await editor.transportType).toBe("http");
        } finally {
            await disconnectIfNeeded(ctx, pageId);
            await closeInspector(ctx, pageId);
        }
    }),

    test("MCP Inspector connects, calls a read-only tool, reads a guide, records history, and disconnects", async (ctx) => {
        await resetFixtureDirectory(ctx, "us-2071/self-connection");
        let pageId;
        try {
            pageId = await openInspector(ctx, SELF_ENDPOINT);
            const editor = ctx.app.pages[pageId].editor;
            await editor.connect();
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.connectionStatus,
                (status) => status === "connected",
                { timeout: 20000 },
            );

            ctx.expect(await editor.serverName).toBe("persephone");
            ctx.expect((await editor.serverVersion).length > 0).toBe(true);
            ctx.expect(await editor.serverTitle).toBe("Persephone");
            ctx.expect((await editor.instructions).length > 0).toBe(true);
            const availablePanels = await editor.availablePanels;
            for (const panel of ["info", "tools", "resources", "history"]) {
                ctx.expect(availablePanels.includes(panel)).toBe(true);
            }
            ctx.expect(availablePanels.includes("prompts")).toBe(false);
            ctx.expect((await editor.tools).some((tool) => tool.name === "call")).toBe(true);
            ctx.expect((await editor.resources).some((resource) => resource.uri === "persephone://guides/overview")).toBe(true);

            await ctx.app.window.screen.click('text="Tools"');
            await ctx.app.window.screen.type(
                '[data-name="mcp-arg-path"] [data-type="textarea"]',
                "main.runtime.paths.userData",
            );
            await ctx.app.window.screen.click('[data-name="mcp-call-tool"]');
            const toolResult = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.toolResult,
                (result) => result?.content?.some((item) => item.type === "text" && item.text.includes(".profile")),
            );
            ctx.expect(toolResult.content.some((item) => item.type === "text" && item.text.includes(".profile"))).toBe(true);

            await ctx.app.window.screen.click('text="Resources"');
            await ctx.app.window.screen.click('[data-name="mcp-read-resource"]');
            const resourceContent = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.resourceContent,
                (content) => typeof content?.text === "string" && content.text.length > 0,
            );
            ctx.expect(resourceContent.text).toContain("Persephone");

            const history = await ctx.waitFor(
                (activeContext) => /* ctx.call remains because the app stand-in cannot pass call options such as maxLength; the history holds full tool and resource payloads. */ activeContext.call(`pages[${JSON.stringify(pageId)}].editor.history`, undefined, { maxLength: 2000000 }),
                (entries) => entries.some((entry) => entry.direction === "outgoing" && entry.method === "tools/call")
                    && entries.some((entry) => entry.direction === "outgoing" && entry.method === "resources/read"),
            );
            ctx.expect(history.some((entry) => entry.direction === "outgoing" && entry.method === "tools/call")).toBe(true);
            ctx.expect(history.some((entry) => entry.direction === "outgoing" && entry.method === "resources/read")).toBe(true);
            ctx.expect(await editor.historyCount > 0).toBe(true);

            await editor.disconnect();
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.connectionStatus,
                (status) => status === "disconnected",
            );
            ctx.expect(await editor.serverName).toBe("");
        } finally {
            await disconnectIfNeeded(ctx, pageId);
            await closeInspector(ctx, pageId);
        }
    }),

    test("MCP Inspector reports a closed loopback endpoint error", async (ctx) => {
        await resetFixtureDirectory(ctx, "us-2071/closed-port");
        let pageId;
        try {
            pageId = await openInspector(ctx, "http://127.0.0.1:17899/mcp");
            const editor = ctx.app.pages[pageId].editor;
            await editor.connect();
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.connectionStatus,
                (status) => status === "error",
                { timeout: 20000 },
            );
            ctx.expect((await editor.errorMessage).length > 0).toBe(true);
        } finally {
            await disconnectIfNeeded(ctx, pageId);
            await closeInspector(ctx, pageId);
        }
    }),
];
