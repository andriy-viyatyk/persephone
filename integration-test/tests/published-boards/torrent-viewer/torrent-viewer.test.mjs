import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";

const sampleRel = "torrent-viewer/offline-note.torrent";
const torrentName = "offline-note.txt";

function bencode(value) {
    if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
    if (typeof value === "string") return bencode(Buffer.from(value, "utf8"));
    if (Number.isSafeInteger(value)) return Buffer.from(`i${value}e`);
    if (Array.isArray(value)) return Buffer.concat([Buffer.from("l"), ...value.map(bencode), Buffer.from("e")]);
    if (value && typeof value === "object") {
        const entries = Object.keys(value).sort().flatMap((key) => [bencode(key), bencode(value[key])]);
        return Buffer.concat([Buffer.from("d"), ...entries, Buffer.from("e")]);
    }
    throw new TypeError("Unsupported bencode value.");
}

function makeTorrent() {
    return bencode({
        info: {
            length: 4,
            name: torrentName,
            "piece length": 16_384,
            pieces: Buffer.alloc(20),
        },
    });
}

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

export default [
    test("inspects trackerless torrent metadata without joining the swarm", async (ctx) => {
        let sample;
        try {
            const file = ctx.fixture(`boards-samples/${sampleRel}`);
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, makeTorrent());

            sample = await openPublishedSample(ctx, "torrent-viewer", sampleRel);
            const state = await ctx.waitFor(async (active) => {
                try {
                    const editor = active.app.pages[sample.id].editor;
                    return {
                        mode: await editor.app.mode,
                        online: await editor.app.online,
                        peerCount: await editor.app.peerCount,
                        view: await editor.evaluate("() => ({ name: document.querySelector('#selected-torrent')?.textContent, files: [...document.querySelectorAll('#file-list .row')].map((row) => ({ path: row.title, name: row.children[1]?.textContent, size: row.children[2]?.textContent })) })"),
                    };
                } catch {
                    return null;
                }
            }, (value) => value?.mode === "offline-inspecting"
                && value.online === false
                && value.peerCount === 0
                && value.view?.name === torrentName
                && value.view.files?.length === 1);

            ctx.expect(state.mode).toBe("offline-inspecting");
            ctx.expect(state.online).toBe(false);
            ctx.expect(state.peerCount).toBe(0);
            ctx.expect(state.view.name).toBe(torrentName);
            ctx.expect(state.view.files.map((file) => file.path)).toEqual([torrentName]);
            ctx.expect(state.view.files[0].name).toBe(torrentName);
            ctx.expect(state.view.files[0].size).toBe("4 B");
        } finally {
            await closePublishedSample(ctx, sample);
        }
    }, requiresPublishedBoard),
];
