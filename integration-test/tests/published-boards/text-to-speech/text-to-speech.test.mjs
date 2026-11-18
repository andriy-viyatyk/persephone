import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedBoard } from "../helpers.mjs";

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };
// Exact English pack value from text-to-speech/lang/en.json.
const NOT_READY_TEXT = "Install the runtime and model to get started.";
const NOT_READY_MESSAGE = "Install the runtime and model from the board page.";

async function waitForDom(ctx, editor, expression, predicate) {
    return ctx.waitFor(async () => {
        try {
            return await editor.evaluate(expression);
        } catch {
            return null;
        }
    }, predicate);
}

async function waitForProvider(ctx) {
    return ctx.waitFor(
        () => ctx.callText("capabilities.$help"),
        (help) => help.includes("Text to Speech") && help.includes("speech.synthesize"),
    );
}

async function readChannel(ctx, editor, open) {
    return editor.evaluate(`async () => {
        const channel = await window.persephone.service.openChannel(${JSON.stringify(open)});
        return await new Promise(resolve => {
            let message = null;
            channel.onMessage(value => { message = value; });
            channel.onClose(reason => resolve({ message, closed: true, closeCode: reason?.code ?? null }));
        });
    }`);
}

async function selectBoardSettings(ctx, namespace) {
    const section = `[data-name="settings-section-board-${encodeURIComponent(namespace)}"]`;
    await ctx.app.pages.showSettingsPage();
    await ctx.waitFor((active) => active.app.pages.all, (pages) => pages.some((page) => page.editor === "settings-view"));
    await ctx.app.window.screen.click(section);
    return section;
}

async function closeNewSettingsPages(ctx, before) {
    try {
        const after = await ctx.app.pages.all;
        for (const page of after) {
            if (page.editor === "settings-view" && !before.some((old) => old.id === page.id)) {
                await ctx.app.pages.closePage(page.id);
            }
        }
    } catch { /* Cleanup must not hide the test result. */ }
}

export default [
    test("renders the missing runtime state and install control without downloading", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "text-to-speech");
            const state = await waitForDom(ctx, handle.editor, `() => ({
                status: document.querySelector('#status')?.textContent?.trim(),
                installHidden: document.querySelector('#install')?.hidden,
                controls: ['#speak', '#language', '#voice'].map(selector => {
                    const element = document.querySelector(selector);
                    return Boolean(element && !element.hidden && element.getClientRects().length);
                })
            })`, (value) => value?.status === NOT_READY_TEXT
                && value.installHidden === false && value.controls?.length === 3);
            ctx.expect(state.status).toBe(NOT_READY_TEXT);
            ctx.expect(state.controls).toEqual([true, true, true]);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("registers speech.synthesize and describes local voices", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "text-to-speech");
            await waitForProvider(ctx);
            const help = await ctx.callText('capabilities["speech.synthesize"].$help');
            ctx.expect(help).toContain("speak(");
            ctx.expect(help).toContain("stop(");

            const result = await readChannel(ctx, handle.editor, { type: "describe" });
            ctx.expect(result.closed).toBe(true);
            ctx.expect(result.message.type).toBe("description");
            ctx.expect(result.message.local).toBe(true);
            ctx.expect(result.message.voices.length).toBe(10);
            ctx.expect(result.message.voices.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
            ctx.expect(result.message.voices.every(({ name }) => typeof name === "string" && name.startsWith("Voice "))).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("speak rejects without an installed runtime or model", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "text-to-speech");
            await waitForProvider(ctx);
            let outcome;
            try {
                await ctx.call('capabilities["speech.synthesize"].speak', ["Synthetic offline test"]);
                outcome = { rejected: false, message: "" };
            } catch (error) {
                outcome = { rejected: true, message: error.message, code: error.code };
            }
            ctx.expect(outcome.rejected).toBe(true);
            ctx.expect(outcome.message).toContain(NOT_READY_MESSAGE);
            ctx.expect(outcome.code).toBe("rejected");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("renders Text to Speech settings without changing their values", async (ctx) => {
        let namespace;
        const pagesBefore = await ctx.app.pages.all;
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "text-to-speech");
            namespace = await ctx.app.boardVars.namespaceFor(handle.root);
            const section = await selectBoardSettings(ctx, namespace);
            const selectors = [
                `${section} [data-name="board-setting-default-voice"]`,
                `${section} [data-name="board-setting-caller-approval-policy"]`,
            ];
            const rendered = await ctx.waitFor(
                () => ctx.app.window.screen.evaluate(`() => ${JSON.stringify(selectors)}.map(selector => Boolean(document.querySelector(selector)))`),
                (values) => values.length === selectors.length && values.every(Boolean),
            );
            ctx.expect(rendered).toEqual([true, true]);
        } finally {
            await closePublishedSample(ctx, handle);
            await closeNewSettingsPages(ctx, pagesBefore);
        }
    }, requiresPublishedBoard),
];
