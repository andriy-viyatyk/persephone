import { readFile } from "node:fs/promises";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";

const sampleRel = "todo/sample.todo.json";
const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

async function resetSample(ctx) {
    const sampleText = await readFile(ctx.file("../../../fixtures/boards-samples/todo/sample.todo.json"), "utf8");
    await ctx.app.fs.write(ctx.fixture(`boards-samples/${sampleRel}`), sampleText);
}

async function waitForTodoModel(ctx, pageId) {
    return ctx.waitFor(
        async (activeContext) => {
            try {
                return await activeContext.app.pages[pageId].editor.app.items.count;
            } catch {
                return null;
            }
        },
        (count) => count === 2,
    );
}

export default [
    test("opens the sample, reads lists and items, and renders Lists & Tags", async (ctx) => {
        let handle;
        try {
            await resetSample(ctx);
            handle = await openPublishedSample(ctx, "todo", sampleRel);
            const pageId = handle.id;
            await waitForTodoModel(ctx, pageId);

            const model = ctx.app.pages[pageId].editor.app;
            ctx.expect(await model.items.totalCount).toBe(2);
            ctx.expect(await model.items[0].id).toBe("todo-check");
            ctx.expect(await model.items[0].title).toBe("Check the sample parser");
            ctx.expect(await model.items[0].done).toBe(false);

            ctx.expect(await model.lists.count).toBe(2);
            ctx.expect(await model.lists[0].name).toBe("Inbox");
            ctx.expect(await model.lists[0].total).toBe(1);
            ctx.expect(await model.lists[0].undone).toBe(1);
            ctx.expect(await model.tags.count).toBe(2);
            ctx.expect(await model.tags[0].name).toBe("review");
            ctx.expect(await model.tags[0].color).toBe("tomato");
            ctx.expect(await model.tags[0].count).toBe(1);

            const editor = ctx.app.pages[pageId].editor;
            const tabs = await editor.tabs;
            ctx.expect(tabs.some((tab) => tab.id === "board-secondary:lists" && tab.title === "Lists & Tags")).toBe(true);
            await handle.editor.switchTab("board-secondary:lists");
            const snapshot = await handle.editor.snapshot();
            for (const text of ["Inbox", "Personal", "review", "later"]) ctx.expect(snapshot).toContain(text);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("adds, completes, edits, and saves an item to the Todo file", async (ctx) => {
        let handle;
        try {
            await resetSample(ctx);
            handle = await openPublishedSample(ctx, "todo", sampleRel);
            const pageId = handle.id;
            await waitForTodoModel(ctx, pageId);

            const itemId = await ctx.app.pages[pageId].editor.app.addItem("Confirm synthetic export", "Inbox");
            ctx.expect(typeof itemId).toBe("string");
            ctx.expect(itemId.length > 0).toBe(true);
            ctx.expect(await ctx.app.pages[pageId].editor.app.toggleItem(itemId)).toBe(true);
            await ctx.app.pages[pageId].editor.app.setItemTitle(itemId, "Confirm sample export");
            await ctx.app.pages[pageId].editor.app.setItemComment(itemId, "Offline fixture edit");
            await ctx.app.pages[pageId].editor.app.setItemTag(itemId, "later");

            const items = await ctx.app.pages[pageId].editor.app.items;
            const editedItem = items.find((item) => item.id === itemId);
            ctx.expect(editedItem.id).toBe(itemId);
            ctx.expect(editedItem.title).toBe("Confirm sample export");
            ctx.expect(editedItem.done).toBe(true);
            ctx.expect(editedItem.comment).toBe("Offline fixture edit");
            ctx.expect(editedItem.tag).toBe("later");

            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (modified) => modified === true);
            ctx.expect(await ctx.app.pages[pageId].save()).toBe(true);
            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (modified) => modified === false);

            const saved = JSON.parse(await ctx.callText("fs.read", [handle.file]));
            const savedItem = saved.items.find((item) => item.id === itemId);
            ctx.expect(savedItem.id).toBe(itemId);
            ctx.expect(savedItem.title).toBe("Confirm sample export");
            ctx.expect(savedItem.done).toBe(true);
            ctx.expect(typeof savedItem.doneDate).toBe("string");
            ctx.expect(savedItem.doneDate.length > 0).toBe(true);
            ctx.expect(savedItem.comment).toBe("Offline fixture edit");
            ctx.expect(savedItem.tag).toBe("later");
            ctx.expect(saved.items.some((item) => item.id === "todo-check")).toBe(true);
            ctx.expect(saved.lists).toEqual(["Inbox", "Personal"]);
            ctx.expect(saved.tags.map(({ name, color }) => ({ name, color }))).toEqual([
                { name: "review", color: "tomato" },
                { name: "later", color: "" },
            ]);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("search filters Todo items by title and tag", async (ctx) => {
        let handle;
        try {
            await resetSample(ctx);
            handle = await openPublishedSample(ctx, "todo", sampleRel);
            const pageId = handle.id;
            await waitForTodoModel(ctx, pageId);

            const modelPath = `pages[${JSON.stringify(pageId)}].editor.app`;
            await ctx.set(`${modelPath}.searchText`, "archive later");
            const model = ctx.app.pages[pageId].editor.app;
            ctx.expect(await model.items.count).toBe(1);
            ctx.expect(await model.items[0].id).toBe("todo-archive");
            ctx.expect(await model.items[0].title).toBe("Archive the sample notes");

            await ctx.set(`${modelPath}.searchText`, "no-match-token");
            ctx.expect(await model.items.count).toBe(0);
            ctx.expect(await model.items.totalCount).toBe(2);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
