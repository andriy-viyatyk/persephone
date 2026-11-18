import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedBoard } from "../helpers.mjs";

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };
// Exact English pack values from speech-to-text/lang/en.json.
const NOT_INSTALLED_TEXT = "Not installed";
const NOT_READY_TEXT = "Install the runtime and a model";
const SETUP_NEEDED_TEXT = "Install the engine and selected model";
const NOT_READY_MESSAGE = "Install the whisper.cpp runtime and choose an installed model in the Speech to Text board.";

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
        (help) => help.includes("Speech to Text") && help.includes("speech.transcribe"),
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

async function writeSilentPcm16Wav(ctx, relativePath) {
    const sampleRate = 16000;
    const sampleCount = 1600;
    const dataBytes = sampleCount * 2;
    const wav = Buffer.alloc(44 + dataBytes);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + dataBytes, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(dataBytes, 40);

    const file = ctx.fixture(relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, wav);
    return file;
}

async function createTextPage(ctx, title, content) {
    const page = await ctx.app.pages.addEditorPage("monaco", "plaintext", title, content);
    await ctx.app.pages.showPage(page.id);
    await ctx.waitFor("pages.activePage.id", (id) => id === page.id);
    return page.id;
}

async function closePage(ctx, id) {
    if (!id) return;
    try { await ctx.app.pages.closePage(id); } catch { /* Cleanup must not hide the test result. */ }
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
    test("renders the uninstalled runtime and model state without downloading", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "speech-to-text");
            const state = await waitForDom(ctx, handle.editor, `() => ({
                engine: document.querySelector('#engine-state')?.textContent?.trim(),
                setup: document.querySelector('#setup-summary')?.textContent?.trim(),
                runtime: document.querySelector('#runtime-row .asset-meta')?.textContent?.trim(),
                modelCount: document.querySelectorAll('#model-list .asset-row').length,
                modelMeta: [...document.querySelectorAll('#model-list .asset-row .asset-meta')].map(node => node.textContent.trim()),
                hintHidden: document.querySelector('#not-ready-hint')?.hidden,
                recorderDisabled: document.querySelector('#test-button')?.disabled,
                runtimeDownloadVisible: (() => {
                    const button = document.querySelector('#runtime-row .asset-actions button');
                    return Boolean(button && !button.hidden && button.getClientRects().length);
                })()
            })`, (value) => value?.runtime?.startsWith(`${NOT_INSTALLED_TEXT} ·`)
                && value.modelCount === 5 && value.modelMeta.length === 5
                && value.modelMeta.every((item) => item.startsWith(`${NOT_INSTALLED_TEXT} ·`))
                && value.engine === NOT_READY_TEXT && value.setup === SETUP_NEEDED_TEXT);
            ctx.expect(state.engine).toBe(NOT_READY_TEXT);
            ctx.expect(state.setup).toBe(SETUP_NEEDED_TEXT);
            ctx.expect(state.runtime.startsWith(`${NOT_INSTALLED_TEXT} ·`)).toBe(true);
            ctx.expect(state.modelMeta.every((value) => value.startsWith(`${NOT_INSTALLED_TEXT} ·`))).toBe(true);
            ctx.expect(state.hintHidden).toBe(false);
            ctx.expect(state.recorderDisabled).toBe(true);
            ctx.expect(state.runtimeDownloadVisible).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("registers speech.transcribe and describes the local provider", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "speech-to-text");
            await waitForProvider(ctx);
            const help = await ctx.callText('capabilities["speech.transcribe"].$help');
            ctx.expect(help).toContain("transcribeFile");
            ctx.expect(help).toContain("transcribeFile(path: string");

            const result = await readChannel(ctx, handle.editor, { type: "describe" });
            ctx.expect(result.closed).toBe(true);
            ctx.expect(result.message.type).toBe("description");
            ctx.expect(result.message.engine).toBe("whisper.cpp");
            ctx.expect(result.message.local).toBe(true);
            ctx.expect(result.message.maxAudioMs).toBe(300000);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("transcription channel reports not-ready and closes before accepting audio", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "speech-to-text");
            await waitForProvider(ctx);
            const result = await readChannel(ctx, handle.editor, {
                type: "transcribe",
                format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
            });
            ctx.expect(result.message.type).toBe("error");
            ctx.expect(result.message.code).toBe("not-ready");
            ctx.expect(result.message.message).toBe(NOT_READY_MESSAGE);
            ctx.expect(result.closed).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("transcribeFile rejects without an installed engine or model", async (ctx) => {
        const wavPath = await writeSilentPcm16Wav(
            ctx,
            "boards-samples/speech-to-text/transcribe-file-not-ready/not-ready.wav",
        );
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "speech-to-text");
            await waitForProvider(ctx);
            let outcome;
            try {
                await ctx.call('capabilities["speech.transcribe"].transcribeFile', [wavPath]);
                outcome = { rejected: false, message: "" };
            } catch (error) {
                outcome = { rejected: true, message: error.message };
            }
            ctx.expect(outcome.rejected).toBe(true);
            ctx.expect(outcome.message).toContain(NOT_READY_MESSAGE);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("offers the Transcript toolbar on a plaintext page", async (ctx) => {
        let handle;
        let pageId;
        try {
            handle = await openPublishedBoard(ctx, "speech-to-text");
            await waitForProvider(ctx);
            pageId = await createTextPage(ctx, "us-2114-transcript.txt", "Synthetic transcription provider is registered.\n");
            const selector = `[data-name="page-slot"][data-page-id="${pageId}"] [data-name="transcript-button"]`;
            const visible = await ctx.waitFor(
                () => ctx.app.window.screen.evaluate(`() => {
                    const button = document.querySelector(${JSON.stringify(selector)});
                    return Boolean(button && !button.hidden && button.getClientRects().length);
                }`),
                (value) => value === true,
            );
            ctx.expect(visible).toBe(true);
        } finally {
            await closePage(ctx, pageId);
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("renders Speech to Text settings without changing their values", async (ctx) => {
        let namespace;
        const pagesBefore = await ctx.app.pages.all;
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "speech-to-text");
            namespace = await ctx.app.boardVars.namespaceFor(handle.root);
            const section = await selectBoardSettings(ctx, namespace);
            const selectors = [
                "board-setting-language-hints",
                "board-setting-vocabulary-prompt",
                "board-setting-use-gpu",
                "board-setting-idle-unload-minutes",
                "board-setting-caller-approval-policy",
            ].map((name) => `${section} [data-name="${name}"]`);
            const rendered = await ctx.waitFor(
                () => ctx.app.window.screen.evaluate(`() => ${JSON.stringify(selectors)}.map(selector => Boolean(document.querySelector(selector)))`),
                (values) => values.length === selectors.length && values.every(Boolean),
            );
            ctx.expect(rendered).toEqual([true, true, true, true, true]);
        } finally {
            await closePublishedSample(ctx, handle);
            await closeNewSettingsPages(ctx, pagesBefore);
        }
    }, requiresPublishedBoard),
];
