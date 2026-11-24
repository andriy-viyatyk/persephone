import { test } from "../../../lib/context.mjs";

const openedPageFiles = [
    {
        name: "notes.txt",
        content: "Text page session content.\n",
        editor: "monaco",
    },
    {
        name: "table.grid.csv",
        content: "name,count\nalpha,3\nbeta,5\n",
        editor: "grid-csv",
    },
    {
        name: "readme.md",
        content: "# Markdown session content\n\nRestored preview body.\n",
        editor: "md-view",
    },
];

async function waitForPage(ctx, title, editor) {
    const pages = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (currentPages) => currentPages.find((page) => page.title === title && page.editor === editor));
    return pages.find((page) => page.title === title && page.editor === editor);
}

async function closeOwnedPages(ctx, pageIds) {
    const pages = await ctx.app.pages.all;
    for (const page of pages.filter((candidate) => pageIds.has(candidate.id))) {
        if (page.pinned || page.pinSide) await ctx.app.pages.unpinTab(page.id);
        const closed = await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("pages.closePage", [page.id], { dialog: true });
        if (closed?.pending) {
            await ctx.waitFor(
                (activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }),
                (title) => title === "Unsaved Changes",
            );
            await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("dialogs[0].click", ["Don't Save"], { dialog: true });
        }
        await ctx.waitFor((activeContext) => activeContext.app.pages.all, (remaining) => !remaining.some((candidate) => candidate.id === page.id));
    }
}

async function waitForSavedSession(ctx, matches) {
    const sessionPath = await ctx.app.fs.resolveDataPath("openFiles0.json");
    await ctx.waitFor((activeContext) => activeContext.app.fs.exists(sessionPath), Boolean);
    const savedText = await ctx.waitFor(
        (activeContext) => activeContext.callText("fs.read", [sessionPath], { maxLength: 50000 }),
        (text) => {
            try {
                return matches(JSON.parse(text));
            } catch {
                return false;
            }
        },
    );
    ctx.expect(typeof savedText).toBe("string");
}

export default [
    test("a named normal window keeps its name after an app restart", async (ctx) => {
        const name = "us2189-restart-window";
        try {
            await ctx.set("windows[0].name", name);
            await ctx.restartApp();
            const restored = await ctx.waitFor("windows[0].name", (value) => value === name);
            ctx.expect(restored).toBe(name);
            const selected = await ctx.call("windows.selectTestWindow", [`name:${name}`]);
            ctx.expect(selected.index).toBe(0);
        } finally {
            try { await ctx.set("windows[0].name", null); } catch { /* Restart failures leave no live target to clear. */ }
        }
    }, { requires: ["launch"] }),

    test("text, grid, markdown, grouped, untitled, active, and pinned pages restore after restart", async (ctx) => {
        const fixtureDirectory = "us-2030-page-session";
        const pageIds = new Set();
        const filePaths = openedPageFiles.map(({ name }) => ctx.fixture(`${fixtureDirectory}/${name}`));
        let untitledPageId;
        const untitledContent = "Unsaved untitled session edit.\n";

        try {
            for (let index = 0; index < openedPageFiles.length; index += 1) {
                await ctx.app.fs.write(filePaths[index], openedPageFiles[index].content);
            }

            const filePages = [];
            for (let index = 0; index < openedPageFiles.length; index += 1) {
                const expected = openedPageFiles[index];
                await ctx.app.pages.openFile(filePaths[index]);
                const opened = await waitForPage(ctx, expected.name, expected.editor);
                pageIds.add(opened.id);
                filePages.push(opened);
            }

            await ctx.app.pages.group(filePages[0].id, filePages[2].id);
            ctx.expect(await ctx.app.pages.isGrouped(filePages[0].id)).toBe(true);
            ctx.expect(await ctx.app.pages.isGrouped(filePages[2].id)).toBe(true);

            await ctx.app.pages.pinTab(filePages[1].id, "left");
            ctx.expect(await ctx.app.pages[filePages[1].id].pinned).toBe(true);

            await ctx.app.pages.addEmptyPage();
            const pagesAfterUntitled = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.find((page) => page.title === "untitled" && !pageIds.has(page.id)));
            const untitledPage = pagesAfterUntitled.find((page) => page.title === "untitled" && !pageIds.has(page.id));
            untitledPageId = untitledPage.id;
            pageIds.add(untitledPageId);
            await ctx.app.pages.showPage(untitledPageId);
            await ctx.script(`page.content = ${JSON.stringify(untitledContent)};`);
            ctx.expect(await ctx.app.pages[untitledPageId].modified).toBe(true);
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(untitledPageId)}].content`)).toBe(untitledContent);

            const activePageId = filePages[2].id;
            await ctx.app.pages.showPage(activePageId);
            ctx.expect((await ctx.app.pages.all).find((page) => page.active).id).toBe(activePageId);

            await waitForSavedSession(ctx, (state) => {
                const savedIds = new Set(state.pages.map((page) => page.id));
                const hasGroup = state.groupings.some(([leftId, rightId]) =>
                    (leftId === filePages[0].id && rightId === filePages[2].id)
                    || (leftId === filePages[2].id && rightId === filePages[0].id));
                const savedGrid = state.pages.find((page) => page.id === filePages[1].id);
                return [...pageIds].every((id) => savedIds.has(id))
                    && state.activePageId === activePageId
                    && hasGroup
                    && (savedGrid?.pinSide === "left" || savedGrid?.pinned === true);
            });

            await ctx.restartApp();

            const restoredPages = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => openedPageFiles.every(({ name, editor }) => pages.some((page) => page.title === name && page.editor === editor))
                    && pages.some((page) => page.id === untitledPageId && page.modified));
            for (let index = 0; index < openedPageFiles.length; index += 1) {
                const expected = openedPageFiles[index];
                const restored = restoredPages.find((page) => page.title === expected.name);
                ctx.expect(restored.editor).toBe(expected.editor);
                const content = await ctx.waitFor(
                    (activeContext) => activeContext.callText(`pages[${JSON.stringify(restored.id)}].content`),
                    (value) => value === expected.content,
                );
                ctx.expect(content).toBe(expected.content);
            }

            const restoredText = restoredPages.find((page) => page.title === openedPageFiles[0].name);
            const restoredMarkdown = restoredPages.find((page) => page.title === openedPageFiles[2].name);
            ctx.expect(await ctx.app.pages.isGrouped(restoredText.id)).toBe(true);
            const groupedPartner = await ctx.app.pages.getGroupedPage(restoredText.id);
            ctx.expect(groupedPartner.id).toBe(restoredMarkdown.id);

            const restoredGrid = restoredPages.find((page) => page.title === openedPageFiles[1].name);
            ctx.expect(restoredGrid.pinned).toBe(true);

            const restoredUntitled = restoredPages.find((page) => page.id === untitledPageId);
            ctx.expect(restoredUntitled.title).toBe("untitled");
            ctx.expect(restoredUntitled.modified).toBe(true);
            const restoredUntitledContent = await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(untitledPageId)}].content`),
                (value) => value === untitledContent,
            );
            ctx.expect(restoredUntitledContent).toBe(untitledContent);
            ctx.expect(restoredPages.find((page) => page.active).id).toBe(activePageId);
        } finally {
            await closeOwnedPages(ctx, pageIds);
        }
    }, { requires: ["launch"] }),

    test("a deleted file restores from cache and its tab shows the deleted state", async (ctx) => {
        const filePath = ctx.fixture("us-2030-missing-file/missing-at-restore.txt");
        let pageId;
        const fileContent = "Last saved content survives deletion.\n";

        try {
            await ctx.app.fs.write(filePath, fileContent);
            await ctx.app.pages.openFile(filePath);
            const opened = await waitForPage(ctx, "missing-at-restore.txt", "monaco");
            pageId = opened.id;

            ctx.expect(await ctx.app.fs.exists(filePath)).toBe(true);
            await waitForSavedSession(ctx, (state) => state.activePageId === pageId
                && state.pages.some((page) => page.id === pageId));
            await ctx.app.fs.delete(filePath);
            ctx.expect(await ctx.app.fs.exists(filePath)).toBe(false);
            // Let the running app notice the deletion first: it marks the page modified and keeps
            // the content in its cache, which is what the restart must preserve.
            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (modified) => modified === true);
            await waitForSavedSession(ctx, (state) => state.pages.some((page) => page.id === pageId));

            await ctx.restartApp();

            const restored = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.find((page) => page.id === pageId));
            const restoredPage = restored.find((page) => page.id === pageId);
            ctx.expect(restoredPage.editor).toBe("monaco");
            await ctx.app.pages.showPage(pageId);
            const restoredContent = await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(pageId)}].content`),
                (content) => content === fileContent,
            );
            ctx.expect(restoredContent).toBe(fileContent);
            ctx.expect(await ctx.app.fs.exists(filePath)).toBe(false);
            ctx.expect(await ctx.waitFor(
                `pages[${JSON.stringify(pageId)}].modified`,
                (modified) => modified === true,
            )).toBe(true);
            const isMarkedDeleted = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(`() => document.querySelector('[data-type="page-tab"][data-page-id="${pageId}"]')?.hasAttribute("data-deleted") === true`),
                (deleted) => deleted === true,
            );
            ctx.expect(isMarkedDeleted).toBe(true);
        } finally {
            if (pageId) await closeOwnedPages(ctx, new Set([pageId]));
            if (await ctx.app.fs.exists(filePath)) await ctx.app.fs.delete(filePath);
        }
    }, { requires: ["launch"] }),
];
