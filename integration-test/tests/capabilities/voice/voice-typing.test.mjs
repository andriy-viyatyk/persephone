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

// Voice typing itself starts only from its keyboard shortcut, which the main process reads in
// `before-input-event`. Keys sent by `window.screen.pressKey` (CDP) never reach that handler, so the
// shortcut, the overlay and the missing-provider alert are uncovered (EPIC-196 open items). The
// Transcript toolbar runs the same microphone capture and `speech.transcribe` session path.
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
];
