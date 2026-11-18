function comparableRoot(value) {
    return value.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
}

function sameRoot(left, right) {
    return typeof left === "string" && typeof right === "string"
        && comparableRoot(left) === comparableRoot(right);
}

/** Wait for a renderer dialog by title. Dialog reads need { dialog: true }, which a plain path wait cannot pass. */
export async function waitForBoardDialog(ctx, title, timeout = 10000) {
    return ctx.waitFor(
        (active) => active.call("dialogs[0].title", undefined, { dialog: true }).catch(() => null),
        (value) => value === title,
        { timeout },
    );
}

export function fixtureBoard(ctx, rel) {
    return ctx.fixture(`boards/${rel}`);
}

export async function resetBoardFile(ctx, root, relPath, content) {
    await ctx.app.fs.write(`${root}/${relPath}`, content);
}

export async function trustFixtureBoard(ctx, root) {
    await ctx.call("boards.registerBoard", [root], { dialog: true });
    await waitForBoardDialog(ctx, "Trust this board?");
    await ctx.call("dialogs[0].click", ["Trust Board"], { dialog: true });
    await ctx.waitFor(
        (active) => active.app.boards.list(),
        (boards) => boards.some((board) => sameRoot(board.root, root) && board.trusted),
        { timeout: 10000 },
    );
}

export async function openBoardPage(ctx, root) {
    await ctx.app.boards.openBoard(root);
    let id = await ctx.app.pages.activePage.id;
    if (id) {
        try {
            if (!sameRoot(await ctx.app.pages[id].editor.boardRoot, root)) id = null;
        } catch { id = null; }
    }
    if (!id) id = await ctx.waitFor(
        async (active) => {
            const pages = await active.app.pages.all;
            for (const page of pages) {
                if (page.editor === "board-view" || page.editor?.startsWith("board-editor:")) {
                    const candidateRoot = await active.app.pages[page.id].editor.boardRoot;
                    if (sameRoot(candidateRoot, root)) return page.id;
                }
            }
            return null;
        },
        (value) => value !== null,
        { timeout: 15000 },
    );
    await ctx.app.pages.showPage(id);
    await ctx.waitFor("pages.activePage.id", (value) => value === id, { timeout: 10000 });
    const editor = ctx.handle(ctx.app.pages[id].editor);
    await ctx.waitFor(`pages[${JSON.stringify(id)}].editor.frameReady`, (value) => value === true, { timeout: 15000 });
    return { id, editor };
}

export async function closeBoardPage(ctx, id) {
    if (!id) return;
    try { await ctx.app.pages.closePage(id); } catch { /* cleanup must not hide the test failure */ }
}

export async function untrustBoard(ctx, root) {
    if (!root) return;
    try { await ctx.app.boards.unregisterBoard(root); } catch { /* already untrusted or the page is already closed */ }
}
