import { close, open } from "../helpers/pilot-helpers.mjs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

function pngChunk(type, data) {
    const name = Buffer.from(type, "ascii");
    const body = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    body.copy(chunk, 4);
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    return chunk;
}

export function makePng(width, height, rgba = [220, 40, 70, 255]) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const rows = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const rowStart = y * (1 + width * 4);
        for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < 4; channel++) rows[rowStart + 1 + x * 4 + channel] = rgba[channel];
        }
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(rows)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

export function makeWav(seconds = 4, sampleRate = 8000) {
    const sampleCount = seconds * sampleRate;
    const dataSize = sampleCount * 2;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    const samples = Buffer.alloc(dataSize);
    for (let index = 0; index < sampleCount; index++) {
        const value = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 5000);
        samples.writeInt16LE(value, index * 2);
    }
    return Buffer.concat([header, samples]);
}

export async function openVideoPage(ctx, folder, filename = "audio.wav", bytes = makeWav()) {
    const filePath = ctx.fixture(`${folder}/${filename}`);
    await ctx.script(`await app.fs.writeBinary(${JSON.stringify(filePath)}, Buffer.from(${JSON.stringify(bytes.toString("base64"))}, "base64"));`);
    const page = await ctx.call("pages.openFile", [filePath]);
    const root = `pages[${JSON.stringify(page.id)}]`;
    await ctx.waitFor(`${root}.editor.id`, (editor) => editor === "video-view");
    await ctx.waitFor(`${root}.editor.mediaMounted`, (mounted) => mounted === true);
    return { root, id: page.id, filePath };
}

export async function openImagePage(ctx, folder, filename, bytes) {
    const filePath = ctx.fixture(`${folder}/${filename}`);
    await ctx.script(`await app.fs.writeBinary(${JSON.stringify(filePath)}, Buffer.from(${JSON.stringify(bytes.toString("base64"))}, "base64"));`);
    const page = await ctx.call("pages.openFile", [filePath]);
    const root = `pages[${JSON.stringify(page.id)}]`;
    await ctx.waitFor(`${root}.editor.id`, (editor) => editor === "image-view");
    await ctx.waitFor(`${root}.editor.elements`, (elements) => elements.some((element) => element.name === "image-copy" && element.visible));
    return { root, id: page.id, filePath };
}

export async function openHtmlPage(ctx, folder, filename, content) {
    return open(ctx, `${folder}/${filename}`, content, "html-view");
}

export async function openSvgPage(ctx, folder, filename, content) {
    return open(ctx, `${folder}/${filename}`, content, "svg-view");
}

export async function openLogViewPage(ctx, folder, filename, entries) {
    const filePath = ctx.fixture(`${folder}/${filename}`);
    await ctx.call("fs.write", [filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`]);
    const page = await ctx.call("pages.openFile", [filePath]);
    const root = `pages[${JSON.stringify(page.id)}]`;
    await ctx.waitFor(`${root}.editor.id`, (editor) => editor === "log-view");
    return { root, id: page.id, filePath };
}

export async function closeNewManagedLogPage(ctx, previousPageIds) {
    const clearMessage = await ctx.callText("dialogs[0].message", undefined, { dialog: true }).catch(() => "");
    if (clearMessage.toLowerCase().includes("clear all log entries")) {
        await ctx.call("dialogs[0].click", ["Yes"], { dialog: true });
    }
    const pages = await ctx.call("pages.all");
    const page = pages.find((entry) => entry.id === "mcp-ui-log" && !previousPageIds.includes(entry.id));
    if (page) await closePage(ctx, page.id);
}

export async function closeEditorPage(ctx, page) {
    if (!page) return;
    if (await ctx.call(`${page.root}.modified`)) {
        await ctx.call(`${page.root}.editorSwitches.switchTo`, ["monaco"]);
        await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "monaco");
        await ctx.call(`${page.root}.editor.saveFile`, []);
        await ctx.waitFor(`${page.root}.modified`, (modified) => modified === false);
    }
    await closePage(ctx, page.id);
}

export async function closePage(ctx, pageId) {
    if (!pageId) return;
    const closed = await ctx.call("pages.closePage", [pageId], { dialog: true });
    if (closed?.pending) {
        await ctx.waitFor(
            (activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }),
            (title) => title === "Unsaved Changes",
        );
        await ctx.call("dialogs[0].click", ["Don't Save"], { dialog: true });
    }
    await ctx.waitFor("pages.all", (pages) => !pages.some((page) => page.id === pageId));
}

export async function waitForDrawingToastToClear(ctx) {
    const snapshot = await ctx.callText("window.screen.snapshot", [{ maxChars: 12000 }]);
    if (snapshot.includes("Failed to open SVG in Drawing Editor")) {
        await ctx.call("window.screen.click", ['[role="alert"] [data-part="close"] button']);
    }
    await ctx.waitFor(
        (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
        (snapshot) => !snapshot.includes("Failed to open SVG in Drawing Editor"),
    );
}

export async function openMermaidPage(ctx, folder, filename, content) {
    return open(ctx, `${folder}/${filename}`, content, "mermaid-view");
}

export async function closeMermaidPage(ctx, page) {
    if (page) await close(ctx, page.id);
}
