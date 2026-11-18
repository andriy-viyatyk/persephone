import { readFile } from "node:fs/promises";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";

const sampleRel = "notebook/sample.note.json";
const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

async function resetSample(ctx) {
    const sampleText = await readFile(ctx.file("../../../fixtures/boards-samples/notebook/sample.note.json"), "utf8");
    await ctx.app.fs.write(ctx.fixture(`boards-samples/${sampleRel}`), sampleText);
}

async function waitForNotebookModel(ctx, pageId) {
    return ctx.waitFor(
        async (activeContext) => {
            try {
                return await activeContext.app.pages[pageId].editor.app.notesCount;
            } catch {
                return null;
            }
        },
        (count) => count === 2,
    );
}

export default [
    test("opens the sample, reads note vocabulary, and renders Categories & Tags", async (ctx) => {
        let handle;
        try {
            await resetSample(ctx);
            handle = await openPublishedSample(ctx, "notebook", sampleRel);
            const pageId = handle.id;
            await waitForNotebookModel(ctx, pageId);

            const model = ctx.app.pages[pageId].editor.app;
            ctx.expect(await model.notesCount).toBe(2);
            ctx.expect(await model.filteredCount).toBe(2);
            ctx.expect(await model.notes[0].id).toBe("note-alpha");
            ctx.expect(await model.notes[0].title).toBe("Map the sample workflow");
            ctx.expect(await model.notes[0].content).toBe("Synthetic notebook body with lantern-keyword");
            ctx.expect(await model.notes[0].language).toBe("markdown");
            ctx.expect(await model.notes[0].category).toBe("Projects/Local");
            ctx.expect(await model.notes[0].tags).toEqual(["status:active", "idea"]);
            ctx.expect(await model.categories).toEqual(["Projects", "Projects/Local", "Reading"]);
            ctx.expect(await model.tags).toEqual(["idea", "status:active"]);

            const editor = ctx.app.pages[pageId].editor;
            const tabs = await editor.tabs;
            ctx.expect(tabs.some((tab) => tab.id === "board-secondary:nav" && tab.title === "Categories & Tags")).toBe(true);
            await handle.editor.switchTab("board-secondary:nav");
            const snapshot = await handle.editor.snapshot();
            for (const text of ["Projects", "Local", "Reading", "idea", "status:"]) ctx.expect(snapshot).toContain(text);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("adds and edits a note, then saves it to the Notebook file", async (ctx) => {
        let handle;
        try {
            await resetSample(ctx);
            handle = await openPublishedSample(ctx, "notebook", sampleRel);
            const pageId = handle.id;
            await waitForNotebookModel(ctx, pageId);

            const created = await ctx.app.pages[pageId].editor.app.addNote();
            ctx.expect(typeof created.id).toBe("string");
            ctx.expect(created.id.length > 0).toBe(true);
            await ctx.app.pages[pageId].editor.app.updateNoteTitle(created.id, "Saved synthetic note");
            await ctx.app.pages[pageId].editor.app.updateNoteCategory(created.id, "Projects/Export");
            await ctx.app.pages[pageId].editor.app.updateNoteContent(created.id, "Persisted fixture content");
            await ctx.app.pages[pageId].editor.app.addNoteTag(created.id, "test:offline");

            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (modified) => modified === true);
            await ctx.app.pages[pageId].editorSwitches.switchTo("monaco");
            await ctx.app.pages[pageId].editor.saveFile();
            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (modified) => modified === false);

            const saved = JSON.parse(await ctx.callText("fs.read", [handle.file]));
            const savedNote = saved.notes.find((note) => note.id === created.id);
            ctx.expect(savedNote.id).toBe(created.id);
            ctx.expect(savedNote.title).toBe("Saved synthetic note");
            ctx.expect(savedNote.category).toBe("Projects/Export");
            ctx.expect(savedNote.content.language).toBe("plaintext");
            ctx.expect(savedNote.content.content).toBe("Persisted fixture content");
            ctx.expect(savedNote.tags).toContain("test:offline");
            ctx.expect(saved.notes.some((note) => note.id === "note-alpha")).toBe(true);
            ctx.expect(saved.notes.some((note) => note.id === "note-beta")).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("search finds a Notebook note in its content", async (ctx) => {
        let handle;
        try {
            await resetSample(ctx);
            handle = await openPublishedSample(ctx, "notebook", sampleRel);
            const pageId = handle.id;
            await waitForNotebookModel(ctx, pageId);

            const model = ctx.app.pages[pageId].editor.app;
            await model.setSearchText("lantern-keyword");
            ctx.expect(await model.filteredCount).toBe(1);
            ctx.expect(await model.filteredNotes[0].id).toBe("note-alpha");
            ctx.expect(await model.filteredNotes[0].content).toBe("Synthetic notebook body with lantern-keyword");

            await model.setSearchText("absent-token");
            ctx.expect(await model.filteredCount).toBe(0);
            ctx.expect(await model.notesCount).toBe(2);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
