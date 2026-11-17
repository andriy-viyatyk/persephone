import { test } from "../../../lib/context.mjs";
import { close, open } from "../../helpers/pilot-helpers.mjs";

async function openPage(ctx, folder, filename, content, editor = "monaco") {
    return open(ctx, `${folder}/${filename}`, content, editor);
}

async function closePage(ctx, page) {
    if (!page) return;
    const modified = await ctx.call(`${page.root}.modified`);
    if (modified) await ctx.call(`${page.root}.editor.saveFile`, []);
    await close(ctx, page.id);
}

export default [
    test("typing updates content and modified state through undo and redo", async (ctx) => {
        const initial = "alpha\nbeta\n";
        let page;
        try {
            page = await openPage(ctx, "us-2043/undo-redo", "notes.txt", initial);
            ctx.expect(await ctx.call(`${page.root}.modified`)).toBe(false);

            await ctx.call(`${page.root}.editor.insertText`, ["typed-"]);
            const typed = await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content !== initial,
            );
            ctx.expect(typed).toContain("typed-");
            ctx.expect(await ctx.waitFor(`${page.root}.modified`, (modified) => modified)).toBe(true);

            await ctx.call("window.screen.pressKey", ["Control+z", { target: ".monaco-editor-host-root .monaco-editor" }]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content === initial,
            )).toBe(initial);
            // `modified` means "edited since the last save", not "differs from disk": undo back to the
            // saved text keeps the page modified, like Windows Notepad.
            ctx.expect(await ctx.call(`${page.root}.modified`)).toBe(true);

            await ctx.call("window.screen.pressKey", ["Control+Shift+z", { target: ".monaco-editor-host-root .monaco-editor" }]);
            const redone = await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content === typed,
            );
            ctx.expect(redone).toBe(typed);
            ctx.expect(await ctx.waitFor(`${page.root}.modified`, (modified) => modified)).toBe(true);
        } finally {
            await closePage(ctx, page);
        }
    }),

    test("find and replace changes one match and then all remaining matches", async (ctx) => {
        const initial = "red red red\n";
        let page;
        try {
            page = await openPage(ctx, "us-2043/find-replace", "colors.txt", initial);
            await ctx.call(`${page.root}.editor.openReplace`, []);

            await ctx.call("window.screen.type", [".monaco-editor .find-widget .find-part .input", "red"]);
            await ctx.call("window.screen.type", [".monaco-editor .find-widget .replace-part .input", "blue"]);
            await ctx.call("window.screen.click", [".monaco-editor .find-widget .replace-actions .button", { nth: 0 }]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content !== initial,
            )).toBe("blue red red\n");

            await ctx.call("window.screen.click", [".monaco-editor .find-widget .replace-actions .button", { nth: 1 }]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content === "blue blue blue\n",
            )).toBe("blue blue blue\n");
        } finally {
            await closePage(ctx, page);
        }
    }),

    test("changing the language updates the page and Monaco highlighting", async (ctx) => {
        let page;
        try {
            page = await openPage(ctx, "us-2043/language", "sample.txt", '{ "enabled": true }\n');
            const before = await ctx.call("window.screen.evaluate", [
                "() => document.querySelector('.monaco-editor .view-line')?.innerHTML",
            ]);

            await ctx.script('page.language = "json"; return page.language;');
            ctx.expect(await ctx.waitFor(`${page.root}.language`, (language) => language === "json")).toBe("json");

            const after = await ctx.waitFor(
                (activeContext) => activeContext.call("window.screen.evaluate", [
                    "() => document.querySelector('.monaco-editor .view-line')?.innerHTML",
                ]),
                (markup) => typeof markup === "string" && markup.length > 0 && markup !== before,
            );
            ctx.expect(after).toContain("enabled");
        } finally {
            await closePage(ctx, page);
        }
    }),

    test("word wrap can be turned on and off for the current page", async (ctx) => {
        let page;
        let original;
        try {
            page = await openPage(ctx, "us-2043/word-wrap", "long-line.txt", "A deliberately long line for checking the page-local word wrap control.\n");
            original = await ctx.call(`${page.root}.editor.wordWrap`);
            if (original) await ctx.call(`${page.root}.editor.toggleWordWrap`, []);
            ctx.expect(await ctx.call(`${page.root}.editor.wordWrap`)).toBe(false);

            await ctx.call(`${page.root}.editor.toggleWordWrap`, []);
            ctx.expect(await ctx.waitFor(`${page.root}.editor.wordWrap`, (wordWrap) => wordWrap)).toBe(true);

            await ctx.call(`${page.root}.editor.toggleWordWrap`, []);
            ctx.expect(await ctx.waitFor(`${page.root}.editor.wordWrap`, (wordWrap) => !wordWrap)).toBe(false);
        } finally {
            if (page && original !== undefined) {
                const current = await ctx.call(`${page.root}.editor.wordWrap`);
                if (current !== original) await ctx.call(`${page.root}.editor.toggleWordWrap`, []);
            }
            await closePage(ctx, page);
        }
    }),

    test("keyboard multi-cursor typing edits two lines at once", async (ctx) => {
        let page;
        try {
            page = await openPage(ctx, "us-2043/multi-cursor", "two-lines.txt", "one\ntwo\n");
            await ctx.call("window.screen.pressKey", ["Control+Home", { target: ".monaco-editor-host-root .monaco-editor" }]);
            await ctx.call("window.screen.pressKey", ["Control+Alt+ArrowDown"]);
            await ctx.call("window.screen.pressKey", ["X"]);

            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content === "Xone\nXtwo\n",
            )).toBe("Xone\nXtwo\n");
            ctx.expect(await ctx.waitFor(`${page.root}.modified`, (modified) => modified)).toBe(true);
        } finally {
            await closePage(ctx, page);
        }
    }),

    test("JSON document formatting preserves data and changes its layout", async (ctx) => {
        const initial = '{"name":"Ada","active":true,"items":[1,2]}\n';
        let page;
        try {
            page = await openPage(ctx, "us-2043/format-json", "record.json", initial);
            await ctx.call("window.screen.pressKey", ["Shift+Alt+f", { target: ".monaco-editor-host-root .monaco-editor" }]);

            const formatted = await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content !== initial,
            );
            ctx.expect(JSON.parse(formatted)).toEqual({ name: "Ada", active: true, items: [1, 2] });
            ctx.expect(formatted.trim().split("\n").length > 3).toBe(true);
        } finally {
            await closePage(ctx, page);
        }
    }),

    test("saving typed text writes the file and clears modified state", async (ctx) => {
        const initial = "save this file\n";
        let page;
        try {
            page = await openPage(ctx, "us-2043/save", "save.txt", initial);
            await ctx.call(`${page.root}.editor.insertText`, ["updated-"]);
            const changed = await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content !== initial,
            );
            ctx.expect(await ctx.waitFor(`${page.root}.modified`, (modified) => modified)).toBe(true);

            ctx.expect(await ctx.call(`${page.root}.editor.saveFile`, [])).toBe(true);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText("fs.read", [page.filePath]),
                (content) => content === changed,
            )).toBe(changed);
            ctx.expect(await ctx.waitFor(`${page.root}.modified`, (modified) => !modified)).toBe(false);
        } finally {
            await closePage(ctx, page);
        }
    }),
];
