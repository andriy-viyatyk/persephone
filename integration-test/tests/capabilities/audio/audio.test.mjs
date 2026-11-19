import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const BOARD = "audio/audio-board";
const CAPTURE_INDICATOR = '[data-name="audio-capture-indicator"]';
const MUTE_INDICATOR = '[data-name="global-mute"]';

async function openFixture(ctx) {
    const root = fixtureBoard(ctx, BOARD);
    await trustFixtureBoard(ctx, root);
    const page = await openBoardPage(ctx, root);
    return { root, page, app: page.editor.app };
}

async function visible(ctx, selector) {
    return ctx.app.window.screen.evaluate(`() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        return Boolean(element && !element.hidden && element.getClientRects().length);
    }`);
}

async function cleanupFixture(ctx, handle) {
    if (!handle) return;
    try { await handle.app.closeAll(); } catch { /* fixture may not have completed initialization */ }
    await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), (value) => value === false);
    await closeBoardPage(ctx, handle.page?.id);
    await untrustBoard(ctx, handle.root);
}

function captureTest(name, run) {
    return test(name, run, { requires: ["launch"] });
}

export default [
    captureTest("audio devices list the fake inputs after capture is authorized", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            const headerElements = await ctx.app.ui.elements;
            ctx.expect(headerElements.some((element) => element.name === "audio-capture-indicator")).toBe(true);
            const id = await handle.app.openCapture({ source: "microphone", processing: "raw" });
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), Boolean);
            const devices = await handle.app.devices();
            const labels = devices.map((device) => device.label);
            ctx.expect(labels).toContain("Fake Default Audio Input");
            ctx.expect(labels).toContain("Fake Audio Input 1");
            ctx.expect(labels).toContain("Fake Audio Input 2");
            await handle.app.closeCapture(id);
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), (value) => value === false);
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("default microphone capture delivers documented chunks", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            const id = await handle.app.openCapture({ source: "microphone" });
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), Boolean);
            const summary = await handle.app.readCapture(id, 3);
            ctx.expect(summary.count > 0).toBe(true);
            ctx.expect(summary.sizes.every((size) => size === 6400)).toBe(true);
            ctx.expect(summary.sampleRates.every((rate) => rate === 16000)).toBe(true);
            ctx.expect(summary.oneEpoch).toBe(true);
            ctx.expect(summary.increasingTime).toBe(true);
            ctx.expect(summary.validEpoch).toBe(true);
            await handle.app.closeCapture(id);
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), (value) => value === false);
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("raw microphone capture contains non-silent PCM", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            const id = await handle.app.openCapture({ source: "microphone", processing: "raw" });
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), Boolean);
            const summary = await handle.app.readCapture(id, 3);
            ctx.expect(summary.rms > 0).toBe(true);
            ctx.expect(summary.sizes.every((size) => size === 6400)).toBe(true);
            ctx.expect(summary.validEpoch).toBe(true);
            await handle.app.closeCapture(id);
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), (value) => value === false);
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("same-key raw consumers keep the source alive independently", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            const first = await handle.app.openCapture({ source: "microphone", processing: "raw" });
            const second = await handle.app.openCapture({ source: "microphone", processing: "raw" });
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), Boolean);
            await handle.app.readCapture(first, 2);
            await handle.app.closeCapture(first);
            const remaining = await handle.app.readCapture(second, 1);
            ctx.expect(remaining.count).toBe(1);
            ctx.expect(remaining.sizes).toEqual([6400]);
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), Boolean);
            await handle.app.closeCapture(second);
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), (value) => value === false);
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("invalid capture options are rejected with the documented code", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            const outcomes = await Promise.all([
                handle.app.invalidCapture({ source: "invalid" }),
                handle.app.invalidCapture({ source: "microphone", deviceId: "" }),
                handle.app.invalidCapture({ source: "microphone", processing: "raw", echoCancel: true }),
                handle.app.invalidCapture({ source: "computer", deviceId: "fake-device" }),
                handle.app.invalidCapture({ source: "computer", cancelComputerAudio: true }),
            ]);
            ctx.expect(outcomes).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected"]);
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("computer capture delivers the fake loopback fixture", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            const id = await handle.app.openCapture({ source: "computer" });
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), Boolean);
            const summary = await handle.app.readCapture(id, 2);
            ctx.expect(summary.count > 0).toBe(true);
            ctx.expect(summary.sizes.every((size) => size === 6400)).toBe(true);
            ctx.expect(summary.validEpoch).toBe(true);
            ctx.expect(summary.increasingTime).toBe(true);
            ctx.expect(summary.sampleRates.every((rate) => rate === 16000)).toBe(true);
            ctx.expect(summary.oneEpoch).toBe(true);
            ctx.expect(summary.validEpoch).toBe(true);
            ctx.expect(summary.increasingTime).toBe(true);
            await handle.app.closeCapture(id);
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), (value) => value === false);
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("microphone capture with computer-audio cancellation delivers chunks", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            const id = await handle.app.openCapture({ source: "microphone", cancelComputerAudio: true });
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), Boolean);
            const summary = await handle.app.readCapture(id, 3);
            ctx.expect(summary.count > 0).toBe(true);
            // A discontinuity (the loopback reference starting) flushes a shorter chunk; full chunks are 6,400 bytes.
            ctx.expect(summary.sizes.every((size) => size > 0 && size <= 6400 && size % 2 === 0)).toBe(true);
            ctx.expect(summary.sizes.includes(6400)).toBe(true);
            await handle.app.closeCapture(id);
            await ctx.waitFor(() => visible(ctx, CAPTURE_INDICATOR), (value) => value === false);
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("playback completes and malformed playback is rejected", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            const result = await handle.app.play("end");
            ctx.expect(result.type).toBe("ended");
            ctx.expect(result.status).toBe("finished");
            const badRate = await handle.app.invalidPlayback({ sampleRate: 7999 }, { type: "end" });
            const badPcm = await handle.app.invalidPlayback({ sampleRate: 16000 }, {
                type: "chunk", bytes: [0, 0, 192, 127], // one float32 NaN
            });
            ctx.expect(badRate).toBe("rejected");
            ctx.expect(badPcm).toBe("rejected");
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("playback stop reports stopped", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            const result = await handle.app.play("stop");
            ctx.expect(result.type).toBe("ended");
            ctx.expect(result.status).toBe("stopped");
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("mute lease updates the global indicator and releases idempotently", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            await handle.app.openMuteLease();
            await ctx.waitFor(() => ctx.app.window.getGlobalMuteSnapshot(), (snapshot) => snapshot.active);
            await ctx.waitFor(() => visible(ctx, MUTE_INDICATOR), Boolean);
            await handle.app.releaseMuteLease();
            await ctx.waitFor(() => ctx.app.window.getGlobalMuteSnapshot(), (snapshot) => !snapshot.active);
            await ctx.waitFor(() => visible(ctx, MUTE_INDICATOR), (value) => value === false);
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),

    captureTest("global mute header action releases all fixture leases", async (ctx) => {
        let handle;
        try {
            handle = await openFixture(ctx);
            await handle.app.openMuteLease();
            await ctx.waitFor(() => ctx.app.window.getGlobalMuteSnapshot(), (snapshot) => snapshot.active);
            await ctx.waitFor(() => visible(ctx, MUTE_INDICATOR), Boolean);
            await ctx.app.window.screen.click(MUTE_INDICATOR);
            await ctx.waitFor(() => ctx.app.window.getGlobalMuteSnapshot(), (snapshot) => !snapshot.active);
            await ctx.waitFor(() => visible(ctx, MUTE_INDICATOR), (value) => value === false);
        } finally {
            await cleanupFixture(ctx, handle);
        }
    }),
];
