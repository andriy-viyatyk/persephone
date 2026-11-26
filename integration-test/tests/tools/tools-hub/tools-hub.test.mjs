import path from "node:path";
import { test } from "../../../lib/context.mjs";

const HUB_ID = "tools-hub-page";
const HUB_EDITOR = "tools-hub-view";

async function openHub(ctx, tab) {
    const pagesBefore = await ctx.app.pages.all;
    const existed = pagesBefore.some((page) => page.id === HUB_ID);
    const previousTab = existed ? await ctx.app.pages[HUB_ID].editor.activeTab : undefined;
    await ctx.app.pages.showToolsHubPage({ tab });
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages.all,
        (pages) => pages.some((page) => page.id === HUB_ID && page.editor === HUB_EDITOR),
    );
    return { existed, previousTab };
}

async function closePage(ctx, pageId) {
    if (!pageId) return;
    try {
        const closed = await ctx.app.pages.closePage(pageId);
        if (closed) {
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (pages) => !pages.some((page) => page.id === pageId),
            );
        }
    } catch {
        // Keep cleanup from replacing the test's original assertion or error.
    }
}

async function closeHub(ctx, ownership) {
    if (!ownership) return;
    if (ownership.existed) {
        try {
            if (ownership.previousTab) await ctx.app.pages[HUB_ID].editor.setTab(ownership.previousTab);
        } catch {
            // Preserve the test's original result if restoring the prior tab fails.
        }
        return;
    }
    await closePage(ctx, HUB_ID);
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
        await ctx.call("dialogs[0].cancel", [], { dialog: true });
    } catch {
        // There may be no dialog to cancel.
    }
}

export default [
    test("Tools & Editors hub opens and its tabs follow API and button selection", async (ctx) => {
        let hubOwnership;
        try {
            hubOwnership = await openHub(ctx, "editors");
            const hubPage = (await ctx.app.pages.all).find((page) => page.id === HUB_ID);
            ctx.expect(hubPage.editor).toBe(HUB_EDITOR);
            ctx.expect(await ctx.app.pages[HUB_ID].editor.activeTab).toBe("editors");

            for (const tab of ["search", "tools", "site-extensions"]) {
                await ctx.app.pages[HUB_ID].editor.setTab(tab);
                ctx.expect(await ctx.app.pages[HUB_ID].editor.activeTab).toBe(tab);
            }

            for (const [label, tab] of [
                ["Editors", "editors"],
                ["Search boards", "search"],
                ["Tools", "tools"],
                ["Site extensions", "site-extensions"],
            ]) {
                await ctx.app.window.screen.click(`text=${JSON.stringify(label)}`);
                await ctx.waitFor(
                    (activeContext) => activeContext.app.pages[HUB_ID].editor.activeTab,
                    (activeTab) => activeTab === tab,
                );
            }
            ctx.expect(await ctx.app.pages[HUB_ID].editor.activeTab).toBe("site-extensions");
        } finally {
            await closeHub(ctx, hubOwnership);
        }
    }),

    test("Editors tab lists built-in editors and creates a JSON Grid page", async (ctx) => {
        const initialPages = await ctx.app.pages.all;
        const initialIds = new Set(initialPages.map((page) => page.id));
        let hubOwnership;
        let createdPageId;
        try {
            hubOwnership = await openHub(ctx, "editors");
            const snapshot = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot({ interactive: true }),
                (value) => ["Grid (JSON)", "Grid (CSV)", "Links"].every((label) => value.includes(label)),
            );
            for (const label of ["Grid (JSON)", "Grid (CSV)", "Links"]) {
                ctx.expect(snapshot).toContain(label);
            }

            await ctx.app.window.screen.click(`text=${JSON.stringify("Grid (JSON)")}`);
            const pagesAfterCreate = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (pages) => pages.find((page) => !initialIds.has(page.id) && page.editor === "grid-json"),
            );
            // waitFor returns the polled value (the page list), not the predicate's result.
            const createdPage = pagesAfterCreate.find((page) => !initialIds.has(page.id) && page.editor === "grid-json");
            createdPageId = createdPage.id;
            ctx.expect(createdPage.title).toBe("untitled.grid.json");
            ctx.expect(createdPage.editor).toBe("grid-json");
        } finally {
            await closePage(ctx, createdPageId);
            await closeHub(ctx, hubOwnership);
        }
    }),

    test("Tools tab lists a fixture toolset and unregister removes it", async (ctx) => {
        const folder = ctx.fixture("us-2067/toolsets");
        const root = path.join(folder, "ToolsHubProbe");
        let hubOwnership;
        try {
            await removeFixtureDirectory(ctx, folder);
            hubOwnership = await openHub(ctx, "editors");
            await ctx.app.pages[HUB_ID].editor.setTab("tools");
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[HUB_ID].editor.activeTab,
                (activeTab) => activeTab === "tools",
            );

            const pending = await ctx.call("tools.createToolset", ["ToolsHubProbe", folder], { dialog: true });
            ctx.expect(pending.pending).toBe(true);
            await ctx.waitFor(
                (activeContext) => activeContext.call("dialogs[0].title", undefined, { dialog: true }),
                (title) => title === "Register this toolset?",
            );
            ctx.expect(await ctx.call("dialogs[0].toolsetName", undefined, { dialog: true })).toBe("ToolsHubProbe");
            ctx.expect(await ctx.call("dialogs[0].toolsetRoot", undefined, { dialog: true })).toBe(root);
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Cancel", "Register toolset"]);
            await ctx.call("dialogs[0].click", ["Register toolset"], { dialog: true });

            const searchResult = await ctx.waitFor(
                (activeContext) => activeContext.app.tools.search(""),
                (result) => result.tools.some((tool) => tool.id === "ToolsHubProbe/echo"),
            );
            ctx.expect(searchResult.tools.some((tool) => tool.id === "ToolsHubProbe/echo")).toBe(true);
            const snapshot = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot(),
                (value) => value.includes("ToolsHubProbe"),
            );
            ctx.expect(snapshot).toContain("ToolsHubProbe");

            await ctx.app.tools.unregisterToolset(root);
            const afterUnregister = await ctx.waitFor(
                (activeContext) => activeContext.app.tools.search(""),
                (result) => !result.tools.some((tool) => tool.id === "ToolsHubProbe/echo"),
            );
            ctx.expect(afterUnregister.tools.some((tool) => tool.id === "ToolsHubProbe/echo")).toBe(false);
        } finally {
            await cancelPendingDialog(ctx);
            try {
                await ctx.app.tools.unregisterToolset(root);
            } catch {
                // Preserve the test failure when the fixture was never registered.
            }
            await removeFixtureDirectory(ctx, folder);
            await closeHub(ctx, hubOwnership);
        }
    }),

    test("Site Extensions tab lists an untrusted local fixture", async (ctx) => {
        const folder = ctx.fixture("us-2067/site-extensions");
        const extensionId = "tools-hub-probe";
        const previousPath = await ctx.app.settings.get("site-extensions.path");
        let hubOwnership;
        let created = false;
        try {
            await removeFixtureDirectory(ctx, folder);
            await ctx.app.settings.set("site-extensions.path", folder);
            const result = await ctx.app.siteExtensions.create(extensionId, {
                name: "Tools Hub Probe",
                hosts: ["tools-hub-probe.example.test"],
            });
            created = true;
            ctx.expect(result.id).toBe(extensionId);
            ctx.expect(result.requiresTrust).toBe(true);
            ctx.expect(await ctx.app.fs.exists(result.manifestPath)).toBe(true);
            await ctx.waitFor(
                (activeContext) => activeContext.app.siteExtensions.list(),
                (entries) => entries.some((entry) => entry.id === extensionId && entry.status === "valid" && entry.trustState === "untrusted"),
            );

            hubOwnership = await openHub(ctx, "editors");
            await ctx.app.pages[HUB_ID].editor.setTab("site-extensions");
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[HUB_ID].editor.activeTab,
                (activeTab) => activeTab === "site-extensions",
            );
            const snapshot = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot(),
                (value) => value.includes("Tools Hub Probe") && value.includes("not trusted"),
            );
            ctx.expect(snapshot).toContain("Tools Hub Probe");
            ctx.expect(snapshot).toContain("not trusted");
        } finally {
            await cancelPendingDialog(ctx);
            if (created) {
                try {
                    const pending = await ctx.call("siteExtensions.remove", [extensionId], { dialog: true });
                    ctx.expect(pending.pending).toBe(true);
                    await ctx.waitFor(
                        (activeContext) => activeContext.call("dialogs[0].title", undefined, { dialog: true }),
                        (title) => title === "Remove site extension",
                    );
                    ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Delete", "Cancel"]);
                    await ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
                    await ctx.waitFor(
                        (activeContext) => activeContext.app.siteExtensions.list(),
                        (entries) => !entries.some((entry) => entry.id === extensionId),
                    );
                } catch {
                    // Preserve the test failure; direct fixture cleanup follows.
                }
            }
            await removeFixtureDirectory(ctx, folder);
            try {
                await ctx.app.settings.set("site-extensions.path", previousPath);
            } catch {
                // Preserve the test failure if the setting cannot be restored.
            }
            await closeHub(ctx, hubOwnership);
        }
    }),

    test("Search boards shows the no-catalog state and keeps a typed query", async (ctx) => {
        let hubOwnership;
        try {
            hubOwnership = await openHub(ctx, "search");
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[HUB_ID].editor.activeTab,
                (activeTab) => activeTab === "search",
            );
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(
                    "() => Boolean(document.querySelector('[data-name=\"search-boards-filter\"]'))",
                ),
                Boolean,
            );
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot(),
                (snapshot) => snapshot.includes("No published boards available."),
            );

            // data-name sits on the Input wrapper; type into its <input>.
            const filter = '[data-name="search-boards-filter"] input';
            await ctx.app.window.screen.type(filter, "alpha");
            // The seed has an empty catalog, so a query keeps the no-catalog message
            // (SearchBoardsTab.renderCards checks entries before filtered results).
            const typed = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(
                    "() => document.querySelector('[data-name=\"search-boards-filter\"] input')?.value",
                ),
                (value) => value === "alpha",
            );
            ctx.expect(typed).toBe("alpha");
            const stillEmpty = await ctx.app.window.screen.snapshot();
            ctx.expect(stillEmpty).toContain("No published boards available.");

            await ctx.app.window.screen.clear(filter);
            const emptyAgain = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot(),
                (snapshot) => snapshot.includes("No published boards available."),
            );
            ctx.expect(emptyAgain).toContain("No published boards available.");
        } finally {
            await closeHub(ctx, hubOwnership);
        }
    }),
];
