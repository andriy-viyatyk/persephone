import { registerPublishedBoard } from "../helpers/published-boards.mjs";
import { openBoardPage } from "../helpers/boards.mjs";

function comparableRoot(value) {
    return value.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function samePublishedRoot(left, right) {
    return typeof left === "string" && typeof right === "string"
        && comparableRoot(left) === comparableRoot(right);
}

export async function openPublishedSample(ctx, boardId, sampleRel) {
    const root = await registerPublishedBoard(ctx, boardId);
    let id;

    try {
        const file = ctx.fixture(`boards-samples/${sampleRel}`);
        const page = await ctx.app.pages.openFile(file);
        id = page.id;

        const editorNode = ctx.app.pages[id].editor;
        const editorId = await editorNode.id;
        if (typeof editorId !== "string" || !editorId.startsWith("board-editor:")) {
            throw new Error(`Expected a published board editor, received ${editorId}.`);
        }
        if (!samePublishedRoot(editorId.slice("board-editor:".length), root)) {
            throw new Error("The opened board editor does not match the registered published board.");
        }
        if (!samePublishedRoot(await editorNode.boardRoot, root)) {
            throw new Error("The opened board page root does not match the registered published board.");
        }

        const editor = ctx.handle(editorNode);
        await ctx.app.pages.showPage(id);
        await ctx.waitFor("pages.activePage.id", (value) => value === id);
        await ctx.waitFor(`pages[${JSON.stringify(id)}].editor.frameReady`, (value) => value === true);

        return { id, editor, root, file };
    } catch (error) {
        await closePublishedSample(ctx, { id, root });
        throw error;
    }
}

export async function openPublishedBoard(ctx, boardId) {
    const root = await registerPublishedBoard(ctx, boardId);
    try {
        const { id, editor } = await openBoardPage(ctx, root);
        return { id, editor, root };
    } catch (error) {
        await closePublishedSample(ctx, { id: undefined, root });
        throw error;
    }
}

export async function closePublishedSample(ctx, handle) {
    if (handle?.id) {
        try { await ctx.app.pages.closePage(handle.id); } catch { /* cleanup must not hide the test failure */ }
    }
    if (handle?.root) {
        try { await ctx.app.boards.unregisterBoard(handle.root); } catch { /* already unregistered or cleanup is partial */ }
    }
}
