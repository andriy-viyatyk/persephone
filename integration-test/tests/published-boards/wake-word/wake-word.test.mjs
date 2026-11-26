import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedBoard } from "../helpers.mjs";

const TEST_PHRASE = "us-2115-synthetic-wake";
// English quality.silence, quality.short, and quality.noise from the board's lang/en.json.
const QUALITY_REJECTIONS = [
    "Rejected: too quiet or silent.",
    "Rejected: too little speech.",
    "Rejected: clipping or very low level.",
];
const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };
const CAPTURE_INDICATOR = '[data-name="audio-capture-indicator"]';

async function captureIndicatorVisible(ctx) {
    return ctx.app.window.screen.evaluate(`() => {
        const indicator = document.querySelector(${JSON.stringify(CAPTURE_INDICATOR)});
        return Boolean(indicator && !indicator.hidden && indicator.getClientRects().length);
    }`);
}

async function deletePhraseFromPage(editor, phrase) {
    return editor.evaluate(`async () => {
        const channel = await window.persephone.service.openChannel({
            type: "delete",
            target: { phrase: ${JSON.stringify(phrase)}, kind: "wake" },
        });
        return new Promise((resolve, reject) => {
            channel.onMessage(message => {
                if (message?.type === "deleted") resolve(message.count);
                else if (message?.type === "error") reject(new Error(message.code + ": " + message.message));
            });
            channel.onClose(reason => reject(new Error(reason?.message || "Delete channel closed before a result.")));
        });
    }`);
}

export default [
    test("opens with fake microphones and no enrollments", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "wake-word");
            const editor = ctx.app.pages[handle.id].editor;
            const state = await ctx.waitFor(
                () => editor.evaluate(`() => ({
                    microphones: [...document.querySelectorAll("#microphone option")].map(option => option.textContent.trim()),
                    sampleCount: document.querySelectorAll("#samples .tree-node").length,
                    emptyText: document.querySelector("#samples").textContent.trim(),
                })`),
                (value) => value.microphones.includes("Fake Audio Input 1")
                    && value.microphones.includes("Fake Audio Input 2")
                    && value.sampleCount === 0
                    && value.emptyText.length > 0,
            );

            ctx.expect(state.microphones).toContain("Default microphone");
            ctx.expect(state.microphones).toContain("Fake Audio Input 1");
            ctx.expect(state.microphones).toContain("Fake Audio Input 2");
            ctx.expect(state.sampleCount).toBe(0);
            ctx.expect(state.emptyText.length > 0).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("agent methods describe and list; private delete reports zero for an unknown phrase", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "wake-word");
            const capability = ctx.app.capabilities["speech.wake"];
            ctx.expect(await capability.describe()).toEqual({
                local: true,
                features: [],
                defaultThreshold: 0.85,
                maxEnrollMs: 3000,
            });
            ctx.expect(await capability.list(TEST_PHRASE)).toEqual([]);

            ctx.expect(await deletePhraseFromPage(handle.editor, TEST_PHRASE)).toBe(0);
            ctx.expect(await capability.list(TEST_PHRASE)).toEqual([]);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    // The board's quality check runs on audio after Chromium's processing and microphone cleaning, which
    // treat the synthetic sweep differently per platform: Windows rejects it ("clipping or very low level"),
    // Linux passes it to the review dialog. Either way, nothing may be stored unless the user adds the sample.
    test("a synthetic recording is rejected or cancelled and nothing is stored", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "wake-word");
            const editor = handle.editor;
            const readState = () => editor.evaluate(`() => ({
                status: document.querySelector("#status").textContent.trim(),
                recording: document.querySelector("#recording").textContent.trim(),
                reviewOpen: document.querySelector("#review-dialog").open,
                sampleCount: document.querySelectorAll("#samples .tree-node").length,
                recordDisabled: document.querySelector("#record").disabled,
            })`);
            await editor.click("#record");
            const outcome = await ctx.waitFor(
                readState,
                (value) => value.reviewOpen
                    || (value.status === "Check recording" && QUALITY_REJECTIONS.includes(value.recording) && !value.recordDisabled),
            );
            if (outcome.reviewOpen) {
                await editor.click("#review-cancel");
                const cancelled = await ctx.waitFor(
                    readState,
                    (value) => !value.reviewOpen && value.status === "Ready" && !value.recordDisabled,
                );
                ctx.expect(cancelled.sampleCount).toBe(0);
            } else {
                ctx.expect(QUALITY_REJECTIONS).toContain(outcome.recording);
                ctx.expect(outcome.sampleCount).toBe(0);
            }
            await ctx.waitFor(() => captureIndicatorVisible(ctx), (visible) => visible === false);
            ctx.expect(await ctx.app.capabilities["speech.wake"].list("agent-wake")).toEqual([]);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("listening without an enrollment reports no-enrollments and opens no capture", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "wake-word");
            const editor = handle.editor;
            await editor.click("#listen");
            const outcome = await ctx.waitFor(
                async () => ({
                    ui: await editor.evaluate(`() => ({
                        error: document.querySelector("#error").textContent.trim(),
                        status: document.querySelector("#status").textContent.trim(),
                        listenLabel: document.querySelector("#listen").textContent.trim(),
                    })`),
                    captureVisible: await captureIndicatorVisible(ctx),
                }),
                (value) => value.ui.error.includes("no-enrollments")
                    && value.ui.status === "Needs attention"
                    && value.ui.listenLabel === "Start listening"
                    && !value.captureVisible,
            );
            ctx.expect(outcome.ui.error).toContain("no-enrollments");
            ctx.expect(outcome.ui.status).toBe("Needs attention");
            ctx.expect(outcome.ui.listenLabel).toBe("Start listening");
            ctx.expect(outcome.captureVisible).toBe(false);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
