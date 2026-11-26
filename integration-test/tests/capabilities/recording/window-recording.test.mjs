import path from "node:path";
import { test } from "../../../lib/context.mjs";
import { samePath } from "../../helpers/path-comparison.mjs";

const DISCARD = '[data-name="video-recording-discard"]';

export default [
    test("window recording creates a profile-local file and discard removes it", async (ctx) => {
        let recordingStarted = false;
        let result;
        try {
            await ctx.app.window.screen.recording.start({ region: "window", openPlayer: true });
            recordingStarted = true;
            await ctx.waitFor(() => ctx.app.window.screen.recording.state, (state) => state.status === "recording");
            result = await ctx.app.window.screen.recording.stop();
            recordingStarted = false;

            ctx.expect(result.durationMs > 0).toBe(true);
            ctx.expect(result.mimeType).toContain("video/");
            ctx.expect(result.width > 0).toBe(true);
            ctx.expect(result.height > 0).toBe(true);
            ctx.expect(result.stoppedBy).toBe("agent");

            const recordingsDir = await ctx.app.fs.resolveDataPath("recordings");
            ctx.expect(samePath(path.dirname(result.path), recordingsDir)).toBe(true);
            ctx.expect(await ctx.app.fs.exists(result.path)).toBe(true);

            await ctx.waitFor((active) => active.app.pages.all, (pages) => pages.some((page) => page.editor === "video-view"));
            await ctx.waitFor(() => ctx.app.window.screen.evaluate(`() => Boolean(document.querySelector(${JSON.stringify(DISCARD)}))`), Boolean);
            await ctx.app.window.screen.click(DISCARD);
            await ctx.waitFor((active) => active.app.fs.exists(result.path), (exists) => exists === false);
            await ctx.waitFor(() => ctx.app.window.screen.recording.state, (state) => state.last == null);
        } finally {
            if (recordingStarted) {
                try { await ctx.app.window.screen.recording.cancel(); } catch { /* recording may already have stopped */ }
            }
            let cleanupResult = result;
            if (!cleanupResult) {
                try { cleanupResult = await ctx.app.window.screen.recording.state.last; } catch { /* no completed result */ }
            }
            if (cleanupResult) {
                try {
                    const discardVisible = await ctx.app.window.screen.evaluate(`() => Boolean(document.querySelector(${JSON.stringify(DISCARD)}))`);
                    if (discardVisible) {
                        await ctx.app.window.screen.click(DISCARD);
                        await ctx.waitFor((active) => active.app.fs.exists(cleanupResult.path), (value) => value === false);
                        await ctx.waitFor(() => ctx.app.window.screen.recording.state, (state) => state.last == null);
                    }
                } catch { /* preserve the test failure while attempting profile-local cleanup */ }
            }
        }
    }),
];
