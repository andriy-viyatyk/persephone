import { test } from "../../../lib/context.mjs";
import { fixtureBoard, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const FIXTURE_TEXT = "hello from the fixture";
const EDITOR_SELECTOR = ".monaco-editor-host-root .monaco-editor";

async function createTextPage(ctx, title, content) {
    const page = await ctx.app.pages.addEditorPage("monaco", "plaintext", title, content);
    await ctx.app.pages.showPage(page.id);
    await ctx.waitFor("pages.activePage.id", (pageId) => pageId === page.id);
    return page.id;
}

async function closePage(ctx, id) {
    if (!id) return;
    try { await ctx.app.pages.closePage(id); } catch { /* cleanup must not hide the test result */ }
}

// Inactive pages stay mounted, so every toolbar selector is scoped to the test page's slot.
function inPage(pageId, name) {
    return `[data-name="page-slot"][data-page-id="${pageId}"] [data-name="${name}"]`;
}

async function isVisible(ctx, selector) {
    return ctx.app.window.screen.evaluate(`() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        return Boolean(element && !element.hidden && element.getClientRects().length);
    }`);
}

async function displayRequestDenied(ctx) {
    return ctx.app.window.screen.evaluate(`async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
            stream.getTracks().forEach((track) => track.stop());
            return false;
        } catch {
            return true;
        }
    }`);
}

async function transcribeFromSource(ctx, source) {
    let root;
    let pageId;
    try {
        root = fixtureBoard(ctx, "voice/fixture-transcriber");
        await trustFixtureBoard(ctx, root);
        pageId = await createTextPage(ctx, `us-2228-transcript-${source}.txt`, "Transcript fixture: \n");
        await ctx.app.window.screen.pressKey("Control+End", { target: EDITOR_SELECTOR });

        await ctx.waitFor(() => isVisible(ctx, inPage(pageId, "transcript-button")), (visible) => visible === true);
        await ctx.app.window.screen.click(inPage(pageId, "transcript-button"));
        const modeId = source === "both" ? "transcript-mode-both" : "transcript-mode-computer-audio";
        await ctx.waitFor(() => isVisible(ctx, `[data-name="${modeId}"]`), (visible) => visible === true);
        ctx.expect(await displayRequestDenied(ctx)).toBe(true);
        await ctx.app.window.screen.click(`[data-name="${modeId}"]`);

        await ctx.waitFor(() => isVisible(ctx, inPage(pageId, "transcript-stop")), (visible) => visible === true);
        ctx.expect(await displayRequestDenied(ctx)).toBe(true);
        const inserted = await ctx.waitFor(
            () => ctx.callText(`pages[${JSON.stringify(pageId)}].content`),
            (content) => content.includes(FIXTURE_TEXT),
        );
        ctx.expect(inserted).toContain(FIXTURE_TEXT);

        await ctx.app.window.screen.click(inPage(pageId, "transcript-stop"));
        await ctx.waitFor(() => isVisible(ctx, inPage(pageId, "transcript-button")), (visible) => visible === true);
    } finally {
        // The transcribed page is unsaved: the runner's per-test cleanup closes it and answers Don't Save.
        await untrustBoard(ctx, root);
    }
}

// The shortcut test covers the app before-input-event route, recording overlay and transcription.
// The Transcript toolbar also exercises the shared microphone capture and speech.transcribe path.
export default [
    test("Transcript toolbar is hidden when no transcription provider is trusted", async (ctx) => {
        const root = fixtureBoard(ctx, "voice/fixture-transcriber");
        let pageId;
        try {
            await untrustBoard(ctx, root);
            pageId = await createTextPage(ctx, "us-2111-no-provider.txt", "No provider is registered.\n");
            const toolbarHidden = await ctx.waitFor(
                () => ctx.app.window.screen.evaluate(`() => {
                    const toolbar = document.querySelector(${JSON.stringify(inPage(pageId, "transcript-toolbar"))});
                    return Boolean(toolbar) && toolbar.hidden;
                }`),
                (hidden) => hidden === true,
            );
            ctx.expect(toolbarHidden).toBe(true);
        } finally {
            await closePage(ctx, pageId);
        }
    }, { requires: ["launch"] }),

    test("Transcript toolbar transcribes from the microphone", async (ctx) => {
        let root;
        let pageId;
        try {
            root = fixtureBoard(ctx, "voice/fixture-transcriber");
            await trustFixtureBoard(ctx, root);
            pageId = await createTextPage(ctx, "us-2111-transcript.txt", "Transcript fixture: \n");
            await ctx.app.window.screen.pressKey("Control+End", { target: EDITOR_SELECTOR });

            await ctx.waitFor(() => isVisible(ctx, inPage(pageId, "transcript-button")), (visible) => visible === true);
            await ctx.app.window.screen.click(inPage(pageId, "transcript-button"));
            await ctx.waitFor(() => isVisible(ctx, '[data-name="transcript-mode-microphone-me"]'), (visible) => visible === true);
            await ctx.app.window.screen.click('[data-name="transcript-mode-microphone-me"]');

            await ctx.waitFor(() => isVisible(ctx, inPage(pageId, "transcript-stop")), (visible) => visible === true);
            const inserted = await ctx.waitFor(
                () => ctx.callText(`pages[${JSON.stringify(pageId)}].content`),
                (content) => content.includes(FIXTURE_TEXT),
            );
            ctx.expect(inserted).toContain(FIXTURE_TEXT);

            await ctx.app.window.screen.click(inPage(pageId, "transcript-stop"));
            const idle = await ctx.waitFor(
                () => isVisible(ctx, inPage(pageId, "transcript-stop")),
                (visible) => visible === false,
            );
            ctx.expect(idle).toBe(false);
            const button = await ctx.waitFor(() => isVisible(ctx, inPage(pageId, "transcript-button")), (visible) => visible === true);
            ctx.expect(button).toBe(true);
        } finally {
            // The transcribed page is unsaved: the runner's per-test cleanup closes it and answers Don't Save.
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("Transcript transcribes from computer audio", async (ctx) => transcribeFromSource(ctx, "computer"), { requires: ["launch"] }),

    test("Transcript transcribes from Both sources", async (ctx) => transcribeFromSource(ctx, "both"), { requires: ["launch"] }),

    test("configured voice-typing shortcut transcribes from the microphone", async (ctx) => {
        let root;
        let pageId;
        try {
            root = fixtureBoard(ctx, "voice/fixture-transcriber");
            await trustFixtureBoard(ctx, root);
            pageId = await createTextPage(ctx, "us-2123-voice-shortcut.txt", "Voice shortcut fixture: \n");
            await ctx.app.window.screen.click(`[data-name="page-slot"][data-page-id="${pageId}"] ${EDITOR_SELECTOR}`);

            const shortcut = await ctx.app.settings.get("voice-typing.shortcut");
            const overlayVisible = () => ctx.app.window.screen.evaluate(`() => {
                const overlay = document.querySelector('[data-name="voice-typing-overlay"]');
                return Boolean(overlay && !overlay.hidden && overlay.textContent.toLowerCase().includes("recording"));
            }`);

            await ctx.app.window.screen.pressKey(shortcut);
            ctx.expect(await ctx.waitFor(() => overlayVisible(), (recording) => recording === true)).toBe(true);

            const inserted = await ctx.waitFor(
                () => ctx.callText(`pages[${JSON.stringify(pageId)}].content`),
                (content) => content.includes(FIXTURE_TEXT),
            );
            ctx.expect(inserted).toContain(FIXTURE_TEXT);

            await ctx.app.window.screen.pressKey(shortcut);
            const hidden = await ctx.waitFor(() => isVisible(ctx, '[data-name="voice-typing-overlay"]'), (visible) => visible === false);
            ctx.expect(hidden).toBe(false);
        } finally {
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),
];
