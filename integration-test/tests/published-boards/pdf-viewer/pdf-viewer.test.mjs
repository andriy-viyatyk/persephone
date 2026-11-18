import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";

const sampleRel = "pdf-viewer/sample.pdf";
const pageText = [
    "ORBITAL SAMPLE PAGE ONE",
    "COPPER SAMPLE PAGE TWO",
    "LANTERN SAMPLE PAGE THREE",
];

function buildPdfFixture() {
    const streams = pageText.map((line) => `BT /F1 18 Tf 72 720 Td (${line}) Tj ET\n`);
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents 4 0 R >>",
        `<< /Length ${Buffer.byteLength(streams[0], "ascii")} >>\nstream\n${streams[0]}endstream`,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>",
        `<< /Length ${Buffer.byteLength(streams[1], "ascii")} >>\nstream\n${streams[1]}endstream`,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>",
        `<< /Length ${Buffer.byteLength(streams[2], "ascii")} >>\nstream\n${streams[2]}endstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];

    let pdf = "%PDF-1.4\n% deterministic integration fixture\n";
    const offsets = [0];
    for (let index = 0; index < objects.length; index += 1) {
        offsets.push(Buffer.byteLength(pdf, "ascii"));
        pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, "ascii");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, "ascii");
}

async function writePdfSample(ctx) {
    const file = ctx.fixture(`boards-samples/${sampleRel}`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, buildPdfFixture());
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

async function waitForStats(ctx, id) {
    return ctx.waitFor(
        async (active) => {
            try {
                return await active.app.pages[id].editor.app.getStats();
            } catch {
                return null;
            }
        },
        (stats) => stats?.pageCount === 3,
    );
}

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

export default [
    test("opens and renders a PDF in the registered PDF Viewer board", async (ctx) => {
        let sample;
        try {
            await writePdfSample(ctx);
            sample = await openPublishedSample(ctx, "pdf-viewer", sampleRel);
            ctx.expect((await sample.editor.id).startsWith("board-editor:")).toBe(true);
            ctx.expect(await sample.editor.frameReady).toBe(true);
            await waitForModel(ctx, sample.id, "isLoaded", (value) => value === true);
            const stats = await waitForStats(ctx, sample.id);
            ctx.expect(stats.pageCount).toBe(3);

            const rendered = await ctx.waitFor(
                async (active) => {
                    try {
                        return await active.app.pages[sample.id].editor.evaluate(
                            "() => { const page = document.querySelector('#viewer')?.contentDocument?.querySelector('.page'); return Boolean(page?.querySelector('canvas') && page.getBoundingClientRect().height > 0); }",
                        );
                    } catch {
                        return false;
                    }
                },
                (value) => value === true,
            );
            ctx.expect(rendered).toBe(true);
        } finally {
            await closePublishedSample(ctx, sample);
        }
    }, requiresPublishedBoard),

    test("reads the PDF page count and page text", async (ctx) => {
        let sample;
        try {
            await writePdfSample(ctx);
            sample = await openPublishedSample(ctx, "pdf-viewer", sampleRel);
            await waitForModel(ctx, sample.id, "isLoaded", (value) => value === true);
            const stats = await waitForStats(ctx, sample.id);
            ctx.expect({
                pageCount: stats.pageCount,
                hasTextLayer: stats.hasTextLayer,
                pagesWithText: stats.pagesWithText,
            }).toEqual({ pageCount: 3, hasTextLayer: true, pagesWithText: 3 });

            const text = await ctx.callText(
                `pages[${JSON.stringify(sample.id)}].editor.app.getText`,
                [2, 2],
            );
            ctx.expect(text).toContain(pageText[1]);
            ctx.expect(text.includes(pageText[0])).toBe(false);
            ctx.expect(text.includes(pageText[2])).toBe(false);
        } finally {
            await closePublishedSample(ctx, sample);
        }
    }, requiresPublishedBoard),

    test("searches the PDF and reports the matching page", async (ctx) => {
        let sample;
        try {
            await writePdfSample(ctx);
            sample = await openPublishedSample(ctx, "pdf-viewer", sampleRel);
            await waitForModel(ctx, sample.id, "isLoaded", (value) => value === true);
            await waitForStats(ctx, sample.id);

            const result = await sample.editor.app.search(pageText[1]);
            ctx.expect(result.hitCount).toBe(1);
            ctx.expect(result.pages).toEqual([2]);
            ctx.expect(result.hits.length).toBe(1);
            ctx.expect(result.hits[0].page).toBe(2);
            ctx.expect(result.hits[0].match).toBe(pageText[1]);
            ctx.expect(result.hits[0].snippet).toContain(pageText[1]);
        } finally {
            await closePublishedSample(ctx, sample);
        }
    }, requiresPublishedBoard),

    test("goToPage moves the PDF viewer to the requested page", async (ctx) => {
        let sample;
        try {
            await writePdfSample(ctx);
            sample = await openPublishedSample(ctx, "pdf-viewer", sampleRel);
            await waitForModel(ctx, sample.id, "isLoaded", (value) => value === true);
            await waitForStats(ctx, sample.id);

            ctx.expect(await sample.editor.app.goToPage(3)).toBe(3);
            const currentPage = await waitForModel(ctx, sample.id, "currentPage", (value) => value === 3);
            ctx.expect(currentPage).toBe(3);
        } finally {
            await closePublishedSample(ctx, sample);
        }
    }, requiresPublishedBoard),
];
