import { test } from "../../../lib/context.mjs";
import { fixtureBoard, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const TRANSLATION_BOARD = "translate/fixture-translator";
const FAILURE_SENTINEL = "Fixture translation failure sentinel";

function inPage(pageId, name) {
    return `[data-name="page-slot"][data-page-id="${pageId}"] [data-name="${name}"]`;
}

async function createTextPage(ctx, title, content) {
    const page = await ctx.app.pages.addEditorPage("monaco", "plaintext", title, content);
    await ctx.app.pages.showPage(page.id);
    await ctx.waitFor("pages.activePage.id", (id) => id === page.id);
    return page.id;
}

async function visible(ctx, selector) {
    return ctx.app.window.screen.evaluate(`() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        return Boolean(element && !element.hidden && element.getClientRects().length);
    }`);
}

async function closePage(ctx, id) {
    if (!id) return;
    try { await ctx.app.pages.closePage(id); } catch { /* Cleanup must not hide the test result. */ }
}

async function closeTranslationDialog(ctx) {
    try {
        await ctx.call("dialogs[0].cancel", [], { dialog: true });
    } catch { /* The dialog may already have closed. */ }
}

async function setupMonacoTranslation(ctx, content) {
    const sourcePageId = await createTextPage(ctx, "us-2116-translation.txt", content);
    await ctx.waitFor(() => visible(ctx, inPage(sourcePageId, "translate-text-toolbar")), Boolean);
    await ctx.app.window.screen.click(inPage(sourcePageId, "translate-text-button"));
    await ctx.app.window.screen.click("[data-name=\"translate-page\"]");
    await ctx.waitFor(
        async (active) => active.call("window.screen.evaluate", [`() => {
            const dialog = document.querySelector('[data-name="translate-text-dialog"]');
            return Boolean(dialog && !dialog.hidden && dialog.getClientRects().length);
        }`], { dialog: true }),
        (isVisible) => isVisible === true,
    );
    return sourcePageId;
}

export default [
    test("capabilities help discovers the trusted text translation provider", async (ctx) => {
        const root = fixtureBoard(ctx, TRANSLATION_BOARD);
        try {
            await trustFixtureBoard(ctx, root);
            const rootHelp = await ctx.waitFor(
                () => ctx.callText("capabilities.$help"),
                (help) => help.includes("text.translate"),
            );
            ctx.expect(rootHelp).toContain("Fixture Translator");
            ctx.expect(rootHelp).toContain("channels only (not callable by agents)");

            const providerHelp = await ctx.callText('capabilities["text.translate"].$help');
            ctx.expect(providerHelp).toContain("Fixture Translator");
            for (const operation of ["describe", "detect", "translate"]) ctx.expect(providerHelp).toContain(operation);
        } finally {
            await untrustBoard(ctx, root);
        }
    }),

    test("Monaco Translate creates a translated text page", async (ctx) => {
        const source = "Hola, este es un texto sintético para la prueba de traducción.";
        let root;
        let sourcePageId;
        let resultPageId;
        try {
            root = fixtureBoard(ctx, TRANSLATION_BOARD);
            await trustFixtureBoard(ctx, root);
            sourcePageId = await setupMonacoTranslation(ctx, source);
            const choices = await ctx.waitFor(
                (active) => active.call("window.screen.evaluate", [`() => {
                    const dialog = document.querySelector('[data-name="translate-text-dialog"]');
                    return {
                        source: dialog.querySelector('[data-name="translation-source"] input')?.value,
                        target: dialog.querySelector('[data-name="translation-target"] input')?.value,
                    };
                }`], { dialog: true }),
                (value) => value?.source === "Spanish (es)" && value?.target === "English (en)",
            );
            ctx.expect(choices).toEqual({ source: "Spanish (es)", target: "English (en)" });
            await ctx.call("window.screen.click", ['[data-name="translation-start"]'], { dialog: true });

            resultPageId = await ctx.waitFor(async (active) => {
                const pages = await active.call("pages.all", undefined, { dialog: true });
                if (pages?.pending) return null;
                for (const page of pages) {
                    if (page.id === sourcePageId || page.editor !== "monaco") continue;
                    const content = await active.callText(`pages[${JSON.stringify(page.id)}].content`, undefined, { dialog: true });
                    if (typeof content === "string" && content.includes("Fixture translation:")) return page.id;
                }
                return null;
            }, (id) => id !== null, { timeout: 15000 });
            const translatedContent = await ctx.waitFor(
                (active) => active.callText(`pages[${JSON.stringify(resultPageId)}].content`, undefined, { dialog: true }),
                (content) => content === `Fixture translation: ${source}`,
            );
            const sourceContent = await ctx.waitFor(
                (active) => active.callText(`pages[${JSON.stringify(sourcePageId)}].content`, undefined, { dialog: true }),
                (content) => content === source,
            );
            ctx.expect(translatedContent).toBe(`Fixture translation: ${source}`);
            ctx.expect(sourceContent).toBe(source);
        } finally {
            await closeTranslationDialog(ctx);
            await closePage(ctx, resultPageId);
            await closePage(ctx, sourcePageId);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("a failed Monaco translation shows an error and creates no result page", async (ctx) => {
        const source = `${FAILURE_SENTINEL}.`;
        let root;
        let sourcePageId;
        let pageIdsBefore;
        try {
            pageIdsBefore = new Set((await ctx.app.pages.all).map((page) => page.id));
            root = fixtureBoard(ctx, TRANSLATION_BOARD);
            await trustFixtureBoard(ctx, root);
            sourcePageId = await setupMonacoTranslation(ctx, source);
            await ctx.call("window.screen.click", ['[data-name="translation-start"]'], { dialog: true });
            const alert = await ctx.waitFor(
                (active) => active.call("ui.alerts.list", [], { dialog: true }),
                (alerts) => Array.isArray(alerts) && alerts.find((item) => item.message === "Translation could not be completed: Fixture translation failed."),
                { timeout: 10000 },
            );
            const failure = alert.find((item) => item.message === "Translation could not be completed: Fixture translation failed.");
            ctx.expect(failure.type).toBe("warning");
            await ctx.call("ui.alerts.close", [failure.key], { dialog: true });

            const pages = await ctx.waitFor(
                (active) => active.call("pages.all", undefined, { dialog: true }),
                (value) => Array.isArray(value),
            );
            ctx.expect(pages.some((page) => page.id !== sourcePageId && !pageIdsBefore.has(page.id))).toBe(false);
            const sourceContent = await ctx.waitFor(
                (active) => active.callText(`pages[${JSON.stringify(sourcePageId)}].content`, undefined, { dialog: true }),
                (content) => content === source,
            );
            ctx.expect(sourceContent).toBe(source);
        } finally {
            await closeTranslationDialog(ctx);
            await closePage(ctx, sourcePageId);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("browser page translation changes page text and restores the original", async (ctx) => {
        const originalTarget = await ctx.app.settings.get("browser-translate-target");
        const root = fixtureBoard(ctx, TRANSLATION_BOARD);
        let pageId;
        try {
            await ctx.app.settings.set("browser-translate-target", "en");
            await trustFixtureBoard(ctx, root);
            // openUrlInBrowserTab resolves to the new page id (pages.d.ts), not a page object.
            pageId = await ctx.app.pages.openUrlInBrowserTab(ctx.httpUrl("/translate/page.html"));
            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].editor.id`, (id) => id === "browser-view");
            const originalText = await ctx.waitFor(
                () => ctx.app.pages[pageId].editor.evaluate("document.body.innerText"),
                (text) => text.includes("Esta es una página de prueba"),
            );
            const toolbar = inPage(pageId, "toolbar-translate");
            await ctx.waitFor(() => visible(ctx, toolbar), Boolean);
            await ctx.app.window.screen.click(toolbar);
            await ctx.waitFor(
                () => ctx.app.window.screen.evaluate(`() => document.querySelector('[data-translation-label]')?.textContent ?? ""`),
                (label) => label.includes("Translated from Spanish (es)"),
            );
            const translatedText = await ctx.waitFor(
                () => ctx.app.pages[pageId].editor.evaluate("document.body.innerText"),
                (text) => text.includes("Fixture translation:"),
                { timeout: 15000 },
            );
            ctx.expect(translatedText).toContain("Fixture translation:");
            await ctx.app.window.screen.click(toolbar);
            const restoredText = await ctx.waitFor(
                () => ctx.app.pages[pageId].editor.evaluate("document.body.innerText"),
                (text) => text === originalText,
                { timeout: 10000 },
            );
            ctx.expect(restoredText).toBe(originalText);
            ctx.expect(restoredText.includes("Fixture translation:")).toBe(false);
        } finally {
            await closePage(ctx, pageId);
            await untrustBoard(ctx, root);
            try { await ctx.app.settings.set("browser-translate-target", originalTarget); } catch { /* Cleanup must not hide the test result. */ }
        }
    }, { requires: ["launch"] }),
];
