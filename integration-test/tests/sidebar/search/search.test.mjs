import { test } from "../../../lib/context.mjs";
import {
    chooseTreeMenuItem,
    closeExplorerFixture,
    openTreeContextMenu,
    openExplorerFixture,
} from "../../helpers/sidebar-helpers.mjs";
import { shellPagePath } from "../../helpers/shell-helpers.mjs";

export default [
    test("Explorer name search filters entries and restores expanded folders when cleared", async (ctx) => {
        const fixture = await openExplorerFixture(ctx, "us-2040/search-file-names", {
            "matching-notes.txt": "Matching filename.\n",
            "unrelated.txt": "This filename should be filtered out.\n",
            "nested/inside.txt": "Nested file should reappear after clearing search.\n",
        });
        try {
            await ctx.call(`${fixture.pageRoot}panels.explorer.expand`, [ctx.fixture("us-2040/search-file-names/nested")]);
            const expandedSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => snapshot.includes('treeitem "inside.txt"'),
            );
            ctx.expect(expandedSnapshot).toContain('treeitem "inside.txt"');

            await ctx.call("window.screen.pressKey", ["Control+f", { target: '[data-type="tree-provider-view"]' }]);
            await ctx.call("window.screen.type", ['[data-name="tree-provider-search-input"] input', "matching"]);

            const filteredSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => snapshot.includes('treeitem "matching-notes.txt"'),
            );
            ctx.expect(filteredSnapshot).toContain('treeitem "matching-notes.txt"');
            ctx.expect(filteredSnapshot.includes('treeitem "unrelated.txt"')).toBe(false);
            ctx.expect(filteredSnapshot.includes('treeitem "inside.txt"')).toBe(false);

            await ctx.call("window.screen.pressKey", ["Escape"]);
            const restoredSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => snapshot.includes('treeitem "unrelated.txt"'),
            );
            ctx.expect(restoredSnapshot).toContain('treeitem "matching-notes.txt"');
            ctx.expect(restoredSnapshot).toContain('treeitem "unrelated.txt"');
            ctx.expect(restoredSnapshot).toContain('treeitem "inside.txt"');
        } finally {
            await closeExplorerFixture(ctx, fixture);
        }
    }),

    test("Search in Folder limits content results to the selected folder", async (ctx) => {
        const fixture = await openExplorerFixture(ctx, "us-2040/search-folder-scope", {
            "inside-only/inside.txt": "A shared scope-token is here.\n",
            "outside.txt": "A shared scope-token is outside the folder.\n",
        });
        const searchPath = shellPagePath(fixture.pageId, "panels.search");
        const scopeFolder = ctx.fixture("us-2040/search-folder-scope/inside-only");
        const insideFile = ctx.fixture("us-2040/search-folder-scope/inside-only/inside.txt");
        try {
            await openTreeContextMenu(ctx, "inside-only");
            await chooseTreeMenuItem(ctx, "search-in-folder");
            await ctx.waitFor(`${fixture.pageRoot}panels.search`, Boolean);
            ctx.expect(await ctx.waitFor(`${searchPath}.searchFolder`, (folder) => folder === scopeFolder)).toBe(scopeFolder);

            await ctx.call("window.screen.type", ['[data-type="file-search"] .fs-query-row input', "scope-token"]);
            const results = await ctx.waitFor(
                (activeContext) => activeContext.call(`${searchPath}.results`),
                (rows) => rows?.some((row) => row.type === "line" && row.lineText.includes("scope-token")),
            );
            const files = results.filter((row) => row.type === "file").map((row) => row.filePath);
            ctx.expect(files).toEqual([insideFile]);
            ctx.expect(files.includes(ctx.fixture("us-2040/search-folder-scope/outside.txt"))).toBe(false);
        } finally {
            await closeExplorerFixture(ctx, fixture);
        }
    }),

    test("content search lists matching files and lines and opens a result at its matching line", async (ctx) => {
        const fixture = await openExplorerFixture(ctx, "us-2040/search-content-results", {
            "match.txt": "First line.\nSecond line has needle-token.\nThird line.\n",
            "other.txt": "No matching phrase is in this file.\n",
        });
        const searchPath = shellPagePath(fixture.pageId, "panels.search");
        const matchPath = ctx.fixture("us-2040/search-content-results/match.txt");
        try {
            await ctx.call(`${fixture.pageRoot}panels.explorer.openSearch`, []);
            await ctx.waitFor(`${fixture.pageRoot}panels.search`, Boolean);
            await ctx.call("window.screen.type", ['[data-type="file-search"] .fs-query-row input', "needle-token"]);

            const results = await ctx.waitFor(
                (activeContext) => activeContext.call(`${searchPath}.results`),
                (rows) => rows?.some((row) => row.type === "line" && row.lineText.includes("needle-token")),
            );
            const fileRows = results.filter((row) => row.type === "file");
            const matchingLines = results.filter((row) => row.type === "line");
            ctx.expect(fileRows.map((row) => row.fileName)).toEqual(["match.txt"]);
            ctx.expect(matchingLines.map((row) => row.lineNumber)).toEqual([2]);
            ctx.expect(matchingLines[0].lineText).toBe("Second line has needle-token.");

            await ctx.call("window.screen.click", ['[data-type="file-search"] .fs-line-row']);
            await ctx.waitFor(shellPagePath(fixture.pageId, "filePath"), (filePath) => filePath === matchPath);
            ctx.expect(await ctx.call(`${shellPagePath(fixture.pageId, "editor")}.getCursorPosition`, [])).toEqual({ lineNumber: 2, column: 1 });
            ctx.expect(await ctx.callText(shellPagePath(fixture.pageId, "content"))).toBe("First line.\nSecond line has needle-token.\nThird line.\n");
        } finally {
            await closeExplorerFixture(ctx, fixture);
        }
    }),

    test("content search shows the empty state when the fixture has no matches", async (ctx) => {
        const fixture = await openExplorerFixture(ctx, "us-2040/search-no-results", {
            "present.txt": "The fixture contains different text.\n",
        });
        const searchPath = shellPagePath(fixture.pageId, "panels.search");
        try {
            await ctx.call(`${fixture.pageRoot}panels.explorer.openSearch`, []);
            await ctx.waitFor(`${fixture.pageRoot}panels.search`, Boolean);
            await ctx.call("window.screen.type", ['[data-type="file-search"] .fs-query-row input', "missing-needle"]);

            const emptyState = await ctx.waitFor(
                (activeContext) => activeContext.call("window.screen.evaluate", [
                    "() => { const empty = document.querySelector('[data-type=\"file-search\"] .fs-empty'); return empty ? { text: empty.textContent, hidden: empty.hasAttribute('data-hidden'), visible: getComputedStyle(empty).display !== 'none' } : null; }",
                ]),
                (state) => state?.text === "No results found" && !state.hidden && state.visible,
            );
            ctx.expect(await ctx.call(`${searchPath}.results`)).toEqual([]);
            ctx.expect(await ctx.call(`${searchPath}.totalFiles`)).toBe(0);
            ctx.expect(emptyState.text).toBe("No results found");
        } finally {
            await closeExplorerFixture(ctx, fixture);
        }
    }),

    test("content search Include and Exclude globs narrow matching files", async (ctx) => {
        const fixture = await openExplorerFixture(ctx, "us-2040/search-glob-filters", {
            "plain.txt": "The shared filter-token appears here.\n",
            "match.md": "The shared filter-token appears here too.\n",
            "excluded/match.md": "The shared filter-token is inside the excluded folder.\n",
        });
        const searchPath = shellPagePath(fixture.pageId, "panels.search");
        const rootText = ctx.fixture("us-2040/search-glob-filters/plain.txt");
        const rootMarkdown = ctx.fixture("us-2040/search-glob-filters/match.md");
        const nestedMarkdown = ctx.fixture("us-2040/search-glob-filters/excluded/match.md");
        const filePaths = (rows) => rows.filter((row) => row.type === "file").map((row) => row.filePath).sort();
        try {
            await ctx.call(`${fixture.pageRoot}panels.explorer.openSearch`, []);
            await ctx.waitFor(`${fixture.pageRoot}panels.search`, Boolean);
            await ctx.call("window.screen.click", ['[data-type="file-search"] .fs-query-row button']);
            await ctx.call("window.screen.type", ['[data-type="file-search"] .fs-query-row input', "filter-token"]);

            const unfiltered = await ctx.waitFor(
                (activeContext) => activeContext.call(`${searchPath}.results`),
                (rows) => rows?.filter((row) => row.type === "file").length === 3,
            );
            ctx.expect(filePaths(unfiltered)).toEqual([rootText, rootMarkdown, nestedMarkdown].sort());

            await ctx.call("window.screen.type", ['[data-type="file-search"] input[placeholder^="Include"]', "*.md"]);
            const included = await ctx.waitFor(
                (activeContext) => activeContext.call(`${searchPath}.results`),
                (rows) => rows?.filter((row) => row.type === "file").length === 2,
            );
            ctx.expect(await ctx.waitFor(`${searchPath}.includePattern`, (pattern) => pattern === "*.md")).toBe("*.md");
            ctx.expect(filePaths(included)).toEqual([rootMarkdown, nestedMarkdown].sort());

            await ctx.call("window.screen.type", ['[data-type="file-search"] input[placeholder^="Exclude"]', "excluded"]);
            const excluded = await ctx.waitFor(
                (activeContext) => activeContext.call(`${searchPath}.results`),
                (rows) => rows?.filter((row) => row.type === "file").length === 1,
            );
            ctx.expect(await ctx.waitFor(`${searchPath}.excludePattern`, (pattern) => pattern === "excluded")).toBe("excluded");
            ctx.expect(filePaths(excluded)).toEqual([rootMarkdown]);
        } finally {
            await closeExplorerFixture(ctx, fixture);
        }
    }),
];
