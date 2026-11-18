import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";

const sampleRel = "force-graph/sample.fg.json";
const sample = {
    nodes: [
        { id: "alpha", title: "Alpha" },
        { id: "beta", title: "Beta" },
    ],
    links: [{ source: "alpha", target: "beta" }],
};
const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

async function sampleFile(ctx) {
    const file = ctx.fixture(`boards-samples/${sampleRel}`);
    await mkdir(dirname(file), { recursive: true });
    return file;
}

async function writeGraph(ctx, json) {
    const file = await sampleFile(ctx);
    await writeFile(file, JSON.stringify(json, null, 2), "utf8");
}

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

export default [
    test("opens a graph and reads its nodes and links", async (ctx) => {
        let handle;
        try {
            await writeGraph(ctx, sample);
            handle = await openPublishedSample(ctx, "force-graph", sampleRel);
            const nodeCount = await waitForModel(ctx, handle.id, "nodeCount", (value) => value === 2);
            ctx.expect(nodeCount).toBe(2);

            const editor = ctx.app.pages[handle.id].editor;
            const nodeIds = await editor.app.nodes.ids;
            ctx.expect(nodeIds).toEqual(["alpha", "beta"]);
            const alpha = await editor.app.getNode("alpha");
            const beta = await editor.app.getNode("beta");
            ctx.expect(alpha.id).toBe("alpha");
            ctx.expect(alpha.title).toBe("Alpha");
            ctx.expect(beta.id).toBe("beta");
            ctx.expect(beta.title).toBe("Beta");

            const links = await editor.app.links;
            ctx.expect(links.length).toBe(1);
            ctx.expect(links.some(({ source, target }) => source === "alpha" && target === "beta")).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("saves node and link edits to the sample", async (ctx) => {
        let handle;
        try {
            await writeGraph(ctx, sample);
            handle = await openPublishedSample(ctx, "force-graph", sampleRel);
            await waitForModel(ctx, handle.id, "nodeCount", (value) => value === 2);

            const editor = ctx.app.pages[handle.id].editor;
            const gammaId = await editor.app.addNode({ title: "Gamma" });
            await editor.app.setNodeProps("beta", { title: "Beta Updated" });
            ctx.expect(await editor.app.addLink("beta", gammaId)).toBe(true);
            await editor.app.save();

            const saved = JSON.parse(await ctx.callText("fs.read", [handle.file]));
            const beta = saved.nodes.find(({ id }) => id === "beta");
            const gamma = saved.nodes.find(({ id }) => id === gammaId);
            ctx.expect(beta.title).toBe("Beta Updated");
            ctx.expect(gamma.id).toBe(gammaId);
            ctx.expect(gamma.title).toBe("Gamma");
            ctx.expect(saved.links.some(({ source, target }) => source === "beta" && target === gammaId)).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("shows an error for malformed graph JSON", async (ctx) => {
        let handle;
        try {
            const file = await sampleFile(ctx);
            await writeFile(file, "{\"nodes\":[", "utf8");
            handle = await openPublishedSample(ctx, "force-graph", sampleRel);
            const error = await waitForModel(ctx, handle.id, "error", (value) => typeof value === "string" && value.length > 0);
            ctx.expect(error.length > 0).toBe(true);

            const editor = ctx.app.pages[handle.id].editor;
            const errorPanelVisible = await editor.evaluate(
                "() => !document.querySelector('#error-panel')?.hidden",
            );
            ctx.expect(errorPanelVisible).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
