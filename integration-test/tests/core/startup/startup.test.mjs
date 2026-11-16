import { test } from "../../../lib/context.mjs";

export default [
    test("fresh profile opens a ready window with one default page", async (ctx) => {
        // This is first after the module app starts, so the profile has not yet gained pages from other tests.
        const pages = await ctx.call("pages.all");
        ctx.expect(pages.length).toBe(1);
        ctx.expect(pages[0].title).toBe("untitled");
        ctx.expect(pages[0].editor).toBe("monaco");

        const title = await ctx.call("window.screen.evaluate", ["() => document.title"]);
        ctx.expect(title).toBe("Persephone — uitest");
        const snapshot = await ctx.callText("window.screen.snapshot", []);
        ctx.expect(snapshot).toContain('StaticText "— uitest"');
        ctx.expect(snapshot).toContain('textbox "Editor content"');
    }, { requires: ["launch"] }),

    test("second launch with a file opens it in the existing window", async (ctx) => {
        const filePath = ctx.fixture("us-2028/second-instance/file.txt");
        await ctx.call("fs.write", [filePath, "Opened by the second launch.\n"]);

        let openedPage;
        try {
            ctx.expect(await ctx.launchSecondInstance([filePath])).toBe(0);
            const pages = await ctx.waitFor(
                (activeContext) => activeContext.call("pages.all"),
                (currentPages) => currentPages.find((page) => page.title === "file.txt"),
            );
            openedPage = pages.find((page) => page.title === "file.txt");

            ctx.expect(await ctx.call("windows.count")).toBe(1);
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(openedPage.id)}].content`)).toBe("Opened by the second launch.\n");
        } finally {
            const page = openedPage ?? (await ctx.call("pages.all")).find((entry) => entry.title === "file.txt");
            if (page) await ctx.call("pages.closePage", [page.id]);
        }
    }, { requires: ["launch"] }),

    test("second launch without arguments keeps one responsive window", async (ctx) => {
        ctx.expect(await ctx.launchSecondInstance()).toBe(0);
        ctx.expect(await ctx.waitFor("windows.count", (count) => count === 1)).toBe(1);
        ctx.expect((await ctx.call("pages.all")).length > 0).toBe(true);
    }, { requires: ["launch"] }),

    test("window maximize and restore state follows each action", async (ctx) => {
        const wasMaximized = await ctx.call("window.isMaximized");
        try {
            if (wasMaximized) {
                await ctx.call("window.restore", []);
                await ctx.waitFor("window.isMaximized", (value) => value === false);
            }

            await ctx.call("window.maximize", []);
            ctx.expect(await ctx.waitFor("window.isMaximized", (value) => value === true)).toBe(true);

            await ctx.call("window.restore", []);
            ctx.expect(await ctx.waitFor("window.isMaximized", (value) => value === false)).toBe(false);
        } finally {
            if (wasMaximized) {
                await ctx.call("window.maximize", []);
                await ctx.waitFor("window.isMaximized", (value) => value === true);
            }
        }
    }),

    test("last page can close while the window creates a usable page", async (ctx) => {
        const pagesBefore = await ctx.call("pages.all");
        ctx.expect(pagesBefore.length > 0).toBe(true);
        const closedPageIds = new Set(pagesBefore.map((page) => page.id));
        for (const page of pagesBefore) {
            ctx.expect(await ctx.call("pages.closePage", [page.id])).toBe(true);
        }

        const remainingPages = await ctx.waitFor(
            "pages.all",
            (pages) => pages.length === 1 && !closedPageIds.has(pages[0].id),
        );
        ctx.expect(remainingPages[0].editor).toBe("monaco");

        const snapshot = await ctx.callText("window.screen.snapshot", []);
        ctx.expect(snapshot).toContain('textbox "Editor content"');
    }),

    test("window size and position survive an app restart", async (ctx) => {
        const bounds = () => ctx.call("window.screen.evaluate", [
            "() => ({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight })",
        ]);
        if (await ctx.call("window.isMaximized")) {
            await ctx.call("window.restore", []);
            await ctx.waitFor("window.isMaximized", (value) => value === false);
        }

        const before = await bounds();
        ctx.expect(before.width > 0 && before.height > 0).toBe(true);
        const paths = await ctx.call("main.runtime.paths");
        const configPath = `${paths.userData}\\config.json`;
        const readSavedBounds = async (activeContext) => {
            const text = await activeContext.callText("fs.read", [configPath], { maxLength: 1024 });
            const match = text.match(/"windowState"\s*:\s*({[^}]+})/);
            if (!match) throw new Error("The profile config did not expose saved window bounds.");
            return JSON.parse(match[1]);
        };
        const savedBefore = await readSavedBounds(ctx);

        await ctx.call("window.screen.evaluate", ["() => window.resizeTo(900, 600)"]);
        await ctx.call("window.moveToDisplay", ["primary", { maximize: false, fullscreen: false }]);
        const changed = await ctx.waitFor(
            bounds,
            (value) => value.width !== before.width || value.height !== before.height
                || value.x !== before.x || value.y !== before.y,
        );
        ctx.expect(changed.width !== before.width || changed.height !== before.height).toBe(true);
        ctx.expect(changed.x !== before.x || changed.y !== before.y).toBe(true);
        await ctx.waitFor(
            readSavedBounds,
            (saved) => saved.width !== savedBefore.width || saved.height !== savedBefore.height
                || saved.x !== savedBefore.x || saved.y !== savedBefore.y,
        );

        await ctx.restartApp();
        const after = await ctx.waitFor(bounds, (value) => value.width > 0 && value.height > 0);
        // The app saves DIP bounds; the renderer reads them back through the display scale factor
        // (125% on a typical laptop), which can round a restored edge by 1 px either way.
        for (const key of ["x", "y", "width", "height"]) {
            ctx.expect(Math.abs(after[key] - changed[key]) <= 1).toBe(true);
        }
    }, { requires: ["launch"] }),
];
