import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";
import { writeExcelSample } from "../office-samples.mjs";

async function waitForExcelModel(ctx, pageId) {
    return ctx.waitFor(
        async (activeContext) => {
            try {
                return await activeContext.app.pages[pageId].editor.app.isLoaded;
            } catch {
                return null;
            }
        },
        (loaded) => loaded === true,
        { timeout: 15000 },
    );
}

export default [
    test("opens and renders a two-sheet workbook", async (ctx) => {
        await writeExcelSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "excel-viewer", "excel-viewer/sample.xlsx");
            await waitForExcelModel(ctx, handle.id);
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(await editor.app.sheetNames).toEqual(["Summary", "Details"]);
            const stats = await editor.app.getStats();
            ctx.expect(stats.sheetCount).toBe(2);
            ctx.expect(await editor.evaluate("() => document.querySelector('#grid')?.childElementCount > 0")).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("reads workbook cells including a cached formula result", async (ctx) => {
        await writeExcelSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "excel-viewer", "excel-viewer/sample.xlsx");
            await waitForExcelModel(ctx, handle.id);
            const cells = await ctx.app.pages[handle.id].editor.app.getCells("A1:B4", { sheet: "Summary", raw: true });
            ctx.expect(cells.source).toBe("sheet");
            ctx.expect(cells.rows).toEqual([
                { row: 1, cells: ["Item", "Count"] },
                { row: 2, cells: ["Apples", 2] },
                { row: 3, cells: ["Oranges", 3] },
                { row: 4, cells: ["Total", 5] },
            ]);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("switches the visible worksheet", async (ctx) => {
        await writeExcelSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "excel-viewer", "excel-viewer/sample.xlsx");
            await waitForExcelModel(ctx, handle.id);
            const change = await ctx.app.pages[handle.id].editor.app.goToSheet("Details");
            ctx.expect(change.sheet).toBe("Details");
            ctx.expect(change.changed).toBe(true);
            ctx.expect(change.hasGrid).toBe(true);
            ctx.expect(change.rowCount).toBe(2);
            ctx.expect(await ctx.waitFor(
                `pages[${JSON.stringify(handle.id)}].editor.app.activeSheet`,
                (sheet) => sheet === "Details",
                { timeout: 15000 },
            )).toBe("Details");
            const cells = await ctx.app.pages[handle.id].editor.app.getCells("A1:B2", { raw: true });
            ctx.expect(cells.rows.map((row) => row.cells)).toEqual([
                ["Field", "Value"],
                ["Source", "Details only"],
            ]);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),
];
