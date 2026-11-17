import { test } from "../../../lib/context.mjs";
import { closeOwnedPages, pressWindowShortcut } from "../../helpers/shell-helpers.mjs";

const guideSourcePath = "../../../../assets/guides/editors/grid.md";
const guideAnchor = 'a[href="persephone-guide://editors/grid"]';

async function waitForAbout(ctx) {
    return ctx.waitFor(
        (activeContext) => activeContext.app.pages.all,
        (pages) => pages.find((page) => page.id === "about-page" && page.editor === "about-view"),
    );
}

async function waitForAboutLocation(ctx, expected) {
    return ctx.waitFor(
        (activeContext) => activeContext.app.pages["about-page"].editor.current,
        (current) => JSON.stringify(current) === JSON.stringify(expected),
    );
}

export default [
    test("About opens from the Menu Bar with its version card and guide browser", async (ctx) => {
        const initialPages = await ctx.app.pages.all;
        const hadAboutPage = initialPages.some((page) => page.id === "about-page");
        try {
            await ctx.app.window.menuBar.open();
            await ctx.waitFor((activeContext) => activeContext.app.window.menuBar.isOpen, Boolean);
            await ctx.app.window.screen.click('[data-name="menubar-about"]');
            await waitForAbout(ctx);

            await ctx.app.window.screen.waitFor({ selector: '[data-name="about-root"]' });
            await ctx.app.window.screen.waitFor({ selector: '[data-name="about-card"]' });
            await ctx.app.window.screen.waitFor({ selector: '[data-name="about-guide-browser"]' });

            ctx.expect(await ctx.app.pages["about-page"].editor.id).toBe("about-view");
            const visibleElements = (await ctx.app.pages["about-page"].editor.elements)
                .filter((element) => element.visible)
                .map((element) => element.name);
            for (const elementName of ["about-root", "about-card", "about-guide-browser"]) {
                ctx.expect(visibleElements).toContain(elementName);
            }

            const version = await ctx.app.version;
            const snapshot = await ctx.app.window.screen.snapshot();
            ctx.expect(snapshot).toContain(version);
        } finally {
            if (await ctx.app.window.menuBar.isOpen) await ctx.app.window.menuBar.close();
            if (!hadAboutPage) await closeOwnedPages(ctx, ["about-page"]);
        }
    }),

    test("F1 opens the active grid editor guide when focus is outside Monaco", async (ctx) => {
        const initialPages = await ctx.app.pages.all;
        const initialPageIds = new Set(initialPages.map((page) => page.id));
        const hadAboutPage = initialPageIds.has("about-page");
        let gridPageId;
        let f1LocationReached = false;
        try {
            const page = await ctx.app.pages.addEditorPage("grid-json", "json", "us-2068-grid", '[{"label":"alpha"}]\n');
            gridPageId = page.id;
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.id,
                (editorId) => editorId === "grid-json",
            );
            await ctx.app.pages.showPage(page.id);

            await pressWindowShortcut(ctx, "F1");
            await waitForAbout(ctx);
            const location = { kind: "guide", path: "editors/grid" };
            ctx.expect(await waitForAboutLocation(ctx, location)).toEqual(location);
            f1LocationReached = true;
            await ctx.app.window.screen.waitFor({ selector: '[data-name="about-guide-body"]' });

            const snapshot = await ctx.app.window.screen.snapshot({ root: '[data-name="about-guide-browser"]' });
            ctx.expect(snapshot).toContain("Grid Editor");
        } finally {
            await closeOwnedPages(ctx, [gridPageId]);
            if (!hadAboutPage) {
                await closeOwnedPages(ctx, ["about-page"]);
            } else if (f1LocationReached) {
                // F1 pushes the previous About location before opening the mapped guide.
                await ctx.app.pages["about-page"].editor.back();
            }
            const remaining = await ctx.app.pages.all;
            const unexpected = remaining.filter((page) => !initialPageIds.has(page.id)).map((page) => page.id);
            await closeOwnedPages(ctx, unexpected);
        }
    }),

    test("About opens a guide, follows its link, and returns with back", async (ctx) => {
        const initialPages = await ctx.app.pages.all;
        const initialPageIds = new Set(initialPages.map((page) => page.id));
        const hadAboutPage = initialPageIds.has("about-page");
        let originalLocation;
        let aboutNavigated = false;
        try {
            await ctx.app.pages.showAboutPage();
            await waitForAbout(ctx);
            const editor = ctx.app.pages["about-page"].editor;
            originalLocation = await editor.current;

            await editor.open("editors/index");
            const indexLocation = { kind: "guide", path: "editors/index" };
            ctx.expect(await waitForAboutLocation(ctx, indexLocation)).toEqual(indexLocation);
            aboutNavigated = true;
            await ctx.app.window.screen.waitFor({ selector: '[data-name="about-guide-body"]' });
            await ctx.app.window.screen.waitFor({ selector: guideAnchor });

            const pageIdsBeforeLink = new Set((await ctx.app.pages.all).map((page) => page.id));
            // editors/index links to the Grid guide twice (table and list); take the first.
            await ctx.app.window.screen.click(guideAnchor, { nth: 0 });
            const gridLocation = { kind: "guide", path: "editors/grid" };
            ctx.expect(await waitForAboutLocation(ctx, gridLocation)).toEqual(gridLocation);
            aboutNavigated = true;
            ctx.expect((await ctx.app.pages.all).every((page) => pageIdsBeforeLink.has(page.id))).toBe(true);

            await editor.back();
            ctx.expect(await waitForAboutLocation(ctx, indexLocation)).toEqual(indexLocation);
        } finally {
            if (!hadAboutPage) {
                await closeOwnedPages(ctx, ["about-page"]);
            } else if (originalLocation && aboutNavigated) {
                // Return through at most the two locations this test can add.
                for (let attempt = 0; attempt < 2; attempt++) {
                    const current = await ctx.app.pages["about-page"].editor.current;
                    if (JSON.stringify(current) === JSON.stringify(originalLocation)) break;
                    await ctx.app.pages["about-page"].editor.back();
                }
                ctx.expect(await waitForAboutLocation(ctx, originalLocation)).toEqual(originalLocation);
            }
            const remaining = await ctx.app.pages.all;
            await closeOwnedPages(ctx, remaining.filter((page) => !initialPageIds.has(page.id)).map((page) => page.id));
        }
    }),

    test("pages.openUrl opens a guide as a Markdown tab", async (ctx) => {
        const initialPages = await ctx.app.pages.all;
        const initialPageIds = new Set(initialPages.map((page) => page.id));
        let guidePageId;
        try {
            await ctx.app.pages.openUrl("persephone-guide://editors/grid");
            guidePageId = await ctx.waitFor(async (activeContext) => {
                const pages = await activeContext.app.pages.all;
                for (const page of pages) {
                    if (!initialPageIds.has(page.id) && await activeContext.app.pages[page.id].editor.id === "md-view") {
                        return page.id;
                    }
                }
                return undefined;
            }, Boolean);

            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[guidePageId].content,
                (content) => content.includes("# Grid Editor"),
            )).toContain("# Grid Editor");
            ctx.expect(await ctx.app.pages[guidePageId].editor.id).toBe("md-view");
        } finally {
            await closeOwnedPages(ctx, [guidePageId]);
            const remaining = await ctx.app.pages.all;
            await closeOwnedPages(ctx, remaining.filter((page) => !initialPageIds.has(page.id)).map((page) => page.id));
        }
    }),

    test("guides page reads equal the shipped body after front matter", async (ctx) => {
        const sourcePath = ctx.file(guideSourcePath);
        const source = await ctx.app.fs.read(sourcePath);
        const frontMatter = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/);
        ctx.expect(Boolean(frontMatter)).toBe(true);
        const shippedBody = frontMatter ? source.slice(frontMatter[0].length) : source;

        const guideText = await ctx.callText('guides["editors/grid"]');
        ctx.expect(guideText).toBe(shippedBody);
        ctx.expect(guideText.trimStart().startsWith("# Grid Editor")).toBe(true);
    }),
];
