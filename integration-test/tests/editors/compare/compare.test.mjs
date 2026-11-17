import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "../../../lib/context.mjs";

async function openTextPage(ctx, fixtureFolder, filename, content) {
    const filePath = ctx.fixture(`${fixtureFolder}/${filename}`);
    await ctx.call("fs.write", [filePath, content]);
    const page = await ctx.call("pages.openFile", [filePath]);
    return { ...page, root: `pages[${JSON.stringify(page.id)}]`, filePath };
}

async function closePage(ctx, page) {
    if (!page) return;
    if (await ctx.call(`${page.root}.modified`)) {
        const editorId = await ctx.call(`${page.root}.editor.id`);
        if (editorId === "monaco") await ctx.call(`${page.root}.editor.saveFile`, []);
    }
    await ctx.call("pages.closePage", [page.id]);
}

export default [
    test("compare mode shows grouped text changes and exits back to both editors", async (ctx) => {
        let left;
        let right;
        try {
            left = await openTextPage(ctx, "us-2046/compare-mode", "original.txt", "before\nshared\n");
            right = await openTextPage(ctx, "us-2046/compare-mode", "updated.txt", "after\nshared\n");
            await ctx.call("pages.group", [left.id, right.id]);
            ctx.expect(await ctx.call("pages.isGrouped", [left.id])).toBe(true);
            ctx.expect(await ctx.call("pages.isGrouped", [right.id])).toBe(true);

            await ctx.call("pages.compare.enter", [left.id]);
            const pairs = await ctx.waitFor("pages.compare.pairs", (value) => value.length === 1);
            ctx.expect(pairs[0].leftPageId).toBe(left.id);
            ctx.expect(pairs[0].rightPageId).toBe(right.id);

            const compareElements = await ctx.call("pages.compare.elements");
            ctx.expect(compareElements.find((element) => element.name === "compare-root").visible).toBe(true);
            const renderedDiff = await ctx.waitFor(
                (activeContext) => activeContext.call("window.screen.evaluate", [
                    "() => Array.from(document.querySelectorAll('.monaco-diff-editor .view-line')).map((line) => line.textContent).join('\\n').replaceAll(String.fromCharCode(160), ' ')",
                ]),
                (text) => text.includes("before") && text.includes("after"),
            );
            ctx.expect(renderedDiff).toContain("before");
            ctx.expect(renderedDiff).toContain("after");

            await ctx.call("window.screen.click", ['[data-name="compare-exit"]']);
            ctx.expect(await ctx.waitFor("pages.compare.pairs", (value) => value.length === 0)).toEqual([]);
            ctx.expect(await ctx.call(`${left.root}.editor.id`)).toBe("monaco");
            ctx.expect(await ctx.call(`${right.root}.editor.id`)).toBe("monaco");
            ctx.expect(await ctx.call("pages.isGrouped", [left.id])).toBe(true);
            ctx.expect(await ctx.callText(`${left.root}.content`)).toBe("before\nshared\n");
            ctx.expect(await ctx.callText(`${right.root}.content`)).toBe("after\nshared\n");
        } finally {
            await closePage(ctx, right);
            await closePage(ctx, left);
        }
    }),

    test("Git Diff shows committed and working revisions and saves edits from the working side", async (ctx) => {
        const fixtureFolder = "us-2046/git-diff";
        const repository = ctx.fixture(fixtureFolder);
        const filePath = path.join(repository, "notes.txt");
        const initial = "committed version\n";
        const changed = "working version\n";
        const edited = "edited working version";
        const previousGitEnabled = await ctx.call("settings.get", ["git.enabled"]);
        let page;

        try {
            rmSync(repository, { recursive: true, force: true });
            mkdirSync(repository, { recursive: true });
            await ctx.call("fs.write", [filePath, initial]);
            execFileSync("git", ["init", "--quiet"], { cwd: repository, stdio: "ignore" });
            execFileSync("git", ["config", "user.name", "Persephone UI Test"], { cwd: repository, stdio: "ignore" });
            execFileSync("git", ["config", "user.email", "uitest@example.invalid"], { cwd: repository, stdio: "ignore" });
            execFileSync("git", ["add", "notes.txt"], { cwd: repository, stdio: "ignore" });
            execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: repository, stdio: "ignore" });
            await ctx.call("fs.write", [filePath, changed]);

            if (!previousGitEnabled) await ctx.call("settings.set", ["git.enabled", true]);
            page = await ctx.call("pages.openFile", [filePath]);
            const root = `pages[${JSON.stringify(page.id)}]`;
            await ctx.call(`${root}.editorSwitches.switchTo`, ["file-diff"]);
            ctx.expect(await ctx.waitFor(`${root}.editor.id`, (editor) => editor === "file-diff")).toBe("file-diff");
            const fromRevision = await ctx.waitFor(`${root}.editor.from`, (revision) => revision?.kind === "commit");
            ctx.expect(fromRevision.kind).toBe("commit");
            ctx.expect(fromRevision.hash.length > 0).toBe(true);
            ctx.expect((await ctx.call(`${root}.editor.to`)).kind).toBe("unstaged");
            ctx.expect(await ctx.call(`${root}.editor.readOnly`)).toBe(false);

            const renderedDiff = await ctx.waitFor(
                (activeContext) => activeContext.call("window.screen.evaluate", [
                    "() => Array.from(document.querySelectorAll('.monaco-diff-editor .view-line')).map((line) => line.textContent).join('\\n').replaceAll(String.fromCharCode(160), ' ')",
                ]),
                (text) => text.includes("committed version") && text.includes("working version"),
            );
            ctx.expect(renderedDiff).toContain("committed version");
            ctx.expect(renderedDiff).toContain("working version");

            const modifiedSide = ".monaco-diff-editor .editor.modified";
            await ctx.call("window.screen.pressKey", ["Control+a", { target: modifiedSide }]);
            for (const character of edited) {
                const key = character === "\n" ? "Enter" : character === " " ? "Space" : character;
                await ctx.call("window.screen.pressKey", [key]);
            }
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${root}.content`),
                (content) => content === edited,
            )).toBe(edited);

            await ctx.call("window.screen.pressKey", ["Control+s", { target: modifiedSide }]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText("fs.read", [filePath]),
                (content) => content === edited,
            )).toBe(edited);
        } finally {
            try {
                if (page) {
                    const root = `pages[${JSON.stringify(page.id)}]`;
                    try {
                        if (await ctx.call(`${root}.editor.id`) === "file-diff") {
                            await ctx.call(`${root}.editorSwitches.switchTo`, ["monaco"]);
                            await ctx.waitFor(`${root}.editor.id`, (editor) => editor === "monaco");
                        }
                        if (await ctx.call(`${root}.modified`)) await ctx.call(`${root}.editor.saveFile`, []);
                    } finally {
                        await ctx.call("pages.closePage", [page.id]);
                    }
                }
            } finally {
                if (previousGitEnabled !== undefined && (await ctx.call("settings.get", ["git.enabled"])) !== previousGitEnabled) {
                    await ctx.call("settings.set", ["git.enabled", previousGitEnabled]);
                }
            }
        }
    }, { requires: ["git"] }),
];
