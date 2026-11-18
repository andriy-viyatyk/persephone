import { writeFile } from "node:fs/promises";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample, samePublishedRoot } from "../helpers.mjs";

function minimalImportPe() {
    const bytes = Buffer.alloc(0x600);
    const u16 = (offset, value) => bytes.writeUInt16LE(value, offset);
    const u32 = (offset, value) => bytes.writeUInt32LE(value, offset);
    const u64 = (offset, value) => bytes.writeBigUInt64LE(BigInt(value), offset);
    const ascii = (offset, value) => bytes.write(value, offset, "ascii");

    ascii(0, "MZ");
    u32(0x3c, 0x80);
    ascii(0x80, "PE\0\0");

    const coff = 0x84;
    u16(coff, 0x8664);
    u16(coff + 2, 2);
    u16(coff + 16, 0xf0);
    u16(coff + 18, 0x0022);

    const optional = coff + 20;
    u16(optional, 0x20b);
    u32(optional + 4, 0x200);
    u32(optional + 16, 0x1000);
    u32(optional + 20, 0x1000);
    u64(optional + 24, 0x140000000n);
    u32(optional + 32, 0x1000);
    u32(optional + 36, 0x200);
    u32(optional + 56, 0x3000);
    u32(optional + 60, 0x200);
    u16(optional + 68, 3);
    u32(optional + 108, 16);
    u32(optional + 120, 0x2000);
    u32(optional + 124, 40);

    const sections = optional + 0xf0;
    ascii(sections, ".text");
    u32(sections + 8, 1);
    u32(sections + 12, 0x1000);
    u32(sections + 16, 0x200);
    u32(sections + 20, 0x200);
    u32(sections + 36, 0x60000020);

    const idata = sections + 40;
    ascii(idata, ".idata");
    u32(idata + 8, 0x80);
    u32(idata + 12, 0x2000);
    u32(idata + 16, 0x200);
    u32(idata + 20, 0x400);
    u32(idata + 36, 0xc0000040);

    // One IMAGE_IMPORT_DESCRIPTOR maps the lookup table, DLL name, and hint/name through .idata.
    u32(0x400, 0x2040);
    u32(0x40c, 0x2060);
    u32(0x410, 0x2050);
    u64(0x440, 0x2070n);
    u64(0x450, 0x2070n);
    ascii(0x460, "KERNEL32.dll\0");
    u16(0x470, 0);
    ascii(0x472, "ExitProcess\0");
    return bytes;
}

async function openPeSample(ctx) {
    const file = ctx.fixture("boards-samples/pe-viewer/minimal-import.exe");
    await writeFile(file, minimalImportPe());
    return openPublishedSample(ctx, "pe-viewer", "pe-viewer/minimal-import.exe");
}

export default [
    test("PE viewer opens the sample and shows its machine headers", async (ctx) => {
        const handle = await openPeSample(ctx);
        try {
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(samePublishedRoot(await editor.boardRoot, handle.root)).toBe(true);
            await ctx.waitFor(`pages[${JSON.stringify(handle.id)}].editor.frameReady`, (ready) => ready === true);
            await ctx.waitFor(() => editor.evaluate("() => document.querySelector('#tabs').classList.contains('show')"), (visible) => visible === true, { timeout: 10000 });
            const overview = await editor.evaluate("() => document.querySelector('#panel').innerText");
            ctx.expect(overview.includes("PE32+")).toBe(true);
            ctx.expect(overview.includes("x64")).toBe(true);
            await editor.click("text=Headers");
            const headers = await editor.evaluate("() => document.querySelector('#panel').innerText");
            ctx.expect(headers).toContain("Machine");
            ctx.expect(headers).toContain("x64 (AMD64)");
            ctx.expect(headers).toContain("Sections");
            ctx.expect(headers).toContain("2");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("PE viewer lists both sample sections", async (ctx) => {
        const handle = await openPeSample(ctx);
        try {
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(samePublishedRoot(await editor.boardRoot, handle.root)).toBe(true);
            await editor.click("text=Sections");
            const sections = await editor.evaluate("() => document.querySelector('#panel').innerText");
            ctx.expect(sections).toContain("Sections (2)");
            ctx.expect(sections).toContain(".text");
            ctx.expect(sections).toContain(".idata");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("PE viewer renders the sample import library and symbol", async (ctx) => {
        const handle = await openPeSample(ctx);
        try {
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(samePublishedRoot(await editor.boardRoot, handle.root)).toBe(true);
            await editor.click("text=Imports");
            await ctx.waitFor(() => editor.evaluate("() => document.querySelector('#panel').innerText"), (text) => text.includes("KERNEL32.dll"), { timeout: 10000 });
            const imports = await editor.evaluate("() => document.querySelector('#panel').innerText");
            ctx.expect(imports).toContain("KERNEL32.dll");
            ctx.expect(imports).toContain("1 libraries, 1 imported symbols.");
            if (!(await editor.evaluate("() => document.querySelector('details.imp').open"))) {
                await editor.click("details.imp summary");
            }
            const expandedImports = await editor.evaluate("() => document.querySelector('#panel').innerText");
            ctx.expect(expandedImports).toContain("ExitProcess");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("PE viewer displays a visible parse error for a corrupt executable", async (ctx) => {
        const handle = await openPublishedSample(ctx, "pe-viewer", "pe-viewer/corrupt.exe");
        try {
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(samePublishedRoot(await editor.boardRoot, handle.root)).toBe(true);
            await ctx.waitFor(() => editor.evaluate("() => document.querySelector('#state').classList.contains('show') && document.querySelector('#state').classList.contains('error')"), (error) => error === true, { timeout: 10000 });
            const state = await editor.evaluate("() => ({ text: document.querySelector('#state').innerText, tabsVisible: document.querySelector('#tabs').classList.contains('show') })");
            ctx.expect(state.text.startsWith("Could not open this file.")).toBe(true);
            ctx.expect(state.tabsVisible).toBe(false);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),
];
