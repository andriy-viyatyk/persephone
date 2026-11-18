import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";

const samplePath = "sqlite-viewer/sample.db";

async function waitForDatabase(ctx, pageId) {
    return ctx.waitFor(
        async (activeContext) => {
            try {
                return await activeContext.app.pages[pageId].editor.app.getStats();
            } catch {
                return null;
            }
        },
        (stats) => stats?.tableCount === 2,
        { timeout: 15000 },
    );
}

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

export default [
    test("opens the sample and lists its tables in the model and Tables view", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedSample(ctx, "sqlite-viewer", samplePath);
            const pageId = handle.id;
            const stats = await waitForDatabase(ctx, pageId);
            ctx.expect(stats.tableCount).toBe(2);

            const result = await ctx.app.pages[pageId].editor.app.getTables();
            const tables = result.tables.map(({ name, type, rowCount }) => ({ name, type, rowCount }));
            tables.sort((left, right) => left.name.localeCompare(right.name));
            ctx.expect(tables).toEqual([
                { name: "authors", type: "table", rowCount: 3 },
                { name: "books", type: "table", rowCount: 3 },
            ]);

            const editor = ctx.app.pages[pageId].editor;
            const tabs = await editor.tabs;
            ctx.expect(tabs.some((tab) => tab.id === "board-secondary:tables" && tab.title === "Tables")).toBe(true);
            await editor.switchTab("board-secondary:tables");
            const snapshot = await editor.snapshot();
            ctx.expect(snapshot).toContain("authors");
            ctx.expect(snapshot).toContain("books");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("returns the expected SELECT rows", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedSample(ctx, "sqlite-viewer", samplePath);
            await waitForDatabase(ctx, handle.id);

            const result = await ctx.app.pages[handle.id].editor.app.query(
                "SELECT id, name FROM authors ORDER BY id",
                { format: "rows" },
            );
            ctx.expect(result.columns).toEqual(["id", "name"]);
            ctx.expect(result.rows).toEqual([
                { row: 1, cells: [1, "Sample Author 1"] },
                { row: 2, cells: [2, "Sample Author 2"] },
                { row: 3, cells: [3, "Sample Author 3"] },
            ]);
            ctx.expect(result.rowCount).toBe(3);
            ctx.expect(result.totalRows).toBe(3);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("reports an invalid SELECT as an error", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedSample(ctx, "sqlite-viewer", samplePath);
            await waitForDatabase(ctx, handle.id);

            let errorMessage = "";
            try {
                await ctx.app.pages[handle.id].editor.app.query("SELECT * FROM no_such_table");
            } catch (error) {
                errorMessage = typeof error?.message === "string" ? error.message : String(error);
            }
            ctx.expect(errorMessage.length > 0).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("refuses writes and leaves the database bytes unchanged", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedSample(ctx, "sqlite-viewer", samplePath);
            await waitForDatabase(ctx, handle.id);
            const beforeHash = sha256(await readFile(handle.file));

            let writeError = null;
            try {
                await ctx.app.pages[handle.id].editor.app.query(
                    "UPDATE authors SET name = 'Changed' WHERE id = 1",
                );
            } catch (error) {
                writeError = error;
            }
            const writeMessage = typeof writeError?.message === "string" ? writeError.message : String(writeError);
            ctx.expect(writeMessage.toLowerCase().includes("readonly database")).toBe(true);

            const result = await ctx.app.pages[handle.id].editor.app.query(
                "SELECT id, name FROM authors WHERE id = 1",
                { format: "rows" },
            );
            ctx.expect(result.rows).toEqual([{ row: 1, cells: [1, "Sample Author 1"] }]);
            const afterHash = sha256(await readFile(handle.file));
            ctx.expect(afterHash).toBe(beforeHash);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),
];
