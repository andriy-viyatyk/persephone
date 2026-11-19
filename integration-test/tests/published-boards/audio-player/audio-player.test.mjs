import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedBoard, openPublishedSample } from "../helpers.mjs";

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

function createWavBuffer(durationSeconds, sampleRate = 8000) {
    const sampleCount = Math.round(durationSeconds * sampleRate);
    const dataBytes = sampleCount * 2;
    const buffer = Buffer.alloc(44 + dataBytes);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataBytes, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataBytes, 40);

    for (let index = 0; index < sampleCount; index++) {
        const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 4000);
        buffer.writeInt16LE(sample, 44 + index * 2);
    }
    return buffer;
}

async function writeFixture(ctx, relativePath, content) {
    const file = ctx.fixture(relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
    return file;
}

function comparablePath(value) {
    return typeof value === "string"
        ? value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase()
        : "";
}

function samePath(left, right) {
    return comparablePath(left) === comparablePath(right);
}

function waitForModel(ctx, editor) {
    return ctx.waitFor(
        async () => {
            try {
                return await editor.app.$help;
            } catch {
                return null;
            }
        },
        (help) => typeof help === "string" && help.length > 0,
    );
}

function formatDuration(seconds) {
    const wholeSeconds = Math.floor(seconds);
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

export default [
    test("plays and pauses a generated WAV in the full Audio Player host", async (ctx) => {
        const durationSeconds = 3;
        const filename = "synthetic-full-host.wav";
        const wavPath = await writeFixture(
            ctx,
            "boards-samples/audio-player/full-host/" + filename,
            createWavBuffer(durationSeconds),
        );
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "audio-player");
            await waitForModel(ctx, handle.editor);
            const app = handle.editor.app;
            await app.play(wavPath);

            const playing = await ctx.waitFor(
                () => app.getNowPlaying(),
                (state) => state !== null && samePath(state.href, wavPath)
                    && state.paused === false && Number.isFinite(state.duration),
            );
            ctx.expect(playing.title).toBe(filename);
            ctx.expect(Math.abs(playing.duration - durationSeconds) < 0.25).toBe(true);

            const rendered = await ctx.waitFor(
                () => handle.editor.evaluate(`() => ({
                    playState: document.querySelector('#play')?.dataset.state,
                    duration: document.querySelector('#duration')?.textContent?.trim()
                })`),
                (state) => state?.playState === "playing" && state.duration === formatDuration(durationSeconds),
            );
            ctx.expect(rendered.playState).toBe("playing");
            ctx.expect(rendered.duration).toBe(formatDuration(durationSeconds));

            await ctx.waitFor(
                () => app.getNowPlaying(),
                (state) => state !== null && samePath(state.href, wavPath) && state.position > 0,
            );
            await app.pause();
            const paused = await ctx.waitFor(
                () => app.getNowPlaying(),
                (state) => state !== null && samePath(state.href, wavPath) && state.paused === true,
            );
            ctx.expect(paused.paused).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("opens a generated WAV in light mode and renders its title and duration", async (ctx) => {
        const durationSeconds = 4.2;
        const filename = "synthetic-light-mode.wav";
        // The track chip shows the file name without its extension (visualizer.js getTrackInfo).
        const displayTitle = "synthetic-light-mode";
        await writeFixture(
            ctx,
            "boards-samples/audio-player/light-mode/" + filename,
            createWavBuffer(durationSeconds),
        );
        let handle;
        try {
            handle = await openPublishedSample(
                ctx,
                "audio-player",
                `audio-player/light-mode/${filename}`,
            );
            const state = await ctx.waitFor(
                () => handle.editor.evaluate(`() => ({
                    mode: document.body.dataset.mode,
                    duration: document.querySelector('#duration')?.textContent?.trim(),
                    title: document.querySelector('#track-chip-title')?.textContent?.trim()
                })`),
                (value) => value?.mode === "light" && value.duration && value.duration !== "0:00"
                    && value.title === displayTitle,
            );
            ctx.expect(state.mode).toBe("light");
            ctx.expect(state.title).toBe(displayTitle);
            const [minutes, seconds] = state.duration.split(":").map(Number);
            const renderedSeconds = minutes * 60 + seconds;
            ctx.expect(Math.abs(renderedSeconds - durationSeconds) <= 1).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("imports an M3U queue and moves between its WAV entries", async (ctx) => {
        const firstName = "first-track.wav";
        const secondName = "second-track.wav";
        await writeFixture(ctx, "boards-samples/audio-player/playlist/" + firstName, createWavBuffer(30));
        await writeFixture(ctx, "boards-samples/audio-player/playlist/" + secondName, createWavBuffer(30));
        await writeFixture(
            ctx,
            "boards-samples/audio-player/playlist/synthetic-queue.m3u",
            `#EXTM3U\n${firstName}\n${secondName}\n`,
        );
        const firstPath = ctx.fixture(`boards-samples/audio-player/playlist/${firstName}`);
        const secondPath = ctx.fixture(`boards-samples/audio-player/playlist/${secondName}`);
        let handle;
        try {
            handle = await openPublishedSample(
                ctx,
                "audio-player",
                "audio-player/playlist/synthetic-queue.m3u",
            );
            await waitForModel(ctx, handle.editor);
            const previewCount = await ctx.waitFor(
                () => handle.editor.evaluate("() => document.querySelectorAll('#playlist-preview-list li').length"),
                (count) => count === 2,
            );
            ctx.expect(previewCount).toBe(2);
            await handle.editor.click("#playlist-import-play");

            const app = handle.editor.app;
            const first = await ctx.waitFor(
                () => app.getNowPlaying(),
                (state) => state !== null && samePath(state.href, firstPath),
            );
            ctx.expect(samePath(first.href, firstPath)).toBe(true);
            await app.next();
            const second = await ctx.waitFor(
                () => app.getNowPlaying(),
                (state) => state !== null && samePath(state.href, secondPath),
            );
            ctx.expect(samePath(second.href, secondPath)).toBe(true);

            await app.previous();
            const returnedByModel = await ctx.waitFor(
                () => app.getNowPlaying(),
                (state) => state !== null && samePath(state.href, firstPath),
            );
            ctx.expect(samePath(returnedByModel.href, firstPath)).toBe(true);

            // The transport controls are revealed on hover, as for a user.
            await handle.editor.hover(".transport");
            await handle.editor.click('[data-name="next-track"]');
            const secondAgain = await ctx.waitFor(
                () => app.getNowPlaying(),
                (state) => state !== null && samePath(state.href, secondPath),
            );
            ctx.expect(samePath(secondAgain.href, secondPath)).toBe(true);

            await handle.editor.click('[data-name="previous-track"]');
            const returned = await ctx.waitFor(
                () => app.getNowPlaying(),
                (state) => state !== null && samePath(state.href, firstPath),
            );
            ctx.expect(samePath(returned.href, firstPath)).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("lists and searches tracks from a delivered music catalog", async (ctx) => {
        const catalog = {
            type: "link-editor",
            links: [
                { id: "synthetic-amber", title: "Amber Signal", href: "file:///synthetic/amber.wav" },
                { id: "synthetic-violet", title: "Violet Horizon", href: "file:///synthetic/violet.wav" },
            ],
            state: {},
        };
        await writeFixture(
            ctx,
            "boards-samples/audio-player/catalog/synthetic-catalog.music.link.json",
            JSON.stringify(catalog, null, 2) + "\n",
        );
        let handle;
        try {
            handle = await openPublishedSample(
                ctx,
                "audio-player",
                "audio-player/catalog/synthetic-catalog.music.link.json",
            );
            await waitForModel(ctx, handle.editor);
            const app = handle.editor.app;
            const listed = await ctx.waitFor(
                () => app.listTracks({ limit: 10 }),
                (result) => result?.total === 2,
            );
            ctx.expect(listed.items.map(({ id }) => id).sort()).toEqual(["synthetic-amber", "synthetic-violet"]);
            ctx.expect(listed.items.map(({ title }) => title).sort()).toEqual(["Amber Signal", "Violet Horizon"]);

            const searched = await app.listTracks({ text: "Violet Hor", limit: 10 });
            ctx.expect(searched.total).toBe(1);
            ctx.expect(searched.items[0].id).toBe("synthetic-violet");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
