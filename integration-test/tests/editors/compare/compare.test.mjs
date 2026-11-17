import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "../../../lib/context.mjs";

async function openTextPage(ctx, fixtureFolder, filename, content) {
    const filePath = ctx.fixture(`${fixtureFolder}/${filename}`);
    await ctx.app.fs.write(filePath, content);
    const page = await ctx.app.pages.openFile(filePath);
    return { ...page, node: ctx.handle(ctx.app.pages[page.id]), filePath };
}

async function closePage(ctx, page) {
    if (!page) return;
    if (await ctx.app.pages[page.id].modified) {
        const editorId = await ctx.app.pages[page.id].editor.id;
        if (editorId === "monaco") await ctx.app.pages[page.id].editor.saveFile();
    }
    await ctx.app.pages.closePage(page.id);
}

export default [
    test("compare mode shows grouped text changes and exits back to both editors", async (ctx) => {
        let left;
        let right;
        try {
            left = await openTextPage(ctx, "us-2046/compare-mode", "original.txt", "before\nshared\n");
            right = await openTextPage(ctx, "us-2046/compare-mode", "updated.txt", "after\nshared\n");
            await ctx.app.pages.group(left.id, right.id);
            ctx.expect(await ctx.app.pages.isGrouped(left.id)).toBe(true);
            ctx.expect(await ctx.app.pages.isGrouped(right.id)).toBe(true);

            await ctx.app.pages.compare.enter(left.id);
            const pairs = await ctx.waitFor((activeContext) => activeContext.app.pages.compare.pairs, (value) => value.length === 1);
            ctx.expect(pairs[0].leftPageId).toBe(left.id);
            ctx.expect(pairs[0].rightPageId).toBe(right.id);

            const compareElements = await ctx.app.pages.compare.elements;
            ctx.expect(compareElements.find((element) => element.name === "compare-root").visible).toBe(true);
            const renderedDiff = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate("() => Array.from(document.querySelectorAll('.monaco-diff-editor .view-line')).map((line) => line.textContent).join('\\n').replaceAll(String.fromCharCode(160), ' ')"),
                (text) => text.includes("before") && text.includes("after"),
            );
            ctx.expect(renderedDiff).toContain("before");
            ctx.expect(renderedDiff).toContain("after");

            await ctx.app.window.screen.click('[data-name="compare-exit"]');
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages.compare.pairs, (value) => value.length === 0)).toEqual([]);
            ctx.expect(await ctx.app.pages[left.id].editor.id).toBe("monaco");
            ctx.expect(await ctx.app.pages[right.id].editor.id).toBe("monaco");
            ctx.expect(await ctx.app.pages.isGrouped(left.id)).toBe(true);
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(left.id)}].content`)).toBe("before\nshared\n");
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(right.id)}].content`)).toBe("after\nshared\n");
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
        const previousGitEnabled = await ctx.app.settings.get("git.enabled");
        let page;

        try {
            rmSync(repository, { recursive: true, force: true });
            mkdirSync(repository, { recursive: true });
            await ctx.app.fs.write(filePath, initial);
            execFileSync("git", ["init", "--quiet"], { cwd: repository, stdio: "ignore" });
            execFileSync("git", ["config", "user.name", "Persephone UI Test"], { cwd: repository, stdio: "ignore" });
            execFileSync("git", ["config", "user.email", "uitest@example.invalid"], { cwd: repository, stdio: "ignore" });
            execFileSync("git", ["add", "notes.txt"], { cwd: repository, stdio: "ignore" });
            execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: repository, stdio: "ignore" });
            await ctx.app.fs.write(filePath, changed);

            if (!previousGitEnabled) await ctx.app.settings.set("git.enabled", true);
            page = await ctx.app.pages.openFile(filePath);
            const node = ctx.handle(ctx.app.pages[page.id]);
            await node.editorSwitches.switchTo("file-diff");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "file-diff")).toBe("file-diff");
            const fromRevision = await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.from, (revision) => revision?.kind === "commit");
            ctx.expect(fromRevision.kind).toBe("commit");
            ctx.expect(fromRevision.hash.length > 0).toBe(true);
            ctx.expect((await node.editor.to).kind).toBe("unstaged");
            ctx.expect(await node.editor.readOnly).toBe(false);

            const renderedDiff = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate("() => Array.from(document.querySelectorAll('.monaco-diff-editor .view-line')).map((line) => line.textContent).join('\\n').replaceAll(String.fromCharCode(160), ' ')"),
                (text) => text.includes("committed version") && text.includes("working version"),
            );
            ctx.expect(renderedDiff).toContain("committed version");
            ctx.expect(renderedDiff).toContain("working version");

            const modifiedSide = ".monaco-diff-editor .editor.modified";
            await ctx.app.window.screen.pressKey("Control+a", { target: modifiedSide });
            for (const character of edited) {
                const key = character === "\n" ? "Enter" : character === " " ? "Space" : character;
                await ctx.app.window.screen.pressKey(key);
            }
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(page.id)}].content`),
                (content) => content === edited,
            )).toBe(edited);

            await ctx.app.window.screen.pressKey("Control+s", { target: modifiedSide });
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText("fs.read", [filePath]),
                (content) => content === edited,
            )).toBe(edited);
        } finally {
            try {
                if (page) {
                    const node = ctx.handle(ctx.app.pages[page.id]);
                    try {
                        if (await node.editor.id === "file-diff") {
                            await node.editorSwitches.switchTo("monaco");
                            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "monaco");
                        }
                        if (await node.modified) await node.editor.saveFile();
                    } finally {
                        await ctx.app.pages.closePage(page.id);
                    }
                }
            } finally {
                if (previousGitEnabled !== undefined && (await ctx.app.settings.get("git.enabled")) !== previousGitEnabled) {
                    await ctx.app.settings.set("git.enabled", previousGitEnabled);
                }
            }
        }
    }, { requires: ["git"] }),
];
