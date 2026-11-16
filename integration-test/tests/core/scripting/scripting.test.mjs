import { test } from "../../../lib/context.mjs";

const closePages = async (ctx, pageIds) => {
    for (const pageId of new Set(pageIds.filter(Boolean))) {
        try {
            await ctx.call("pages.closePage", [pageId], { dialog: true });
            const buttons = await ctx.call("dialogs[0].buttons", undefined, { dialog: true }).catch(() => undefined);
            const discard = buttons?.find((button) => /don't save|discard/i.test(button));
            if (discard) await ctx.call("dialogs[0].click", [discard], { dialog: true });
        } catch {
            // Cleanup must not hide the original test failure.
        }
    }
};

const pagePath = (pageId, member) => `pages[${JSON.stringify(pageId)}].${member}`;

export default [
    test("JavaScript and TypeScript transform their page and create grouped output", async (ctx) => {
        const openedPageIds = [];
        try {
            const javascript = await ctx.call("pages.addEditorPage", [
                "monaco",
                "javascript",
                "us-2032-javascript.js",
                'const value = "before"; page.content = value.replace("before", "after"); return page.content;',
            ]);
            openedPageIds.push(javascript.id);
            await ctx.call("pages.showPage", [javascript.id]);

            const javascriptResult = await ctx.call(pagePath(javascript.id, "runScript"), []);
            ctx.expect(javascriptResult).toBe("after");
            ctx.expect(await ctx.call(pagePath(javascript.id, "content"))).toBe("after");
            const javascriptOutput = await ctx.call(pagePath(javascript.id, "grouped"));
            openedPageIds.push(javascriptOutput.id);
            ctx.expect(await ctx.call(pagePath(javascriptOutput.id, "content"))).toBe("after");

            const typescript = await ctx.call("pages.addEditorPage", [
                "monaco",
                "typescript",
                "us-2032-typescript.ts",
                'type Change = { before: string; after: string }; const change: Change = { before: "before", after: "after" }; page.content = change.before.replace(change.before, change.after); return page.content;',
            ]);
            openedPageIds.push(typescript.id);
            await ctx.call("pages.showPage", [typescript.id]);
            const typescriptResult = await ctx.call(pagePath(typescript.id, "runScript"), []);
            ctx.expect(typescriptResult).toBe("after");
            ctx.expect(await ctx.call(pagePath(typescript.id, "content"))).toBe("after");
            const typescriptOutput = await ctx.call(pagePath(typescript.id, "grouped"));
            openedPageIds.push(typescriptOutput.id);
            ctx.expect(await ctx.call(pagePath(typescriptOutput.id, "content"))).toBe("after");
        } finally {
            await closePages(ctx, openedPageIds);
        }
    }),

    test("app and io read pages, fixture files, and fixture HTTP responses", async (ctx) => {
        const openedPageIds = [];
        const folderPath = ctx.fixture("us-2032/scripting/app-io");
        const filePath = ctx.fixture("us-2032/scripting/app-io/source.txt");
        try {
            const page = await ctx.call("pages.addEmptyPage", []);
            openedPageIds.push(page.id);
            await ctx.call("pages.showPage", [page.id]);
            const url = ctx.httpUrl("/echo?source=us-2032");
            const code = [
                `await app.fs.mkdir(${JSON.stringify(folderPath)});`,
                `await app.fs.write(${JSON.stringify(filePath)}, "fixture file content\\n");`,
                `const pageIsActive = app.pages.activePage.id === ${JSON.stringify(page.id)};`,
                `const fileText = await io.createPipe(new io.FileProvider(${JSON.stringify(filePath)})).readText();`,
                `const httpText = await io.createPipe(new io.HttpProvider(${JSON.stringify(url)})).readText();`,
                "const echo = JSON.parse(httpText);",
                "JSON.stringify({ pageIsActive, fileText, method: echo.method, body: echo.body });",
            ].join("\n");

            const result = JSON.parse(await ctx.script(code));
            ctx.expect(result.pageIsActive).toBe(true);
            ctx.expect(result.fileText).toBe("fixture file content\n");
            ctx.expect(result.method).toBe("GET");
            ctx.expect(result.body).toBe("");
        } finally {
            await ctx.call("fs.delete", [filePath]).catch(() => {});
            await ctx.call("fs.removeDir", [folderPath, true]).catch(() => {});
            await closePages(ctx, openedPageIds);
        }
    }),

    test("script log output is visible in grouped Log View with its levels", async (ctx) => {
        const openedPageIds = [];
        try {
            const page = await ctx.call("pages.addEditorPage", [
                "monaco",
                "javascript",
                "us-2032-log.js",
                'ui.info("US-2032 info marker")\nui.warn("US-2032 warning marker")',
            ]);
            openedPageIds.push(page.id);
            await ctx.call("pages.showPage", [page.id]);
            await ctx.call(pagePath(page.id, "runScript"), []);

            const grouped = await ctx.waitFor(
                (activeContext) => activeContext.call(pagePath(page.id, "grouped")),
                (value) => value?.editor === "log-view",
            );
            openedPageIds.push(grouped.id);
            const entries = await ctx.waitFor(
                pagePath(grouped.id, "editor.entries"),
                (value) => Array.isArray(value)
                    && value.some((entry) => JSON.stringify(entry).includes("US-2032 info marker"))
                    && value.some((entry) => JSON.stringify(entry).includes("US-2032 warning marker")),
            );
            const info = entries.find((entry) => JSON.stringify(entry).includes("US-2032 info marker"));
            const warning = entries.find((entry) => JSON.stringify(entry).includes("US-2032 warning marker"));
            ctx.expect(info.type).toBe("log.info");
            ctx.expect(warning.type).toBe("log.warn");
        } finally {
            await closePages(ctx, openedPageIds);
        }
    }),

    test("script errors reach the result and leave the page usable", async (ctx) => {
        const openedPageIds = [];
        try {
            const page = await ctx.call("pages.addEmptyPage", []);
            openedPageIds.push(page.id);
            await ctx.call("pages.showPage", [page.id]);
            const failure = await ctx.call("script.execute", [
                'throw new Error("US-2032 intentional script failure")',
                page.id,
                "javascript",
            ]);

            ctx.expect(failure.isError).toBe(true);
            ctx.expect(failure.text).toContain("US-2032 intentional script failure");
            const recovery = await ctx.call("script.execute", [
                'page.data.us2032Recovery = "still-usable"',
                page.id,
                "javascript",
            ]);
            ctx.expect(recovery.isError).toBe(false);
            ctx.expect(recovery.text).toBe("still-usable");
            ctx.expect(await ctx.call(pagePath(page.id, "data.us2032Recovery"))).toBe("still-usable");
            ctx.expect((await ctx.call("pages.all")).some((entry) => entry.id === page.id)).toBe(true);
        } finally {
            await closePages(ctx, openedPageIds);
        }
    }),

    test("an inline script input dialog can be answered through the dialog-aware call", async (ctx) => {
        const openedPageIds = [];
        try {
            const page = await ctx.call("pages.addEditorPage", [
                "monaco",
                "javascript",
                "us-2032-dialog.js",
                'const result = await app.ui.input("US-2032 script input", { value: "dialog-answer" }); page.content = result?.value ?? ""; return result?.value ?? "";',
            ]);
            openedPageIds.push(page.id);
            await ctx.call("pages.showPage", [page.id]);

            const pending = await ctx.call(pagePath(page.id, "runScript"), [], { dialog: true });
            ctx.expect(pending.pending).toBe(true);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.call("dialogs[0].message", undefined, { dialog: true }),
                (value) => value === "US-2032 script input",
            )).toBe("US-2032 script input");
            ctx.expect(await ctx.call("dialogs[0].value", undefined, { dialog: true })).toBe("dialog-answer");
            ctx.expect(await ctx.call("dialogs[0].click", ["OK"], { dialog: true })).toBe(true);

            ctx.expect(await ctx.waitFor(pagePath(page.id, "content"), (value) => value === "dialog-answer")).toBe("dialog-answer");
            const grouped = await ctx.call(pagePath(page.id, "grouped"));
            openedPageIds.push(grouped.id);
            ctx.expect(await ctx.call(pagePath(grouped.id, "content"))).toBe("dialog-answer");
        } finally {
            await ctx.call("dialogs[0].cancel", [], { dialog: true }).catch(() => {});
            await closePages(ctx, openedPageIds);
        }
    }),

    test("a selected script-library entry runs from the related-script panel command", async (ctx) => {
        const openedPageIds = [];
        const libraryPath = ctx.fixture("us-2032/scripting/library");
        const scriptFolder = ctx.fixture("us-2032/scripting/library/script-panel/all");
        const libraryScript = ctx.fixture("us-2032/scripting/library/script-panel/all/transform.js");
        const sourcePath = ctx.fixture("us-2032/scripting/library/source.txt");
        const previousLibraryPath = await ctx.script("app.settings.get(\"script-library.path\")");
        try {
            await ctx.call("fs.mkdir", [scriptFolder]);
            await ctx.call("fs.write", [libraryScript, 'page.content = page.content.replace("original", "from-library"); return page.content;\n']);
            await ctx.call("fs.write", [sourcePath, "original source\n"]);
            await ctx.script(`app.settings.set("script-library.path", ${JSON.stringify(libraryPath)});`);
            const page = await ctx.call("pages.openFile", [sourcePath]);
            openedPageIds.push(page.id);
            await ctx.call("pages.showPage", [page.id]);
            await ctx.call(pagePath(page.id, "editor.toggleScriptPanel"), []);

            const availableScripts = await ctx.waitFor(
                pagePath(page.id, "editor.scriptAvailableScripts"),
                (value) => Array.isArray(value) && value.includes(libraryScript),
            );
            ctx.expect(availableScripts.includes(libraryScript)).toBe(true);
            await ctx.call(pagePath(page.id, "editor.selectScript"), [libraryScript]);
            ctx.expect(await ctx.waitFor(pagePath(page.id, "editor.scriptSelectedScript"), (value) => value === libraryScript)).toBe(libraryScript);
            await ctx.call("window.screen.click", ['[data-name="script-run"]']);

            ctx.expect(await ctx.waitFor(pagePath(page.id, "content"), (value) => value === "from-library source\n")).toBe("from-library source\n");
            const grouped = await ctx.call(pagePath(page.id, "grouped"));
            openedPageIds.push(grouped.id);
        } finally {
            await ctx.script(`app.settings.set("script-library.path", ${JSON.stringify(previousLibraryPath)});`).catch(() => {});
            await ctx.call("fs.removeDir", [ctx.fixture("us-2032/scripting/library"), true]).catch(() => {});
            await closePages(ctx, openedPageIds);
        }
    }),
];
