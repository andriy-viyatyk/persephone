import { test } from "../../../lib/context.mjs";
import { closePage } from "../../editors/helpers.mjs";

const HUB_ID = "tools-hub-page";
const HUB_EDITOR = "tools-hub-view";
const TOOLSET_EDITOR = "toolset-view";

async function openHub(ctx) {
    const pagesBefore = await ctx.app.pages.all;
    const existed = pagesBefore.some((page) => page.id === HUB_ID);
    const previousTab = existed ? await ctx.app.pages[HUB_ID].editor.activeTab : undefined;
    await ctx.app.pages.showToolsHubPage({ tab: "tools" });
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages.all,
        (pages) => pages.some((page) => page.id === HUB_ID && page.editor === HUB_EDITOR),
    );
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages[HUB_ID].editor.activeTab,
        (activeTab) => activeTab === "tools",
    );
    return { existed, previousTab };
}

async function closeHub(ctx, ownership) {
    if (!ownership) return;
    if (ownership.existed) {
        try {
            if (ownership.previousTab) await ctx.app.pages[HUB_ID].editor.setTab(ownership.previousTab);
        } catch {
            // Preserve the test result if restoring the prior tab fails.
        }
        return;
    }
    try {
        await closePage(ctx, HUB_ID);
    } catch {
        // Preserve the test result; the runner also cleans up test-owned pages.
    }
}

async function closeNewPages(ctx, initialPageIds) {
    const pages = await ctx.app.pages.all;
    for (const page of pages) {
        if (initialPageIds.has(page.id) || page.id === HUB_ID) continue;
        try {
            await closePage(ctx, page.id);
        } catch {
            // Continue closing the remaining pages if one page cannot be closed.
        }
    }
}

async function removeFixtureDirectory(ctx, folder) {
    try {
        await ctx.app.fs.removeDir(folder, true);
    } catch {
        // A missing fixture directory is already clean.
    }
}

async function cancelPendingDialog(ctx) {
    try {
        // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
        await ctx.call("dialogs[0].cancel", [], { dialog: true });
    } catch {
        // There may be no pending dialog.
    }
}

async function createToolsetFixture(ctx, relativeFolder, name, manifest, scripts = {}) {
    const folder = ctx.fixture(relativeFolder);
    const root = `${folder}\\${name}`;
    await removeFixtureDirectory(ctx, folder);
    await ctx.app.fs.mkdir(root);
    await ctx.app.fs.write(`${root}\\tools-manifest.json`, JSON.stringify(manifest, null, 2));
    for (const [filename, source] of Object.entries(scripts)) {
        await ctx.app.fs.write(`${root}\\${filename}`, source);
    }
    return { folder, root };
}

function validManifest(name) {
    return {
        schemaVersion: 1,
        name,
        tools: [
            { name: "echo", description: "Echo fixture args", command: "node echo.js" },
            { name: "fail", description: "Return a fixture process failure", command: "node fail.js" },
        ],
    };
}

const echoScript = `let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
    const args = JSON.parse(input || "{}");
    process.stdout.write("##PERSEPHONE_RESULT##" + JSON.stringify({ received: args }) + "\\n");
});
`;

const failScript = `process.stderr.write("fixture failure\\n");
process.exitCode = 7;
`;

async function registerToolset(ctx, name, folder) {
    // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
    const pending = await ctx.call("tools.createToolset", [name, folder], { dialog: true });
    ctx.expect(pending.pending).toBe(true);
    const title = await ctx.waitFor(
        // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
        (activeContext) => activeContext.call("dialogs[0].title", [], { dialog: true }),
        (value) => value === "Register this toolset?",
    );
    ctx.expect(title).toBe("Register this toolset?");
    // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
    ctx.expect(await ctx.call("dialogs[0].toolsetName", [], { dialog: true })).toBe(name);
    const expectedRoot = `${folder}\\${name}`;
    // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
    ctx.expect(await ctx.call("dialogs[0].toolsetRoot", [], { dialog: true })).toBe(expectedRoot);
    // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
    ctx.expect(await ctx.call("dialogs[0].buttons", [], { dialog: true })).toEqual(["Cancel", "Register toolset"]);
    // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
    await ctx.call("dialogs[0].click", ["Register toolset"], { dialog: true });
    return expectedRoot;
}

async function openToolsetEditor(ctx, name, initialPageIds, cleanupState) {
    const hubOwnership = await openHub(ctx);
    cleanupState.hubOwnership = hubOwnership;
    await ctx.app.window.screen.click(`text=${JSON.stringify(name)}`);
    const pages = await ctx.waitFor(
        (activeContext) => activeContext.app.pages.all,
        (current) => current.some((page) => !initialPageIds.has(page.id) && page.editor === TOOLSET_EDITOR),
    );
    const toolsetPage = pages.find((page) => !initialPageIds.has(page.id) && page.editor === TOOLSET_EDITOR);
    await ctx.app.pages.showPage(toolsetPage.id);
    return { hubOwnership, toolsetPage };
}

async function cleanupToolsetTest(ctx, state) {
    await cancelPendingDialog(ctx);
    try {
        await closeNewPages(ctx, state.initialPageIds);
    } finally {
        try {
            await closeHub(ctx, state.hubOwnership);
        } finally {
            try {
                await ctx.app.tools.unregisterToolset(state.root);
            } catch {
                // Preserve the test result when the fixture was never registered.
            } finally {
                await removeFixtureDirectory(ctx, state.folder);
            }
        }
    }
}

async function expectRegistryRestored(ctx, beforeTools, name) {
    const afterTools = await ctx.waitFor(
        (activeContext) => activeContext.app.tools.search(""),
        (result) => !result.tools.some((tool) => tool.toolsetName === name || tool.id.startsWith(`${name}/`)),
    );
    ctx.expect(afterTools.tools.some((tool) => tool.toolsetName === name || tool.id.startsWith(`${name}/`))).toBe(false);
    ctx.expect(afterTools).toEqual(beforeTools);
}

export default [
    test("registered toolset is found by search and execute returns structured success and failure results", async (ctx) => {
        const name = "AgentToolsProbe";
        const folder = ctx.fixture("us-2073/execute");
        const root = `${folder}\\${name}`;
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        const beforeTools = await ctx.app.tools.search("");
        const cleanupState = { folder, root, initialPageIds };
        try {
            await createToolsetFixture(
                ctx,
                "us-2073/execute",
                name,
                validManifest(name),
                { "echo.js": echoScript, "fail.js": failScript },
            );
            await registerToolset(ctx, name, folder);

            const found = await ctx.waitFor(
                (activeContext) => activeContext.app.tools.search(name),
                (result) => result.tools.some((tool) => tool.id === `${name}/echo`)
                    && result.tools.some((tool) => tool.id === `${name}/fail`),
            );
            ctx.expect(found.tools.some((tool) => tool.id === `${name}/echo`)).toBe(true);
            ctx.expect(found.tools.some((tool) => tool.id === `${name}/fail`)).toBe(true);

            const args = { value: "fixture input", count: 3 };
            const success = await ctx.app.tools.execute(`${name}/echo`, args);
            ctx.expect(success.ok).toBe(true);
            ctx.expect(success.toolId).toBe(`${name}/echo`);
            ctx.expect(success.toolsetRoot).toBe(root);
            ctx.expect(success.result).toEqual({ received: args });

            const failure = await ctx.app.tools.execute(`${name}/fail`, { value: "failure case" });
            ctx.expect(failure.ok).toBe(false);
            ctx.expect(failure.toolId).toBe(`${name}/fail`);
            ctx.expect(failure.toolsetRoot).toBe(root);
            ctx.expect(failure.error).toContain("Tool exited with code 7.");
            ctx.expect(failure.exitCode).toBe(7);
            ctx.expect(failure.stderr).toContain("fixture failure");
        } finally {
            await cleanupToolsetTest(ctx, cleanupState);
        }
        await expectRegistryRestored(ctx, beforeTools, name);
    }),

    test("toolset editor shows a valid toolset and opens its execution log", async (ctx) => {
        const name = "AgentToolsEditorProbe";
        const folder = ctx.fixture("us-2073/editor");
        const root = `${folder}\\${name}`;
        const initialPages = await ctx.app.pages.all;
        const initialPageIds = new Set(initialPages.map((page) => page.id));
        const beforeTools = await ctx.app.tools.search("");
        const cleanupState = { folder, root, initialPageIds };
        try {
            await createToolsetFixture(
                ctx,
                "us-2073/editor",
                name,
                validManifest(name),
                { "echo.js": echoScript, "fail.js": failScript },
            );
            await registerToolset(ctx, name, folder);
            const success = await ctx.app.tools.execute(`${name}/echo`, { value: "log entry" });
            ctx.expect(success.ok).toBe(true);
            ctx.expect(success.result).toEqual({ received: { value: "log entry" } });

            const opened = await openToolsetEditor(ctx, name, initialPageIds, cleanupState);
            const toolsetPageId = opened.toolsetPage.id;
            const editor = ctx.app.pages[toolsetPageId].editor;
            ctx.expect(await editor.$help).toBeTruthy();
            ctx.expect(await editor.toolsetRoot).toBe(root);
            ctx.expect(await editor.toolsetName).toBe(name);
            ctx.expect(await editor.registered).toBe(true);
            ctx.expect(await editor.valid).toBe(true);
            ctx.expect(await editor.errors).toEqual([]);

            const snapshot = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot(),
                (value) => value.includes(name) && value.includes("echo")
                    && value.includes("Open Folder") && value.includes("Open Log"),
            );
            ctx.expect(snapshot).toContain(name);
            ctx.expect(snapshot).toContain("echo");
            ctx.expect(snapshot).toContain("Open Folder");
            ctx.expect(snapshot).toContain("Open Log");

            await editor.openLog();
            const pagesWithLog = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (pages) => pages.some((page) => !initialPageIds.has(page.id) && page.title === "tools-execution.log"),
            );
            const logPage = pagesWithLog.find((page) => !initialPageIds.has(page.id) && page.title === "tools-execution.log");
            // ctx.callText remains because the app stand-in cannot pass maxLength and exact text is required.
            const logContent = await ctx.waitFor(
                (activeContext) => activeContext.callText(
                    `pages[${JSON.stringify(logPage.id)}].content`,
                    [],
                    { maxLength: 2000000 },
                ),
                (value) => value.includes(`${name}/echo`),
            );
            ctx.expect(logContent).toContain(`${name}/echo`);
        } finally {
            await cleanupToolsetTest(ctx, cleanupState);
        }
        await expectRegistryRestored(ctx, beforeTools, name);
    }),

    test("invalid registered manifest shows the toolset editor error state", async (ctx) => {
        const name = "AgentToolsInvalid";
        const invalidManifest = {
            schemaVersion: 1,
            name,
            tools: [
                {
                    name: "invalid-schema",
                    description: "Tool with an invalid input schema",
                    command: "node missing.js",
                    inputSchema: "not an object",
                },
            ],
        };
        const folder = ctx.fixture("us-2073/invalid");
        const root = `${folder}\\${name}`;
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        const beforeTools = await ctx.app.tools.search("");
        const cleanupState = { folder, root, initialPageIds };
        try {
            await createToolsetFixture(ctx, "us-2073/invalid", name, invalidManifest);
            await registerToolset(ctx, name, folder);
            const opened = await openToolsetEditor(ctx, name, initialPageIds, cleanupState);

            const editor = ctx.app.pages[opened.toolsetPage.id].editor;
            ctx.expect(await editor.$help).toBeTruthy();
            ctx.expect(await editor.toolsetRoot).toBe(root);
            ctx.expect(await editor.toolsetName).toBe(name);
            ctx.expect(await editor.registered).toBe(true);
            ctx.expect(await editor.valid).toBe(false);
            const errors = await editor.errors;
            ctx.expect(errors).toContain("tools[0].inputSchema, if present, must be an object.");

            const snapshot = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot(),
                (value) => value.includes("This toolset's manifest has problems:")
                    && value.includes("tools[0].inputSchema, if present, must be an object."),
            );
            ctx.expect(snapshot).toContain("This toolset's manifest has problems:");
            ctx.expect(snapshot).toContain("tools[0].inputSchema, if present, must be an object.");
        } finally {
            await cleanupToolsetTest(ctx, cleanupState);
        }
        await expectRegistryRestored(ctx, beforeTools, name);
    }),
];
