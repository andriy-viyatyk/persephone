import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { closePage } from "../../editors/helpers.mjs";
import { test } from "../../../lib/context.mjs";

const INITIAL_NOTES = "initial notes\n";
const COMMITTED_NOTES = "committed update notes\n";
const WORKING_NOTES = "working tree notes\n";

async function buildRepository(ctx, caseName) {
    const repository = ctx.fixture(`us-2074/${caseName}`);
    rmSync(repository, { recursive: true, force: true });
    mkdirSync(repository, { recursive: true });

    execFileSync("git", ["init", "--quiet"], { cwd: repository, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Persephone UI Test"], { cwd: repository, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "uitest@example.invalid"], { cwd: repository, stdio: "ignore" });

    await ctx.app.fs.write(path.join(repository, "notes.txt"), INITIAL_NOTES);
    execFileSync("git", ["add", "notes.txt"], { cwd: repository, stdio: "ignore" });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: repository, stdio: "ignore" });

    await ctx.app.fs.write(path.join(repository, "history.txt"), "history entry\n");
    execFileSync("git", ["add", "history.txt"], { cwd: repository, stdio: "ignore" });
    execFileSync("git", ["commit", "--quiet", "-m", "add second file"], { cwd: repository, stdio: "ignore" });

    await ctx.app.fs.write(path.join(repository, "notes.txt"), COMMITTED_NOTES);
    execFileSync("git", ["add", "notes.txt"], { cwd: repository, stdio: "ignore" });
    execFileSync("git", ["commit", "--quiet", "-m", "update notes"], { cwd: repository, stdio: "ignore" });
    await ctx.app.fs.write(path.join(repository, "notes.txt"), WORKING_NOTES);

    return repository;
}

async function openGitTree(ctx, repository, openedPageIds) {
    const page = await ctx.app.pages.openFile(repository);
    openedPageIds.add(page.id);
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages[page.id].panels.explorer.rootPath,
        (rootPath) => rootPath === repository,
        { timeout: 15000 },
    );
    const explorerSnapshot = await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.snapshot({
            interactive: true,
            root: '[data-type="tree-provider-view"]',
        }),
        (snapshot) => snapshot.match(/treeitem "(?:Expand )?\.git"/u) && /\[ref=e\d+\]/u.test(snapshot),
        { timeout: 15000 },
    );
    const gitRow = explorerSnapshot
        .split("\n")
        .find((line) => line.match(/treeitem "(?:Expand )?\.git"/u) && /\[ref=e\d+\]/u.test(line));
    const gitRowRef = gitRow?.match(/\[ref=(e\d+)\]/u)?.[1];
    ctx.expect(Boolean(gitRowRef)).toBe(true);
    await ctx.app.window.screen.click({ ref: gitRowRef });

    await ctx.waitFor(
        (activeContext) => activeContext.app.pages[page.id].editor.id,
        (editorId) => editorId === "git-tree",
        { timeout: 15000 },
    );
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages[page.id].editor.repoRoot,
        (repoRoot) => repoRoot === repository,
        { timeout: 15000 },
    );
    return page;
}

async function readRenderedDiff(ctx) {
    return await ctx.app.window.screen.evaluate(
        "() => Array.from(document.querySelectorAll('.monaco-diff-editor .view-line')).map((line) => line.textContent).join('\\n').replaceAll(String.fromCharCode(160), ' ')",
    );
}

async function selectHistoryCommit(ctx, subject) {
    // History rows are drawn grid cells: an interactive snapshot does not list them, so wait for the
    // visible text and click it with the exact text locator.
    await ctx.app.window.screen.waitFor({ text: subject, timeout: 15000 });
    await ctx.app.window.screen.click(`text=${JSON.stringify(subject)}`);
}

async function restoreGitAndClose(ctx, openedPageIds, previousGitEnabled) {
    try {
        for (const pageId of [...openedPageIds].reverse()) {
            try {
                await closePage(ctx, pageId);
            } catch {
                // Continue closing pages opened by this test before restoring Git Integration.
            }
        }
    } finally {
        await ctx.app.settings.set("git.enabled", previousGitEnabled);
    }
}

export default [
    test("Git Tree lists fixture history and shows the selected commit and its diff", async (ctx) => {
        const repository = ctx.fixture("us-2074/history");
        const previousGitEnabled = await ctx.app.settings.get("git.enabled");
        const openedPageIds = new Set();

        try {
            const builtRepository = await buildRepository(ctx, "history");
            if (!previousGitEnabled) await ctx.app.settings.set("git.enabled", true);
            const page = await openGitTree(ctx, builtRepository, openedPageIds);

            const commits = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.commits,
                (history) => history?.length === 3,
            );
            for (const subject of ["initial", "add second file", "update notes"]) {
                ctx.expect(commits.some((commit) => commit.subject === subject)).toBe(true);
            }

            await selectHistoryCommit(ctx, "update notes");
            const selectedCommit = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.selectedCommit,
                (commit) => commit?.subject === "update notes",
            );
            ctx.expect(selectedCommit.subject).toBe("update notes");
            ctx.expect(selectedCommit.authorName).toBe("Persephone UI Test");
            ctx.expect(selectedCommit.authorEmail).toBe("uitest@example.invalid");

            await ctx.app.window.screen.click('text="Diff"');
            const renderedDiff = await ctx.waitFor(
                (activeContext) => readRenderedDiff(activeContext),
                (value) => value.includes(INITIAL_NOTES.trim()) && value.includes(COMMITTED_NOTES.trim()),
            );
            ctx.expect(renderedDiff).toContain(INITIAL_NOTES.trim());
            ctx.expect(renderedDiff).toContain(COMMITTED_NOTES.trim());
        } finally {
            await restoreGitAndClose(ctx, openedPageIds, previousGitEnabled);
        }
    }, { requires: ["git"] }),

    test("Git Tree reports the unstaged working change and opens it in File Diff", async (ctx) => {
        const repository = ctx.fixture("us-2074/working-change");
        const previousGitEnabled = await ctx.app.settings.get("git.enabled");
        const openedPageIds = new Set();

        try {
            const builtRepository = await buildRepository(ctx, "working-change");
            if (!previousGitEnabled) await ctx.app.settings.set("git.enabled", true);
            const page = await openGitTree(ctx, builtRepository, openedPageIds);

            const changes = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.changes,
                (value) => value?.unstaged?.some((change) => change.path === "notes.txt"),
            );
            const editorChange = changes.unstaged.find((change) => change.path === "notes.txt");
            ctx.expect(editorChange.status).toBe("M");

            const panelChanges = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].panels.git.unstaged,
                (value) => value?.some((change) => change.path === "notes.txt"),
            );
            const panelChange = panelChanges.find((change) => change.path === "notes.txt");
            ctx.expect(panelChange.status).toBe("M");

            await ctx.app.pages[page.id].editor.openChange("notes.txt");
            const editorId = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.id,
                (value) => value === "file-diff",
            );
            ctx.expect(editorId).toBe("file-diff");

            const renderedDiff = await ctx.waitFor(
                (activeContext) => readRenderedDiff(activeContext),
                (value) => value.includes(COMMITTED_NOTES.trim()) && value.includes(WORKING_NOTES.trim()),
            );
            ctx.expect(renderedDiff).toContain(COMMITTED_NOTES.trim());
            ctx.expect(renderedDiff).toContain(WORKING_NOTES.trim());
        } finally {
            await restoreGitAndClose(ctx, openedPageIds, previousGitEnabled);
        }
    }, { requires: ["git"] }),

    test("Git Tree switches to Folder View and back with its repository intact", async (ctx) => {
        const repository = ctx.fixture("us-2074/folder-view");
        const previousGitEnabled = await ctx.app.settings.get("git.enabled");
        const openedPageIds = new Set();

        try {
            const builtRepository = await buildRepository(ctx, "folder-view");
            if (!previousGitEnabled) await ctx.app.settings.set("git.enabled", true);
            const page = await openGitTree(ctx, builtRepository, openedPageIds);

            const initialHistory = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.commits,
                (history) => history?.length === 3,
            );
            ctx.expect(initialHistory.length).toBe(3);

            await ctx.app.pages[page.id].editorSwitches.switchTo("category-view");
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.id,
                (editorId) => editorId === "category-view",
            )).toBe("category-view");

            await ctx.app.pages[page.id].editorSwitches.switchTo("git-tree");
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.id,
                (editorId) => editorId === "git-tree",
            )).toBe("git-tree");
            ctx.expect(await ctx.app.pages[page.id].editor.repoRoot).toBe(builtRepository);

            const restoredHistory = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.commits,
                (history) => history?.length === 3,
            );
            for (const subject of ["initial", "add second file", "update notes"]) {
                ctx.expect(restoredHistory.some((commit) => commit.subject === subject)).toBe(true);
            }
        } finally {
            await restoreGitAndClose(ctx, openedPageIds, previousGitEnabled);
        }
    }, { requires: ["git"] }),
];
