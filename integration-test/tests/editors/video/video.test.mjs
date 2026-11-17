import { test } from "../../../lib/context.mjs";
import { closePage, makeWav, openVideoPage } from "../helpers.mjs";

async function videoElements(ctx, root) {
    return ctx.call(`${root}.editor.elements`);
}

async function closeVideoPage(ctx, page) {
    if (page) await closePage(ctx, page.id);
}

export default [
    test("Video Player streams a generated WAV and controls live playback state", async (ctx) => {
        let page;
        let startingMute;
        try {
            page = await openVideoPage(ctx, "us-2053/local-playback");
            const editor = `${page.root}.editor`;
            ctx.expect(await ctx.call(`${editor}.source`)).toBe(page.filePath);
            ctx.expect(await ctx.call(`${editor}.format`)).toBe("audio");
            ctx.expect(await ctx.call(`${editor}.mediaMounted`)).toBe(true);
            ctx.expect(await ctx.waitFor(`${editor}.duration`, (duration) => typeof duration === "number" && duration > 0)).toBeTruthy();

            await ctx.call(`${editor}.play`, []);
            ctx.expect(await ctx.waitFor(`${editor}.playerState`, (state) => state === "playing")).toBe("playing");
            ctx.expect(await ctx.call(`${editor}.paused`)).toBe(false);
            await ctx.call(`${editor}.pause`, []);
            ctx.expect(await ctx.waitFor(`${editor}.paused`, (paused) => paused === true)).toBe(true);
            ctx.expect(await ctx.call(`${editor}.playerState`)).toBe("paused");

            await ctx.call(`${editor}.seek`, [1.5]);
            ctx.expect(await ctx.waitFor(`${editor}.currentTime`, (time) => time === 1.5)).toBe(1.5);
            startingMute = await ctx.call(`${editor}.pageMuted`);
            await ctx.call(`${editor}.toggleMute`, []);
            ctx.expect(await ctx.waitFor(`${editor}.muted`, (muted) => muted === !startingMute)).toBe(!startingMute);
            ctx.expect(await ctx.call(`${editor}.pageMuted`)).toBe(!startingMute);
            await ctx.call(`${editor}.toggleMute`, []);
            ctx.expect(await ctx.waitFor(`${editor}.muted`, (muted) => muted === startingMute)).toBe(startingMute);
        } finally {
            if (page) {
                if (startingMute !== undefined && await ctx.call(`${page.root}.editor.pageMuted`) !== startingMute) {
                    await ctx.call(`${page.root}.editor.toggleMute`, []);
                }
                await closeVideoPage(ctx, page);
            }
        }
    }),

    test("Video Player submitUrl plays an HTTP fixture and Enter submits the expanded URL field", async (ctx) => {
        let page;
        try {
            page = await openVideoPage(ctx, "us-2053/http-url-precondition");
            const editor = `${page.root}.editor`;
            const url = ctx.httpUrl("/us-2053/video/audio.wav");
            await ctx.call(`${editor}.submitUrl`, [url]);
            ctx.expect(await ctx.waitFor(`${editor}.source`, (source) => source === url)).toBe(url);
            ctx.expect(await ctx.call(`${editor}.format`)).toBe("audio");
            ctx.expect(await ctx.waitFor(`${editor}.duration`, (duration) => typeof duration === "number" && duration > 0)).toBeTruthy();
            await ctx.call(`${editor}.play`, []);
            ctx.expect(await ctx.waitFor(`${editor}.playerState`, (state) => state === "playing")).toBe("playing");

            const fieldUrl = `${url}?via=video-url-input`;
            const input = '[data-name="video-url-input"]';
            await ctx.call("window.screen.click", [`[data-type="page-tab"][data-page-id="${page.id}"]`]);
            await ctx.call("window.screen.click", [input]);
            const expanded = await ctx.waitFor(
                (activeContext) => activeContext.call("window.screen.evaluate", [
                    '() => document.querySelector(\'[data-part="video-url-slot"]\')?.dataset.expanded === "true"',
                ]),
                (value) => value === true,
            );
            ctx.expect(expanded).toBe(true);
            await ctx.call("window.screen.pressKey", ["Control+a", { target: input }]);
            await ctx.call("window.screen.type", [input, fieldUrl]);
            await ctx.call("window.screen.pressKey", ["Enter", { target: input }]);

            ctx.expect(await ctx.waitFor(`${editor}.source`, (source) => source === fieldUrl)).toBe(fieldUrl);
            ctx.expect(await ctx.call(`${editor}.format`)).toBe("audio");
            ctx.expect(await ctx.call(`${editor}.elements`).then((elements) => elements.some((element) => element.name === "video-url-input" && element.visible))).toBe(true);
            ctx.expect(await ctx.waitFor(`${editor}.duration`, (duration) => typeof duration === "number" && duration > 0)).toBeTruthy();
            ctx.expect(await ctx.waitFor(`${editor}.playerState`, (state) => state === "playing")).toBe("playing");
        } finally {
            await closeVideoPage(ctx, page);
        }
    }),

    test("Undecodable media reports its error and shows the Open in VLC control", async (ctx) => {
        let page;
        try {
            page = await openVideoPage(ctx, "us-2053/undecodable", "broken.wav", Buffer.from("not a WAV media file"));
            const editor = `${page.root}.editor`;
            const mediaError = await ctx.waitFor(
                (activeContext) => activeContext.call(`${editor}.playerState`),
                (state) => state === "unsupported format" || state === "error",
            );
            ctx.expect(mediaError === "unsupported format" || mediaError === "error").toBe(true);
            const elements = await videoElements(ctx, page.root);
            ctx.expect(elements.find((element) => element.name === "video-open-vlc").visible).toBe(true);
        } finally {
            await closeVideoPage(ctx, page);
        }
    }),
];
