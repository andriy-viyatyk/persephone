import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";

const sampleRel = "drawio-viewer/sample.drawio";
const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

async function waitForModel(ctx, id, member, predicate) {
    return ctx.waitFor(
        async (active) => {
            try {
                return await active.app.pages[id].editor.app[member];
            } catch {
                return null;
            }
        },
        predicate,
    );
}

async function waitForStats(ctx, id) {
    return ctx.waitFor(
        async (active) => {
            try {
                return await active.app.pages[id].editor.app.getStats();
            } catch {
                return null;
            }
        },
        (stats) => stats?.pageCount === 2,
    );
}

export default [
    test("opens and renders a two-page draw.io file in the registered viewer", async (ctx) => {
        let sample;
        try {
            sample = await openPublishedSample(ctx, "drawio-viewer", sampleRel);
            ctx.expect((await sample.editor.id).startsWith("board-editor:")).toBe(true);
            ctx.expect(await sample.editor.frameReady).toBe(true);
            await waitForModel(ctx, sample.id, "isLoaded", (value) => value === true);
            await waitForStats(ctx, sample.id);
            await sample.editor.waitFor({ selector: "#canvas svg", state: "visible" });
        } finally {
            await closePublishedSample(ctx, sample);
        }
    }, requiresPublishedBoard),

    test("reads page names, shapes and labels from both draw.io pages", async (ctx) => {
        let sample;
        try {
            sample = await openPublishedSample(ctx, "drawio-viewer", sampleRel);
            await waitForModel(ctx, sample.id, "isLoaded", (value) => value === true);
            const stats = await waitForStats(ctx, sample.id);
            ctx.expect(stats.pageCount).toBe(2);
            ctx.expect(stats.pages.map(({ name }) => name)).toEqual(["Intake", "Archive"]);
            ctx.expect(stats.pages.map(({ shapes }) => shapes)).toEqual([2, 2]);

            const firstPage = await sample.editor.app.getShapes(1);
            const secondPage = await sample.editor.app.getShapes(2);
            ctx.expect(firstPage.map(({ text }) => text)).toEqual(["Intake Queue", "Validate Record"]);
            ctx.expect(secondPage.map(({ text }) => text)).toEqual(["Archive Store", "Retention Note"]);

            const labels = await ctx.callText(
                `pages[${JSON.stringify(sample.id)}].editor.app.getText`,
                ["all"],
            );
            for (const label of ["Intake Queue", "Validate Record", "Archive Store", "Retention Note"]) {
                ctx.expect(labels).toContain(label);
            }
        } finally {
            await closePublishedSample(ctx, sample);
        }
    }, requiresPublishedBoard),

    test("switches the rendered draw.io page through its model", async (ctx) => {
        let sample;
        try {
            sample = await openPublishedSample(ctx, "drawio-viewer", sampleRel);
            await waitForModel(ctx, sample.id, "isLoaded", (value) => value === true);
            await waitForStats(ctx, sample.id);

            const navigation = await sample.editor.app.goToPage("Archive");
            ctx.expect(navigation).toEqual({ page: 2, pageName: "Archive", shapes: 2, connections: 0 });
            ctx.expect(await waitForModel(ctx, sample.id, "currentPage", (value) => value === 2)).toBe(2);
            const activeTab = await ctx.callText(
                `pages[${JSON.stringify(sample.id)}].editor.evaluate`,
                ["() => document.querySelector('#tabs .tab.active')?.textContent"],
            );
            ctx.expect(activeTab).toBe("Archive");
        } finally {
            await closePublishedSample(ctx, sample);
        }
    }, requiresPublishedBoard),
];
