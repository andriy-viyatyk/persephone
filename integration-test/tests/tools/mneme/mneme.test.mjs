import { test } from "../../../lib/context.mjs";
import path from "node:path";
import { closePage } from "../../editors/helpers.mjs";

const CONFIG_PAGE_ID = "mneme-config-page";
const CONFIG_EDITOR_ID = "mneme-config";
const INSPECTOR_EDITOR_ID = "mcp-view";
const ROOT_EDITOR_ID = "mneme-root";
const MNEME_PORT = 17700;
const ROOT_NAME = "us2075-fixture-root";
const FIXTURE_MARKER = "mneme fixture marker";

async function removeFixtureDirectory(ctx, folder) {
    try {
        await ctx.app.fs.removeDir(folder, true);
    } catch {
        // A missing fixture directory is already clean.
    }
}

async function openConfigPage(ctx) {
    await ctx.app.pages.showMnemeConfigPage();
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages.all,
        (pages) => pages.some((page) => page.id === CONFIG_PAGE_ID && page.editor === CONFIG_EDITOR_ID),
    );
}

async function enableMneme(ctx) {
    await ctx.app.settings.set("mneme.port", MNEME_PORT);
    await ctx.app.settings.set("mneme.enabled", true);
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages[CONFIG_PAGE_ID].editor.running,
        (running) => running === true,
        { timeout: 30000 },
    );
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages[CONFIG_PAGE_ID].editor.connectionStatus,
        (status) => status === "connected",
        { timeout: 30000 },
    );
}

async function closeOwnedPages(ctx, previousPageIds) {
    const pages = await ctx.app.pages.all;
    const ownedIds = pages.filter((page) => !previousPageIds.has(page.id)).map((page) => page.id);
    for (const pageId of ownedIds.reverse()) {
        try {
            await closePage(ctx, pageId);
        } catch {
            // Continue closing pages owned by this test.
        }
    }
}

async function disconnectInspector(ctx, pageId) {
    if (!pageId) return;
    try {
        const status = await ctx.app.pages[pageId].editor.connectionStatus;
        if (status !== "disconnected") await ctx.app.pages[pageId].editor.disconnect();
    } catch {
        // The inspector may already be disconnected or closing.
    }
}

async function findTreeRowRef(ctx, name) {
    const snapshot = await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.snapshot({ interactive: true }),
        (value) => value.split("\n").some((line) => line.includes("treeitem ") && line.includes(name) && /\[ref=e\d+\]/u.test(line)),
        { timeout: 15000 },
    );
    const line = snapshot.split("\n").find((entry) => entry.includes("treeitem ") && entry.includes(name) && /\[ref=e\d+\]/u.test(entry));
    const ref = line?.match(/\[ref=(e\d+)\]/u)?.[1];
    if (!ref) throw new Error(`Could not find the Mneme tree row for ${name}.`);
    return ref;
}

async function findPageId(ctx, previousPageIds, editorId) {
    const pages = await ctx.waitFor(
        (activeContext) => activeContext.app.pages.all,
        (currentPages) => currentPages.some((page) => !previousPageIds.has(page.id) && page.editor === editorId),
        { timeout: 15000 },
    );
    return pages.find((page) => !previousPageIds.has(page.id) && page.editor === editorId).id;
}

export default [
    test("Mneme Config opens stopped, starts on port 17700, and stops cleanly", async (ctx) => {
        const fixtureFolder = ctx.fixture("us-2075/config-lifecycle");
        const initialPages = await ctx.app.pages.all;
        const initialPageIds = new Set(initialPages.map((page) => page.id));
        const previousEnabled = await ctx.app.settings.get("mneme.enabled");
        const previousPort = await ctx.app.settings.get("mneme.port");
        let configPageOwned = false;

        try {
            await removeFixtureDirectory(ctx, fixtureFolder);
            await ctx.app.fs.mkdir(fixtureFolder);
            configPageOwned = !initialPageIds.has(CONFIG_PAGE_ID);
            await openConfigPage(ctx);

            const configEditor = ctx.app.pages[CONFIG_PAGE_ID].editor;
            const help = await configEditor.$help;
            ctx.expect(help).toContain("running");
            ctx.expect(await configEditor.running).toBe(false);

            await ctx.app.settings.set("mneme.port", MNEME_PORT);
            await ctx.app.settings.set("mneme.enabled", true);
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[CONFIG_PAGE_ID].editor.running,
                (running) => running === true,
                { timeout: 30000 },
            );
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[CONFIG_PAGE_ID].editor.connectionStatus,
                (status) => status === "connected",
                { timeout: 30000 },
            );
            ctx.expect(await configEditor.url).toContain(`:${MNEME_PORT}/`);
        } finally {
            try {
                await ctx.app.settings.set("mneme.enabled", false);
                await ctx.waitFor(
                    (activeContext) => activeContext.app.pages[CONFIG_PAGE_ID].editor.running,
                    (running) => running === false,
                    { timeout: 30000 },
                );
            } catch {
                // Continue restoring the previous settings if stopping fails.
            }
            try {
                await ctx.app.settings.set("mneme.port", previousPort);
            } catch {
                // Continue restoring the enabled setting if port restoration fails.
            }
            try {
                await ctx.app.settings.set("mneme.enabled", previousEnabled);
            } catch {
                // Preserve the test failure if settings restoration is unavailable.
            }
            await removeFixtureDirectory(ctx, fixtureFolder);
            if (configPageOwned) await closePage(ctx, CONFIG_PAGE_ID);
        }
    }, { requires: ["mneme"] }),

    test("Mneme Root browses, searches, and opens a fixture document", async (ctx) => {
        const fixtureFolder = ctx.fixture("us-2075/root");
        const notesFolder = path.join(fixtureFolder, "notes");
        const documentPath = path.join(notesFolder, "mneme-fixture.md");
        const initialPages = await ctx.app.pages.all;
        const initialPageIds = new Set(initialPages.map((page) => page.id));
        const previousEnabled = await ctx.app.settings.get("mneme.enabled");
        const previousPort = await ctx.app.settings.get("mneme.port");
        const configPageOwned = !initialPageIds.has(CONFIG_PAGE_ID);
        let inspectorPageId;
        let rootPageId;
        let rootRegistered = false;

        try {
            await removeFixtureDirectory(ctx, fixtureFolder);
            await ctx.app.fs.mkdir(notesFolder);
            await ctx.app.fs.write(documentPath, `# Mneme fixture\n\n${FIXTURE_MARKER}\n`);
            await openConfigPage(ctx);
            await enableMneme(ctx);

            const beforeInspectorIds = new Set((await ctx.app.pages.all).map((page) => page.id));
            await ctx.app.window.screen.click('[data-name="mneme-open-mcp-inspector"]');
            inspectorPageId = await findPageId(ctx, beforeInspectorIds, INSPECTOR_EDITOR_ID);
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[inspectorPageId].editor.connectionStatus,
                (status) => status === "connected",
                { timeout: 30000 },
            );

            const inspector = ctx.app.pages[inspectorPageId].editor;
            // ctx.call remains because the app stand-in cannot pass call options such as maxLength; tool schemas are long.
            const tools = await ctx.call(`pages[${JSON.stringify(inspectorPageId)}].editor.tools`, undefined, { maxLength: 2000000 });
            ctx.expect(tools.some((tool) => tool.name === "add_root")).toBe(true);
            await ctx.app.window.screen.click('text="Tools"');
            await ctx.app.window.screen.click('text="add_root"', { nth: 0 });
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[inspectorPageId].editor.selectedTool,
                (tool) => tool?.name === "add_root",
            );

            await ctx.app.window.screen.type('[data-name="mcp-arg-folder"] [data-type="textarea"]', fixtureFolder);
            await ctx.app.window.screen.type('[data-name="mcp-arg-name"] [data-type="textarea"]', ROOT_NAME);
            await ctx.app.window.screen.click('[data-name="mcp-call-tool"]');

            const addRootResult = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[inspectorPageId].editor.toolResult,
                (result) => result && typeof result.isError === "boolean",
                { timeout: 30000 },
            );
            ctx.expect(addRootResult.isError).toBe(false);
            rootRegistered = true;

            const configEditor = ctx.app.pages[CONFIG_PAGE_ID].editor;
            await configEditor.refresh();
            const registeredRoot = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[CONFIG_PAGE_ID].editor.roots,
                (roots) => roots?.some((root) => root.name === ROOT_NAME && root.folder === fixtureFolder && root.docCount === 1),
                { timeout: 30000 },
            );
            const rootStatus = registeredRoot.find((root) => root.name === ROOT_NAME);
            ctx.expect(rootStatus.folder).toBe(fixtureFolder);
            ctx.expect(rootStatus.docCount).toBe(1);

            const beforeRootIds = new Set((await ctx.app.pages.all).map((page) => page.id));
            // The Inspector page is active and shows the root name in its tool result; open the Config page first.
            await ctx.app.pages.showPage(CONFIG_PAGE_ID);
            await ctx.app.window.screen.click(`text="${ROOT_NAME}"`);
            rootPageId = await findPageId(ctx, beforeRootIds, ROOT_EDITOR_ID);
            const rootEditor = ctx.app.pages[rootPageId].editor;
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[rootPageId].editor.resolving,
                (resolving) => resolving === false,
                { timeout: 30000 },
            );
            ctx.expect(await rootEditor.rootFolder).toBe(fixtureFolder);
            ctx.expect(await rootEditor.rootName).toBe(ROOT_NAME);

            await rootEditor.setMode("text");
            await rootEditor.setQuery(FIXTURE_MARKER);
            await rootEditor.runSearch();
            const searchResults = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[rootPageId].editor.results,
                (results) => results?.some((result) => result.uri.endsWith("/notes/mneme-fixture.md")),
                { timeout: 30000 },
            );
            ctx.expect(searchResults.some((result) => result.uri.endsWith("/notes/mneme-fixture.md"))).toBe(true);
            const notesRef = await findTreeRowRef(ctx, "notes");
            await ctx.app.window.screen.click({ ref: notesRef });
            // A row click selects the folder; ArrowRight expands it (assets/guides/mneme.md).
            await ctx.app.window.screen.pressKey("ArrowRight");
            const documentRef = await findTreeRowRef(ctx, "mneme-fixture.md");
            await ctx.app.window.screen.click({ ref: documentRef });
            // A document opens in the same page, which navigates from Mneme Root to the Markdown view.
            const documentPage = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (pages) => pages.some((page) => page.id === rootPageId && page.title.includes("mneme-fixture.md")),
                { timeout: 15000 },
            );
            ctx.expect(documentPage.some((page) => page.id === rootPageId && page.title.includes("mneme-fixture.md"))).toBe(true);
        } finally {
            await disconnectInspector(ctx, inspectorPageId);
            // Keep the Config page open until the root is removed and the service stopped.
            await closeOwnedPages(ctx, new Set([...initialPageIds, CONFIG_PAGE_ID]));
            try {
                const pages = await ctx.app.pages.all;
                if (rootRegistered && pages.some((page) => page.id === CONFIG_PAGE_ID)) {
                    // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
                    const pending = await ctx.call(`pages[${JSON.stringify(CONFIG_PAGE_ID)}].editor.removeRoot`, [ROOT_NAME], { dialog: true });
                    ctx.expect(pending.pending).toBe(true);
                    if (pending?.pending) {
                        await ctx.waitFor(
                            (activeContext) => activeContext.call("dialogs[0].title", undefined, { dialog: true }),
                            (title) => title === "Remove root",
                        );
                        // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
                        await ctx.call("dialogs[0].click", ["Remove"], { dialog: true });
                        await ctx.waitFor(
                            (activeContext) => activeContext.app.pages[CONFIG_PAGE_ID].editor.roots,
                            (roots) => !roots?.some((root) => root.name === ROOT_NAME),
                            { timeout: 30000 },
                        );
                    }
                }
            } catch {
                // Continue restoring settings and fixture state if root cleanup fails.
            }
            try {
                await ctx.app.settings.set("mneme.enabled", false);
                await ctx.waitFor(
                    (activeContext) => activeContext.app.pages[CONFIG_PAGE_ID].editor.running,
                    (running) => running === false,
                    { timeout: 30000 },
                );
            } catch {
                // Continue restoring both settings if the service does not stop cleanly.
            }
            try {
                await ctx.app.settings.set("mneme.port", previousPort);
            } catch {
                // Continue restoring the enabled setting if port restoration fails.
            }
            try {
                await ctx.app.settings.set("mneme.enabled", previousEnabled);
            } catch {
                // Preserve the test result if the enabled setting cannot be restored.
            }
            await removeFixtureDirectory(ctx, fixtureFolder);
            await closeOwnedPages(ctx, configPageOwned ? initialPageIds : new Set([...initialPageIds, CONFIG_PAGE_ID]));
        }
    }, { requires: ["mneme"] }),
];
