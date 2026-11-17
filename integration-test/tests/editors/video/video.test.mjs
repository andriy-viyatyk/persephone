import { test } from "../../../lib/context.mjs";
import { closePage, makeWav, openVideoPage } from "../helpers.mjs";

async function videoElements(ctx, root) {
    return root.editor.elements;
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
            const editor = page.node.editor;
            ctx.expect(await editor.source).toBe(page.filePath);
            ctx.expect(await editor.format).toBe("audio");
            ctx.expect(await editor.mediaMounted).toBe(true);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.duration, (duration) => typeof duration === "number" && duration > 0)).toBeTruthy();

            await editor.play();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.playerState, (state) => state === "playing")).toBe("playing");
            ctx.expect(await editor.paused).toBe(false);
            await editor.pause();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.paused, (paused) => paused === true)).toBe(true);
            ctx.expect(await editor.playerState).toBe("paused");

            await editor.seek(1.5);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.currentTime, (time) => time === 1.5)).toBe(1.5);
            startingMute = await editor.pageMuted;
            await editor.toggleMute();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.muted, (muted) => muted === !startingMute)).toBe(!startingMute);
            ctx.expect(await editor.pageMuted).toBe(!startingMute);
            await editor.toggleMute();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.muted, (muted) => muted === startingMute)).toBe(startingMute);
        } finally {
            if (page) {
                if (startingMute !== undefined && await ctx.app.pages[page.id].editor.pageMuted !== startingMute) {
                    await ctx.app.pages[page.id].editor.toggleMute();
                }
                await closeVideoPage(ctx, page);
            }
        }
    }),

    test("Video Player submitUrl plays an HTTP fixture and Enter submits the expanded URL field", async (ctx) => {
        let page;
        try {
            page = await openVideoPage(ctx, "us-2053/http-url-precondition");
            const editor = page.node.editor;
            const url = ctx.httpUrl("/us-2053/video/audio.wav");
            await editor.submitUrl(url);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.source, (source) => source === url)).toBe(url);
            ctx.expect(await editor.format).toBe("audio");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.duration, (duration) => typeof duration === "number" && duration > 0)).toBeTruthy();
            await editor.play();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.playerState, (state) => state === "playing")).toBe("playing");

            const fieldUrl = `${url}?via=video-url-input`;
            const input = '[data-name="video-url-input"]';
            await ctx.app.window.screen.click(`[data-type="page-tab"][data-page-id="${page.id}"]`);
            await ctx.app.window.screen.click(input);
            const expanded = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate('() => document.querySelector(\'[data-part="video-url-slot"]\')?.dataset.expanded === "true"'),
                (value) => value === true,
            );
            ctx.expect(expanded).toBe(true);
            await ctx.app.window.screen.pressKey("Control+a", { target: input });
            await ctx.app.window.screen.type(input, fieldUrl);
            await ctx.app.window.screen.pressKey("Enter", { target: input });

            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.source, (source) => source === fieldUrl)).toBe(fieldUrl);
            ctx.expect(await editor.format).toBe("audio");
            ctx.expect((await editor.elements).some((element) => element.name === "video-url-input" && element.visible)).toBe(true);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.duration, (duration) => typeof duration === "number" && duration > 0)).toBeTruthy();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.playerState, (state) => state === "playing")).toBe("playing");
        } finally {
            await closeVideoPage(ctx, page);
        }
    }),

    test("Undecodable media reports its error and shows the Open in VLC control", async (ctx) => {
        let page;
        try {
            page = await openVideoPage(ctx, "us-2053/undecodable", "broken.wav", Buffer.from("not a WAV media file"));
            const editor = page.node.editor;
            const mediaError = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.playerState,
                (state) => state === "unsupported format" || state === "error",
            );
            ctx.expect(mediaError === "unsupported format" || mediaError === "error").toBe(true);
            const elements = await videoElements(ctx, page.node);
            ctx.expect(elements.find((element) => element.name === "video-open-vlc").visible).toBe(true);
        } finally {
            await closeVideoPage(ctx, page);
        }
    }),
];
